/**
 * Pure, isomorphic tag helpers (no DB, no Node APIs): safe to import from
 * client components and from services. OWNED BY: Agent B.
 *
 * ## Group fingerprint: how a tag page finds "your" identity
 *
 * A tag token may only complete its own chore, and the group id is the
 * full-access secret, so `/t/{token}` must never reveal the group id. But the
 * page still needs to know which identity in this browser's localStorage
 * applies to the tag. So the server returns a **group fingerprint**:
 *
 *     fingerprint = hex(SHA-256("yakka:group-fingerprint:v1:" + groupId))[0..16]
 *
 * and the client computes the same fingerprint for every group id it already
 * holds (local-groups.ts) and picks the one that matches.
 *
 * - It doesn't leak the id: group ids are ~131 random bits, so SHA-256 can't
 *   be inverted or brute-forced. A browser only learns that "this tag belongs
 *   to group X" for groups it already has full access to.
 * - Truncated to 64 bits: plenty to tell apart the handful of groups a
 *   browser knows, and still unusable for guessing ids.
 * - Unkeyed (not an HMAC with a server secret) on purpose: the client must be
 *   able to compute it. A plain-JS SHA-256 is used instead of WebCrypto
 *   because `crypto.subtle` is missing on plain-http LAN addresses, which is
 *   how many homelab installs are reached.
 * - The fingerprint is the same for every tag of a group, so someone holding
 *   two tags can tell they're from the same household. Acceptable: tags are
 *   physically in that household anyway.
 *
 * When the client does hold the group id, it sends it along with the token;
 * the server checks it matches (`verifyGroupClaim`) before returning the
 * member list for groups with `joinFromTag = false`.
 *
 * When the client does NOT hold the group id (joinFromTag = true, first scan
 * on this device), the chosen identity is stored tag-side, keyed by the
 * fingerprint (src/components/tag/tag-identity.ts). It is NOT added to the
 * recent-groups list: that list needs the group id, which the tag never
 * reveals. Security of the group id wins over convenience.
 */

const FINGERPRINT_PREFIX = "yakka:group-fingerprint:v1:";
/** Hex characters kept from the digest (64 bits). */
export const FINGERPRINT_LENGTH = 16;

// --- SHA-256 (FIPS 180-4), synchronous, UTF-8 input --------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** SHA-256 of a string (UTF-8), as lowercase hex. Synchronous and dependency-free. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

/** Non-secret fingerprint of a group id (see the module comment). */
export function groupFingerprint(groupId: string): string {
  return sha256Hex(FINGERPRINT_PREFIX + groupId).slice(0, FINGERPRINT_LENGTH);
}

/**
 * The group id among `candidates` whose fingerprint is `fingerprint`, or
 * null. `candidates` are the group ids this browser already holds.
 */
export function matchGroupByFingerprint(fingerprint: string, candidates: Iterable<string>): string | null {
  for (const id of candidates) if (groupFingerprint(id) === fingerprint) return id;
  return null;
}

/** Path of a tag's public page. Prefix with BASE_URL for the full URL. */
export function tagPath(token: string): string {
  return `/t/${token}`;
}

// --- Tag-scope authorisation (pure; the service feeds it DB rows) ------------

/** Why a tag-scoped action was refused; matches DomainError reasons. */
export type TagDenyReason =
  | "TAG_NOT_FOUND"
  | "TAG_REVOKED"
  | "GROUP_MISMATCH"
  | "JOIN_FROM_TAG_DISABLED"
  | "UNDO_NOT_ALLOWED"
  | "UNDO_WINDOW_EXPIRED";

/** Outcome of a policy check. */
export type TagDecision = { ok: true } | { ok: false; reason: TagDenyReason };

const allow: TagDecision = { ok: true };
const deny = (reason: TagDenyReason): TagDecision => ({ ok: false, reason });

/** Minimal tag shape the policy needs. */
export interface PolicyTag {
  id: string;
  groupId: string;
  choreId: string;
  revokedAt: Date | null;
  /** The group's soft-delete marker; a deleted group's tags are "not found". */
  groupDeletedAt?: Date | null;
}

/** A tag can be used (resolved / completed) if it exists, isn't revoked and its group isn't deleted. */
export function checkTagUsable(tag: PolicyTag | null): TagDecision {
  if (!tag || tag.groupDeletedAt) return deny("TAG_NOT_FOUND");
  if (tag.revokedAt) return deny("TAG_REVOKED");
  return allow;
}

/**
 * Does a group id claimed by the client match the tag's group? `undefined`
 * or null claims are "no claim" (fine for completing; members stay hidden
 * unless joinFromTag). A wrong claim is refused outright.
 */
export function checkGroupClaim(tagGroupId: string, claimed: string | null | undefined): TagDecision {
  if (claimed == null) return allow;
  return constantTimeEqual(tagGroupId, claimed) ? allow : deny("GROUP_MISMATCH");
}

/**
 * Whether the tag page may see the group's member list and add a member
 * ("I'm new"): when the group allows joining from a tag, or when the client
 * proved it already holds the group id.
 */
export function canUseMembers(opts: { joinFromTag: boolean; groupVerified: boolean }): boolean {
  return opts.joinFromTag || opts.groupVerified;
}

/** A completion as far as the undo policy is concerned. */
export interface PolicyCompletion {
  tagId: string | null;
  deviceId: string | null;
  createdAt: Date;
  undoneAt: Date | null;
}

/**
 * Undo through a tag: only completions recorded via this very tag, from the
 * same device (when the completion has one), within `undoSeconds` of when
 * the server recorded it. Already-undone completions pass (undo is idempotent).
 */
export function checkTagUndo(opts: {
  tag: PolicyTag;
  completion: PolicyCompletion | null;
  deviceId: string | null | undefined;
  undoSeconds: number;
  now: Date;
}): TagDecision {
  const { tag, completion } = opts;
  if (!completion || completion.tagId !== tag.id) return deny("UNDO_NOT_ALLOWED");
  if (completion.deviceId && completion.deviceId !== opts.deviceId) return deny("UNDO_NOT_ALLOWED");
  if (completion.undoneAt) return allow;
  if (opts.now.getTime() - completion.createdAt.getTime() > opts.undoSeconds * 1000) {
    return deny("UNDO_WINDOW_EXPIRED");
  }
  return allow;
}

/** Milliseconds of undo left for a completion (0 when expired). */
export function undoRemainingMs(createdAt: Date, undoSeconds: number, now: Date): number {
  return Math.max(0, createdAt.getTime() + undoSeconds * 1000 - now.getTime());
}

/** Length-independent-ish string compare without early exit (isomorphic; no node:crypto). */
function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
