/**
 * Outbound webhook URL checks (SSRF). OWNED BY: Agent C.
 *
 * Only http(s) URLs without credentials are accepted. Whether private / LAN
 * addresses are allowed is WEBHOOK_ALLOW_PRIVATE_NETWORKS (src/lib/env.ts):
 * on by default for self-hosting (Home Assistant on 192.168.x.x), off by
 * default on Vercel. When off, every address a delivery connects to is
 * checked by isPrivateAddress() *inside the socket's DNS lookup*
 * (guardedLookup), so the address that was checked is the address that is
 * connected to: a DNS-rebinding answer between "check" and "connect" can't
 * slip through. Redirects are never followed.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";

/** Syntactic check of a webhook URL (used on create/update). */
export function validateWebhookUrl(value: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "URL_INVALID" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "URL_SCHEME_NOT_ALLOWED" };
  if (url.username || url.password) return { ok: false, reason: "URL_CREDENTIALS_NOT_ALLOWED" };
  if (!url.hostname) return { ok: false, reason: "URL_INVALID" };
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Address classification (byte level)
// ---------------------------------------------------------------------------

/** IPv4 dotted quad to 4 bytes, or null. */
function parseIPv4(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").map(Number);
}

/**
 * IPv6 text (any valid form: compressed, embedded dotted quad, zone id) to
 * 16 bytes, or null.
 */
export function parseIPv6(input: string): number[] | null {
  const ip = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIP(ip) !== 6) return null;
  let text = ip.toLowerCase();
  // Embedded IPv4 in the last 32 bits (e.g. ::ffff:1.2.3.4) -> two hex groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const b = parseIPv4(v4[1]);
    if (!b) return null;
    text = text.slice(0, -v4[1].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const n = Number.parseInt(g, 16);
    if (!/^[0-9a-f]{1,4}$/.test(g) || Number.isNaN(n)) return null;
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

/** [base bytes, prefix length] */
type Block = [number[], number];

const V4_BLOCKS: Block[] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // RFC 1918
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local (cloud metadata)
  [[172, 16, 0, 0], 12], // RFC 1918
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // RFC 1918
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved + broadcast
];

const V6_BLOCKS: Block[] = [
  [[0x01, 0x00, 0, 0, 0, 0, 0, 0], 64], // 100::/64 discard
  [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48], // 64:ff9b:1::/48 local-use NAT64
  [[0x20, 0x01, 0x00, 0x00], 32], // 2001::/32 Teredo (embeds an obfuscated IPv4)
  [[0x20, 0x01, 0x00, 0x02, 0, 0], 48], // 2001:2::/48 benchmarking
  [[0x20, 0x01, 0x0d, 0xb8], 32], // 2001:db8::/32 documentation
  [[0x3f, 0xff], 20], // 3fff::/20 documentation
  [[0xfc], 7], // fc00::/7 unique local
  [[0xfe, 0x80], 10], // fe80::/10 link-local
  [[0xfe, 0xc0], 10], // fec0::/10 site-local (deprecated)
  [[0xff], 8], // ff00::/8 multicast
];

function inBlock(bytes: number[], [base, bits]: Block): boolean {
  for (let i = 0; i < bits; i += 8) {
    const take = Math.min(8, bits - i);
    const mask = (0xff << (8 - take)) & 0xff;
    if (((bytes[i / 8] ?? 0) & mask) !== ((base[i / 8] ?? 0) & mask)) return false;
  }
  return true;
}

const zeros = (bytes: number[], from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);

/**
 * The IPv4 address embedded in an IPv6 address by a transition mechanism
 * that the network may route to it: IPv4-mapped (::ffff:a.b.c.d),
 * IPv4-translated (::ffff:0:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64
 * (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::/48). Null otherwise.
 */
export function embeddedIPv4(bytes: number[]): number[] | null {
  const last4 = bytes.slice(12, 16);
  if (zeros(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return last4; // ::ffff:0:0/96
  if (zeros(bytes, 0, 8) && bytes[8] === 0xff && bytes[9] === 0xff && zeros(bytes, 10, 12)) return last4; // ::ffff:0:0:0/96
  if (zeros(bytes, 0, 12)) return last4; // ::/96 (also :: and ::1, handled by the caller)
  if (inBlock(bytes, [[0x00, 0x64, 0xff, 0x9b], 96])) return last4; // 64:ff9b::/96
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6); // 2002::/16
  return null;
}

/**
 * Whether an IP literal is loopback, private, link-local, CGNAT, multicast,
 * reserved or documentation space, including IPv4 addresses wrapped in IPv6
 * (mapped, NAT64, 6to4, ...). Non-IP strings return false.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return V4_BLOCKS.some((b) => inBlock(v4, b));
  const v6 = parseIPv6(ip);
  if (!v6) return false;
  if (zeros(v6, 0, 15) && (v6[15] === 0 || v6[15] === 1)) return true; // :: and ::1
  const inner = embeddedIPv4(v6);
  if (inner) return V4_BLOCKS.some((b) => inBlock(inner, b));
  return V6_BLOCKS.some((b) => inBlock(v6, b));
}

// ---------------------------------------------------------------------------
// Delivery-time guard
// ---------------------------------------------------------------------------

/** Generic message for a refused destination. Deliberately says nothing about what the host resolved to. */
export const DESTINATION_NOT_ALLOWED = "Destination not allowed (WEBHOOK_ALLOW_PRIVATE_NETWORKS=false)";

/** Error thrown when the destination is a private address. */
export class DestinationNotAllowedError extends Error {
  readonly code = "DESTINATION_NOT_ALLOWED";
  constructor() {
    super(DESTINATION_NOT_ALLOWED);
    this.name = "DestinationNotAllowedError";
  }
}

/** Resolver used by guardedLookup: all addresses for a hostname. */
export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  );

/** Syntactic pre-check of the host (no DNS): IP literals and localhost names. */
export function assertHostAllowed(url: URL, allowPrivate: boolean): void {
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new DestinationNotAllowedError();
  if (isIP(host) && isPrivateAddress(host)) throw new DestinationNotAllowedError();
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for node:http / node:net that resolves the host and, unless
 * private networks are allowed, refuses the connection if ANY resolved
 * address is private. The socket connects to the address returned here, so
 * the checked address is the connected one (no DNS-rebinding window).
 */
export function guardedLookup(allowPrivate: boolean, resolver: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback) => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }), []);
        if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
          return callback(new DestinationNotAllowedError(), []);
        }
        const family = options.family === 6 || options.family === "IPv6" ? 6 : options.family === 4 || options.family === "IPv4" ? 4 : 0;
        const usable = family ? addresses.filter((a) => a.family === family) : addresses;
        if (options.all) return callback(null, usable);
        const first = usable[0] ?? addresses[0];
        callback(null, first.address, first.family);
      },
      (err: NodeJS.ErrnoException) => callback(err, []),
    );
  };
}

// ---------------------------------------------------------------------------
// Web Push endpoints
// ---------------------------------------------------------------------------

/**
 * Push services browsers actually use. A subscription's endpoint comes from
 * the client, and the cron job POSTs to it, so anything else would be an
 * SSRF vector. `*.` matches any subdomain (not the bare domain).
 */
export const DEFAULT_PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge (Chromium), Opera, Samsung Internet
  "android.googleapis.com", // legacy GCM endpoints
  "*.push.services.mozilla.com", // Firefox
  "*.push.apple.com", // Safari / iOS
  "*.notify.windows.com", // legacy Edge (WNS)
];

/** Parse PUSH_ALLOWED_HOSTS ("a.example,*.b.example"); "*" means any https host. */
export function pushHostPatterns(extra: string | undefined): string[] {
  const more = (extra ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_PUSH_HOSTS, ...more];
}

/** Whether `endpoint` is an https URL on one of the allowed push service hosts (default port only). */
export function isAllowedPushEndpoint(endpoint: string, patterns: string[] = DEFAULT_PUSH_HOSTS): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return patterns.some((p) =>
    p === "*" ? !isIP(host.replace(/^\[|\]$/g, "")) && !isPrivateHostname(host) : p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p,
  );
}

function isPrivateHostname(host: string) {
  return host === "localhost" || host.endsWith(".localhost");
}
