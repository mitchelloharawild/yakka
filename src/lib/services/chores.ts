import { z } from "zod";
import type { Chore, Completion, Member, Prisma } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { currentAssigneeId } from "@/lib/assignee";
import { prisma, type Db } from "@/lib/db";
import { DomainError, notFound } from "@/lib/errors";
import { compareSchedules, computeSchedule, SCHEDULE_HISTORY, validateRRule, type Schedule } from "@/lib/schedule";
import { requireGroup } from "@/lib/services/groups";

/** A completion with its member (if any), as embedded in ChoreView. */
export type CompletionWithMember = Completion & { member: Pick<Member, "id" | "name" | "colour"> | null };

/**
 * A chore plus everything computed on read. This is what lists and detail
 * views render; `schedule.lastCompletion` is the latest non-undone completion.
 */
export type ChoreView = Chore & {
  schedule: Schedule<CompletionWithMember>;
  /** Whose turn it is (null = anyone). */
  currentAssigneeId: string | null;
};

const rruleSchema = z
  .string()
  .trim()
  .max(500)
  .transform((v, ctx) => {
    const res = validateRRule(v);
    if (!res.ok) {
      ctx.addIssue({ code: "custom", message: `Invalid RRULE: ${res.error}` });
      return z.NEVER;
    }
    return res.rrule;
  });

const choreFields = {
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullish(),
  icon: z.string().trim().max(64).nullish(),
  /** RRULE body, e.g. "FREQ=WEEKLY;BYDAY=MO"; null/omitted = one-off or unscheduled. */
  rrule: rruleSchema.nullish(),
  startsAt: z.coerce.date().nullish(),
  anchor: z.enum(["DUE_DATE", "COMPLETION"]).optional(),
  assigneeMode: z.enum(["ANYONE", "FIXED", "ROUND_ROBIN"]).optional(),
  assigneeId: z.string().nullish(),
  graceMinutes: z.number().int().min(0).max(60 * 24 * 31).optional(),
  sortOrder: z.number().int().optional(),
};

/** zod: input of createChore(). */
export const createChoreInput = z.object(choreFields);
/** zod: patch accepted by updateChore() (all fields optional; null clears). */
export const updateChoreInput = z.object(choreFields).partial();

/** The latest non-undone completion plus SCHEDULE_HISTORY before it (newest first). */
const lastCompletionInclude = {
  completions: {
    where: { undoneAt: null },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: 1 + SCHEDULE_HISTORY,
    include: { member: { select: { id: true, name: true, colour: true } } },
  },
} satisfies Prisma.ChoreInclude;

/**
 * Build a ChoreView from a chore row, its recent non-undone completions
 * (newest first: the last one plus up to SCHEDULE_HISTORY before it), the
 * group's members and timezone.
 */
export function toChoreView(
  chore: Chore,
  completions: CompletionWithMember[],
  ctx: { timezone: string; members: Member[]; now?: Date },
): ChoreView {
  const lastCompletion = completions[0] ?? null;
  const schedule = computeSchedule({
    chore,
    timezone: ctx.timezone,
    lastCompletion,
    previousCompletions: completions.slice(1),
    completeHistory: completions.length < 1 + SCHEDULE_HISTORY,
    now: ctx.now,
  });
  return {
    ...chore,
    schedule,
    currentAssigneeId: currentAssigneeId({
      chore,
      members: ctx.members,
      lastCompletedBy: lastCompletion?.memberId ?? null,
    }),
  };
}

/**
 * All chores of a group with computed schedule and assignee, sorted by
 * urgency (overdue, due, upcoming by date, unscheduled, done), then sortOrder.
 */
export async function listChores(
  groupId: string,
  opts: { includeArchived?: boolean; now?: Date } = {},
): Promise<ChoreView[]> {
  const group = await requireGroup(groupId);
  const [members, chores] = await Promise.all([
    prisma.member.findMany({ where: { groupId } }),
    prisma.chore.findMany({
      where: { groupId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
      include: lastCompletionInclude,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const views = chores.map(({ completions, ...chore }) =>
    toChoreView(chore, completions, { timezone: group.timezone, members, now: opts.now }),
  );
  return views.sort((a, b) => compareSchedules(a.schedule, b.schedule) || a.sortOrder - b.sortOrder);
}

/** One chore with computed schedule. `groupId` scopes the lookup (NOT_FOUND if it doesn't match). */
export async function getChoreView(
  choreId: string,
  opts: { groupId?: string; now?: Date; db?: Db } = {},
): Promise<ChoreView> {
  const db = opts.db ?? prisma;
  const chore = await db.chore.findFirst({
    where: { id: choreId, ...(opts.groupId ? { groupId: opts.groupId } : {}), group: { deletedAt: null } },
    include: { ...lastCompletionInclude, group: { include: { members: true } } },
  });
  if (!chore) throw notFound("CHORE_NOT_FOUND");
  const { completions, group, ...rest } = chore;
  return toChoreView(rest, completions, { timezone: group.timezone, members: group.members, now: opts.now });
}

async function assertAssignee(groupId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const m = await prisma.member.findFirst({ where: { id: assigneeId, groupId } });
  if (!m) throw new DomainError("BAD_REQUEST", "ASSIGNEE_NOT_IN_GROUP");
}

/** Create a chore. */
export async function createChore(groupId: string, input: z.input<typeof createChoreInput>, actor?: Actor) {
  const data = createChoreInput.parse(input);
  await requireGroup(groupId);
  await assertAssignee(groupId, data.assigneeId);
  const chore = await prisma.$transaction(async (tx) => {
    const chore = await tx.chore.create({ data: { ...data, groupId } });
    await logActivity(tx, { groupId, type: "chore.created", actor, choreId: chore.id, data: { title: chore.title } });
    return chore;
  });
  return getChoreView(chore.id);
}

/** Update a chore. */
export async function updateChore(
  groupId: string,
  choreId: string,
  patch: z.input<typeof updateChoreInput>,
  actor?: Actor,
) {
  const data = updateChoreInput.parse(patch);
  const before = await prisma.chore.findFirst({ where: { id: choreId, groupId } });
  if (!before) throw notFound("CHORE_NOT_FOUND");
  await assertAssignee(groupId, data.assigneeId);
  const changed = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
  await prisma.$transaction(async (tx) => {
    const chore = await tx.chore.update({ where: { id: choreId }, data });
    await logActivity(tx, { groupId, type: "chore.updated", actor, choreId, data: { title: chore.title, changed } });
  });
  return getChoreView(choreId);
}

/** Archive (true) or restore (false) a chore. Chores are never hard-deleted from the UI. */
export async function setChoreArchived(groupId: string, choreId: string, archived: boolean, actor?: Actor) {
  const before = await prisma.chore.findFirst({ where: { id: choreId, groupId } });
  if (!before) throw notFound("CHORE_NOT_FOUND");
  if (Boolean(before.archivedAt) !== archived) {
    await prisma.$transaction(async (tx) => {
      const chore = await tx.chore.update({
        where: { id: choreId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await logActivity(tx, {
        groupId,
        type: archived ? "chore.archived" : "chore.restored",
        actor,
        choreId,
        data: { title: chore.title },
      });
    });
  }
  return getChoreView(choreId);
}
