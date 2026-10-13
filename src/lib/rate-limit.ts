/**
 * In-memory sliding-window rate limiter, used by src/proxy.ts. OWNED BY: Agent D.
 *
 * Algorithm: sliding-window counter. Each key keeps the count for the current
 * fixed window and the previous one; the estimate is
 * `previous * (1 - elapsed/window) + current`. That's O(1) memory per key
 * and smooths out the burst-at-the-boundary problem of fixed windows.
 * Denied requests don't count.
 *
 * Limits are per process. With several instances (serverless, replicas)
 * each one counts separately, so the effective limit is `limit × instances`.
 * Good enough to stop token guessing; use a shared store (Redis) if you need
 * exact global limits.
 */

export interface RateLimitRule {
  /** Bucket name; keys are `${name}:${client}`. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (after this one, if allowed). */
  remaining: number;
  /** Seconds until a request would be allowed again (0 if allowed). */
  retryAfterSeconds: number;
}

interface Bucket {
  windowStart: number;
  current: number;
  previous: number;
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxKeys = 10_000) {}

  /** Count one request for `client` against `rule`. */
  hit(rule: RateLimitRule, client: string, now = Date.now()): RateLimitResult {
    const key = `${rule.name}:${client}`;
    const { windowMs, limit } = rule;
    const windowStart = Math.floor(now / windowMs) * windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      this.prune(now, windowMs);
      bucket = { windowStart, current: 0, previous: 0 };
      this.buckets.set(key, bucket);
    } else if (bucket.windowStart !== windowStart) {
      bucket.previous = bucket.windowStart === windowStart - windowMs ? bucket.current : 0;
      bucket.current = 0;
      bucket.windowStart = windowStart;
    }

    const elapsed = now - windowStart;
    const weight = 1 - elapsed / windowMs;
    const estimate = bucket.previous * weight + bucket.current;

    if (estimate + 1 <= limit) {
      bucket.current++;
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, Math.floor(limit - (estimate + 1))),
        retryAfterSeconds: 0,
      };
    }

    // When will `estimate + 1 <= limit` hold again?
    let waitMs: number;
    if (bucket.current + 1 <= limit && bucket.previous > 0) {
      // The previous window's share has to decay: previous * (1 - e/w) <= limit - 1 - current.
      const e = windowMs * (1 - (limit - 1 - bucket.current) / bucket.previous);
      waitMs = windowStart + e - now;
    } else {
      // This window alone is full; in the next one it decays: current * (1 - e/w) <= limit - 1.
      const e = bucket.current > 0 ? windowMs * Math.max(0, 1 - (limit - 1) / bucket.current) : 0;
      waitMs = windowStart + windowMs + e - now;
    }
    return { allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  /** Number of tracked keys (tests, metrics). */
  get size(): number {
    return this.buckets.size;
  }

  /** Forget everything (tests). */
  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number, windowMs: number) {
    if (this.buckets.size < this.maxKeys) return;
    // Drop buckets that no longer affect any estimate.
    for (const [key, b] of this.buckets) if (b.windowStart + 2 * windowMs <= now) this.buckets.delete(key);
    // Still full (e.g. a flood of distinct IPs): drop the oldest-inserted half.
    if (this.buckets.size >= this.maxKeys) {
      let drop = Math.ceil(this.buckets.size / 2);
      for (const key of this.buckets.keys()) {
        if (drop-- <= 0) break;
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * The client's IP from proxy headers. `x-real-ip` wins (nginx/Caddy/Traefik
 * set it to the peer address). Otherwise the `hops`-th address from the
 * right of `x-forwarded-for`: each trusted proxy appends the address it saw,
 * so with one reverse proxy (hops = 1) the last entry is the real client and
 * anything a client puts earlier in the header is ignored. Vercel sets both
 * headers itself. Without a proxy these headers are client-controlled;
 * deploy behind one (you need it for HTTPS anyway).
 */
export function clientIp(headers: Headers, hops = 1): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (forwarded?.length) return forwarded[Math.max(0, forwarded.length - Math.max(1, hops))];
  return "unknown";
}
