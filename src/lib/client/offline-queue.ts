/**
 * Offline completion queue (ARCHITECTURE §3, "Offline"). OWNED BY: Agent D.
 *
 * Completions that couldn't reach the server are stored in IndexedDB and
 * replayed to `POST /api/offline/replay` (contract in
 * src/app/api/offline/replay/protocol.ts) later:
 *
 * - by Background Sync (Chrome/Android): enqueueing registers the sync tag
 *   OFFLINE_SYNC_TAG and the service worker (src/app/sw.ts) replays it, even
 *   after the tab has closed;
 * - on app open, the `online` event and when the page becomes visible
 *   (`<ServiceWorkerRegistration />` in src/components/pwa wires these up).
 *   This is the only path on iOS/Safari and Firefox, which lack Background
 *   Sync.
 *
 * Replays are idempotent (see src/app/api/offline/replay/replay.ts): each item
 * carries a client id and the `completedAt` stamped when it was queued.
 *
 * Works in both window and service-worker contexts. Every function is a
 * no-op (or returns empty) where IndexedDB is unavailable, e.g. on the server.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ReplayItem, ReplayResponse, ReplayResult } from "@/app/api/offline/replay/protocol";

/** Background Sync tag registered by the queue and handled by the service worker. */
export const OFFLINE_SYNC_TAG = "yakka-offline-replay";
/** Endpoint the queue replays to. */
export const OFFLINE_REPLAY_ENDPOINT = "/api/offline/replay";

const DB_NAME = "yakka-offline";
const STORE = "completions";
const CHANNEL = "yakka-offline-queue";
const LOCK = "yakka-offline-replay";
const BATCH = 25;

/** A tag (QR/NFC) completion; Agent B queues these from /t/{token}. */
export interface TagCompletionInput {
  token: string;
  memberId: string;
  deviceId: string;
  /** ISO timestamp of the tap. Stamp it once; it is part of the dedupe key. */
  completedAt: string;
}

/** A completion from the group UI. */
export interface ManualCompletionInput {
  kind: "manual";
  groupId: string;
  choreId: string;
  memberId: string;
  deviceId: string;
  completedAt: string;
}

/** What is stored: the wire item plus bookkeeping. */
export type QueuedCompletion = ReplayItem & {
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

/** Outcome of one replayQueue() run. */
export interface ReplaySummary {
  /** Recorded now, or already recorded earlier. */
  synced: number;
  /** Permanently refused and dropped from the queue, with the reason. */
  rejected: ReplayResult[];
  /** Still queued (offline, server error, or a replay already running). */
  remaining: number;
}

/** Messages broadcast to every tab and the service worker. */
export type QueueMessage = { type: "changed"; count: number } | { type: "replayed"; summary: ReplaySummary };

interface QueueDB extends DBSchema {
  completions: { key: string; value: QueuedCompletion };
}

let dbPromise: Promise<IDBPDatabase<QueueDB>> | null = null;

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function db(): Promise<IDBPDatabase<QueueDB>> {
  dbPromise ??= openDB<QueueDB>(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(STORE, { keyPath: "id" });
    },
  });
  return dbPromise;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// A BroadcastChannel delivers to every *other* channel object with the same
// name, including ones in this context, so subscribers each open their own.
// Where BroadcastChannel is missing, fall back to an in-context EventTarget.
const hasChannel = typeof BroadcastChannel !== "undefined";
const local: EventTarget | null = !hasChannel && typeof EventTarget !== "undefined" ? new EventTarget() : null;

function broadcast(message: QueueMessage) {
  if (hasChannel) {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(message);
    channel.close();
  } else {
    local?.dispatchEvent(new CustomEvent<QueueMessage>("message", { detail: message }));
  }
}

async function add(item: ReplayItem): Promise<void> {
  if (!available()) return;
  const entry: QueuedCompletion = { ...item, queuedAt: new Date().toISOString(), attempts: 0 };
  const database = await db();
  await database.put(STORE, entry);
  broadcast({ type: "changed", count: await database.count(STORE) });
  await requestBackgroundSync();
  // If we're actually online (e.g. the request failed for another reason),
  // try right away; failures just leave the item queued.
  if (typeof navigator !== "undefined" && navigator.onLine) void replayQueue().catch(() => {});
}

/**
 * Queue a tag completion for replay. Agent B calls this from /t/{token} when
 * the completion POST fails because the device is offline.
 */
export async function enqueueCompletion(item: {
  token: string;
  memberId: string;
  deviceId: string;
  completedAt: string;
}): Promise<void> {
  await add({ id: newId(), kind: "tag", ...item });
}

/** Queue a manual completion from the group UI for replay. */
export async function enqueueManualCompletion(item: ManualCompletionInput): Promise<void> {
  await add({ id: newId(), ...item });
}

/** All queued completions, oldest `completedAt` first. */
export async function listQueued(): Promise<QueuedCompletion[]> {
  if (!available()) return [];
  const all = await (await db()).getAll(STORE);
  return all.sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
}

/** Number of queued completions. */
export async function countQueued(): Promise<number> {
  if (!available()) return 0;
  return (await db()).count(STORE);
}

/**
 * Listen for queue changes in this and other tabs (and the service worker).
 * Returns an unsubscribe function.
 */
export function subscribeQueue(listener: (message: QueueMessage) => void): () => void {
  if (hasChannel) {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<QueueMessage>) => listener(e.data);
    return () => channel.close();
  }
  const onLocal = (e: Event) => listener((e as CustomEvent<QueueMessage>).detail);
  local?.addEventListener("message", onLocal);
  return () => local?.removeEventListener("message", onLocal);
}

/**
 * Ask the service worker to replay when connectivity returns (Background
 * Sync). Resolves false where unsupported (iOS, Firefox) or without a service
 * worker; the window-side triggers cover those.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  try {
    // In the service worker itself the sync event is what's calling us.
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    const sync = (registration as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined)
      ?.sync;
    if (!sync) return false;
    await sync.register(OFFLINE_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

let running: Promise<ReplaySummary> | null = null;

/**
 * Replay everything in the queue. Safe to call often and from several places
 * at once: runs are serialised within a context, and across tabs and the
 * service worker with the Web Locks API where available (the server dedupes
 * anyway). Never throws for network errors; returns what's left.
 */
export function replayQueue(): Promise<ReplaySummary> {
  if (!available()) return Promise.resolve({ synced: 0, rejected: [], remaining: 0 });
  running ??= withLock(replayOnce).finally(() => {
    running = null;
  });
  return running;
}

async function withLock(fn: () => Promise<ReplaySummary>): Promise<ReplaySummary> {
  const locks = (typeof navigator !== "undefined" ? navigator.locks : undefined) as LockManager | undefined;
  if (!locks?.request) return fn();
  const result = await locks.request(LOCK, { ifAvailable: true }, async (lock) => (lock ? fn() : null));
  return result ?? { synced: 0, rejected: [], remaining: await countQueued() };
}

async function replayOnce(): Promise<ReplaySummary> {
  const database = await db();
  const queued = await listQueued();
  const summary: ReplaySummary = { synced: 0, rejected: [], remaining: queued.length };
  if (queued.length === 0) return summary;

  for (let i = 0; i < queued.length; i += BATCH) {
    const batch = queued.slice(i, i + BATCH);
    let response: ReplayResponse;
    try {
      const res = await fetch(OFFLINE_REPLAY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch.map(toWire) }),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      response = (await res.json()) as ReplayResponse;
    } catch (e) {
      // Offline, rate-limited or server down: keep everything for next time.
      const message = e instanceof Error ? e.message : String(e);
      const tx = database.transaction(STORE, "readwrite");
      for (const item of batch) await tx.store.put({ ...item, attempts: item.attempts + 1, lastError: message });
      await tx.done;
      break;
    }

    const byId = new Map(response.results.map((r) => [r.id, r]));
    const tx = database.transaction(STORE, "readwrite");
    for (const item of batch) {
      const result = byId.get(item.id);
      if (!result || result.status === "retry") {
        await tx.store.put({ ...item, attempts: item.attempts + 1, lastError: result?.reason ?? "NO_RESULT" });
        continue;
      }
      await tx.store.delete(item.id);
      if (result.status === "rejected") summary.rejected.push(result);
      else summary.synced++;
    }
    await tx.done;
  }

  summary.remaining = await database.count(STORE);
  broadcast({ type: "changed", count: summary.remaining });
  if (summary.synced || summary.rejected.length) broadcast({ type: "replayed", summary });
  return summary;
}

function toWire(item: QueuedCompletion): ReplayItem {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { queuedAt, attempts, lastError, ...wire } = item;
  return wire as ReplayItem;
}
