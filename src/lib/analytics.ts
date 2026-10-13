/**
 * Analytics privacy helper (ARCHITECTURE §7, like Spliit). OWNED BY: Agent D.
 *
 * Group ids and tag tokens are access secrets, so they must never reach an
 * analytics provider. <Analytics /> (src/components/analytics.tsx) reports
 * `stripIdsFromPath(pathname)` instead of the real URL (and never the query
 * string: `?as=` carries a member id). Safe on server and client.
 */

const ID = /^c[a-z0-9]{20,32}$/; // cuid (members, chores, completions, ...)

/** [prefix segments, placeholders for the following segments] */
const ROUTES: Array<[string[], string[]]> = [
  [["groups"], ["[groupId]"]],
  [["t"], ["[token]"]],
  [["api", "hooks"], ["[secret]"]],
  [["api", "v1", "groups"], ["[groupId]"]],
];

/**
 * Replace secrets and ids in a path with placeholders and drop any query or
 * hash, e.g. `/groups/Xk3…/chores/cm1…?as=cm2…` → `/groups/[groupId]/chores/[id]`.
 */
export function stripIdsFromPath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  const segments = pathname.split("/");
  // segments[0] is "" for absolute paths.
  for (const [prefix, placeholders] of ROUTES) {
    if (prefix.every((p, i) => segments[i + 1] === p)) {
      placeholders.forEach((placeholder, i) => {
        const at = prefix.length + 1 + i;
        if (segments[at]) segments[at] = placeholder;
      });
    }
  }
  const out = segments.map((s) => (ID.test(s) ? "[id]" : s)).join("/");
  return out || "/";
}

/** Page-view analytics settings for <Analytics />. */
export interface AnalyticsConfig {
  provider: "plausible" | "umami";
  /** Plausible: the site's domain (data-domain). Umami: the website id. */
  siteId: string;
  scriptUrl: string;
}

const DEFAULT_SCRIPTS: Record<AnalyticsConfig["provider"], string> = {
  // The "manual" variant doesn't track on its own: we send stripped URLs.
  plausible: "https://plausible.io/js/script.manual.js",
  umami: "https://cloud.umami.is/script.js",
};

/**
 * Analytics settings from ANALYTICS_PROVIDER ("plausible" | "umami"),
 * ANALYTICS_SITE_ID and optional ANALYTICS_SCRIPT_URL (self-hosted
 * instances), or null when unset, unknown or incomplete. Server-side.
 */
export function analyticsConfig(env: Record<string, string | undefined> = process.env): AnalyticsConfig | null {
  const provider = env.ANALYTICS_PROVIDER?.trim().toLowerCase();
  const siteId = env.ANALYTICS_SITE_ID?.trim();
  if ((provider !== "plausible" && provider !== "umami") || !siteId) return null;
  return { provider, siteId, scriptUrl: env.ANALYTICS_SCRIPT_URL?.trim() || DEFAULT_SCRIPTS[provider] };
}
