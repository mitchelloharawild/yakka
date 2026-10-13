import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * `scope: "/"` covers /t/{token}, so on Android a tag scan opens the installed
 * app; `launch_handler` reuses an open window instead of stacking new ones.
 * (iOS ignores both: scans always open Safari. See ARCHITECTURE §3.)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Yakka",
    short_name: "Yakka",
    description: "Share the yakka: account-less household chores, ticked off with a tap.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#15803d",
    categories: ["lifestyle", "productivity", "utilities"],
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
