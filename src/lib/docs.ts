import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The markdown files in docs/ that are published at /docs/{slug}. The files
 * stay the source of truth (they also render on GitHub); links between them
 * (`API.md#x`) are rewritten to site URLs by `docHref`. NAMING.md is a
 * working note, so it isn't published.
 */
export const DOCS = [
  {
    slug: "deployment",
    file: "DEPLOYMENT.md",
    title: "Deployment",
    description: "Self-host with Docker (Postgres or SQLite) or deploy to Vercel: environment variables, HTTPS, VAPID keys and rate limiting.",
  },
  {
    slug: "api",
    file: "API.md",
    title: "API, hooks and webhooks",
    description: "The REST API, inbound hooks that complete a chore, and signed outbound webhooks with signature verification.",
  },
  {
    slug: "architecture",
    file: "ARCHITECTURE.md",
    title: "Architecture",
    description: "Data model, the tap-to-complete flow, identity in the browser, scheduling and deployment.",
  },
  {
    slug: "development",
    file: "DEVELOPMENT.md",
    title: "Development",
    description: "Code layout, conventions and the Next.js 16 and Prisma 7 gotchas for contributors.",
  },
] as const;

export type Doc = (typeof DOCS)[number];

export const REPO_URL = "https://github.com/mitchelloharawild/yakka";

export function findDoc(slug: string): Doc | undefined {
  return DOCS.find((d) => d.slug === slug);
}

/** The doc's markdown, read at build time (every doc page is prerendered). */
export async function loadDoc(doc: Doc): Promise<string> {
  "use cache";
  return readFile(path.join(process.cwd(), "docs", doc.file), "utf8");
}

/**
 * Where a link inside a doc should point on the site: other published docs
 * map to /docs/{slug}, other repo paths to GitHub, and anything absolute or
 * in-page is left alone.
 */
export function docHref(href: string): string {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href;
  const [target, hash] = href.split("#", 2);
  const anchor = hash ? `#${hash}` : "";
  const doc = DOCS.find((d) => d.file === path.posix.basename(target));
  if (doc) return `/docs/${doc.slug}${anchor}`;
  const repoPath = path.posix.normalize(path.posix.join("docs", target));
  return `${REPO_URL}/blob/main/${repoPath.replace(/^(\.\.\/)+/, "")}${anchor}`;
}
