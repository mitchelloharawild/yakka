/**
 * Next 16 proxy (formerly middleware). OWNED BY: Agent D (rate limiting);
 * Agent C may add to it.
 *
 * Rate limits by client IP, to stop secret guessing (tag tokens, hook
 * secrets, API tokens) and floods. In-memory and per instance: see
 * src/lib/rate-limit.ts and docs/DEPLOYMENT.md. Disable with
 * RATE_LIMIT_ENABLED=false. The client IP comes from the one header named
 * by RATE_LIMIT_IP_HEADER (default X-Forwarded-For, with
 * RATE_LIMIT_PROXY_HOPS trusted proxies; Vercel: X-Vercel-Forwarded-For).
 *
 * Batched tRPC requests (`/api/trpc/a,b,c?batch=1`) count once per tag
 * procedure in the batch, so batching can't multiply the tag limit; the tRPC
 * route caps batches at TRPC_MAX_BATCH (src/trpc/limits.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  clientIp,
  clientIpConfig,
  SlidingWindowRateLimiter,
  trpcProcedures,
  type RateLimitRule,
} from "@/lib/rate-limit";

const minute = 60_000;

/** First matching rule wins. `match` returns the request's cost (0 = no match). */
const RULES: Array<{ match: (pathname: string) => number; rule: RateLimitRule }> = [
  // Tag pages, and the tag-token tRPC procedures behind them (Agent B): one per procedure.
  {
    match: (p) => (p.startsWith("/t/") ? 1 : trpcProcedures(p).filter((x) => x.startsWith("tags.")).length),
    rule: { name: "tag", limit: 30, windowMs: minute },
  },
  { match: (p) => (p.startsWith("/api/hooks/") ? 1 : 0), rule: { name: "hooks", limit: 30, windowMs: minute } },
  { match: (p) => (p.startsWith("/api/offline/") ? 1 : 0), rule: { name: "offline", limit: 30, windowMs: minute } },
  // Group import (creates a whole group from a file): expensive, so tight.
  {
    match: (p) => (trpcProcedures(p).includes("groups.import") ? 1 : 0),
    rule: { name: "import", limit: 10, windowMs: 10 * minute },
  },
  { match: (p) => (p.startsWith("/api/v1/") ? 1 : 0), rule: { name: "api", limit: 120, windowMs: minute } },
];

// One limiter per process; survives across requests (and HMR in dev).
const globalForLimiter = globalThis as unknown as { yakkaRateLimiter?: SlidingWindowRateLimiter };
const limiter = (globalForLimiter.yakkaRateLimiter ??= new SlidingWindowRateLimiter());

function enabled(): boolean {
  const v = process.env.RATE_LIMIT_ENABLED?.trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let entry: (typeof RULES)[number] | undefined;
  let cost = 0;
  if (enabled()) {
    for (const r of RULES) {
      cost = r.match(pathname);
      if (cost > 0) {
        entry = r;
        break;
      }
    }
  }
  if (!entry) return NextResponse.next();

  const result = limiter.hit(entry.rule, clientIp(request.headers, clientIpConfig()), Date.now(), cost);
  const headers = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
  };

  if (!result.allowed) {
    const tooMany = { ...headers, "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" };
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: tooMany },
      );
    }
    return new NextResponse(`Too many requests. Try again in ${result.retryAfterSeconds} s.`, {
      status: 429,
      headers: { ...tooMany, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const response = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: ["/t/:path*", "/api/hooks/:path*", "/api/offline/:path*", "/api/v1/:path*", "/api/trpc/:path*"],
};
