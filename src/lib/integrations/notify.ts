/**
 * Optional instance-wide notification sinks for self-hosters: ntfy and
 * Apprise. OWNED BY: Agent C. Each is a single POST when its env var is set
 * (both are off unless NTFY_URL / APPRISE_URL is set); failures are logged
 * and swallowed.
 *
 * INSTANCE-WIDE: every group's due/overdue notices go to the same sink, so
 * this is for a single-household (self-hosted) instance only. Never set it
 * on an instance other people use. The group name is included so several
 * groups stay distinguishable. The click URL includes the group id (its
 * access secret), so only point these at a topic/server you control (not a
 * public ntfy.sh topic).
 */
import { env } from "@/lib/env";
import type { PushPayload } from "@/lib/integrations/push";

/** Send a notice to NTFY_URL and/or APPRISE_URL. Returns which sinks accepted it. */
export async function sendExternalNotice(
  payload: PushPayload & { priority?: "default" | "high"; groupName?: string },
): Promise<{ ntfy?: boolean; apprise?: boolean }> {
  const e = env();
  const title = payload.groupName ? `${payload.groupName}: ${payload.title}` : payload.title;
  const clickUrl = payload.url.startsWith("/") ? `${e.BASE_URL}${payload.url}` : payload.url;
  const out: { ntfy?: boolean; apprise?: boolean } = {};
  const jobs: Promise<void>[] = [];

  if (e.NTFY_URL) {
    jobs.push(
      fetch(e.NTFY_URL, {
        method: "POST",
        body: payload.body,
        headers: {
          // ntfy reads non-ASCII titles only via RFC 2047; keep it simple and strip them.
          Title: title.replace(/[^\x20-\x7e]/g, "").trim() || "Yakka",
          Click: clickUrl,
          Tags: "broom",
          Priority: payload.priority === "high" ? "high" : "default",
          ...(e.NTFY_TOKEN ? { Authorization: `Bearer ${e.NTFY_TOKEN}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      })
        .then((r) => {
          out.ntfy = r.ok;
          if (!r.ok) console.warn(`[notify] ntfy responded ${r.status}`);
        })
        .catch((err) => {
          out.ntfy = false;
          console.warn("[notify] ntfy failed", (err as Error).message);
        }),
    );
  }

  if (e.APPRISE_URL) {
    jobs.push(
      fetch(e.APPRISE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body: `${payload.body}\n${clickUrl}`,
          type: payload.priority === "high" ? "warning" : "info",
        }),
        signal: AbortSignal.timeout(10_000),
      })
        .then((r) => {
          out.apprise = r.ok;
          if (!r.ok) console.warn(`[notify] apprise responded ${r.status}`);
        })
        .catch((err) => {
          out.apprise = false;
          console.warn("[notify] apprise failed", (err as Error).message);
        }),
    );
  }

  await Promise.all(jobs);
  return out;
}
