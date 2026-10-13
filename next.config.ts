import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Native modules must not be bundled.
  serverExternalPackages: ["better-sqlite3", "web-push"],
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
