import { describe, expect, it } from "vitest";
import { MAX_LOCK_MS, PER_CLIENT, PER_GROUP, PinAttemptLimiter } from "./pin-limiter";

const T0 = 1_800_000_000_000;

describe("PinAttemptLimiter", () => {
  it("locks a client out after 5 wrong PINs, then backs off exponentially", () => {
    const l = new PinAttemptLimiter();
    for (let i = 0; i < PER_CLIENT.free - 1; i++) {
      expect(l.check("g", "ip", T0).allowed).toBe(true);
      l.fail("g", "ip", T0);
    }
    expect(l.check("g", "ip", T0).allowed).toBe(true);
    l.fail("g", "ip", T0); // 5th
    expect(l.check("g", "ip", T0)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    // Another client of the same group isn't affected yet.
    expect(l.check("g", "other", T0).allowed).toBe(true);
    // After the lock, one more failure doubles it.
    const t1 = T0 + 30_000;
    expect(l.check("g", "ip", t1).allowed).toBe(true);
    l.fail("g", "ip", t1);
    expect(l.check("g", "ip", t1)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("a correct PIN resets the client's counter", () => {
    const l = new PinAttemptLimiter();
    for (let i = 0; i < PER_CLIENT.free - 1; i++) l.fail("g", "ip", T0);
    l.succeed("g", "ip");
    l.fail("g", "ip", T0);
    expect(l.check("g", "ip", T0).allowed).toBe(true);
  });

  it("locks the whole group when guesses come from many clients", () => {
    const l = new PinAttemptLimiter();
    for (let i = 0; i < PER_GROUP.free; i++) l.fail("g", `ip${i}`, T0);
    expect(l.check("g", "fresh-ip", T0)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(l.check("other-group", "fresh-ip", T0).allowed).toBe(true);
  });

  it("caps the lock and forgets old failures", () => {
    const l = new PinAttemptLimiter();
    let t = T0;
    for (let i = 0; i < 40; i++) {
      l.fail("g", "ip", t);
      t += MAX_LOCK_MS;
    }
    const res = l.check("g", "ip", t - MAX_LOCK_MS);
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.retryAfterSeconds).toBeLessThanOrEqual(MAX_LOCK_MS / 1000);
    expect(l.check("g", "ip", t + 7 * 60 * 60_000).allowed).toBe(true);
  });
});
