"use client";

import { useEffect } from "react";
import { replayQueue } from "@/lib/client/offline-queue";
import { serviceWorkerEnabled } from "./platform";

/**
 * Registers /sw.js (production builds, or with NEXT_PUBLIC_ENABLE_SW=true in
 * dev) and replays the offline completion queue on app open, when the
 * browser comes back online and whenever the page becomes visible. Those
 * triggers are what make the queue work on iOS, which has no Background
 * Sync. Mounted once in the root layout; renders nothing.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (serviceWorkerEnabled() && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((e) => console.warn("Service worker registration failed", e));
    }

    const replay = () => {
      if (navigator.onLine) void replayQueue().catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") replay();
    };
    replay();
    window.addEventListener("online", replay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", replay);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
