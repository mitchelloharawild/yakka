/**
 * Who is the current assignee of a chore. Pure (no DB access).
 *
 *  - ANYONE: nobody in particular (null).
 *  - FIXED: chore.assigneeId, unless that member is archived or missing.
 *  - ROUND_ROBIN: rotates over the group's non-archived members ordered by
 *    createdAt (then id). The member after whoever did the last (non-undone)
 *    completion is next, so if someone covers your turn the rotation carries
 *    on from them. Before any completion, or when the last completer is not
 *    in the rotation (automation, archived member), it starts at
 *    chore.assigneeId if set and active, else the first member.
 */

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
  chore: { assigneeMode: AssigneeModeValue; assigneeId: string | null };
  /** All members of the group (archived ones are filtered out here). */
  members: AssigneeMember[];
  /** memberId of the latest non-undone completion (null for automations or none). */
  lastCompletedBy: string | null;
}

/** Active members in rotation order (createdAt, then id). */
export function rotationOrder<M extends AssigneeMember>(members: M[]): M[] {
  return members
    .filter((m) => !m.archivedAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** The id of the member whose turn it is, or null for "anyone". */
export function currentAssigneeId(input: AssigneeInput): string | null {
  const { chore, members, lastCompletedBy } = input;
  const active = rotationOrder(members);
  const isActive = (id: string | null): id is string => !!id && active.some((m) => m.id === id);

  switch (chore.assigneeMode) {
    case "ANYONE":
      return null;
    case "FIXED":
      return isActive(chore.assigneeId) ? chore.assigneeId : null;
    case "ROUND_ROBIN": {
      if (active.length === 0) return null;
      const idx = lastCompletedBy ? active.findIndex((m) => m.id === lastCompletedBy) : -1;
      if (idx >= 0) return active[(idx + 1) % active.length].id;
      return isActive(chore.assigneeId) ? chore.assigneeId : active[0].id;
    }
  }
}
