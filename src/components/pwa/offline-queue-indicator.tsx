"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { countQueued, replayQueue, subscribeQueue } from "@/lib/client/offline-queue";
import { cn } from "@/lib/utils";

/** Number of completions waiting in the offline queue; live across tabs. 0 on the server. */
export function useOfflineQueueCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    countQueued()
      .then((n) => alive && setCount(n))
      .catch(() => {});
    const unsubscribe = subscribeQueue((message) => {
      if (message.type === "changed") setCount(message.count);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return count;
}

/**
 * "N completions waiting to sync" with a Sync now button. Renders nothing
 * when the queue is empty. `floating` pins it to the bottom of the screen
 * (used once in the root layout); `inline` fits into a page.
 *
 * With `announce`, also toasts the outcome of replays (from any tab or the
 * service worker). Only one mounted instance should announce.
 */
export function OfflineQueueIndicator({
  variant = "inline",
  announce = false,
  className,
}: {
  variant?: "inline" | "floating";
  announce?: boolean;
  className?: string;
}) {
  const t = useTranslations("pwa.queue");
  const count = useOfflineQueueCount();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!announce) return;
    return subscribeQueue((message) => {
      if (message.type !== "replayed") return;
      const { synced, rejected } = message.summary;
      if (synced) toast.success(t("synced", { count: synced }));
      if (rejected.length) toast.error(t("rejected", { count: rejected.length }), { description: t("rejectedHint") });
    });
  }, [announce, t]);

  if (count === 0) return null;

  const syncNow = async () => {
    setSyncing(true);
    try {
      await replayQueue();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm shadow-sm",
        variant === "floating" &&
          "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2",
        className,
      )}
    >
      <CloudOff className="size-4 text-muted-foreground" aria-hidden />
      <span>{t("waiting", { count })}</span>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={syncNow} disabled={syncing}>
        <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} aria-hidden />
        {syncing ? t("syncing") : t("syncNow")}
      </Button>
    </div>
  );
}
