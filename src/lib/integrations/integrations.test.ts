import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BACKOFF_SCHEDULE_MS, MAX_ATTEMPTS, nextRetryAt, shouldAutoDisable } from "@/lib/integrations/backoff";
import { parseBearer } from "@/lib/integrations/bearer";
import { matchMember } from "@/lib/integrations/member-match";
import {
  DELIVERY_HEADER,
  deliveryHeaders,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  signPayload,
  TIMESTAMP_HEADER,
  verifySignature,
} from "@/lib/integrations/signing";
import { isPrivateAddress, validateWebhookUrl } from "@/lib/integrations/url-safety";

const secret = "whsec_test";
const body = JSON.stringify({ id: "evt_1", type: "chore.completed" });
const now = new Date("2026-03-01T10:00:00Z");
const ts = Math.floor(now.getTime() / 1000);

describe("signing", () => {
  it("signs `${timestamp}.${body}` with HMAC-SHA256", () => {
    const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(signPayload(secret, ts, body)).toBe(`sha256=${expected}`);
  });

  it("produces headers that verify", () => {
    const h = deliveryHeaders({ secret, rawBody: body, event: "chore.completed", deliveryId: "d1", now });
    expect(h[EVENT_HEADER]).toBe("chore.completed");
    expect(h[DELIVERY_HEADER]).toBe("d1");
    expect(h[TIMESTAMP_HEADER]).toBe(String(ts));
    expect(
      verifySignature({ secret, rawBody: body, signature: h[SIGNATURE_HEADER], timestamp: h[TIMESTAMP_HEADER], now }),
    ).toEqual({ ok: true });
  });

  it("rejects tampered bodies, wrong secrets and replayed timestamps", () => {
    const sig = signPayload(secret, ts, body);
    expect(verifySignature({ secret, rawBody: body + " ", signature: sig, timestamp: ts, now })).toEqual({
      ok: false,
      reason: "MISMATCH",
    });
    expect(verifySignature({ secret: "other", rawBody: body, signature: sig, timestamp: ts, now }).ok).toBe(false);
    // Same signature with a different timestamp fails (timestamp is signed).
    expect(verifySignature({ secret, rawBody: body, signature: sig, timestamp: ts + 1, now }).ok).toBe(false);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(verifySignature({ secret, rawBody: body, signature: sig, timestamp: ts, now: later })).toEqual({
      ok: false,
      reason: "TIMESTAMP_OUT_OF_RANGE",
    });
    expect(verifySignature({ secret, rawBody: body, signature: sig, timestamp: ts, now: later, toleranceSeconds: 0 }))
      .toEqual({ ok: true });
  });

  it("rejects missing or malformed headers", () => {
    expect(verifySignature({ secret, rawBody: body, signature: null, timestamp: ts, now }).ok).toBe(false);
    expect(verifySignature({ secret, rawBody: body, signature: "md5=abc", timestamp: ts, now })).toEqual({
      ok: false,
      reason: "MALFORMED",
    });
    expect(
      verifySignature({ secret, rawBody: body, signature: signPayload(secret, ts, body), timestamp: "abc", now }).ok,
    ).toBe(false);
  });
});

describe("backoff", () => {
  it("follows 1m, 5m, 30m, 2h, 12h then gives up", () => {
    const delays = [1, 2, 3, 4, 5].map((n) => nextRetryAt(n, now)!.getTime() - now.getTime());
    expect(delays).toEqual([...BACKOFF_SCHEDULE_MS]);
    expect(delays).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect(MAX_ATTEMPTS).toBe(6);
    expect(nextRetryAt(6, now)).toBeNull();
    expect(nextRetryAt(99, now)).toBeNull();
  });

  it("auto-disables after enough consecutive failures", () => {
    expect(shouldAutoDisable(0)).toBe(false);
    expect(shouldAutoDisable(14)).toBe(false);
    expect(shouldAutoDisable(15)).toBe(true);
  });
});

describe("parseBearer", () => {
  it("parses Bearer credentials case-insensitively", () => {
    expect(parseBearer("Bearer yk_abc")).toBe("yk_abc");
    expect(parseBearer("bearer   yk_abc  ")).toBe("yk_abc");
  });
  it("rejects anything else", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer a b")).toBeNull();
    expect(parseBearer(`Bearer ${"x".repeat(600)}`)).toBeNull();
  });
});

describe("matchMember", () => {
  const members = [
    { id: "m1", name: "Alice", archivedAt: null },
    { id: "m2", name: "Bob", archivedAt: null },
    { id: "m3", name: "bob", archivedAt: null },
    { id: "m4", name: "Carol", archivedAt: new Date() },
    { id: "m5", name: "Zoë", archivedAt: null },
  ];
  it("matches by id first, then by case-insensitive name", () => {
    expect(matchMember(members, "m2")).toEqual({ ok: true, member: members[1] });
    expect(matchMember(members, "  alice ")).toEqual({ ok: true, member: members[0] });
    expect(matchMember(members, "ZOË")).toEqual({ ok: true, member: members[4] });
  });
  it("reports ambiguous and unknown names", () => {
    expect(matchMember(members, "BOB")).toEqual({ ok: false, reason: "MEMBER_AMBIGUOUS" });
    expect(matchMember(members, "dave")).toEqual({ ok: false, reason: "MEMBER_NOT_FOUND" });
    expect(matchMember(members, "")).toEqual({ ok: false, reason: "MEMBER_NOT_FOUND" });
  });
  it("matches archived members only by id", () => {
    expect(matchMember(members, "carol")).toEqual({ ok: false, reason: "MEMBER_NOT_FOUND" });
    expect(matchMember(members, "m4")).toEqual({ ok: true, member: members[3] });
  });
});

describe("url safety", () => {
  it("accepts only http(s) without credentials", () => {
    expect(validateWebhookUrl("https://example.com/hook").ok).toBe(true);
    expect(validateWebhookUrl("http://192.168.1.10:8123/api/webhook/x").ok).toBe(true);
    expect(validateWebhookUrl("ftp://example.com")).toEqual({ ok: false, reason: "URL_SCHEME_NOT_ALLOWED" });
    expect(validateWebhookUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateWebhookUrl("https://user:pw@example.com").ok).toBe(false);
    expect(validateWebhookUrl("not a url").ok).toBe(false);
  });
  it("classifies private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
