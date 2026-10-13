/**
 * Who is the current assignee of a chore. Pure (no DB access).
 *
 *  - ANYONE: nobody in particular (null).
 *  - FIXED: chore.assigneeId, unless that member is archived or missing.
 *  - ROUND_ROBIN: rotates over the group's non-archived members ordered by
 *    createdAt (then id). The member after whoever did the last (non-undone)
 *    completion is next, so if someone covers your turn the rotation carries
 *    on from them. If the last completer has since been archived, the
 *    rotation continues with the next active member after their place in
 *    the order (archived members keep their createdAt slot), so archiving
 *    someone doesn't reset it. Before any completion, or when the last
 *    completion has no member (automation) or an unknown one, it starts at
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
  return members.filter((m) => !m.archivedAt).sort(byRotation);
}

function byRotation(a: AssigneeMember, b: AssigneeMember): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
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
      // Order everyone (archived included) so an archived last completer still has a place.
      const all = [...members].sort(byRotation);
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
