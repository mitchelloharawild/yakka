/**
 * Groups, members, chores, completions and activity. OWNED BY: group UI
 * (Agent A). Thin wrappers over src/lib/services/*; keep logic in services.
 */
import { z } from "zod";
import { listActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  createChore,
  createChoreInput,
  getChoreView,
  listChores,
  setChoreArchived,
  updateChore,
  updateChoreInput,
} from "@/lib/services/chores";
import { completeChore, completionTallies, listCompletions, undoCompletion } from "@/lib/services/completions";
import {
  assertSettingsPin,
  createGroup,
  createGroupInput,
  getGroupWithMembers,
  setSettingsPin,
  softDeleteGroup,
  toPublicGroup,
  updateGroup,
  updateGroupInput,
} from "@/lib/services/groups";
import {
  addMember,
  addMemberInput,
  memberTallies,
  setMemberArchived,
  updateMember,
  updateMemberInput,
} from "@/lib/services/members";
import { actorInput, baseProcedure, createTRPCRouter, groupProcedure } from "@/trpc/init";

const id = z.string().min(1).max(64);
const pageInput = { limit: z.number().int().min(1).max(200).optional(), cursor: z.string().nullish() };

const membersRouter = createTRPCRouter({
  add: groupProcedure
    .input(addMemberInput)
    .mutation(({ ctx, input }) => addMember(ctx.group.id, { name: input.name, colour: input.colour }, ctx.actor)),
  update: groupProcedure
    .input(z.object({ memberId: id, patch: updateMemberInput }))
    .mutation(({ ctx, input }) => updateMember(ctx.group.id, input.memberId, input.patch, ctx.actor)),
  setArchived: groupProcedure
    .input(z.object({ memberId: id, archived: z.boolean() }))
    .mutation(({ ctx, input }) => setMemberArchived(ctx.group.id, input.memberId, input.archived, ctx.actor)),
  /** Completions per member this week / this month (group timezone). */
  tallies: groupProcedure.query(({ ctx }) => memberTallies(ctx.group.id)),
});

const choresRouter = createTRPCRouter({
  /** Chores with computed schedule + assignee, sorted by urgency. */
  list: groupProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }))
    .query(({ ctx, input }) => listChores(ctx.group.id, { includeArchived: input.includeArchived })),
  get: groupProcedure
    .input(z.object({ choreId: id }))
    .query(({ ctx, input }) => getChoreView(input.choreId, { groupId: ctx.group.id })),
  create: groupProcedure
    .input(z.object({ chore: createChoreInput }))
    .mutation(({ ctx, input }) => createChore(ctx.group.id, input.chore, ctx.actor)),
  update: groupProcedure
    .input(z.object({ choreId: id, patch: updateChoreInput }))
    .mutation(({ ctx, input }) => updateChore(ctx.group.id, input.choreId, input.patch, ctx.actor)),
  setArchived: groupProcedure
    .input(z.object({ choreId: id, archived: z.boolean() }))
    .mutation(({ ctx, input }) => setChoreArchived(ctx.group.id, input.choreId, input.archived, ctx.actor)),
  /** Mark done from the group UI. memberId defaults to actor.memberId. */
  complete: groupProcedure
    .input(
      z.object({
        choreId: id,
        memberId: id.nullish(),
        note: z.string().max(500).nullish(),
        completedAt: z.date().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      completeChore({
        choreId: input.choreId,
        groupId: ctx.group.id,
        memberId: input.memberId === undefined ? ctx.actor.memberId : input.memberId,
        deviceId: ctx.actor.deviceId,
        source: "MANUAL",
        note: input.note,
        completedAt: input.completedAt,
      }),
    ),
  /** Undo from the group UI: no time limit (group link = full access). */
  undo: groupProcedure
    .input(z.object({ completionId: id }))
    .mutation(({ ctx, input }) =>
      undoCompletion({ completionId: input.completionId, groupId: ctx.group.id, actor: ctx.actor, enforceWindow: false }),
    ),
});

const completionsRouter = createTRPCRouter({
  list: groupProcedure
    .input(z.object({ choreId: id.optional(), memberId: id.optional(), includeUndone: z.boolean().optional(), ...pageInput }))
    .query(({ ctx, input }) => listCompletions({ ...input, groupId: ctx.group.id })),
  tallies: groupProcedure
    .input(z.object({ since: z.date().optional() }))
    .query(({ ctx, input }) => completionTallies(ctx.group.id, input.since)),
});

const activityRouter = createTRPCRouter({
  list: groupProcedure
    .input(z.object({ choreId: id.optional(), ...pageInput }))
    .query(({ ctx, input }) => listActivity(prisma, { ...input, groupId: ctx.group.id })),
});

export const groupsRouter = createTRPCRouter({
  /** Instance-wide flags the group UI needs (no secrets). */
  config: baseProcedure.query(() => ({ enableGroupDeletion: env().ENABLE_GROUP_DELETION })),
  /** Create a group with initial members. Returns the group (no PIN hash) with members. */
  create: baseProcedure
    .input(createGroupInput.extend({ actor: actorInput }))
    .mutation(async ({ input }) => {
      const { actor, ...data } = input;
      const group = await createGroup(data, actor ?? undefined);
      return toPublicGroup(group);
    }),
  /** The group with all members (archived included). */
  get: groupProcedure.query(async ({ ctx }) => toPublicGroup(await getGroupWithMembers(ctx.group.id))),
  /** Names of known groups, for the "recent groups" list. Unknown/deleted ids are omitted. */
  getMany: baseProcedure
    .input(z.object({ groupIds: z.array(id).max(100) }))
    .query(async ({ input }) =>
      prisma.group.findMany({
        where: { id: { in: input.groupIds }, deletedAt: null },
        select: { id: true, name: true },
      }),
    ),
  update: groupProcedure
    .input(z.object({ patch: updateGroupInput, pin: z.string().max(16).nullish() }))
    .mutation(async ({ ctx, input }) =>
      toPublicGroup(
        await updateGroup(ctx.group.id, input.patch, { actor: ctx.actor, pin: input.pin, client: ctx.clientIp }),
      ),
    ),
  /**
   * Check a settings PIN (throws FORBIDDEN PIN_INVALID / PIN_REQUIRED, or
   * TOO_MANY_REQUESTS PIN_LOCKED after repeated wrong PINs).
   */
  verifyPin: groupProcedure
    .input(z.object({ pin: z.string().max(16) }))
    .mutation(async ({ ctx, input }) => {
      await assertSettingsPin(ctx.group, input.pin, { client: ctx.clientIp });
      return true;
    }),
  setPin: groupProcedure
    .input(z.object({ currentPin: z.string().max(16).nullish(), newPin: z.string().max(16).nullable() }))
    .mutation(async ({ ctx, input }) => toPublicGroup(await setSettingsPin(ctx.group.id, input, ctx.actor, { client: ctx.clientIp }))),
  delete: groupProcedure
    .input(z.object({ pin: z.string().max(16).nullish() }))
    .mutation(async ({ ctx, input }) => {
      await softDeleteGroup(ctx.group.id, { actor: ctx.actor, pin: input.pin, client: ctx.clientIp });
      return { ok: true as const };
    }),
  members: membersRouter,
  chores: choresRouter,
  completions: completionsRouter,
  activity: activityRouter,
});
