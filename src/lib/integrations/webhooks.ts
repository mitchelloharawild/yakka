/**
 * Outbound webhooks: management and the delivery worker. OWNED BY: Agent C.
 *
 * emitEvent() (src/lib/events.ts) inserts one WebhookDelivery row per
 * subscribed, enabled webhook. processDueDeliveries() picks due rows
 * (not delivered, not failed, nextAttemptAt <= now), claims each one with a
 * conditional update (so the cron sweep and the immediate kick after a
 * request never send the same row twice), signs and POSTs it, and applies
 * the retry policy in ./backoff.ts.
 *
 * Webhook.failCount counts consecutive failed attempts across deliveries; it
 * resets on any success. At AUTO_DISABLE_AFTER_FAILURES the webhook is
 * disabled (disabledAt) and its pending deliveries are failed.
 */
import http from "node:http";
import https from "node:https";
import { z } from "zod";
import type { Prisma, Webhook } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { env } from "@/lib/env";
import { parseWebhookEvents, serializeWebhookEvents, WEBHOOK_EVENTS, type EventEnvelope } from "@/lib/events";
import { newWebhookSecret } from "@/lib/ids";
import {
  CLAIM_LEASE_MS,
  DELIVERY_TIMEOUT_MS,
  nextRetryAt,
  shouldAutoDisable,
} from "@/lib/integrations/backoff";
import { deliveryHeaders } from "@/lib/integrations/signing";
import { integrationNameSchema } from "@/lib/integrations/tokens";
import {
  assertHostAllowed,
  DESTINATION_NOT_ALLOWED,
  DestinationNotAllowedError,
  guardedLookup,
  validateWebhookUrl,
  type Resolver,
} from "@/lib/integrations/url-safety";

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

const webhookUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .superRefine((v, ctx) => {
    const res = validateWebhookUrl(v);
    if (!res.ok) ctx.addIssue({ code: "custom", message: res.reason });
  });

/** zod: fields of a webhook on create. */
export const webhookInput = z.object({
  name: integrationNameSchema.nullish(),
  url: webhookUrlSchema,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
/** zod: patch on update. */
export const webhookPatch = webhookInput.partial();

/** Webhook as returned to the UI: events parsed, secret omitted (use revealWebhookSecret). */
function toPublicWebhook(w: Webhook) {
  const { secret, ...rest } = w;
  return { ...rest, events: parseWebhookEvents(w.events), secretHint: `${secret.slice(0, 10)}…` };
}

/** Webhooks of a group with their 5 most recent deliveries. */
export async function listWebhooks(groupId: string) {
  const rows = await prisma.webhook.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          event: true,
          attempts: true,
          createdAt: true,
          nextAttemptAt: true,
          deliveredAt: true,
          failedAt: true,
          responseStatus: true,
          lastError: true,
        },
      },
    },
  });
  return rows.map(({ deliveries, ...w }) => ({ ...toPublicWebhook(w), deliveries }));
}

async function requireWebhook(groupId: string, webhookId: string) {
  const w = await prisma.webhook.findFirst({ where: { id: webhookId, groupId } });
  if (!w) throw notFound("WEBHOOK_NOT_FOUND");
  return w;
}

/** Create a webhook. Returns the signing secret (also viewable later with revealWebhookSecret). */
export async function createWebhook(groupId: string, input: z.input<typeof webhookInput>, actor?: Actor) {
  const data = webhookInput.parse(input);
  const secret = newWebhookSecret();
  const w = await prisma.$transaction(async (tx) => {
    const created = await tx.webhook.create({
      data: { groupId, name: data.name ?? null, url: data.url, events: serializeWebhookEvents(data.events), secret },
    });
    await logActivity(tx, { groupId, type: "webhook.created", actor, data: { name: created.name, host: new URL(data.url).host } });
    return created;
  });
  return { ...toPublicWebhook(w), secret };
}

/** Update name/url/events. */
export async function updateWebhook(groupId: string, webhookId: string, patch: z.input<typeof webhookPatch>, actor?: Actor) {
  const data = webhookPatch.parse(patch);
  await requireWebhook(groupId, webhookId);
  const w = await prisma.$transaction(async (tx) => {
    const updated = await tx.webhook.update({
      where: { id: webhookId },
      data: {
        ...(data.name !== undefined ? { name: data.name ?? null } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.events !== undefined ? { events: serializeWebhookEvents(data.events) } : {}),
      },
    });
    await logActivity(tx, { groupId, type: "webhook.updated", actor, data: { name: updated.name, changed: Object.keys(data) } });
    return updated;
  });
  return toPublicWebhook(w);
}

/** Enable (resets failCount) or disable a webhook. Disabling fails its pending deliveries. */
export async function setWebhookEnabled(groupId: string, webhookId: string, enabled: boolean, actor?: Actor) {
  const existing = await requireWebhook(groupId, webhookId);
  const now = new Date();
  const w = await prisma.$transaction(async (tx) => {
    const updated = await tx.webhook.update({
      where: { id: webhookId },
      data: enabled ? { disabledAt: null, failCount: 0 } : { disabledAt: existing.disabledAt ?? now },
    });
    if (!enabled) await failPending(tx, webhookId, now, "Webhook disabled");
    await logActivity(tx, {
      groupId,
      type: enabled ? "webhook.updated" : "webhook.disabled",
      actor,
      data: { name: updated.name, ...(enabled ? { changed: ["enabled"] } : { reason: "manual" }) },
    });
    return updated;
  });
  return toPublicWebhook(w);
}

/** Delete a webhook and its delivery history. */
export async function deleteWebhook(groupId: string, webhookId: string, actor?: Actor) {
  const w = await requireWebhook(groupId, webhookId);
  await prisma.$transaction(async (tx) => {
    await tx.webhook.delete({ where: { id: webhookId } });
    await logActivity(tx, { groupId, type: "webhook.deleted", actor, data: { name: w.name, host: safeHost(w.url) } });
  });
  return { ok: true as const };
}

/** The signing secret of a webhook. */
export async function revealWebhookSecret(groupId: string, webhookId: string) {
  const w = await requireWebhook(groupId, webhookId);
  return { secret: w.secret };
}

/** Replace the signing secret. Pending deliveries are signed with the new one. */
export async function rotateWebhookSecret(groupId: string, webhookId: string, actor?: Actor) {
  await requireWebhook(groupId, webhookId);
  const secret = newWebhookSecret();
  await prisma.$transaction(async (tx) => {
    const w = await tx.webhook.update({ where: { id: webhookId }, data: { secret } });
    await logActivity(tx, { groupId, type: "webhook.updated", actor, data: { name: w.name, changed: ["secret"] } });
  });
  return { secret };
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Outcome of one HTTP attempt. */
export interface SendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
}

/** Test seams for sendSigned(). */
export interface SendOptions {
  /** Defaults to env().WEBHOOK_ALLOW_PRIVATE_NETWORKS. */
  allowPrivate?: boolean;
  /** DNS resolver for the guarded lookup (tests). */
  resolver?: Resolver;
  timeoutMs?: number;
}

/**
 * POST once with node:http(s). The connection's DNS lookup is
 * guardedLookup(), so with private networks disallowed the address that was
 * checked is the one connected to. No redirects, no connection reuse.
 */
function postOnce(url: URL, headers: Record<string, string>, body: string, opts: Required<Pick<SendOptions, "allowPrivate" | "timeoutMs">> & SendOptions) {
  return new Promise<number>((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: guardedLookup(opts.allowPrivate, opts.resolver) as unknown as http.RequestOptions["lookup"],
        agent: false,
      },
      (res) => {
        clearTimeout(timer);
        resolve(res.statusCode ?? 0);
        // We don't read the body.
        res.destroy();
      },
    );
    const timer = setTimeout(() => {
      const err = new Error(`Timed out after ${opts.timeoutMs / 1000}s`);
      err.name = "TimeoutError";
      req.destroy(err);
    }, opts.timeoutMs);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(body);
  });
}

/** Sign and POST a body to a URL once. Never throws. Redirects are not followed. */
export async function sendSigned(
  input: {
    url: string;
    secret: string;
    event: string;
    deliveryId: string;
    rawBody: string;
    now?: Date;
  },
  opts: SendOptions = {},
): Promise<SendResult> {
  const started = Date.now();
  const allowPrivate = opts.allowPrivate ?? env().WEBHOOK_ALLOW_PRIVATE_NETWORKS;
  const timeoutMs = opts.timeoutMs ?? DELIVERY_TIMEOUT_MS;
  try {
    const check = validateWebhookUrl(input.url);
    if (!check.ok) throw new Error(check.reason);
    assertHostAllowed(check.url, allowPrivate);
    const status = await postOnce(check.url, deliveryHeaders(input), input.rawBody, { ...opts, allowPrivate, timeoutMs });
    const ok = status >= 200 && status < 300;
    return { ok, status, error: ok ? null : `HTTP ${status}`, durationMs: Date.now() - started };
  } catch (err) {
    const msg =
      err instanceof DestinationNotAllowedError
        ? DESTINATION_NOT_ALLOWED
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, status: null, error: msg.slice(0, 500), durationMs: Date.now() - started };
  }
}

/**
 * Send a `ping` event to a webhook right now (the "Send test" button). Not
 * queued and doesn't affect failCount; disabled webhooks can be tested too.
 *
 * When private networks are disallowed (public instances) the result is
 * reduced to ok / not ok with a generic error, so the button can't be used
 * as a port scanner or to learn what a hostname resolves to. Self-hosted
 * instances (private networks allowed) get the HTTP status and error.
 */
export async function testWebhook(groupId: string, webhookId: string, opts: SendOptions = {}) {
  const w = await prisma.webhook.findFirst({ where: { id: webhookId, groupId }, include: { group: true } });
  if (!w) throw notFound("WEBHOOK_NOT_FOUND");
  const now = new Date();
  const deliveryId = `test_${now.getTime().toString(36)}`;
  const envelope = {
    id: `evt_test_${now.getTime().toString(36)}`,
    type: "ping",
    createdAt: now.toISOString(),
    group: { name: w.group.name, timezone: w.group.timezone },
    data: { message: "Test delivery from Yakka", webhook: { id: w.id, name: w.name } },
  };
  const allowPrivate = opts.allowPrivate ?? env().WEBHOOK_ALLOW_PRIVATE_NETWORKS;
  const res = await sendSigned(
    { url: w.url, secret: w.secret, event: "ping", deliveryId, rawBody: JSON.stringify(envelope), now },
    { ...opts, allowPrivate },
  );
  return allowPrivate ? res : redactTestResult(res);
}

/** The test result as shown on a public instance: success/failure only. */
export function redactTestResult(res: SendResult): SendResult {
  return res.ok
    ? { ok: true, status: null, error: null, durationMs: 0 }
    : { ok: false, status: null, error: res.error === DESTINATION_NOT_ALLOWED ? DESTINATION_NOT_ALLOWED : "Delivery failed", durationMs: 0 };
}

async function failPending(tx: Prisma.TransactionClient, webhookId: string, now: Date, reason: string) {
  await tx.webhookDelivery.updateMany({
    where: { webhookId, deliveredAt: null, failedAt: null },
    data: { failedAt: now, lastError: reason },
  });
}

/** Summary returned by processDueDeliveries(). */
export interface DeliveryRunResult {
  attempted: number;
  delivered: number;
  failed: number;
  retrying: number;
  disabledWebhooks: number;
}

/**
 * Deliver due WebhookDelivery rows. `groupId` limits the run to one group
 * (used for the immediate kick after an event); the cron runs it unscoped.
 */
export async function processDueDeliveries(
  opts: {
    now?: Date;
    limit?: number;
    groupId?: string;
    concurrency?: number;
    /** Clock read at each claim (tests). Defaults to the real time, NOT `now`. */
    clock?: () => Date;
    send?: SendOptions;
  } = {},
): Promise<DeliveryRunResult> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? (() => new Date());
  const result: DeliveryRunResult = { attempted: 0, delivered: 0, failed: 0, retrying: 0, disabledWebhooks: 0 };
  const due = await prisma.webhookDelivery.findMany({
    where: {
      deliveredAt: null,
      failedAt: null,
      nextAttemptAt: { lte: now },
      ...(opts.groupId ? { webhook: { groupId: opts.groupId } } : {}),
    },
    orderBy: { nextAttemptAt: "asc" },
    take: opts.limit ?? 100,
    select: { id: true, nextAttemptAt: true },
  });

  const queue = [...due];
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 4, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      await deliverOne(row, clock, result, opts.send);
    }
  });
  await Promise.all(workers);
  return result;
}

async function deliverOne(
  row: { id: string; nextAttemptAt: Date },
  clock: () => Date,
  result: DeliveryRunResult,
  send?: SendOptions,
) {
  // Claim: only one worker wins the conditional update. The lease starts at
  // claim time, not at the start of the sweep: a row claimed late in a long
  // run would otherwise get a lease that has already expired, and another
  // worker could pick it up and send it again.
  const now = clock();
  const claim = await prisma.webhookDelivery.updateMany({
    where: { id: row.id, nextAttemptAt: row.nextAttemptAt, deliveredAt: null, failedAt: null },
    data: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
  });
  if (claim.count !== 1) return;

  const d = await prisma.webhookDelivery.findUnique({ where: { id: row.id }, include: { webhook: true } });
  if (!d) return;
  const hook = d.webhook;
  if (hook.disabledAt) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { failedAt: now, lastError: "Webhook disabled" } });
    result.failed++;
    return;
  }

  result.attempted++;
  const envelope = d.payload as unknown as EventEnvelope;
  const res = await sendSigned({
    url: hook.url,
    secret: hook.secret,
    event: d.event,
    deliveryId: d.id,
    rawBody: JSON.stringify(envelope),
  }, send);
  const finishedAt = clock();
  const attempts = d.attempts + 1;

  if (res.ok) {
    result.delivered++;
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { attempts, deliveredAt: finishedAt, responseStatus: res.status, lastError: null },
      }),
      prisma.webhook.update({
        where: { id: hook.id },
        data: { failCount: 0, lastDeliveredAt: finishedAt, lastError: null },
      }),
    ]);
    return;
  }

  const retryAt = nextRetryAt(attempts, finishedAt);
  if (retryAt) result.retrying++;
  else result.failed++;
  await prisma.$transaction(async (tx) => {
    await tx.webhookDelivery.update({
      where: { id: d.id },
      data: {
        attempts,
        responseStatus: res.status,
        lastError: res.error,
        ...(retryAt ? { nextAttemptAt: retryAt } : { failedAt: finishedAt }),
      },
    });
    const updated = await tx.webhook.update({
      where: { id: hook.id },
      data: { failCount: { increment: 1 }, lastError: res.error },
    });
    if (!updated.disabledAt && shouldAutoDisable(updated.failCount)) {
      await tx.webhook.update({ where: { id: hook.id }, data: { disabledAt: finishedAt } });
      await failPending(tx, hook.id, finishedAt, "Webhook disabled after repeated failures");
      await logActivity(tx, {
        groupId: hook.groupId,
        type: "webhook.disabled",
        data: { name: hook.name, reason: "failures", failCount: updated.failCount, lastError: res.error },
      });
      result.disabledWebhooks++;
    }
  });
}
