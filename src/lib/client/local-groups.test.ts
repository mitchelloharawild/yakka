import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
