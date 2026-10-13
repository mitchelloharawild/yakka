/**
 * GET /sw.js: the service worker.
 *
 * `scripts/build-sw.mjs` bundles src/app/sw.ts to .sw/sw.js before
 * `next build`; this handler injects the precache manifest. It reads neither
 * the request nor any runtime data, so `next build` prerenders it (at which
 * point .next/static is complete) and /sw.js ships as a static build output
 * on every target: Vercel, `next start` and the Docker standalone server.
 * See docs/DEPLOYMENT.md, "Service worker".
 */
import fs from "node:fs";
import path from "node:path";
import { buildPrecacheManifest } from "@/lib/sw-manifest";

const PLACEHOLDER = "__YAKKA_PRECACHE_MANIFEST__";

export function GET() {
  let source: string;
  try {
    source = fs.readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), ".sw", "sw.js"), "utf8");
  } catch {
    return new Response("// Service worker not built: run `npm run sw:build` (or `npm run build`).\n", {
      status: 404,
      headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  // In `next dev` there is nothing hashed to precache.
  const manifest = process.env.NODE_ENV === "production" ? buildPrecacheManifest() : [];
  return new Response(source.replaceAll(PLACEHOLDER, JSON.stringify(manifest)), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
