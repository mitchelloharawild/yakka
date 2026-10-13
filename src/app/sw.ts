/// <reference lib="webworker" />
/**
 * Service worker source, bundled to public/sw.js by scripts/build-sw.mjs
 * (esbuild) after `next build`. OWNED BY: Agent D. Not a route: Next ignores
 * this file.
 *
 * Caching (GET only; the Cache API never stores POSTs, so tRPC mutations,
 * completions and replays always hit the network):
 * - precache: hashed /_next/static assets, icons and the /offline fallback;
 * - pages and RSC payloads: network-first, falling back to cache, then to
 *   /offline for documents;
 * - /t/{token}: network-first too. The page is side-effect free (completion
 *   is a separate POST from client JS), so a cached shell is safe: offline,
 *   it renders and queues the completion in IndexedDB;
 * - tRPC queries: network-first, so the dashboard shows the last known data
 *   offline;
 * - every other /api/* route: network-only;
 * - other same-origin static files: stale-while-revalidate.
 */
import type { PrecacheEntry, RouteMatchCallbackOptions, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
import { OFFLINE_SYNC_TAG, replayQueue } from "@/lib/client/offline-queue";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    /** Replaced at build time with the precache manifest. */
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Payload contract of a Web Push message (sent by src/lib/integrations/push.ts). */
export interface PushPayload {
  title: string;
  body: string;
  /** Opened when the notification is clicked; same-origin path or URL. */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
}

const sameOrigin = (url: URL) => url.origin === self.location.origin;
const day = 24 * 60 * 60;

const expire = (maxEntries: number, maxAgeSeconds: number) =>
  new ExpirationPlugin({ maxEntries, maxAgeSeconds, maxAgeFrom: "last-used" });

const isRsc = (request: Request) => request.headers.get("RSC") === "1";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // tRPC queries (GET). Mutations are POSTs and never reach a cache.
      matcher: ({ url }: RouteMatchCallbackOptions) => sameOrigin(url) && url.pathname.startsWith("/api/trpc/"),
      handler: new NetworkFirst({ cacheName: "trpc-queries", networkTimeoutSeconds: 5, plugins: [expire(64, day)] }),
    },
    {
      // Health, cron, REST, hooks, offline replay, ...: never cached.
      matcher: ({ url }: RouteMatchCallbackOptions) => sameOrigin(url) && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }: RouteMatchCallbackOptions) => sameOrigin(url) && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: "next-static", plugins: [expire(256, 30 * day)] }),
    },
    {
      matcher: ({ url }: RouteMatchCallbackOptions) => sameOrigin(url) && url.pathname.startsWith("/t/"),
      handler: new NetworkFirst({ cacheName: "tag-pages", networkTimeoutSeconds: 4, plugins: [expire(32, 14 * day)] }),
    },
    {
      matcher: ({ request, url }: RouteMatchCallbackOptions) => sameOrigin(url) && isRsc(request),
      handler: new NetworkFirst({ cacheName: "pages-rsc", networkTimeoutSeconds: 4, plugins: [expire(64, 7 * day)] }),
    },
    {
      matcher: ({ request, url }: RouteMatchCallbackOptions) => sameOrigin(url) && request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: "pages", networkTimeoutSeconds: 4, plugins: [expire(32, 7 * day)] }),
    },
    {
      matcher: ({ request, url }: RouteMatchCallbackOptions) =>
        sameOrigin(url) && ["style", "script", "image", "font", "manifest"].includes(request.destination),
      handler: new StaleWhileRevalidate({ cacheName: "static", plugins: [expire(128, 30 * day)] }),
    },
  ],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();

// Web Push --------------------------------------------------------------------

function parsePush(event: PushEvent): PushPayload {
  const fallback: PushPayload = { title: "Yakka", body: "", url: "/" };
  if (!event.data) return fallback;
  try {
    const data = event.data.json() as Partial<PushPayload>;
    return {
      title: typeof data.title === "string" && data.title ? data.title : fallback.title,
      body: typeof data.body === "string" ? data.body : "",
      url: typeof data.url === "string" && data.url ? data.url : "/",
      tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
    };
  } catch {
    return { ...fallback, body: event.data.text() };
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePush(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data as { url?: string } | null)?.url ?? "/";
  let target = new URL(raw, self.location.origin);
  // Only ever open our own pages.
  if (!sameOrigin(target)) target = new URL("/", self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = windows.find((c) => c.url === target.href);
      if (exact) return void (await exact.focus());
      const any = windows.find((c) => sameOrigin(new URL(c.url)));
      if (any) {
        const navigated = await any.navigate(target.href).catch(() => null);
        return void (await (navigated ?? any).focus());
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

// Background Sync: replay the offline completion queue -------------------------

interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  readonly lastChance: boolean;
}

self.addEventListener("sync", ((event: SyncEvent) => {
  if (event.tag !== OFFLINE_SYNC_TAG) return;
  event.waitUntil(
    replayQueue().then((summary) => {
      // Rejecting asks the browser to retry the sync later (with backoff).
      if (summary.remaining > 0 && !event.lastChance) throw new Error(`${summary.remaining} completions still queued`);
    }),
  );
}) as EventListener);
