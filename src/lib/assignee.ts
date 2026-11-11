/**
 * Who is the current assignee of a chore. Pure (no DB access).
 *
 *  - ANYONE: nobody in particular (null).
 *  - FIXED: chore.assigneeId, unless that member is archived or missing.
 *  - ROUND_ROBIN: rotates over the group's non-archived members in the
 *    chore's rotation order (see rotationOrder). The member after whoever
 *    did the last (non-undone) completion is next, so if someone covers your
 *    turn the rotation carries on from them. If the last completer has since
 *    been archived, the rotation continues with the next active member after
 *    their place in the order (archived members keep their slot), so
 *    archiving someone doesn't reset it. Before any completion, or when the
 *    last completion has no member (automation) or an unknown one, it starts
 *    at chore.assigneeId if set and active, else the first member.
 */
import { z } from "zod";

/** Mirrors the Prisma AssigneeMode enum. */
export type AssigneeModeValue = "ANYONE" | "FIXED" | "ROUND_ROBIN";

/** Member fields needed for assignment (a Prisma Member satisfies this). */
export interface AssigneeMember {
  id: string;
  createdAt: Date;
  archivedAt: Date | null;
}

/** Input for currentAssigneeId(). */
export interface AssigneeInput {
  chore: {
    assigneeMode: AssigneeModeValue;
    assigneeId: string | null;
    /** Stored Chore.rotation (comma-separated member ids), or null for the default order. */
    rotation?: string | null;
  };
  /** All members of the group (archived ones are filtered out here). */
  members: AssigneeMember[];
  /** memberId of the latest non-undone completion (null for automations or none). */
  lastCompletedBy: string | null;
}

/** Most members a rotation lists (matches the import limit). */
export const ROTATION_MAX = 200;

/**
 * A chore's custom rotation order. Stored in Chore.rotation as comma-separated
 * member ids (portable across Postgres/SQLite, like Webhook.events); exposed
 * everywhere else as a string array. Never split by hand.
 */
export function parseRotation(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return [...new Set(stored.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Member ids → stored value (no ids → null, i.e. the default order). */
export function serializeRotation(ids: readonly string[]): string | null {
  const clean = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  return clean.length ? clean.join(",") : null;
}

/** zod: a rotation as accepted by the API (member ids, duplicates dropped). */
export const rotationSchema = z
  .array(z.string().trim().min(1).max(64).regex(/^[^,\s]+$/))
  .max(ROTATION_MAX)
  .transform((ids) => [...new Set(ids)]);

/**
 * Members (archived included) in rotation order: those listed in `rotation`
 * first, in that order, then everyone else by createdAt (then id), so a new
 * member joins at the end of an existing rotation. Ids in `rotation` that
 * aren't among `members` are ignored.
 */
export function rotationOrderAll<M extends AssigneeMember>(members: M[], rotation?: string | readonly string[] | null): M[] {
  const ids = typeof rotation === "string" || rotation == null ? parseRotation(rotation) : rotation;
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...members].sort((a, b) => {
    const ra = rank.get(a.id) ?? Infinity;
    const rb = rank.get(b.id) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  });
}

/** Active members in rotation order (see rotationOrderAll). */
export function rotationOrder<M extends AssigneeMember>(members: M[], rotation?: string | readonly string[] | null): M[] {
  return rotationOrderAll(members, rotation).filter((m) => !m.archivedAt);
}

/** The id of the member whose turn it is, or null for "anyone". */
export function currentAssigneeId(input: AssigneeInput): string | null {
  const { chore, members, lastCompletedBy } = input;
  // Everyone (archived included) so an archived last completer still has a place.
  const all = rotationOrderAll(members, chore.rotation);
  const active = all.filter((m) => !m.archivedAt);
  const isActive = (id: string | null): id is string => !!id && active.some((m) => m.id === id);

  switch (chore.assigneeMode) {
    case "ANYONE":
      return null;
    case "FIXED":
      return isActive(chore.assigneeId) ? chore.assigneeId : null;
    case "ROUND_ROBIN": {
      if (active.length === 0) return null;
      const idx = lastCompletedBy ? all.findIndex((m) => m.id === lastCompletedBy) : -1;
      if (idx >= 0) {
        for (let i = 1; i <= all.length; i++) {
          const next = all[(idx + i) % all.length];
          if (!next.archivedAt) return next.id;
        }
      }
      return isActive(chore.assigneeId) ? chore.assigneeId : active[0].id;
    }
  }
}
