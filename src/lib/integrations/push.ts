/**
 * Web Push sending (VAPID). OWNED BY: Agent C. Subscriptions are saved by
 * Agent D's push router into PushSub; the service worker (src/app/sw.ts)
 * displays the payload. Contract (also in docs/DEVELOPMENT.md "Push payload"):
 *
 *   { title: string; body: string; url: string; tag?: string }
 *
 * `url` is a same-origin path to open on click (e.g. `/groups/{id}`); `tag`
 * lets a later notification replace an earlier one for the same chore.
 */
import webpush from "web-push";
import { prisma } from "@/lib/db";
import { env, isPushConfigured } from "@/lib/env";
import { isAllowedPushEndpoint, pushHostPatterns } from "@/lib/integrations/url-safety";

/** The JSON payload of every push message. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** Counts returned by sendPushToGroup(). */
export interface PushResult {
  sent: number;
  failed: number;
  removed: number;
  skipped?: "NOT_CONFIGURED";
}

/** Subscriptions are deleted after this many consecutive non-fatal failures. */
const MAX_SUB_FAILURES = 5;

let configured = false;
let warned = false;

function configure(): boolean {
  if (!isPushConfigured()) {
    if (!warned) {
      console.info("[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set; Web Push disabled");
      warned = true;
    }
    return false;
  }
  if (!configured) {
    const e = env();
    webpush.setVapidDetails(e.VAPID_SUBJECT ?? e.BASE_URL, e.VAPID_PUBLIC_KEY!, e.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

/**
 * Send a push message to the members of a group: `memberIds` if given
 * (e.g. the assignee), otherwise every non-archived member. Subscriptions
 * that the push service reports gone (404/410) are deleted; other failures
 * bump PushSub.failCount. No-op (with one log line) without VAPID keys.
 */
export async function sendPushToGroup(
  groupId: string,
  payload: PushPayload,
  opts: { memberIds?: string[]; ttlSeconds?: number } = {},
): Promise<PushResult> {
  if (!configure()) return { sent: 0, failed: 0, removed: 0, skipped: "NOT_CONFIGURED" };
  const subs = await prisma.pushSub.findMany({
    where: {
      member: { groupId, archivedAt: null, ...(opts.memberIds ? { id: { in: opts.memberIds } } : {}) },
    },
  });
  const result: PushResult = { sent: 0, failed: 0, removed: 0 };
  const body = JSON.stringify(payload);
  const patterns = pushHostPatterns(env().PUSH_ALLOWED_HOSTS);
  await Promise.all(
    subs.map(async (sub) => {
      // Saved before the host allowlist existed, or the allowlist shrank: never POST there.
      if (!isAllowedPushEndpoint(sub.endpoint, patterns)) {
        await prisma.pushSub.deleteMany({ where: { id: sub.id } });
        result.removed++;
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: opts.ttlSeconds ?? 6 * 3600, urgency: "normal", timeout: 10_000 },
        );
        result.sent++;
        if (sub.failCount > 0) await prisma.pushSub.update({ where: { id: sub.id }, data: { failCount: 0 } });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410 || sub.failCount + 1 >= MAX_SUB_FAILURES) {
          await prisma.pushSub.deleteMany({ where: { id: sub.id } });
          result.removed++;
        } else {
          await prisma.pushSub.update({ where: { id: sub.id }, data: { failCount: { increment: 1 } } });
          result.failed++;
          console.warn(`[push] send failed (${status ?? "network"})`, (err as Error).message);
        }
      }
    }),
  );
  return result;
}
