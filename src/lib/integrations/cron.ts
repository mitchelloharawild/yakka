/**
 * Periodic jobs. OWNED BY: Agent C.
 *
 * runCronTick() is called every 5 minutes, either by `/api/cron/tick`
 * (Vercel Cron or any external scheduler) or in-process from node-cron in
 * the Docker image (Agent D). It:
 *  1. finds chores that became due/overdue since the previous run, records a
 *     ChoreNotice per (chore, kind, dueAt) — the unique key makes this
 *     idempotent across overlapping or concurrent runs — and, only for newly
 *     inserted notices, emits chore.due / chore.overdue and sends Web Push
 *     (plus ntfy/Apprise if configured);
 *  2. delivers due outbound webhook rows (new events and retries);
 *  3. purges soft-deleted groups older than 30 days and old queue rows.
 *
 * The look-back window starts at the last successful tick, which is kept in
 * the database (SystemState "cron.lastTickAt") so serverless cold starts and
 * restarts don't lose it, clamped to [15 min, 24 h] ago: an infrequent
 * external scheduler (or the Vercel Hobby plan's daily cron) still sees
 * every transition, and a first run or a long outage doesn't flood people
 * with day-old notices.
 */
import { createTranslator } from "next-intl";
import { Prisma } from "@/generated/prisma/client";
import { currentAssigneeId } from "@/lib/assignee";
import { prisma } from "@/lib/db";
import { emitEvent } from "@/lib/events";
import { sendExternalNotice } from "@/lib/integrations/notify";
import { sendPushToGroup, type PushPayload, type PushResult } from "@/lib/integrations/push";
import { processDueDeliveries, type DeliveryRunResult } from "@/lib/integrations/webhooks";
import { SCHEDULE_HISTORY, scheduleTransitions, type ScheduleTransition } from "@/lib/schedule";
import messages from "../../../messages/en/integrations.json";

/** Minimum look-back window: covers a 5-minute schedule with slack for late runs. */
export const MIN_LOOKBACK_MS = 15 * 60_000;
/** Maximum look-back window (after downtime we don't notify about older transitions). */
export const MAX_LOOKBACK_MS = 24 * 60 * 60_000;
/** SystemState key holding the ISO time of the last successful tick. */
export const LAST_TICK_KEY = "cron.lastTickAt";
/** Soft-deleted groups are purged after this long. */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60_000;
/** Finished webhook deliveries are pruned after this long. */
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** ChoreNotices are pruned after this long (far beyond any look-back window). */
const NOTICE_RETENTION_MS = 90 * 24 * 60 * 60_000;

const GROUP_PAGE = 100;

/** Result of runCronTick(). */
export interface CronTickResult {
  since: string;
  now: string;
  choresChecked: number;
  notices: number;
  events: number;
  push: Pick<PushResult, "sent" | "failed" | "removed">;
  deliveries: DeliveryRunResult;
  purged: { groups: number; deliveries: number; notices: number };
  durationMs: number;
}

/** Fallback when the database can't be read/written (same process only). */
let lastRunAt: Date | undefined;

const t = createTranslator({ locale: "en", messages: { integrations: messages }, namespace: "integrations.push" });

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Run all periodic jobs once. `since` defaults to the previous successful
 * run (persisted in SystemState), clamped to [15 min, 24 h] ago, so a missed
 * tick is caught up and overlapping windows are harmless (ChoreNotice).
 */
export async function runCronTick(opts: { now?: Date; since?: Date } = {}): Promise<CronTickResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const since = opts.since ?? lookbackSince(now, await readLastTick());

  const notices = await detectDueNotices({ since, now });
  // Only a tick whose detection finished moves the window forward.
  await writeLastTick(now);
  const deliveries = await processDueDeliveries({ now: new Date() });
  const purged = await purgeExpired(now);

  return {
    since: since.toISOString(),
    now: now.toISOString(),
    ...notices,
    deliveries,
    purged,
    durationMs: Date.now() - started,
  };
}

/** Start of the look-back window: the previous tick, clamped to [MIN_LOOKBACK_MS, MAX_LOOKBACK_MS] before `now`. */
export function lookbackSince(now: Date, previous: Date | null | undefined): Date {
  const prev = previous?.getTime() ?? now.getTime();
  const lookback = Math.min(Math.max(now.getTime() - prev, MIN_LOOKBACK_MS), MAX_LOOKBACK_MS);
  return new Date(now.getTime() - lookback);
}

async function readLastTick(): Promise<Date | undefined> {
  try {
    const row = await prisma.systemState.findUnique({ where: { key: LAST_TICK_KEY } });
    const at = row ? new Date(row.value) : undefined;
    return at && !Number.isNaN(at.getTime()) ? at : lastRunAt;
  } catch (err) {
    console.error("[cron] could not read the last tick time", err);
    return lastRunAt;
  }
}

async function writeLastTick(now: Date): Promise<void> {
  lastRunAt = now;
  try {
    await prisma.systemState.upsert({
      where: { key: LAST_TICK_KEY },
      create: { key: LAST_TICK_KEY, value: now.toISOString() },
      update: { value: now.toISOString() },
    });
  } catch (err) {
    console.error("[cron] could not save the last tick time", err);
  }
}

/** Step 1: due/overdue detection and notification. */
export async function detectDueNotices(input: { since: Date; now: Date }) {
  const { since, now } = input;
  const out = { choresChecked: 0, notices: 0, events: 0, push: { sent: 0, failed: 0, removed: 0 } };
  const scheduledChore = { archivedAt: null, OR: [{ rrule: { not: null } }, { startsAt: { not: null } }] };

  let cursor: string | undefined;
  for (;;) {
    const groups = await prisma.group.findMany({
      where: { deletedAt: null, chores: { some: scheduledChore } },
      orderBy: { id: "asc" },
      take: GROUP_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        members: true,
        chores: {
          where: scheduledChore,
          include: {
            completions: {
              where: { undoneAt: null },
              orderBy: [{ completedAt: "desc" }, { id: "desc" }],
              take: 1 + SCHEDULE_HISTORY,
              include: { member: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (groups.length === 0) break;
    cursor = groups[groups.length - 1].id;

    for (const group of groups) {
      for (const { completions, ...chore } of group.chores) {
        out.choresChecked++;
        const lastCompletion = completions[0] ?? null;
        let transitions: ScheduleTransition[];
        try {
          transitions = scheduleTransitions({
            chore,
            timezone: group.timezone,
            lastCompletion,
            previousCompletions: completions.slice(1),
            completeHistory: completions.length < 1 + SCHEDULE_HISTORY,
            since,
            now,
          });
        } catch (err) {
          console.error(`[cron] schedule failed for chore ${chore.id}`, err);
          continue;
        }
        if (transitions.length === 0) continue;

        const fresh: ScheduleTransition[] = [];
        for (const tr of transitions) {
          try {
            await prisma.choreNotice.create({
              data: { choreId: chore.id, kind: tr.kind === "due" ? "DUE" : "OVERDUE", dueAt: tr.dueAt },
            });
            fresh.push(tr);
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
          }
        }
        if (fresh.length === 0) continue;
        out.notices += fresh.length;

        const assigneeId = currentAssigneeId({
          chore,
          members: group.members,
          lastCompletedBy: lastCompletion?.memberId ?? null,
        });
        const assignee = group.members.find((m) => m.id === assigneeId) ?? null;
        const choreRef = { id: chore.id, title: chore.title, icon: chore.icon };

        for (const tr of fresh) {
          const overdueAt = new Date(tr.dueAt.getTime() + chore.graceMinutes * 60_000);
          await emitEvent(tr.kind === "due" ? "chore.due" : "chore.overdue", {
            group,
            data: {
              chore: choreRef,
              dueAt: tr.dueAt.toISOString(),
              overdueAt: overdueAt.toISOString(),
              assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
            },
          });
          out.events++;
        }

        // One push per chore per run: with grace 0 "due" and "overdue" coincide.
        const kind =
          fresh.length > 1 ? (chore.graceMinutes === 0 ? "due" : "overdue") : fresh[0].kind;
        const title = chore.icon && !/^[a-z0-9-]+$/i.test(chore.icon) ? `${chore.icon} ${chore.title}` : chore.title;
        const payload: PushPayload = {
          title,
          body: assignee
            ? t(kind === "due" ? "dueAssigned" : "overdueAssigned", { name: assignee.name })
            : t(kind === "due" ? "due" : "overdue"),
          url: `/groups/${group.id}`,
          tag: `chore-${chore.id}`,
        };
        const targeted = chore.assigneeMode !== "ANYONE" && assignee ? [assignee.id] : undefined;
        try {
          const res = await sendPushToGroup(group.id, payload, { memberIds: targeted });
          out.push.sent += res.sent;
          out.push.failed += res.failed;
          out.push.removed += res.removed;
        } catch (err) {
          console.error("[cron] push failed", err);
        }
        await sendExternalNotice({ ...payload, priority: kind === "overdue" ? "high" : "default" });
      }
    }
    if (groups.length < GROUP_PAGE) break;
  }
  return out;
}

/** Hard-delete groups soft-deleted more than 30 days ago (cascades to everything in them). */
export async function purgeDeletedGroups(now = new Date()): Promise<number> {
  const res = await prisma.group.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - PURGE_AFTER_MS) } } });
  return res.count;
}

/** Step 3: purge expired groups, finished deliveries and old notices. */
export async function purgeExpired(now = new Date()) {
  const groups = await purgeDeletedGroups(now);
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_MS);
  const deliveries = await prisma.webhookDelivery.deleteMany({
    where: { OR: [{ deliveredAt: { lt: cutoff } }, { failedAt: { lt: cutoff } }] },
  });
  const notices = await prisma.choreNotice.deleteMany({
    where: { sentAt: { lt: new Date(now.getTime() - NOTICE_RETENTION_MS) } },
  });
  return { groups, deliveries: deliveries.count, notices: notices.count };
}
