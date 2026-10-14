/**
 * Parse a pasted Yakka link into an in-app path. Used by the home view's
 * "Join a group" field: an installed iOS PWA can't open links itself, so
 * people paste the link they were sent instead.
 *
 * Client-safe: no imports from `ids.ts` (it pulls in node:crypto), so the
 * shape checks below mirror `isPlausibleGroupId` / `isPlausibleTagToken`.
 */

const GROUP_ID = /^[0-9A-Za-z_-]{16,64}$/;
const TAG_TOKEN = /^[0-9a-z]{8,32}$/;
/** A bare id as `newGroupId()` makes it: 22 base62 chars. */
const BARE_GROUP_ID = /^[0-9A-Za-z]{22}$/;

export type JoinLink = {
  /** Same-origin path to push, including query and hash. Always starts with a single `/`. */
  path: string;
  kind: "group" | "tag";
  /** Host the link was for (lowercase), or null for relative paths and bare ids. */
  host: string | null;
  /** A "Move to another device" link (`?as={memberId}`), which sets the identity on arrival. */
  transfer: boolean;
};

/** Trailing characters that belong to the surrounding sentence, not the URL. */
const TRAILING = /[.,;:!?)\]}>'"’”]+$/;

/** Pull the first URL-ish thing out of free text, as an absolute URL. */
function extractUrl(text: string): URL | null {
  const patterns: [RegExp, (m: string) => string][] = [
    // https://host/... (any scheme; non-http is rejected below)
    [/https?:\/\/[^\s<>"]+/i, (m) => m],
    // host/groups/... without a scheme (some apps copy links that way)
    [/(?:^|[\s(<])((?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/(?:groups|t)\/[^\s<>"]+)/i, (m) => `https://${m}`],
    // relative path
    [/(?:^|[\s(<])(\/(?:groups|t)\/[^\s<>"]+)/, (m) => m],
  ];
  for (const [re, toUrl] of patterns) {
    const match = re.exec(text);
    if (!match) continue;
    const raw = (match[1] ?? match[0]).replace(TRAILING, "");
    try {
      // The placeholder base only resolves relative paths; its host is discarded.
      return new URL(toUrl(raw), "http://relative.invalid");
    } catch {
      return null;
    }
  }
  return null;
}

export function parseJoinLink(input: string): JoinLink | null {
  const text = input.trim();
  if (!text) return null;

  if (BARE_GROUP_ID.test(text)) {
    return { path: `/groups/${text}`, kind: "group", host: null, transfer: false };
  }

  const url = extractUrl(text);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;

  // Rebuild the path from its segments so a crafted `//evil.example/groups/…`
  // can never turn into a protocol-relative URL.
  const segments = url.pathname.split("/").filter(Boolean);
  let kind: JoinLink["kind"];
  if (segments[0] === "groups" && GROUP_ID.test(segments[1] ?? "")) kind = "group";
  else if (segments[0] === "t" && segments.length === 2 && TAG_TOKEN.test(segments[1])) kind = "tag";
  else return null;

  const host = url.hostname === "relative.invalid" ? null : url.host.toLowerCase();
  return {
    path: `/${segments.join("/")}${url.search}${url.hash}`,
    kind,
    host,
    transfer: kind === "group" && url.searchParams.has("as"),
  };
}
