/**
 * Outbound webhook retry policy (pure). OWNED BY: Agent C.
 */

/** Delay before retry n (index 0 = after the first failed attempt). */
export const BACKOFF_SCHEDULE_MS = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  2 * 60 * 60_000, // 2 h
  12 * 60 * 60_000, // 12 h
] as const;

/** Total attempts per delivery: the first try plus one per backoff step. */
export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length + 1;

/** Consecutive failed attempts (across deliveries) after which a webhook is disabled. */
export const AUTO_DISABLE_AFTER_FAILURES = 15;

/** Per-request timeout. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** How long a worker holds a claimed delivery before another worker may retry it. */
export const CLAIM_LEASE_MS = 2 * 60_000;

/**
 * When to try again after a failed attempt. `attempts` is the number of
 * attempts made so far, including the one that just failed. Returns null
 * once MAX_ATTEMPTS is reached (give up).
 */
export function nextRetryAt(attempts: number, now: Date): Date | null {
  if (attempts < 1) return now;
  if (attempts >= MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + BACKOFF_SCHEDULE_MS[attempts - 1]);
}

/** Whether a webhook with this many consecutive failed attempts should be auto-disabled. */
export function shouldAutoDisable(failCount: number): boolean {
  return failCount >= AUTO_DISABLE_AFTER_FAILURES;
}
