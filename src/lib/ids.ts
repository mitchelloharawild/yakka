import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { customAlphabet } from "nanoid";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Base62: URL-safe without escaping and without `-`/`_` (which look odd in URLs and can be clipped by autolinkers). */
export const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Lowercase alphanumerics without lookalikes (0/o, 1/l/i): safe to read aloud or type from a label. */
export const NO_LOOKALIKES = "23456789abcdefghjkmnpqrstuvwxyz";

/** Length of group ids (22 base62 chars ≈ 131 bits). */
export const GROUP_ID_LENGTH = 22;
/** Length of tag tokens (12 chars of a 31-letter alphabet ≈ 59 bits; /t/* is rate-limited). */
export const TAG_TOKEN_LENGTH = 12;

const groupIdGen = customAlphabet(BASE62, GROUP_ID_LENGTH);
const tagTokenGen = customAlphabet(NO_LOOKALIKES, TAG_TOKEN_LENGTH);
const secretGen = customAlphabet(BASE62, 32);

/** New group id. The group id IS the access secret, so it must stay long and random. */
export function newGroupId(): string {
  return groupIdGen();
}

/** New tag token for `/t/{token}`: shorter than a group id but still unguessable. */
export function newTagToken(): string {
  return tagTokenGen();
}

/** Cheap shape check for group ids in URLs (does not hit the DB). */
export function isPlausibleGroupId(id: string): boolean {
  return /^[0-9A-Za-z_-]{16,64}$/.test(id);
}

/** Cheap shape check for tag tokens in URLs (does not hit the DB). */
export function isPlausibleTagToken(token: string): boolean {
  return /^[0-9a-z]{8,32}$/.test(token);
}

/** Prefix of every API token; makes tokens recognisable to secret scanners. */
export const API_TOKEN_PREFIX = "yk_";

/**
 * New group API token. Show `token` to the user once; store only `hash`
 * (and `prefix` for display).
 */
export function newApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${secretGen()}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, API_TOKEN_PREFIX.length + 6) };
}

/** SHA-256 hex digest of a bearer token (tokens are high-entropy, so no salt is needed). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** New secret for an inbound hook URL `/api/hooks/{secret}`. */
export function newHookSecret(): string {
  return secretGen();
}

/** New HMAC signing secret for an outbound webhook. */
export function newWebhookSecret(): string {
  return `whsec_${secretGen()}`;
}

/** Constant-time string comparison (false when lengths differ). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Hash a group settings PIN with scrypt. Format: `scrypt$<saltB64>$<hashB64>`. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Verify a PIN against a hash produced by hashPin(). */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(pin, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
