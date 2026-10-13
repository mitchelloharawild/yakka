import { Prisma, type CompletionSource } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { DomainError, notFound } from "@/lib/errors";
import { emitEvent } from "@/lib/events";
import { getChoreView, type ChoreView, type CompletionWithMember } from "@/lib/services/chores";

/** How far in the future a client-supplied completedAt may be (clock skew). */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** How far back a client-supplied completedAt may be (offline queue replays). */
const MAX_BACKDATE_MS = 14 * 24 * 60 * 60_000;

/** Input of completeChore(). */
export interface CompleteChoreInput {
  choreId: string;
  /** If given, the chore must belong to this group (NOT_FOUND otherwise). Always pass it when you have it. */
  groupId?: string;
  /** Who did it; null/undefined = unknown or an automation. Must be an active member of the group. */
  memberId?: string | null;
  source: CompletionSource;
  /** Tag that was scanned; must belong to the chore and not be revoked. */
  tagId?: string | null;
  deviceId?: string | null;
  note?: string | null;
  /** When it was done (defaults to now). Used by offline replays; clamped to [now-14d, now+5min]. */
  completedAt?: Date;
  /** Override "now" (tests). */
  now?: Date;
}

/** Result of completeChore(). */
export interface CompleteChoreResult {
  completion: CompletionWithMember;
  /** True when an existing completion within the debounce window was returned instead of creating one. */
  deduplicated: boolean;
  /** The chore after the completion, with its new schedule. */
  chore: ChoreView;
}

function isSerializationFailure(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}

/**
 * Record that a chore was done.
 *
 * Debounce: if a non-undone completion of the same chore exists within
 * `group.debounceMinutes` of `completedAt` (either side), that completion is
 * returned with `deduplicated: true` and nothing is written. This absorbs
 * NFC double-reads, double taps and offline replays of the same tap. The
 * check runs in a serializable transaction (retried on conflict), so two
 * concurrent requests cannot both create a completion.
 *
 * Writes a `completion.created` Activity and emits `chore.completed` (only
 * when a new completion was created).
 *
 * Errors (DomainError): NOT_FOUND CHORE_NOT_FOUND / MEMBER_NOT_FOUND /
 * TAG_NOT_FOUND; BAD_REQUEST CHORE_ARCHIVED / MEMBER_ARCHIVED /
 * COMPLETED_AT_OUT_OF_RANGE; FORBIDDEN TAG_REVOKED.
 */
export async function completeChore(input: CompleteChoreInput): Promise<CompleteChoreResult> {
  const now = input.now ?? new Date();
  const completedAt = input.completedAt ?? now;
  if (
    completedAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS ||
    completedAt.getTime() < now.getTime() - MAX_BACKDATE_MS
  ) {
    throw new DomainError("BAD_REQUEST", "COMPLETED_AT_OUT_OF_RANGE");
  }

  const chore = await prisma.chore.findFirst({
    where: { id: input.choreId, ...(input.groupId ? { groupId: input.groupId } : {}), group: { deletedAt: null } },
    include: { group: true },
  });
  if (!chore) throw notFound("CHORE_NOT_FOUND");
  if (chore.archivedAt) throw new DomainError("BAD_REQUEST", "CHORE_ARCHIVED");
  const group = chore.group;

  if (input.memberId) {
    const member = await prisma.member.findFirst({ where: { id: input.memberId, groupId: group.id } });
    if (!member) throw notFound("MEMBER_NOT_FOUND");
    if (member.archivedAt) throw new DomainError("BAD_REQUEST", "MEMBER_ARCHIVED");
  }
  if (input.tagId) {
    const tag = await prisma.tag.findFirst({ where: { id: input.tagId, choreId: chore.id } });
    if (!tag) throw notFound("TAG_NOT_FOUND");
    if (tag.revokedAt) throw new DomainError("FORBIDDEN", "TAG_REVOKED");
  }

  const windowMs = group.debounceMinutes * 60_000;
  const include = { member: { select: { id: true, name: true, colour: true } } } as const;

  let result: { completion: CompletionWithMember; deduplicated: boolean } | undefined;
  for (let attempt = 0; attempt < 5 && !result; attempt++) {
    try {
      result = await prisma.$transaction(
        async (tx) => {
          if (windowMs > 0) {
            const existing = await tx.completion.findFirst({
              where: {
                choreId: chore.id,
                undoneAt: null,
                completedAt: {
                  gte: new Date(completedAt.getTime() - windowMs),
                  lte: new Date(completedAt.getTime() + windowMs),
                },
              },
              orderBy: { completedAt: "desc" },
              include,
            });
            if (existing) return { completion: existing, deduplicated: true };
          }
          const completion = await tx.completion.create({
            data: {
              choreId: chore.id,
              memberId: input.memberId ?? null,
              source: input.source,
              tagId: input.tagId ?? null,
              deviceId: input.deviceId ?? null,
              note: input.note ?? null,
              completedAt,
              createdAt: now,
            },
            include,
          });
          if (input.tagId) await tx.tag.update({ where: { id: input.tagId }, data: { lastUsedAt: now } });
          await logActivity(tx, {
            groupId: group.id,
            type: "completion.created",
            actor: { memberId: input.memberId, deviceId: input.deviceId },
            choreId: chore.id,
            data: { completionId: completion.id, title: chore.title, source: input.source, tagId: input.tagId ?? null },
          });
          return { completion, deduplicated: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (!isSerializationFailure(err)) throw err;
    }
  }
  if (!result) throw new DomainError("CONFLICT", "COMPLETION_CONFLICT");

  const view = await getChoreView(chore.id, { now });

  if (!result.deduplicated) {
    const c = result.completion;
    await emitEvent("chore.completed", {
      group,
      data: {
        chore: { id: chore.id, title: chore.title, icon: chore.icon },
        completion: {
          id: c.id,
          source: c.source,
          completedAt: c.completedAt.toISOString(),
          member: c.member ? { id: c.member.id, name: c.member.name } : null,
          tagId: c.tagId,
        },
        nextDueAt: view.schedule.nextDueAt?.toISOString() ?? null,
      },
    });
  }

  return { ...result, chore: view };
}

/** Input of undoCompletion(). */
export interface UndoCompletionInput {
  completionId: string;
  /** The completion's chore must belong to this group. */
  groupId: string;
  actor?: Actor;
  /**
   * true: only allowed within `group.undoSeconds` of when the completion was
   * recorded (the tap-to-complete page). false: always allowed (the group UI,
   * which has full access anyway).
   */
  enforceWindow: boolean;
  now?: Date;
}

/**
 * Undo a completion (sets undoneAt; the row is kept for the audit log).
 * Idempotent: undoing an already-undone completion returns it unchanged
 * with `alreadyUndone: true`. Writes `completion.undone` and emits
 * `chore.undone`.
 *
 * Errors: NOT_FOUND COMPLETION_NOT_FOUND; FORBIDDEN UNDO_WINDOW_EXPIRED.
 */
export async function undoCompletion(input: UndoCompletionInput) {
  const now = input.now ?? new Date();
  const existing = await prisma.completion.findFirst({
    where: { id: input.completionId, chore: { groupId: input.groupId, group: { deletedAt: null } } },
    include: { chore: { include: { group: true } }, member: { select: { id: true, name: true, colour: true } } },
  });
  if (!existing) throw notFound("COMPLETION_NOT_FOUND");
  const { chore } = existing;
  const group = chore.group;

  if (existing.undoneAt) {
    return { completion: existing, alreadyUndone: true, chore: await getChoreView(chore.id, { now }) };
  }
  if (input.enforceWindow && now.getTime() - existing.createdAt.getTime() > group.undoSeconds * 1000) {
    throw new DomainError("FORBIDDEN", "UNDO_WINDOW_EXPIRED");
  }

  const completion = await prisma.$transaction(async (tx) => {
    const updated = await tx.completion.update({
      where: { id: existing.id },
      data: { undoneAt: now },
      include: { member: { select: { id: true, name: true, colour: true } } },
    });
    await logActivity(tx, {
      groupId: group.id,
      type: "completion.undone",
      actor: input.actor,
      choreId: chore.id,
      data: { completionId: existing.id, title: chore.title },
    });
    return updated;
  });

  const view = await getChoreView(chore.id, { now });
  await emitEvent("chore.undone", {
    group,
    data: {
      chore: { id: chore.id, title: chore.title, icon: chore.icon },
      completion: {
        id: completion.id,
        completedAt: completion.completedAt.toISOString(),
        undoneAt: now.toISOString(),
        member: completion.member ? { id: completion.member.id, name: completion.member.name } : null,
      },
      nextDueAt: view.schedule.nextDueAt?.toISOString() ?? null,
    },
  });

  return { completion, alreadyUndone: false, chore: view };
}

/** Page of completions for a group (optionally one chore/member), newest first. Includes undone ones unless excluded. */
export async function listCompletions(input: {
  groupId: string;
  choreId?: string;
  memberId?: string;
  includeUndone?: boolean;
  limit?: number;
  cursor?: string | null;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await prisma.completion.findMany({
    where: {
      chore: { groupId: input.groupId },
      ...(input.choreId ? { choreId: input.choreId } : {}),
      ...(input.memberId ? { memberId: input.memberId } : {}),
      ...(input.includeUndone === false ? { undoneAt: null } : {}),
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      member: { select: { id: true, name: true, colour: true } },
      chore: { select: { id: true, title: true, icon: true } },
    },
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Completion tallies per member (non-undone), optionally since a date. memberId null = automations. */
export async function completionTallies(groupId: string, since?: Date) {
  const rows = await prisma.completion.groupBy({
    by: ["memberId"],
    where: { chore: { groupId }, undoneAt: null, ...(since ? { completedAt: { gte: since } } : {}) },
    _count: { _all: true },
  });
  return rows.map((r) => ({ memberId: r.memberId, count: r._count._all }));
}
