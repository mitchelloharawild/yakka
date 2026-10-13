/**
 * tRPC initialisation: context, error mapping and the procedure builders
 * every router uses. Server-only.
 *
 * Access model: there are no accounts. A procedure that touches a group
 * takes `groupId` in its input; knowing the id IS the authorisation (it's an
 * unguessable secret, like Spliit). Use `groupProcedure`, which loads the
 * (non-deleted) group into `ctx.group` or throws NOT_FOUND.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod";
import type { Group } from "@/generated/prisma/client";
import type { Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { requestClientIp } from "@/lib/rate-limit";
import { assertSettingsPin, requireGroup } from "@/lib/services/groups";

/**
 * Build the per-request context. `headers` is empty for RSC calls.
 * `clientIp` follows RATE_LIMIT_IP_HEADER (src/lib/rate-limit.ts); it keys
 * the settings-PIN attempt limiter.
 */
export async function createTRPCContext(opts: { headers?: Headers } = {}) {
  const headers = opts.headers ?? new Headers();
  return { db: prisma, headers, clientIp: requestClientIp(headers) };
}

/** Per-request context. */
export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        /** Stable machine-readable reason from DomainError, e.g. "UNDO_WINDOW_EXPIRED". */
        reason: cause instanceof DomainError ? cause.reason : null,
        /** Set with reason "PIN_LOCKED": seconds until another PIN attempt is accepted. */
        retryAfterSeconds: cause instanceof DomainError ? (cause.retryAfterSeconds ?? null) : null,
        zodError: cause instanceof ZodError ? z.flattenError(cause) : null,
      },
    };
  },
});

/** Maps DomainError / ZodError thrown by services to TRPCError. */
const domainErrors = t.middleware(async ({ next }) => {
  const res = await next();
  if (!res.ok) {
    const cause = res.error.cause;
    if (cause instanceof DomainError) {
      res.error = new TRPCError({ code: cause.code, message: cause.reason, cause });
    } else if (cause instanceof ZodError && res.error.code === "INTERNAL_SERVER_ERROR") {
      res.error = new TRPCError({ code: "BAD_REQUEST", message: "Invalid input", cause });
    }
  }
  return res;
});

/** Create a router. */
export const createTRPCRouter = t.router;
/** Create a server-side caller factory. */
export const createCallerFactory = t.createCallerFactory;

/** Procedure with no access check. Only for creating groups and similar public actions. */
export const baseProcedure = t.procedure.use(domainErrors);

/**
 * zod: optional "who is doing this" sent by the client from localStorage
 * (see src/lib/client/local-groups.ts). Not verified: it's for the audit log.
 */
export const actorInput = z
  .object({
    memberId: z.string().max(64).nullish(),
    deviceId: z.string().max(64).nullish(),
  })
  .optional();

/**
 * Procedure scoped to one group. Input always includes
 * `{ groupId: string; actor?: { memberId?, deviceId? } }`; chain `.input()`
 * to add fields (tRPC merges object inputs). Provides `ctx.group` and
 * `ctx.actor`.
 */
export const groupProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1).max(64), actor: actorInput }))
  .use(async ({ input, next }) => {
    let group: Group;
    try {
      group = await requireGroup(input.groupId);
    } catch (e) {
      if (e instanceof DomainError) throw new TRPCError({ code: e.code, message: e.reason, cause: e });
      throw e;
    }
    const actor: Actor = { memberId: input.actor?.memberId ?? null, deviceId: input.actor?.deviceId ?? null };
    return next({ ctx: { group, actor } });
  });

/**
 * Group procedure that also checks the group's settings PIN (input `pin`)
 * when one is set: FORBIDDEN PIN_REQUIRED / PIN_INVALID, or
 * TOO_MANY_REQUESTS PIN_LOCKED after repeated wrong PINs. For actions that
 * hand out or withdraw credentials (API tokens, hooks, webhooks, tags).
 */
export const groupPinProcedure = groupProcedure
  .input(z.object({ pin: z.string().max(16).nullish() }))
  .use(async ({ ctx, input, next }) => {
    await assertSettingsPin(ctx.group, input.pin, { client: ctx.clientIp });
    return next();
  });
