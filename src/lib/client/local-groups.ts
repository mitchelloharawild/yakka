/**
 * Browser-side identity and recent groups (docs/ARCHITECTURE.md §4).
 *
 *   localStorage["groups"]        = [{ id, name, memberId, starred, lastOpened }]
 *   localStorage["deviceId"]      = crypto.randomUUID()
 *   localStorage["tagIdentities"] = { [groupFingerprint]: { memberId, savedAt } }
 *
 * `tagIdentities` holds identities picked on a tag page (/t/{token}) for a
 * group whose id this browser doesn't know: the tag only reveals the
 * group's fingerprint (src/lib/tags.ts). When the full group link is opened
 * later, adoptTagIdentity() moves the entry into `groups`.
 *
 * SSR-safe: nothing touches `window` at import time, and the React hooks
 * return an empty snapshot on the server and during hydration, then update.
 * All writes notify subscribers in this tab; other tabs are notified by the
 * browser's `storage` event. If storage is unavailable (private mode,
 * blocked cookies) an in-memory fallback is used for the session.
 */
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";
import { groupFingerprint } from "@/lib/tags";

/** localStorage key of the groups array. */
export const GROUPS_KEY = "groups";
/** localStorage key of this browser's device id. */
export const DEVICE_ID_KEY = "deviceId";
/** localStorage key of identities picked on tag pages, by group fingerprint. */
export const TAG_IDENTITIES_KEY = "tagIdentities";

const localGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  memberId: z.string().nullable().default(null),
  starred: z.boolean().default(false),
  /** Epoch milliseconds. */
  lastOpened: z.number().default(0),
});

/** One group remembered by this browser. */
export type LocalGroup = z.infer<typeof localGroupSchema>;

const tagIdentitySchema = z.object({
  memberId: z.string().min(1),
  /** Epoch milliseconds. */
  savedAt: z.number().default(0),
});

/** An identity picked on a tag page, stored under the group's fingerprint. */
export type TagIdentity = z.infer<typeof tagIdentitySchema>;

/**
 * Export format. Still version 1: `tagIdentities` was added as an optional
 * field, so files from before it import fine, and older importers (which
 * strip unknown keys) still accept new files.
 */
const exportSchema = z.object({
  version: z.literal(1),
  groups: z.array(localGroupSchema),
  tagIdentities: z.record(z.string(), z.unknown()).optional(),
});

/** Shape of exportLocalData() output. */
export type LocalDataExport = Omit<z.infer<typeof exportSchema>, "tagIdentities"> & {
  tagIdentities?: Record<string, TagIdentity>;
};

// ---------------------------------------------------------------------------
// Storage access
// ---------------------------------------------------------------------------

const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const EVENT = "yakka:local-groups";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.localStorage;
    const probe = "__yakka_probe__";
    s.setItem(probe, probe);
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  const s = storage();
  return s ? s.getItem(key) : (memory.get(key) ?? null);
}

function write(key: string, value: string) {
  const s = storage();
  if (s) {
    try {
      s.setItem(key, value);
    } catch {
      memory.set(key, value); // quota exceeded etc.
    }
  } else {
    memory.set(key, value);
  }
}

function notify() {
  for (const l of listeners) l();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/**
 * Subscribe to changes (this tab and other tabs). Returns an unsubscribe
 * function. Used by the hooks; call directly outside React.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === GROUPS_KEY || e.key === DEVICE_ID_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const EMPTY: LocalGroup[] = [];
let cacheRaw: string | null | undefined;
let cacheValue: LocalGroup[] = EMPTY;

function parseGroups(raw: string | null): LocalGroup[] {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return EMPTY;
    // Drop invalid entries instead of losing everything.
    const out: LocalGroup[] = [];
    const seen = new Set<string>();
    for (const item of data) {
      const r = localGroupSchema.safeParse(item);
      if (r.success && !seen.has(r.data.id)) {
        seen.add(r.data.id);
        out.push(r.data);
      }
    }
    return out;
  } catch {
    return EMPTY;
  }
}

/** All remembered groups, in storage order. Returns the same array instance until storage changes. */
export function getLocalGroups(): LocalGroup[] {
  const raw = read(GROUPS_KEY);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheValue = parseGroups(raw);
  }
  return cacheValue;
}

function saveGroups(groups: LocalGroup[]) {
  write(GROUPS_KEY, JSON.stringify(groups));
  notify();
}

function update(groupId: string, fn: (g: LocalGroup) => LocalGroup, create = true) {
  const groups = getLocalGroups();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) {
    if (!create) return;
    saveGroups([...groups, fn({ id: groupId, name: "", memberId: null, starred: false, lastOpened: 0 })]);
  } else {
    const next = groups.slice();
    next[idx] = fn(groups[idx]);
    saveGroups(next);
  }
}

/** One remembered group, or undefined. */
export function getLocalGroup(groupId: string): LocalGroup | undefined {
  return getLocalGroups().find((g) => g.id === groupId);
}

/** Starred first, then most recently opened. Pure; doesn't mutate. */
export function sortLocalGroups(groups: readonly LocalGroup[]): LocalGroup[] {
  return [...groups].sort((a, b) => Number(b.starred) - Number(a.starred) || b.lastOpened - a.lastOpened);
}

/**
 * Record that a group was opened: adds it to the recent list if missing,
 * refreshes its name and sets lastOpened to now. Call on every group visit.
 */
export function touchGroup(group: { id: string; name: string }): void {
  update(group.id, (g) => ({ ...g, name: group.name || g.name, lastOpened: Date.now() }));
}

/** Rename a remembered group locally (no-op if not remembered). */
export function renameLocalGroup(groupId: string, name: string): void {
  update(groupId, (g) => ({ ...g, name }), false);
}

/** Which member "you" are in a group, or null if not chosen yet. */
export function getIdentity(groupId: string): string | null {
  return getLocalGroup(groupId)?.memberId ?? null;
}

/**
 * Set (or clear with null) which member "you" are in a group. Adds the group
 * to the recent list if missing; pass `name` when known.
 */
export function setIdentity(groupId: string, memberId: string | null, name?: string): void {
  update(groupId, (g) => ({ ...g, memberId, name: name ?? g.name, lastOpened: g.lastOpened || Date.now() }));
}

/** Star or unstar a group (adds it if missing). */
export function setStarred(groupId: string, starred: boolean): void {
  update(groupId, (g) => ({ ...g, starred }));
}

/** Forget a group on this browser (does not delete it on the server). */
export function removeLocalGroup(groupId: string): void {
  const groups = getLocalGroups();
  if (groups.some((g) => g.id === groupId)) saveGroups(groups.filter((g) => g.id !== groupId));
}

// ---------------------------------------------------------------------------
// Tag identities (by group fingerprint)
// ---------------------------------------------------------------------------

/** Keep only well-formed entries. */
function cleanTagIdentities(data: unknown): Record<string, TagIdentity> {
  const out: Record<string, TagIdentity> = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [fp, v] of Object.entries(data)) {
    const r = tagIdentitySchema.safeParse(v);
    if (r.success) out[fp] = r.data;
  }
  return out;
}

/** All tag-page identities, keyed by group fingerprint. Corrupt storage reads as empty. */
export function getTagIdentities(): Record<string, TagIdentity> {
  try {
    const raw = read(TAG_IDENTITIES_KEY);
    return raw ? cleanTagIdentities(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveTagIdentities(all: Record<string, TagIdentity>) {
  write(TAG_IDENTITIES_KEY, JSON.stringify(all));
}

/** Member id remembered on a tag page for a group fingerprint, or null. */
export function getTagIdentity(fingerprint: string): string | null {
  return getTagIdentities()[fingerprint]?.memberId ?? null;
}

/** Remember (or forget, with null) the member for a group fingerprint. */
export function setTagIdentity(fingerprint: string, memberId: string | null): void {
  const all = getTagIdentities();
  if (memberId) all[fingerprint] = { memberId, savedAt: Date.now() };
  else if (fingerprint in all) delete all[fingerprint];
  else return;
  saveTagIdentities(all);
}

/**
 * Hand-over from a tag page to the full group link: if this browser has no
 * identity for `groupId` yet but picked one on one of its tags (stored by
 * fingerprint), adopt it with setIdentity() and drop the tag entry. Pass
 * `isActiveMember` to discard entries for members that no longer exist or
 * are archived. Returns the adopted member id, or null.
 */
export function adoptTagIdentity(
  groupId: string,
  groupName?: string,
  isActiveMember: (memberId: string) => boolean = () => true,
): string | null {
  if (getIdentity(groupId)) return null;
  const fingerprint = groupFingerprint(groupId);
  const all = getTagIdentities();
  const entry = all[fingerprint];
  if (!entry) return null;
  delete all[fingerprint];
  saveTagIdentities(all);
  if (!isActiveMember(entry.memberId)) return null;
  setIdentity(groupId, entry.memberId, groupName);
  return entry.memberId;
}

// ---------------------------------------------------------------------------
// Device id
// ---------------------------------------------------------------------------

function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for non-secure contexts (http on a LAN IP), where randomUUID is missing.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * This browser's device id, created on first call. Browser-only: throws on
 * the server. Attach it to mutations (`actor.deviceId`) for the audit log.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") throw new Error("getDeviceId() is browser-only");
  let id = read(DEVICE_ID_KEY);
  if (!id) {
    id = randomUUID();
    write(DEVICE_ID_KEY, id);
  }
  return id;
}

/** `{ memberId, deviceId }` for tRPC `actor` inputs. Browser-only. */
export function getActor(groupId: string): { memberId: string | null; deviceId: string } {
  return { memberId: getIdentity(groupId), deviceId: getDeviceId() };
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

/**
 * Serialise remembered groups and tag-page identities (not the device id,
 * which is per device) to JSON.
 */
export function exportLocalData(): string {
  const tagIdentities = getTagIdentities();
  const data: LocalDataExport = {
    version: 1,
    groups: getLocalGroups(),
    ...(Object.keys(tagIdentities).length ? { tagIdentities } : {}),
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Import data produced by exportLocalData(). "merge" (default) keeps local
 * groups and overwrites entries present in the import, keeping a local
 * identity when the import has none (tag identities merge the same way, by
 * fingerprint); "replace" discards local groups and tag identities.
 * Returns the number of imported groups. Throws on invalid input.
 */
export function importLocalData(json: string, mode: "merge" | "replace" = "merge"): number {
  const data = exportSchema.parse(JSON.parse(json));
  const byId = new Map<string, LocalGroup>(mode === "merge" ? getLocalGroups().map((g) => [g.id, g]) : []);
  for (const g of data.groups) {
    const existing = byId.get(g.id);
    byId.set(g.id, existing ? { ...existing, ...g, memberId: g.memberId ?? existing.memberId } : g);
  }
  const imported = cleanTagIdentities(data.tagIdentities);
  if (mode === "replace") saveTagIdentities(imported);
  else if (Object.keys(imported).length) saveTagIdentities({ ...getTagIdentities(), ...imported });
  saveGroups([...byId.values()]);
  return data.groups.length;
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

const getServerGroups = () => EMPTY;

/** Remembered groups (storage order; use sortLocalGroups for display). [] on the server / first render. */
export function useLocalGroups(): LocalGroup[] {
  return useSyncExternalStore(subscribe, getLocalGroups, getServerGroups);
}

/** One remembered group, or undefined. */
export function useLocalGroup(groupId: string): LocalGroup | undefined {
  return useLocalGroups().find((g) => g.id === groupId);
}

/**
 * Which member "you" are in `groupId`, plus a setter.
 * `hydrated` is false on the server and during hydration: don't show the
 * "Who are you?" prompt until it's true, or it flashes for known users.
 */
export function useIdentity(groupId: string): {
  memberId: string | null;
  setMemberId: (memberId: string | null, groupName?: string) => void;
  hydrated: boolean;
} {
  const groups = useLocalGroups();
  const hydrated = useHydrated();
  const memberId = groups.find((g) => g.id === groupId)?.memberId ?? null;
  const setMemberId = useCallback(
    (id: string | null, groupName?: string) => setIdentity(groupId, id, groupName),
    [groupId],
  );
  return { memberId, setMemberId, hydrated };
}

/** This browser's device id; null on the server and during hydration. */
export function useDeviceId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getDeviceId(),
    () => null,
  );
}

const noopSubscribe = () => () => {};

/** false on the server and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Test helper: clear the in-memory fallback and parse cache. */
export function __resetForTests(): void {
  memory.clear();
  cacheRaw = undefined;
  cacheValue = EMPTY;
}
