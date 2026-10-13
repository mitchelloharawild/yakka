/**
 * Web Push subscriptions (save/delete). OWNED BY: Agent D.
 * Sending is Agent C's (src/lib/integrations/push.ts); the client side is
 * <PushToggle /> in src/components/pwa/push-toggle.tsx.
 *
 * A browser profile has one push endpoint per service worker, and
 * PushSub.endpoint is unique, so a device's notifications go to one member
 * (in one group) at a time: subscribing again elsewhere moves the row.
 */
import { z } from "zod";
import { env } from "@/lib/env";
import { DomainError, notFound } from "@/lib/errors";
import { baseProcedure, createTRPCRouter, groupProcedure } from "@/trpc/init";

const endpointSchema = z.url().max(2048).startsWith("https://");

/** Shape of `PushSubscription.toJSON()`. */
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

export const pushRouter = createTRPCRouter({
  /** The VAPID public key for `pushManager.subscribe`, or null when push isn't configured. */
  vapidPublicKey: baseProcedure.query(() => env().VAPID_PUBLIC_KEY ?? null),

  /** Whether this endpoint is subscribed for this member, or for someone else (another member or group). */
  status: baseProcedure
    .input(z.object({ endpoint: endpointSchema, memberId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const sub = await ctx.db.pushSub.findUnique({ where: { endpoint: input.endpoint }, select: { memberId: true } });
      return { subscribedHere: sub?.memberId === input.memberId, subscribedElsewhere: !!sub && sub.memberId !== input.memberId };
    }),

  /** Save (or move) this device's subscription to a member. Upserts by endpoint. */
  subscribe: groupProcedure
    .input(
      z.object({
        memberId: z.string().min(1).max(64),
        deviceId: z.string().min(1).max(64),
        subscription: subscriptionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.member.findFirst({
        where: { id: input.memberId, groupId: ctx.group.id },
        select: { id: true, archivedAt: true },
      });
      if (!member) throw notFound("MEMBER_NOT_FOUND");
      if (member.archivedAt) throw new DomainError("BAD_REQUEST", "MEMBER_ARCHIVED");
      const { endpoint, keys } = input.subscription;
      const userAgent = ctx.headers.get("user-agent")?.slice(0, 512) ?? null;
      const data = { memberId: member.id, deviceId: input.deviceId, p256dh: keys.p256dh, auth: keys.auth, userAgent };
      await ctx.db.pushSub.upsert({
        where: { endpoint },
        create: { endpoint, ...data },
        update: { ...data, failCount: 0 },
      });
      return { ok: true as const };
    }),

  /** Forget a subscription. Idempotent; knowing the endpoint is the authorisation. */
  unsubscribe: baseProcedure.input(z.object({ endpoint: endpointSchema })).mutation(async ({ ctx, input }) => {
    const { count } = await ctx.db.pushSub.deleteMany({ where: { endpoint: input.endpoint } });
    return { removed: count > 0 };
  }),
});
