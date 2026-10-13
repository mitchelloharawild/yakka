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

  /**
   * Count a request for `client` against `rule`. `cost` (default 1) counts
   * it as several, e.g. one batched tRPC request carrying N tag calls.
   */
  hit(rule: RateLimitRule, client: string, now = Date.now(), cost = 1): RateLimitResult {
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

    const n = Math.min(Math.max(1, Math.ceil(cost)), limit);
    if (estimate + n <= limit) {
      bucket.current += n;
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, Math.floor(limit - (estimate + n))),
        retryAfterSeconds: 0,
      };
    }

    // When will `estimate + n <= limit` hold again?
    let waitMs: number;
    if (bucket.current + n <= limit && bucket.previous > 0) {
      // The previous window's share has to decay: previous * (1 - e/w) <= limit - n - current.
      const e = windowMs * (1 - (limit - n - bucket.current) / bucket.previous);
      waitMs = windowStart + e - now;
    } else {
      // This window alone is full; in the next one it decays: current * (1 - e/w) <= limit - n.
      const e = bucket.current > 0 ? windowMs * Math.max(0, 1 - (limit - n) / bucket.current) : 0;
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

/** Where the client IP comes from. See docs/DEPLOYMENT.md "Rate limiting". */
export type IpSource = "x-forwarded-for" | "x-real-ip" | "cf-connecting-ip" | "x-vercel-forwarded-for" | "none";

export const IP_SOURCES: readonly IpSource[] = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "x-vercel-forwarded-for",
  "none",
];

/** Client-IP settings. */
export interface ClientIpConfig {
  source: IpSource;
  /** x-forwarded-for only: trusted proxies that append to it (the n-th entry from the right is the client). */
  hops: number;
}

/**
 * Client-IP config from the environment: RATE_LIMIT_IP_HEADER (default
 * `x-vercel-forwarded-for` on Vercel, else `x-forwarded-for`) and
 * RATE_LIMIT_PROXY_HOPS (default 1). Unknown values fall back to the default.
 */
export function clientIpConfig(env: Record<string, string | undefined> = process.env): ClientIpConfig {
  const fallback: IpSource = env.VERCEL?.trim() ? "x-vercel-forwarded-for" : "x-forwarded-for";
  const raw = env.RATE_LIMIT_IP_HEADER?.trim().toLowerCase();
  const source = raw && (IP_SOURCES as readonly string[]).includes(raw) ? (raw as IpSource) : fallback;
  const hops = Number.parseInt(env.RATE_LIMIT_PROXY_HOPS ?? "1", 10);
  return { source, hops: Number.isFinite(hops) && hops > 0 ? hops : 1 };
}

/** Key used for every client when no IP is available (source "none", or the header is missing). */
export const SHARED_CLIENT = "unknown";

/**
 * The client's IP, read from the ONE header the deployment says to trust.
 * Headers a client can set itself must never be trusted, so only the
 * configured source is read:
 *
 *  - `x-forwarded-for`: the `hops`-th address from the right. Each trusted
 *    proxy appends the address it saw, so with one reverse proxy (hops = 1)
 *    the last entry is the real client and anything a client put earlier is
 *    ignored. Without any reverse proxy, `next start` fills the header with
 *    the socket address when the client didn't send one (but keeps a
 *    client-sent value, so put a proxy in front of a public instance).
 *  - `x-real-ip` / `cf-connecting-ip`: a single address set by nginx/Caddy/
 *    Traefik or Cloudflare. Only safe if that proxy always overwrites it.
 *  - `x-vercel-forwarded-for`: set by Vercel's edge (the default there).
 *  - `none`: every client shares one bucket.
 */
export function clientIp(headers: Headers, config: Partial<ClientIpConfig> = {}): string {
  const source = config.source ?? "x-forwarded-for";
  const hops = Math.max(1, config.hops ?? 1);
  if (source === "none") return SHARED_CLIENT;
  const list = headers
    .get(source)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list?.length) return SHARED_CLIENT;
  if (source !== "x-forwarded-for") return list[list.length - 1];
  return list[Math.max(0, list.length - hops)];
}

/** clientIp() with the environment's configuration. */
export function requestClientIp(headers: Headers): string {
  return clientIp(headers, clientIpConfig());
}

/**
 * Procedure paths of a tRPC request path (`/api/trpc/a.b,c.d`), decoded the
 * way tRPC decodes them (so `%2C` can't hide a batched call). Empty for
 * other paths.
 */
export function trpcProcedures(pathname: string): string[] {
  if (!pathname.startsWith("/api/trpc/")) return [];
  let rest = pathname.slice("/api/trpc/".length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // Malformed escapes: tRPC rejects these too; count the raw text.
  }
  return rest.split(",").map((s) => s.trim()).filter(Boolean);
}
