/**
 * API tokens, inbound hooks and outbound webhook management. OWNED BY: Agent C.
 *
 * Reads only need the group id. Mutations (and revealing a webhook secret)
 * also require the group's settings PIN when one is set, because these hand
 * out long-lived credentials.
 */
import { z } from "zod";
import { env, isPushConfigured } from "@/lib/env";
import { WEBHOOK_EVENTS } from "@/lib/events";
import { hookUrl, createInboundHook, listInboundHooks, revokeInboundHook } from "@/lib/integrations/hooks";
import "@/lib/integrations/listeners";
import { createApiToken, integrationNameSchema, listApiTokens, revokeApiToken } from "@/lib/integrations/tokens";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  revealWebhookSecret,
  rotateWebhookSecret,
  setWebhookEnabled,
  testWebhook,
  updateWebhook,
  webhookInput,
  webhookPatch,
} from "@/lib/integrations/webhooks";
import { assertSettingsPin } from "@/lib/services/groups";
import { createTRPCRouter, groupProcedure } from "@/trpc/init";

const id = z.string().min(1).max(64);

/** Group procedure that checks the settings PIN (input `pin`) before running. */
const pinProcedure = groupProcedure
  .input(z.object({ pin: z.string().max(16).nullish() }))
  .use(async ({ ctx, input, next }) => {
    await assertSettingsPin(ctx.group, input.pin);
    return next();
  });

const tokensRouter = createTRPCRouter({
  list: groupProcedure.query(({ ctx }) => listApiTokens(ctx.group.id)),
  /** Returns the plaintext `token` once. */
  create: pinProcedure
    .input(z.object({ name: integrationNameSchema }))
    .mutation(({ ctx, input }) => createApiToken(ctx.group.id, input.name, ctx.actor)),
  revoke: pinProcedure
    .input(z.object({ tokenId: id }))
    .mutation(({ ctx, input }) => revokeApiToken(ctx.group.id, input.tokenId, ctx.actor)),
});

const hooksRouter = createTRPCRouter({
  list: groupProcedure.query(({ ctx }) => listInboundHooks(ctx.group.id)),
  create: pinProcedure
    .input(z.object({ choreId: id, name: integrationNameSchema.nullish(), defaultMemberId: id.nullish() }))
    .mutation(({ ctx, input }) =>
      createInboundHook(
        ctx.group.id,
        { choreId: input.choreId, name: input.name, defaultMemberId: input.defaultMemberId },
        ctx.actor,
      ),
    ),
  revoke: pinProcedure
    .input(z.object({ hookId: id }))
    .mutation(({ ctx, input }) => revokeInboundHook(ctx.group.id, input.hookId, ctx.actor)),
});

const webhooksRouter = createTRPCRouter({
  /** Webhooks (secret omitted) with their 5 latest deliveries. */
  list: groupProcedure.query(({ ctx }) => listWebhooks(ctx.group.id)),
  /** Returns the signing `secret`. */
  create: pinProcedure
    .input(z.object({ webhook: webhookInput }))
    .mutation(({ ctx, input }) => createWebhook(ctx.group.id, input.webhook, ctx.actor)),
  update: pinProcedure
    .input(z.object({ webhookId: id, patch: webhookPatch }))
    .mutation(({ ctx, input }) => updateWebhook(ctx.group.id, input.webhookId, input.patch, ctx.actor)),
  /** Enable (resets the failure count) or disable. */
  setEnabled: pinProcedure
    .input(z.object({ webhookId: id, enabled: z.boolean() }))
    .mutation(({ ctx, input }) => setWebhookEnabled(ctx.group.id, input.webhookId, input.enabled, ctx.actor)),
  delete: pinProcedure
    .input(z.object({ webhookId: id }))
    .mutation(({ ctx, input }) => deleteWebhook(ctx.group.id, input.webhookId, ctx.actor)),
  revealSecret: pinProcedure
    .input(z.object({ webhookId: id }))
    .mutation(({ ctx, input }) => revealWebhookSecret(ctx.group.id, input.webhookId)),
  rotateSecret: pinProcedure
    .input(z.object({ webhookId: id }))
    .mutation(({ ctx, input }) => rotateWebhookSecret(ctx.group.id, input.webhookId, ctx.actor)),
  /** Send a signed `ping` now and report the HTTP result. */
  test: pinProcedure
    .input(z.object({ webhookId: id }))
    .mutation(({ ctx, input }) => testWebhook(ctx.group.id, input.webhookId)),
});

export const integrationsRouter = createTRPCRouter({
  /** Instance facts the UI needs: public base URL (for curl examples), event types, push status. */
  info: groupProcedure.query(({ ctx }) => ({
    baseUrl: env().BASE_URL,
    apiBase: `${env().BASE_URL}/api/v1/groups/${ctx.group.id}`,
    hookUrlPrefix: hookUrl(""),
    events: [...WEBHOOK_EVENTS],
    pushConfigured: isPushConfigured(),
  })),
  tokens: tokensRouter,
  hooks: hooksRouter,
  webhooks: webhooksRouter,
});
