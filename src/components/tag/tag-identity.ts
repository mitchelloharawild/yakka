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
 * Opening the full group link later adopts the entry (adoptTagIdentity in
 * local-groups.ts, called by the group shell).
 */
import { matchGroupByFingerprint } from "@/lib/tags";
import { getLocalGroups, getTagIdentity, type LocalGroup } from "@/lib/client/local-groups";

// The storage lives in local-groups.ts (so it is exported/imported with the
// rest of the local data, and handed over by adoptTagIdentity() when the
// group link is opened).
export { getTagIdentity, setTagIdentity, TAG_IDENTITIES_KEY } from "@/lib/client/local-groups";

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
