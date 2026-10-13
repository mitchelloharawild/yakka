import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone for the Docker image (Agent D).
  // Opt-in, because `next start` refuses to run a standalone build.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  // Native modules must not be bundled.
  serverExternalPackages: ["better-sqlite3", "web-push"],
  // The service worker (src/app/sw.js/route.ts, prerendered at build time)
  // must never be served stale, and may control the whole origin. The route
  // sets these too; this also covers platforms that serve the prerendered
  // body without the handler's headers.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  turbopack: {
    // There's a stray package-lock.json in a parent directory; pin the root.
    root: __dirname,
    resolveAlias: {
      // What `createNextIntlPlugin("./src/i18n/request.ts")` would add. We set
      // it by hand because the plugin eagerly loads @swc/core (for its message
      // extractor, which we don't use), whose native binary refuses to load
      // when ~/.cache is group-writable. Turbopack needs a relative path here.
      "next-intl/config": "./src/i18n/request.ts",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
