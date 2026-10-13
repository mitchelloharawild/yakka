/**
 * Offline completion queue. OWNED BY: Agent D (PWA).
 *
 * STUB created by Agent B so the tag page can call the seam. Agent D replaces
 * this with the IndexedDB queue + Background Sync replay (replay through the
 * `tags.complete` tRPC mutation with `completedAt`; the server-side debounce
 * makes replays idempotent). Keep the signature.
 */

/** One queued tap-to-complete. `completedAt` is the ISO timestamp of the tap. */
export interface QueuedCompletion {
  token: string;
  memberId: string;
  deviceId: string;
  completedAt: string;
}

const KEY = "yakka:offline-completions";

/** Queue a completion that couldn't be sent. Stub: only keeps it in localStorage. */
export async function enqueueCompletion(item: QueuedCompletion): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as QueuedCompletion[];
    list.push(item);
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: nothing more a stub can do.
  }
}
