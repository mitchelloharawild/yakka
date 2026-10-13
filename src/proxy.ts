/**
 * Next 16 proxy (formerly middleware). OWNED BY: Agent D (rate limiting);
 * Agent C may add to it.
 *
 * Rate limits by client IP, to stop secret guessing (tag tokens, hook
 * secrets, API tokens) and floods. In-memory and per instance: see
 * src/lib/rate-limit.ts and docs/DEPLOYMENT.md. Disable with
 * RATE_LIMIT_ENABLED=false; set RATE_LIMIT_PROXY_HOPS to the number of
 * reverse proxies that append to X-Forwarded-For (default 1).
 */
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/rate-limit";

const minute = 60_000;

/** First matching rule wins. */
const RULES: Array<{ match: (pathname: string) => boolean; rule: RateLimitRule }> = [
  // Tag pages, and the tag-token tRPC procedures behind them (Agent B).
  {
    match: (p) => p.startsWith("/t/") || (p.startsWith("/api/trpc/") && /(^|,)tags\./.test(p.slice(10))),
    rule: { name: "tag", limit: 30, windowMs: minute },
  },
  { match: (p) => p.startsWith("/api/hooks/"), rule: { name: "hooks", limit: 30, windowMs: minute } },
  { match: (p) => p.startsWith("/api/offline/"), rule: { name: "offline", limit: 30, windowMs: minute } },
  { match: (p) => p.startsWith("/api/v1/"), rule: { name: "api", limit: 120, windowMs: minute } },
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
  const entry = enabled() ? RULES.find((r) => r.match(pathname)) : undefined;
  if (!entry) return NextResponse.next();

  const hops = Number.parseInt(process.env.RATE_LIMIT_PROXY_HOPS ?? "1", 10) || 1;
  const result = limiter.hit(entry.rule, clientIp(request.headers, hops));
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
