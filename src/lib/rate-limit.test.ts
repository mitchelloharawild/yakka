import { describe, expect, it } from "vitest";
import { clientIp, clientIpConfig, SlidingWindowRateLimiter, trpcProcedures, type RateLimitRule } from "./rate-limit";

const rule: RateLimitRule = { name: "test", limit: 3, windowMs: 60_000 };
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % 60_000); // start of a window

describe("SlidingWindowRateLimiter", () => {
  it("allows up to the limit, then denies with Retry-After", () => {
    const rl = new SlidingWindowRateLimiter();
    expect(rl.hit(rule, "a", T0).remaining).toBe(2);
    expect(rl.hit(rule, "a", T0 + 1).allowed).toBe(true);
    const third = rl.hit(rule, "a", T0 + 2);
    expect(third).toMatchObject({ allowed: true, remaining: 0 });
    const denied = rl.hit(rule, "a", T0 + 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(120);
  });

  it("keeps clients and rules separate", () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit(rule, "a", T0);
    expect(rl.hit(rule, "a", T0).allowed).toBe(false);
    expect(rl.hit(rule, "b", T0).allowed).toBe(true);
    expect(rl.hit({ ...rule, name: "other" }, "a", T0).allowed).toBe(true);
  });

  it("weights the previous window (sliding, not fixed)", () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit(rule, "a", T0 + 59_000);
    // Just after the boundary the previous window still counts almost fully.
    expect(rl.hit(rule, "a", T0 + 60_001).allowed).toBe(false);
    // Two thirds into the next window: 3 * (1/3) = 1 → two more allowed.
    expect(rl.hit(rule, "a", T0 + 100_000).allowed).toBe(true);
    expect(rl.hit(rule, "a", T0 + 100_001).allowed).toBe(true);
    expect(rl.hit(rule, "a", T0 + 100_002).allowed).toBe(false);
  });

  it("Retry-After points at when a request is allowed again", () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit(rule, "a", T0);
    const denied = rl.hit(rule, "a", T0 + 10_000);
    expect(denied.allowed).toBe(false);
    const retryAt = T0 + 10_000 + denied.retryAfterSeconds * 1000;
    expect(rl.hit(rule, "a", retryAt - 2000).allowed).toBe(false);
    expect(rl.hit(rule, "a", retryAt).allowed).toBe(true);
  });

  it("forgets old windows entirely", () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit(rule, "a", T0);
    expect(rl.hit(rule, "a", T0 + 3 * 60_000)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("counts a request with a cost as several", () => {
    const rl = new SlidingWindowRateLimiter();
    const r = { name: "c", limit: 10, windowMs: 60_000 };
    expect(rl.hit(r, "ip", T0, 8).allowed).toBe(true);
    expect(rl.hit(r, "ip", T0, 3).allowed).toBe(false);
    expect(rl.hit(r, "ip", T0, 2)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("bounds memory", () => {
    const rl = new SlidingWindowRateLimiter(100);
    for (let i = 0; i < 1000; i++) rl.hit(rule, `ip${i}`, T0);
    expect(rl.size).toBeLessThanOrEqual(100);
  });
});

describe("clientIp", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("reads only the configured header", () => {
    const both = h({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" });
    // Default is x-forwarded-for: a client-sent X-Real-IP must not win.
    expect(clientIp(both)).toBe("5.6.7.8");
    expect(clientIp(both, { source: "x-real-ip" })).toBe("1.2.3.4");
    expect(clientIp(h({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "5.6.7.8" }), { source: "cf-connecting-ip" })).toBe("9.9.9.9");
    expect(clientIp(h({ "x-vercel-forwarded-for": "7.7.7.7" }), { source: "x-vercel-forwarded-for" })).toBe("7.7.7.7");
    expect(clientIp(both, { source: "none" })).toBe("unknown");
  });
  it("takes the address appended by the trusted proxy from x-forwarded-for", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" }), { hops: 2 })).toBe("1.2.3.4");
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), { hops: 5 })).toBe("1.2.3.4");
  });
  it("falls back to one shared key", () => {
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), { source: "x-real-ip" })).toBe("unknown");
  });
});

describe("clientIpConfig", () => {
  it("defaults to x-forwarded-for, or Vercel's header on Vercel", () => {
    expect(clientIpConfig({})).toEqual({ source: "x-forwarded-for", hops: 1 });
    expect(clientIpConfig({ VERCEL: "1" })).toEqual({ source: "x-vercel-forwarded-for", hops: 1 });
  });
  it("reads RATE_LIMIT_IP_HEADER and RATE_LIMIT_PROXY_HOPS", () => {
    expect(clientIpConfig({ RATE_LIMIT_IP_HEADER: "CF-Connecting-IP", RATE_LIMIT_PROXY_HOPS: "2" })).toEqual({
      source: "cf-connecting-ip",
      hops: 2,
    });
    expect(clientIpConfig({ RATE_LIMIT_IP_HEADER: "bogus", RATE_LIMIT_PROXY_HOPS: "-3" })).toEqual({
      source: "x-forwarded-for",
      hops: 1,
    });
  });
});

describe("trpcProcedures", () => {
  it("splits batched paths, decoding escaped commas", () => {
    expect(trpcProcedures("/api/trpc/tags.resolve")).toEqual(["tags.resolve"]);
    expect(trpcProcedures("/api/trpc/groups.get,tags.complete,tags.undo")).toEqual(["groups.get", "tags.complete", "tags.undo"]);
    expect(trpcProcedures("/api/trpc/groups.get%2Ctags.complete")).toEqual(["groups.get", "tags.complete"]);
    expect(trpcProcedures("/t/abc")).toEqual([]);
  });
});
