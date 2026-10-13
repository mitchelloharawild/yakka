/**
 * Outbound webhook signing (pure, no DB). OWNED BY: Agent C.
 *
 * Every delivery carries
 *   X-Yakka-Timestamp: <unix seconds>
 *   X-Signature:       sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 * The timestamp is part of the signed material, so a captured request can't
 * be replayed later with a fresh timestamp. Receivers should reject
 * timestamps more than a few minutes old (see docs/API.md).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Header names used on outbound webhook requests. */
export const SIGNATURE_HEADER = "X-Signature";
export const TIMESTAMP_HEADER = "X-Yakka-Timestamp";
export const EVENT_HEADER = "X-Yakka-Event";
export const DELIVERY_HEADER = "X-Yakka-Delivery";

/** Default tolerance for verifySignature(): 5 minutes. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** The exact string that is signed. */
export function signedMaterial(timestamp: number | string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

/** `sha256=<hex>` signature of a raw body at a timestamp. */
export function signPayload(secret: string, timestamp: number | string, rawBody: string): string {
  const hex = createHmac("sha256", secret).update(signedMaterial(timestamp, rawBody), "utf8").digest("hex");
  return `sha256=${hex}`;
}

/** Result of verifySignature(). */
export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "MISSING" | "MALFORMED" | "MISMATCH" | "TIMESTAMP_OUT_OF_RANGE" };

/**
 * Verify a delivery as a receiver would: constant-time comparison of the
 * signature and a timestamp freshness check (`toleranceSeconds`, 0 disables).
 */
export function verifySignature(input: {
  secret: string;
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | number | null | undefined;
  now?: Date;
  toleranceSeconds?: number;
}): VerifyResult {
  const { signature, timestamp } = input;
  if (!signature || timestamp === null || timestamp === undefined || timestamp === "") {
    return { ok: false, reason: "MISSING" };
  }
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return { ok: false, reason: "MALFORMED" };
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (tolerance > 0 && Math.abs(nowSec - ts) > tolerance) return { ok: false, reason: "TIMESTAMP_OUT_OF_RANGE" };
  const expected = Buffer.from(signPayload(input.secret, ts, input.rawBody));
  const actual = Buffer.from(signature.toLowerCase());
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "MISMATCH" };
  return { ok: true };
}

/** All headers of a signed delivery. */
export function deliveryHeaders(input: {
  secret: string;
  rawBody: string;
  event: string;
  deliveryId: string;
  now?: Date;
}): Record<string, string> {
  const ts = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return {
    "Content-Type": "application/json",
    "User-Agent": "Yakka-Webhooks/1",
    [EVENT_HEADER]: input.event,
    [DELIVERY_HEADER]: input.deliveryId,
    [TIMESTAMP_HEADER]: String(ts),
    [SIGNATURE_HEADER]: signPayload(input.secret, ts, input.rawBody),
  };
}
