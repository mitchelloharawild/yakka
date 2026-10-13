/**
 * Resolve "who did it" from an API/hook request (pure). OWNED BY: Agent C.
 *
 * The value may be a member id or a member name (case-insensitive, trimmed).
 * Ids win over names. Archived members are only matched by id
 * (completeChore then rejects them with MEMBER_ARCHIVED); a name shared by
 * several active members is ambiguous.
 */

export interface MatchableMember {
  id: string;
  name: string;
  archivedAt: Date | null;
}

export type MemberMatch<M> =
  | { ok: true; member: M }
  | { ok: false; reason: "MEMBER_NOT_FOUND" | "MEMBER_AMBIGUOUS" };

function norm(s: string): string {
  return s.normalize("NFC").trim().toLocaleLowerCase("en");
}

/** Find the member a request refers to. */
export function matchMember<M extends MatchableMember>(members: readonly M[], value: string): MemberMatch<M> {
  const v = value.trim();
  if (!v) return { ok: false, reason: "MEMBER_NOT_FOUND" };
  const byId = members.find((m) => m.id === v);
  if (byId) return { ok: true, member: byId };
  const n = norm(v);
  const byName = members.filter((m) => !m.archivedAt && norm(m.name) === n);
  if (byName.length === 1) return { ok: true, member: byName[0] };
  if (byName.length > 1) return { ok: false, reason: "MEMBER_AMBIGUOUS" };
  return { ok: false, reason: "MEMBER_NOT_FOUND" };
}
