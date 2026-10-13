"use client";

import { Share, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isIos, isStandalone } from "./platform";

/** Chrome's (non-standard) install event. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "yakka.installPromptDismissed";

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Suggests installing the app. On Android/desktop Chrome it shows an Install
 * button (from `beforeinstallprompt`); on iOS Safari, where there's no such
 * event, it explains "Share → Add to Home Screen" (needed for notifications).
 * Hidden when already installed, unsupported, or dismissed (remembered in
 * localStorage). Place it e.g. on the home page or in group settings.
 */
export function InstallPrompt({ className }: { className?: string }) {
  const t = useTranslations("pwa.install");
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || dismissed()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
      setMode("prompt");
    };
    const onInstalled = () => setMode("hidden");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // iOS Safari (only Safari can add to the Home Screen before iOS 16.4; others can since).
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isIos()) timer = setTimeout(() => setMode("ios"), 0);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (mode === "hidden") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // storage blocked: just hide for this visit
    }
    setMode("hidden");
  };

  const install = async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => null);
    setEvent(null);
    setMode("hidden");
  };

  return (
    <div className={cn("relative flex flex-col gap-2 rounded-xl border bg-card p-4 pr-10 text-sm", className)}>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-2 right-2"
        onClick={dismiss}
        aria-label={t("dismiss")}
      >
        <X aria-hidden />
      </Button>
      {mode === "prompt" ? (
        <>
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground">{t("body")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={install}>
              {t("action")}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              {t("dismiss")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="font-medium">{t("iosTitle")}</p>
          <p className="flex items-center gap-1 text-muted-foreground">
            <Share className="size-4" aria-hidden />
            {t("iosSteps")}
          </p>
          <p className="text-muted-foreground">{t("iosNote")}</p>
        </>
      )}
    </div>
  );
}
