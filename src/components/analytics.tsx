"use client";

/**
 * Privacy-preserving page views for Plausible or Umami (ANALYTICS_PROVIDER).
 * Automatic tracking is off; every view reports stripIdsFromPath(pathname),
 * so group ids, tag tokens and the query string (`?as=`) never leave the
 * browser. Secret pages also set `referrer: no-referrer`.
 */
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useCallback, useEffect } from "react";
import { stripIdsFromPath, type AnalyticsConfig } from "@/lib/analytics";

type Plausible = ((event: string, opts?: { u?: string }) => void) & { q?: unknown[] };
type Umami = { track: (fn: (props: Record<string, unknown>) => Record<string, unknown>) => void };
declare global {
  interface Window {
    plausible?: Plausible;
    umami?: Umami;
  }
}

export function Analytics({ provider, siteId, scriptUrl }: AnalyticsConfig) {
  const pathname = usePathname();
  const track = useCallback(() => {
    const path = stripIdsFromPath(pathname ?? "/");
    if (provider === "plausible") window.plausible?.("pageview", { u: `${location.origin}${path}` });
    else window.umami?.track((props) => ({ ...props, url: path, referrer: "", title: "Yakka" }));
  }, [pathname, provider]);

  useEffect(() => {
    if (provider === "plausible" && !window.plausible) {
      // Queue calls made before the script has loaded (Plausible's documented stub).
      const stub: Plausible = (...args) => void (stub.q ??= []).push(args);
      window.plausible = stub;
    }
    track();
  }, [provider, track]);

  return provider === "plausible" ? (
    <Script src={scriptUrl} data-domain={siteId} strategy="afterInteractive" />
  ) : (
    <Script src={scriptUrl} data-website-id={siteId} data-auto-track="false" strategy="afterInteractive" onLoad={track} />
  );
}
