import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { OfflineQueueIndicator } from "@/components/pwa/offline-queue-indicator";
import { ReloadButton } from "@/components/pwa/reload-button";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/**
 * Offline fallback. Precached by the service worker (src/app/sw.ts) and served
 * for any page navigation that fails with no cached copy. Fully static.
 */
export default function OfflinePage() {
  const t = useTranslations("pwa.offline");
  return (
    <section className="flex flex-col items-center gap-4 py-16 text-center">
      <WifiOff className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-prose text-muted-foreground">{t("body")}</p>
      <OfflineQueueIndicator />
      <div className="flex gap-2">
        <ReloadButton>{t("retry")}</ReloadButton>
        <Button variant="outline" asChild>
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </section>
  );
}
