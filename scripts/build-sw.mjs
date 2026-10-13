#!/usr/bin/env node
/**
 * Bundles the service worker source: src/app/sw.ts -> .sw/sw.js.
 *
 * Runs BEFORE `next build` (see the "build" npm script). The bundle is not
 * served as-is: the route handler src/app/sw.js/route.ts reads it while
 * `next build` prerenders that route, injects the precache manifest (the
 * hashed files in .next/static, which exist by then) and so /sw.js becomes a
 * static build output. Nothing is written to public/ after `next build`,
 * which deployment adapters (Vercel's included) would not pick up.
 *
 * We bundle with esbuild directly instead of @serwist/turbopack /
 * @serwist/next: those pull in @swc/core, whose native binary refuses to load
 * on machines where ~/.cache is group-writable. esbuild ships its native
 * binary inside node_modules, so it is unaffected.
 *
 *   node scripts/build-sw.mjs          # minified (production)
 *   node scripts/build-sw.mjs --dev    # unminified, inline source map (for trying the SW with `next dev`)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");
const outfile = path.join(root, ".sw/sw.js");

/** Replaced with the precache manifest (a JSON array) by src/app/sw.js/route.ts. */
const PLACEHOLDER = "__YAKKA_PRECACHE_MANIFEST__";

await build({
  entryPoints: [path.join(root, "src/app/sw.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome109", "safari16.4", "firefox115"],
  minify: !dev,
  // A separate .map file would have to be served too; keep it inline in dev only.
  sourcemap: dev ? "inline" : false,
  tsconfig: path.join(root, "tsconfig.json"),
  define: {
    // An unbound global identifier survives minification unchanged.
    "self.__SW_MANIFEST": PLACEHOLDER,
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
  },
  logLevel: "warning",
});
console.log(`build-sw: wrote ${path.relative(root, outfile)}`);
