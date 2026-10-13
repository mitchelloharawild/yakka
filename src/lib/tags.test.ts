import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newGroupId } from "@/lib/ids";
import {
  canUseMembers,
  checkGroupClaim,
  checkTagUndo,
  checkTagUsable,
  FINGERPRINT_LENGTH,
  groupFingerprint,
  matchGroupByFingerprint,
  sha256Hex,
  undoRemainingMs,
  type PolicyTag,
} from "./tags";

const nodeSha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256Hex", () => {
  it("matches node:crypto for known vectors and assorted lengths", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const len of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const s = "x".repeat(len);
      expect(sha256Hex(s)).toBe(nodeSha(s));
    }
    expect(sha256Hex("Ünïcødé 🧹")).toBe(nodeSha("Ünïcødé 🧹"));
  });
});

describe("groupFingerprint", () => {
  it("is deterministic, short hex, and differs between groups", () => {
    const a = newGroupId();
    const b = newGroupId();
    expect(groupFingerprint(a)).toBe(groupFingerprint(a));
    expect(groupFingerprint(a)).toMatch(new RegExp(`^[0-9a-f]{${FINGERPRINT_LENGTH}}$`));
    expect(groupFingerprint(a)).not.toBe(groupFingerprint(b));
  });

  it("is domain-separated (not a bare hash of the id) and never contains the id", () => {
    const id = newGroupId();
    expect(groupFingerprint(id)).not.toBe(nodeSha(id).slice(0, FINGERPRINT_LENGTH));
    expect(groupFingerprint(id)).not.toContain(id);
    expect(groupFingerprint(id)).toBe(nodeSha(`yakka:group-fingerprint:v1:${id}`).slice(0, FINGERPRINT_LENGTH));
  });

  it("matches the right local group", () => {
    const ids = [newGroupId(), newGroupId(), newGroupId()];
    expect(matchGroupByFingerprint(groupFingerprint(ids[1]), ids)).toBe(ids[1]);
    expect(matchGroupByFingerprint(groupFingerprint(newGroupId()), ids)).toBeNull();
    expect(matchGroupByFingerprint(groupFingerprint(ids[0]), [])).toBeNull();
  });
});

const tag: PolicyTag = { id: "t1", groupId: "G1", choreId: "c1", revokedAt: null };

describe("tag-scope authorisation", () => {
  it("rejects unknown, revoked and deleted-group tags", () => {
    expect(checkTagUsable(null)).toEqual({ ok: false, reason: "TAG_NOT_FOUND" });
    expect(checkTagUsable({ ...tag, revokedAt: new Date() })).toEqual({ ok: false, reason: "TAG_REVOKED" });
    expect(checkTagUsable({ ...tag, groupDeletedAt: new Date() })).toEqual({ ok: false, reason: "TAG_NOT_FOUND" });
    expect(checkTagUsable(tag)).toEqual({ ok: true });
  });

  it("verifies a claimed group id", () => {
    expect(checkGroupClaim("G1", undefined).ok).toBe(true);
    expect(checkGroupClaim("G1", null).ok).toBe(true);
    expect(checkGroupClaim("G1", "G1").ok).toBe(true);
    expect(checkGroupClaim("G1", "G2")).toEqual({ ok: false, reason: "GROUP_MISMATCH" });
    expect(checkGroupClaim("G1", "G1x")).toEqual({ ok: false, reason: "GROUP_MISMATCH" });
    expect(checkGroupClaim("G1", "")).toEqual({ ok: false, reason: "GROUP_MISMATCH" });
  });

  it("only shows members when joinFromTag or the group id was proven", () => {
    expect(canUseMembers({ joinFromTag: true, groupVerified: false })).toBe(true);
    expect(canUseMembers({ joinFromTag: false, groupVerified: true })).toBe(true);
    expect(canUseMembers({ joinFromTag: false, groupVerified: false })).toBe(false);
  });

  describe("undo", () => {
    const now = new Date("2026-01-01T00:00:10Z");
    const completion = {
      tagId: "t1",
      deviceId: "d1",
      createdAt: new Date("2026-01-01T00:00:05Z"),
      undoneAt: null,
    };
    const base = { tag, completion, deviceId: "d1", undoSeconds: 10, now };

    it("allows the same tag + device within the window", () => {
      expect(checkTagUndo(base).ok).toBe(true);
    });
    it("refuses completions made another way or via another tag", () => {
      expect(checkTagUndo({ ...base, completion: { ...completion, tagId: null } }).ok).toBe(false);
      expect(checkTagUndo({ ...base, completion: { ...completion, tagId: "t2" } })).toEqual({
        ok: false,
        reason: "UNDO_NOT_ALLOWED",
      });
      expect(checkTagUndo({ ...base, completion: null }).ok).toBe(false);
    });
    it("refuses another device", () => {
      expect(checkTagUndo({ ...base, deviceId: "d2" })).toEqual({ ok: false, reason: "UNDO_NOT_ALLOWED" });
      expect(checkTagUndo({ ...base, deviceId: null }).ok).toBe(false);
    });
    it("expires after undoSeconds", () => {
      expect(checkTagUndo({ ...base, now: new Date("2026-01-01T00:00:15Z") }).ok).toBe(true);
      expect(checkTagUndo({ ...base, now: new Date("2026-01-01T00:00:16Z") })).toEqual({
        ok: false,
        reason: "UNDO_WINDOW_EXPIRED",
      });
    });
    it("is idempotent for already-undone completions", () => {
      const late = new Date("2026-01-01T01:00:00Z");
      expect(checkTagUndo({ ...base, now: late, completion: { ...completion, undoneAt: now } }).ok).toBe(true);
    });
    it("computes the remaining time", () => {
      expect(undoRemainingMs(completion.createdAt, 10, now)).toBe(5000);
      expect(undoRemainingMs(completion.createdAt, 10, new Date("2026-01-01T00:01:00Z"))).toBe(0);
    });
  });
});
