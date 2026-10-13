import { describe, expect, it } from "vitest";
import { stripIdsFromPath } from "./analytics";

describe("stripIdsFromPath", () => {
  it("replaces group ids", () => {
    expect(stripIdsFromPath("/groups/0gZ1o0Viuau7yPexK9ffYh")).toBe("/groups/[groupId]");
    expect(stripIdsFromPath("/groups/0gZ1o0Viuau7yPexK9ffYh/settings")).toBe("/groups/[groupId]/settings");
  });

  it("replaces tag tokens and hook secrets", () => {
    expect(stripIdsFromPath("/t/6zz2a37kp4sa")).toBe("/t/[token]");
    expect(stripIdsFromPath("/api/hooks/abcDEF123456")).toBe("/api/hooks/[secret]");
  });

  it("replaces cuids anywhere and REST group ids", () => {
    expect(stripIdsFromPath("/groups/0gZ1o0Viuau7yPexK9ffYh/chores/cmgo8x0b80001xyzabcdefghi")).toBe(
      "/groups/[groupId]/chores/[id]",
    );
    expect(
      stripIdsFromPath("/api/v1/groups/0gZ1o0Viuau7yPexK9ffYh/chores/cmgo8x0b80001xyzabcdefghi/complete"),
    ).toBe("/api/v1/groups/[groupId]/chores/[id]/complete");
  });

  it("drops query strings and hashes", () => {
    expect(stripIdsFromPath("/groups/0gZ1o0Viuau7yPexK9ffYh?as=cmgo8x0b80001xyzabcdefghi#x")).toBe(
      "/groups/[groupId]",
    );
  });

  it("leaves other paths alone", () => {
    expect(stripIdsFromPath("/")).toBe("/");
    expect(stripIdsFromPath("/offline")).toBe("/offline");
    expect(stripIdsFromPath("/groups")).toBe("/groups");
    expect(stripIdsFromPath("/groups/")).toBe("/groups/");
  });
});
