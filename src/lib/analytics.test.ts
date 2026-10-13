import { describe, expect, it } from "vitest";
import { analyticsConfig, stripIdsFromPath } from "./analytics";

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

describe("analyticsConfig", () => {
  it("is off unless a known provider and a site id are set", () => {
    expect(analyticsConfig({})).toBeNull();
    expect(analyticsConfig({ ANALYTICS_PROVIDER: "plausible" })).toBeNull();
    expect(analyticsConfig({ ANALYTICS_PROVIDER: "matomo", ANALYTICS_SITE_ID: "1" })).toBeNull();
  });
  it("defaults the script URL per provider and allows a self-hosted one", () => {
    expect(analyticsConfig({ ANALYTICS_PROVIDER: "Plausible", ANALYTICS_SITE_ID: "yakka.example" })).toEqual({
      provider: "plausible",
      siteId: "yakka.example",
      scriptUrl: "https://plausible.io/js/script.manual.js",
    });
    expect(
      analyticsConfig({ ANALYTICS_PROVIDER: "umami", ANALYTICS_SITE_ID: "abc", ANALYTICS_SCRIPT_URL: "https://u.example/s.js" }),
    ).toMatchObject({ provider: "umami", scriptUrl: "https://u.example/s.js" });
  });
});
