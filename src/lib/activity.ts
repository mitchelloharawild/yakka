import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";

/**
 * All Activity.type values. Add new ones here (keep `<entity>.<verb>`), and
 * a translation under `activity.<type>` in messages/en/group.json.
 */
export const ACTIVITY_TYPES = [
  "group.created",
  "group.updated",
  "group.deleted",
  "group.imported",
  "member.created",
  "member.updated",
  "member.archived",
  "member.restored",
  "chore.created",
  "chore.updated",
  "chore.archived",
  "chore.restored",
  "completion.created",
  "completion.undone",
  "tag.created",
  "tag.updated",
  "tag.revoked",
  "apiToken.created",
  "apiToken.revoked",
  "inboundHook.created",
  "inboundHook.revoked",
  "webhook.created",
  "webhook.updated",
  "webhook.deleted",
  "webhook.disabled",
] as const;

/** An Activity.type value. */
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Who performed an action, as far as we know (no accounts: both optional). */
export interface Actor {
  /** The member the browser says it is (from localStorage). */
  memberId?: string | null;
  /** localStorage deviceId of the browser. */
  deviceId?: string | null;
}

/** Arguments for logActivity(). */
export interface LogActivityInput {
  groupId: string;
  type: ActivityType;
  actor?: Actor;
  choreId?: string | null;
  /** Small JSON blob for rendering the entry, e.g. `{ title }` or `{ from, to }`. */
  data?: Prisma.InputJsonValue;
}

/** Append an entry to the group's audit log. Pass the transaction client when inside one. */
export async function logActivity(db: Db, input: LogActivityInput) {
  return db.activity.create({
    data: {
      groupId: input.groupId,
      type: input.type,
      memberId: input.actor?.memberId ?? null,
      deviceId: input.actor?.deviceId ?? null,
      choreId: input.choreId ?? null,
      data: input.data,
    },
  });
}

/** Page of activity, newest first. `cursor` is the id of the last entry of the previous page. */
export async function listActivity(
  db: Db,
  input: { groupId: string; limit?: number; cursor?: string | null; choreId?: string },
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.activity.findMany({
    where: { groupId: input.groupId, ...(input.choreId ? { choreId: input.choreId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
