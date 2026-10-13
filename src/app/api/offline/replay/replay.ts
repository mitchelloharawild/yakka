/**
 * Server side of the offline completion queue. See protocol.ts for the wire
 * format and src/lib/client/offline-queue.ts for the client.
 *
 * Idempotency. A replay can arrive more than once (the response was lost, the
 * service worker and a tab replayed concurrently, Background Sync retried).
 * Two layers make that harmless:
 *
 * 1. Exact match: a completion of the same chore by the same member from the
 *    same device with the same `completedAt` (to the millisecond) is treated
 *    as this item, even if it was undone since. The client stamps
 *    `completedAt` once, when the item is queued, so this identifies a replay
 *    of the same tap without needing a column for the client id.
 * 2. completeChore()'s debounce: any non-undone completion of the chore within
 *    `group.debounceMinutes` of `completedAt` is returned instead
 *    (serializable transaction, so concurrent replays create one row).
 *
 * The client id is only echoed back so the client knows which queue entry a
 * result belongs to; it is not stored.
 */
import "server-only";
import type { CompletionSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { isPlausibleTagToken } from "@/lib/ids";
import { completeChore } from "@/lib/services/completions";
import { replayItemSchema, type ReplayItem, type ReplayResult } from "./protocol";

/** Validate and replay one queued completion. Never throws. */
export async function replayItem(raw: unknown): Promise<ReplayResult> {
  const id = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id.slice(0, 64) : "";
  const parsed = replayItemSchema.safeParse(raw);
  if (!parsed.success) return { id, status: "rejected", reason: "INVALID_ITEM" };
  const item = parsed.data;
  try {
    return await replayValid(item);
  } catch (e) {
    if (e instanceof DomainError) return { id: item.id, status: "rejected", reason: e.reason };
    console.error("offline replay failed", e);
    return { id: item.id, status: "retry", reason: "SERVER_ERROR" };
  }
}

async function replayValid(item: ReplayItem): Promise<ReplayResult> {
  let target: { choreId: string; groupId: string; tagId: string | null; source: CompletionSource };
  if (item.kind === "tag") {
    if (!isPlausibleTagToken(item.token)) return { id: item.id, status: "rejected", reason: "TAG_NOT_FOUND" };
    const tag = await prisma.tag.findUnique({
      where: { token: item.token },
      select: { id: true, choreId: true, groupId: true, revokedAt: true, group: { select: { deletedAt: true } } },
    });
    if (!tag || tag.group.deletedAt) return { id: item.id, status: "rejected", reason: "TAG_NOT_FOUND" };
    if (tag.revokedAt) return { id: item.id, status: "rejected", reason: "TAG_REVOKED" };
    if (item.choreId && item.choreId !== tag.choreId) {
      return { id: item.id, status: "rejected", reason: "TAG_CHORE_MISMATCH" };
    }
    target = { choreId: tag.choreId, groupId: tag.groupId, tagId: tag.id, source: "TAG" };
  } else {
    target = { choreId: item.choreId, groupId: item.groupId, tagId: null, source: "MANUAL" };
  }

  const completedAt = new Date(item.completedAt);
  const existing = await prisma.completion.findFirst({
    where: {
      choreId: target.choreId,
      memberId: item.memberId,
      deviceId: item.deviceId,
      completedAt,
      chore: { groupId: target.groupId },
    },
    select: { id: true },
  });
  if (existing) return { id: item.id, status: "duplicate", completionId: existing.id };

  // completeChore checks the member belongs to the group, the chore isn't
  // archived, the tag still matches and completedAt is within 14 days.
  const result = await completeChore({
    choreId: target.choreId,
    groupId: target.groupId,
    memberId: item.memberId,
    deviceId: item.deviceId,
    tagId: target.tagId,
    source: target.source,
    completedAt,
  });
  return {
    id: item.id,
    status: result.deduplicated ? "duplicate" : "created",
    completionId: result.completion.id,
  };
}
