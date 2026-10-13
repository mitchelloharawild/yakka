#!/usr/bin/env node
/**
 * Builds the service worker: src/app/sw.ts -> public/sw.js.
 *
 * Runs after `next build` (see the "build" npm script), because the precache
 * manifest lists the hashed files in .next/static. We bundle with esbuild
 * directly instead of @serwist/turbopack / @serwist/next: those pull in
 * @swc/core, whose native binary refuses to load on machines where ~/.cache
 * is group-writable, and @serwist/turbopack's route handler relies on route
 * segment config that Cache Components rejects. esbuild ships its native
 * binary inside node_modules, so it is unaffected.
 *
 *   node scripts/build-sw.mjs          # production bundle with precache manifest
 *   node scripts/build-sw.mjs --dev    # no manifest, unminified (for testing the SW with `next dev`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFileManifestEntries } from "@serwist/build";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");
const outfile = path.join(root, "public/sw.js");

let manifest = [];
if (!dev) {
  const buildIdFile = path.join(root, ".next/BUILD_ID");
  if (!fs.existsSync(buildIdFile)) {
    console.error("build-sw: .next/BUILD_ID not found; run `next build` first (or pass --dev).");
    process.exit(1);
  }
  const buildId = fs.readFileSync(buildIdFile, "utf8").trim();
  const result = await getFileManifestEntries({
    globDirectory: root,
    globPatterns: [".next/static/**/*.{js,css,woff,woff2}", "public/**/*.{png,svg,ico,webp}"],
    globIgnores: ["public/sw.js", "public/sw.js.map"],
    globFollow: true,
    globStrict: true,
    // Hashed file names: no ?__WB_REVISION__ needed.
    dontCacheBustURLsMatching: /^\/_next\/static\//,
    modifyURLPrefix: { ".next/": "/_next/", "public/": "/" },
    maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
    additionalPrecacheEntries: [
      // The offline fallback page (and the app shell it renders), revisioned per build.
      { url: "/offline", revision: buildId },
      { url: "/manifest.webmanifest", revision: buildId },
    ],
    disablePrecacheManifest: false,
    manifestTransforms: [],
  });
  for (const w of result.warnings) console.warn(`build-sw: ${w}`);
  manifest = result.manifestEntries ?? [];
  console.log(`build-sw: ${result.count} precache entries (${(result.size / 1024).toFixed(1)} KiB)`);
}

await build({
  entryPoints: [path.join(root, "src/app/sw.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome109", "safari16.4", "firefox115"],
  minify: !dev,
  sourcemap: true,
  tsconfig: path.join(root, "tsconfig.json"),
  define: {
    "self.__SW_MANIFEST": JSON.stringify(manifest),
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
  },
  logLevel: "warning",
});
console.log(`build-sw: wrote ${path.relative(root, outfile)}`);
