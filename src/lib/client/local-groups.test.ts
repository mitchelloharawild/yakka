import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupFingerprint } from "@/lib/tags";
import * as lg from "./local-groups";

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  vi.stubGlobal("window", {
    localStorage: store,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  lg.__resetForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe("local groups", () => {
  it("starts empty and tolerates corrupt storage", () => {
    expect(lg.getLocalGroups()).toEqual([]);
    store.setItem(lg.GROUPS_KEY, "{not json");
    expect(lg.getLocalGroups()).toEqual([]);
    store.setItem(lg.GROUPS_KEY, JSON.stringify([{ id: "g1" }, { nope: true }, { id: "g1" }]));
    expect(lg.getLocalGroups()).toEqual([{ id: "g1", name: "", memberId: null, starred: false, lastOpened: 0 }]);
  });

  it("returns a stable snapshot until storage changes", () => {
    lg.touchGroup({ id: "g1", name: "Home" });
    const a = lg.getLocalGroups();
    expect(lg.getLocalGroups()).toBe(a);
    lg.setStarred("g1", true);
    expect(lg.getLocalGroups()).not.toBe(a);
  });

  it("touches, identifies, stars and removes", () => {
    const listener = vi.fn();
    const unsub = lg.subscribe(listener);
    lg.touchGroup({ id: "g1", name: "Home" });
    lg.setIdentity("g1", "m1");
    lg.setIdentity("g2", "m9", "Beach house");
    lg.setStarred("g2", true);
    expect(lg.getIdentity("g1")).toBe("m1");
    expect(lg.getLocalGroup("g2")).toMatchObject({ name: "Beach house", memberId: "m9", starred: true });
    expect(lg.sortLocalGroups(lg.getLocalGroups())[0].id).toBe("g2");
    lg.removeLocalGroup("g1");
    expect(lg.getLocalGroups().map((g) => g.id)).toEqual(["g2"]);
    expect(listener).toHaveBeenCalledTimes(5);
    unsub();
  });

  it("creates a device id lazily and keeps it", () => {
    expect(store.getItem(lg.DEVICE_ID_KEY)).toBeNull();
    const id = lg.getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lg.getDeviceId()).toBe(id);
    expect(lg.getActor("g1")).toEqual({ memberId: null, deviceId: id });
  });

  it("exports and imports", () => {
    lg.setIdentity("g1", "m1", "Home");
    const json = lg.exportLocalData();
    lg.__resetForTests();
    store.map.clear();
    lg.setIdentity("g2", "m2", "Other");
    expect(lg.importLocalData(json)).toBe(1);
    expect(lg.getLocalGroups().map((g) => g.id).sort()).toEqual(["g1", "g2"]);
    lg.importLocalData(json, "replace");
    expect(lg.getLocalGroups().map((g) => g.id)).toEqual(["g1"]);
    expect(() => lg.importLocalData('{"version":2}')).toThrow();
  });

  it("falls back to memory when storage throws", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    });
    lg.setIdentity("g1", "m1", "Home");
    expect(lg.getIdentity("g1")).toBe("m1");
  });
});

describe("tag identities", () => {
  const gid = "Xk3abcdefghijklmnopqrs";
  const fp = groupFingerprint(gid);

  it("stores, reads and forgets by fingerprint, ignoring junk", () => {
    expect(lg.getTagIdentity(fp)).toBeNull();
    lg.setTagIdentity(fp, "m1");
    expect(lg.getTagIdentity(fp)).toBe("m1");
    expect(JSON.parse(store.getItem(lg.TAG_IDENTITIES_KEY)!)[fp].memberId).toBe("m1");
    lg.setTagIdentity(fp, null);
    expect(lg.getTagIdentity(fp)).toBeNull();
    store.setItem(lg.TAG_IDENTITIES_KEY, JSON.stringify({ a: { memberId: "m2", savedAt: 1 }, b: { nope: 1 }, c: 5 }));
    expect(lg.getTagIdentities()).toEqual({ a: { memberId: "m2", savedAt: 1 } });
    store.setItem(lg.TAG_IDENTITIES_KEY, "[not json");
    expect(lg.getTagIdentities()).toEqual({});
  });

  it("adopts a tag identity when the group link is opened, then removes it", () => {
    lg.setTagIdentity(fp, "m1");
    lg.setTagIdentity("otherfingerprint", "m9");
    lg.touchGroup({ id: gid, name: "Home" }); // the group shell touches first
    expect(lg.adoptTagIdentity(gid, "Home")).toBe("m1");
    expect(lg.getIdentity(gid)).toBe("m1");
    expect(lg.getTagIdentity(fp)).toBeNull();
    expect(lg.getTagIdentity("otherfingerprint")).toBe("m9");
    expect(lg.adoptTagIdentity(gid)).toBeNull();
  });

  it("keeps an existing identity and drops archived/unknown members", () => {
    lg.setIdentity(gid, "mine", "Home");
    lg.setTagIdentity(fp, "m1");
    expect(lg.adoptTagIdentity(gid)).toBeNull();
    expect(lg.getIdentity(gid)).toBe("mine");
    expect(lg.getTagIdentity(fp)).toBe("m1"); // untouched: the group identity wins anyway

    lg.setIdentity(gid, null);
    expect(lg.adoptTagIdentity(gid, "Home", (id) => id !== "m1")).toBeNull();
    expect(lg.getIdentity(gid)).toBeNull();
    expect(lg.getTagIdentity(fp)).toBeNull();
  });

  it("round-trips through export/import and still reads old exports", () => {
    lg.setIdentity("g1", "m1", "Home");
    lg.setTagIdentity(fp, "m2");
    const json = lg.exportLocalData();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.tagIdentities[fp].memberId).toBe("m2");

    store.map.clear();
    lg.__resetForTests();
    lg.setTagIdentity("local", "m5");
    expect(lg.importLocalData(json)).toBe(1);
    expect(lg.getTagIdentity(fp)).toBe("m2");
    expect(lg.getTagIdentity("local")).toBe("m5"); // merged
    lg.importLocalData(json, "replace");
    expect(lg.getTagIdentity("local")).toBeNull();

    // An export from before tag identities existed.
    const old = JSON.stringify({ version: 1, groups: [{ id: "g3", name: "Old", memberId: "m3", starred: false, lastOpened: 1 }] });
    expect(lg.importLocalData(old)).toBe(1);
    expect(lg.getIdentity("g3")).toBe("m3");
    expect(lg.getTagIdentity(fp)).toBe("m2"); // merge leaves tag identities alone
    // No tag identities: the key is omitted from the export.
    store.map.clear();
    lg.__resetForTests();
    expect(JSON.parse(lg.exportLocalData())).toEqual({ version: 1, groups: [] });
  });
});
