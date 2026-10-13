/**
 * Tag-scoped identities: "who you are" for groups this browser only knows
 * through a tag (joinFromTag on, group link never opened here).
 *
 *   localStorage["tagIdentities"] = { [groupFingerprint]: { memberId, savedAt } }
 *
 * Keyed by the non-secret group fingerprint (src/lib/tags.ts), never by
 * group id: a tag must not reveal the id, so these groups are NOT added to
 * the recent-groups list in local-groups.ts. When the browser does hold the
 * group id, the identity lives in local-groups.ts as usual and that wins.
 */
import { matchGroupByFingerprint } from "@/lib/tags";
import { getLocalGroups, type LocalGroup } from "@/lib/client/local-groups";

/** localStorage key. */
export const TAG_IDENTITIES_KEY = "tagIdentities";

interface TagIdentity {
  memberId: string;
  savedAt: number;
}

function readAll(): Record<string, TagIdentity> {
  try {
    const raw = window.localStorage.getItem(TAG_IDENTITIES_KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, TagIdentity>) : {};
  } catch {
    return {};
  }
}

/** Member id remembered for a fingerprint, or null. Browser-only. */
export function getTagIdentity(fingerprint: string): string | null {
  const v = readAll()[fingerprint];
  return v && typeof v.memberId === "string" ? v.memberId : null;
}

/** Remember (or forget, with null) the member for a fingerprint. Browser-only. */
export function setTagIdentity(fingerprint: string, memberId: string | null): void {
  const all = readAll();
  if (memberId) all[fingerprint] = { memberId, savedAt: Date.now() };
  else delete all[fingerprint];
  try {
    window.localStorage.setItem(TAG_IDENTITIES_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the user is simply asked again next time.
  }
}

/** How this browser relates to a tag's group. */
export interface TagContext {
  /** The group id, when this browser already holds it (recent groups). */
  groupId: string | null;
  /** The local group entry, if known. */
  localGroup: LocalGroup | null;
  /** Who "you" are: from the local group, else from the tag-scoped store. */
  memberId: string | null;
}

/** Work out the group id (if held) and identity for a tag's fingerprint. Browser-only. */
export function resolveTagContext(fingerprint: string): TagContext {
  const groups = getLocalGroups();
  const groupId = matchGroupByFingerprint(
    fingerprint,
    groups.map((g) => g.id),
  );
  const localGroup = groupId ? (groups.find((g) => g.id === groupId) ?? null) : null;
  return { groupId, localGroup, memberId: localGroup?.memberId ?? getTagIdentity(fingerprint) };
}
