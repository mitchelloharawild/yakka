/**
 * Outbound webhook URL checks (SSRF). OWNED BY: Agent C.
 *
 * Only http(s) URLs without credentials are accepted. By default private /
 * LAN addresses ARE allowed, because self-hosters point webhooks at Home
 * Assistant on 192.168.x.x. Set WEBHOOK_ALLOW_PRIVATE_NETWORKS=false on a
 * public multi-tenant instance: deliveries then resolve the host and refuse
 * loopback, private, link-local and similar ranges. Redirects are never
 * followed.
 */
import { lookup } from "node:dns/promises";
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

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** Whether an IP literal is loopback, private, link-local, CGNAT, multicast or reserved. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const size = 2 ** (32 - bits);
      return Math.floor(n / size) === Math.floor(ipv4ToInt(base) / size);
    });
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return false;
}

/** At delivery time: throw if the URL's host is private and that isn't allowed. */
export async function assertDeliverable(url: URL, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) throw privateError();
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.some(isPrivateAddress)) throw privateError();
}

function privateError() {
  return new Error("Destination is a private network address (WEBHOOK_ALLOW_PRIVATE_NETWORKS=false)");
}
