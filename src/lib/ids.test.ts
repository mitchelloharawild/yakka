import { describe, expect, it } from "vitest";
import {
  GROUP_ID_LENGTH,
  hashPin,
  hashToken,
  isPlausibleGroupId,
  isPlausibleTagToken,
  newApiToken,
  newGroupId,
  newTagToken,
  newWebhookSecret,
  safeEqual,
  TAG_TOKEN_LENGTH,
  verifyPin,
} from "./ids";

describe("ids", () => {
  it("generates ids of the right shape", () => {
    const g = newGroupId();
    expect(g).toHaveLength(GROUP_ID_LENGTH);
    expect(isPlausibleGroupId(g)).toBe(true);
    const t = newTagToken();
    expect(t).toHaveLength(TAG_TOKEN_LENGTH);
    expect(t).not.toMatch(/[01ilo]/);
    expect(isPlausibleTagToken(t)).toBe(true);
    expect(newWebhookSecret()).toMatch(/^whsec_[0-9A-Za-z]{32}$/);
  });

  it("hashes API tokens", () => {
    const { token, hash, prefix } = newApiToken();
    expect(token.startsWith("yk_")).toBe(true);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.startsWith(prefix)).toBe(true);
  });

  it("compares safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });

  it("hashes and verifies PINs", async () => {
    const h = await hashPin("1234");
    expect(await verifyPin("1234", h)).toBe(true);
    expect(await verifyPin("4321", h)).toBe(false);
    expect(await verifyPin("1234", "garbage")).toBe(false);
  });
});
