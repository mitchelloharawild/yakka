/**
 * Settings-PIN attempt limiter (in memory, per process).
 *
 * A PIN is only 4-8 digits, so wrong guesses are limited at two levels:
 *
 *  - per group and client IP: after PER_CLIENT.free wrong PINs, each further
 *    one locks that client out of that group's PIN for PER_CLIENT.baseMs,
 *    doubling every time (capped at MAX_LOCK_MS);
 *  - per group (all clients together, so rotating IPs doesn't help): the
 *    same with PER_GROUP's larger allowance.
 *
 * While locked, attempts are refused without checking the PIN (so they
 * don't reveal anything) and don't extend the lock. A correct PIN resets the
 * client's counter; the group counter only decays (FORGET_AFTER_MS without a
 * failure), so a correct guess by the household doesn't hand an attacker a
 * fresh allowance. The trade-off: someone hammering a group's PIN can lock
 * its members out of settings for a while (minutes, at most an hour).
 *
 * Counters live in this process only. With several instances each counts
 * separately, and a restart clears them (see docs/DEPLOYMENT.md).
 */

interface Counter {
  failures: number;
  lockedUntil: number;
  lastFailure: number;
}

export interface PinLimitPolicy {
  /** Wrong PINs allowed before the first lock. */
  free: number;
  /** First lock duration; doubles with each further failure. */
  baseMs: number;
}

export const PER_CLIENT: PinLimitPolicy = { free: 5, baseMs: 30_000 };
export const PER_GROUP: PinLimitPolicy = { free: 20, baseMs: 60_000 };
export const MAX_LOCK_MS = 60 * 60_000;
/** A counter with no failure for this long starts from zero again. */
export const FORGET_AFTER_MS = 6 * 60 * 60_000;

/** Result of check(): allowed, or locked with seconds to wait. */
export type PinCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class PinAttemptLimiter {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly maxKeys = 10_000) {}

  /** Whether an attempt for `groupId` from `client` may be checked now. */
  check(groupId: string, client: string, now = Date.now()): PinCheck {
    const until = Math.max(this.get(groupKey(groupId), now)?.lockedUntil ?? 0, this.get(clientKey(groupId, client), now)?.lockedUntil ?? 0);
    return until > now ? { allowed: false, retryAfterSeconds: Math.ceil((until - now) / 1000) } : { allowed: true };
  }

  /** Record a wrong PIN. */
  fail(groupId: string, client: string, now = Date.now()): void {
    this.bump(groupKey(groupId), PER_GROUP, now);
    this.bump(clientKey(groupId, client), PER_CLIENT, now);
  }

  /** Record a correct PIN: resets this client's counter (not the group's). */
  succeed(groupId: string, client: string): void {
    this.counters.delete(clientKey(groupId, client));
  }

  reset(): void {
    this.counters.clear();
  }

  private get(key: string, now: number): Counter | undefined {
    const c = this.counters.get(key);
    if (c && now - c.lastFailure > FORGET_AFTER_MS && c.lockedUntil <= now) {
      this.counters.delete(key);
      return undefined;
    }
    return c;
  }

  private bump(key: string, policy: PinLimitPolicy, now: number) {
    let c = this.get(key, now);
    if (!c) {
      if (this.counters.size >= this.maxKeys) this.prune(now);
      c = { failures: 0, lockedUntil: 0, lastFailure: now };
      this.counters.set(key, c);
    }
    c.failures++;
    c.lastFailure = now;
    const over = c.failures - policy.free;
    if (over >= 0) c.lockedUntil = now + Math.min(MAX_LOCK_MS, policy.baseMs * 2 ** Math.min(over, 20));
  }

  private prune(now: number) {
    for (const [k, c] of this.counters) if (c.lockedUntil <= now && now - c.lastFailure > 60_000) this.counters.delete(k);
    if (this.counters.size >= this.maxKeys) {
      // Keep group-level counters (they're the brute-force backstop); drop the oldest client ones.
      let drop = Math.ceil(this.counters.size / 2);
      for (const k of this.counters.keys()) {
        if (drop <= 0) break;
        if (k.startsWith("c:")) {
          this.counters.delete(k);
          drop--;
        }
      }
    }
  }
}

const groupKey = (groupId: string) => `g:${groupId}`;
const clientKey = (groupId: string, client: string) => `c:${groupId}:${client}`;

const globalForPin = globalThis as unknown as { yakkaPinLimiter?: PinAttemptLimiter };
/** The process-wide limiter. */
export const pinLimiter = (globalForPin.yakkaPinLimiter ??= new PinAttemptLimiter());
