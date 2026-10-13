/**
 * Analytics privacy helper (ARCHITECTURE §7, like Spliit). OWNED BY: Agent D.
 *
 * Group ids and tag tokens are access secrets, so they must never reach an
 * analytics provider. When ANALYTICS_PROVIDER is set, report
 * `stripIdsFromPath(location.pathname)` instead of the real URL (and never
 * the query string: `?as=` carries a member id). Safe on server and client.
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

/** The configured provider ("plausible", "umami", ...) or null. Server-side. */
export function analyticsProvider(): string | null {
  const value = process.env.ANALYTICS_PROVIDER?.trim();
  return value ? value : null;
}
