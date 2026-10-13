import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Precache manifest for the service worker, computed while `next build`
 * prerenders /sw.js (src/app/sw.js/route.ts), when .next/static is complete.
 *
 * - hashed `/_next/static/**` JS, CSS and fonts (no revision: the file names
 *   change with their content);
 * - icons and images in public/ (revisioned by content hash);
 * - the /offline fallback page and the web manifest, revisioned per build.
 */
export interface PrecacheEntry {
  url: string;
  revision: string | null;
}

const MAX_BYTES = 2 * 1024 * 1024;

function walk(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.isFile() ? [full] : [];
  });
}

const posix = (p: string) => p.split(path.sep).join("/");
const md5 = (data: string | Buffer) => createHash("md5").update(data).digest("hex");

export function buildPrecacheManifest(root: string = process.cwd()): PrecacheEntry[] {
  const entries: PrecacheEntry[] = [];

  const staticDir = path.join(root, ".next", "static");
  for (const file of walk(staticDir)) {
    if (!/\.(js|css|woff2?)$/.test(file) || fs.statSync(file).size > MAX_BYTES) continue;
    entries.push({ url: `/_next/static/${posix(path.relative(staticDir, file))}`, revision: null });
  }

  const publicDir = path.join(root, "public");
  for (const file of walk(publicDir)) {
    if (!/\.(png|svg|ico|webp)$/.test(file) || fs.statSync(file).size > MAX_BYTES) continue;
    entries.push({ url: `/${posix(path.relative(publicDir, file))}`, revision: md5(fs.readFileSync(file)) });
  }

  entries.sort((a, b) => a.url.localeCompare(b.url));
  // Changes whenever any built asset changes, i.e. on every meaningful build.
  const buildRevision = md5(entries.map((e) => `${e.url}@${e.revision ?? ""}`).join("\n"));
  entries.push({ url: "/offline", revision: buildRevision }, { url: "/manifest.webmanifest", revision: buildRevision });
  return entries;
}
