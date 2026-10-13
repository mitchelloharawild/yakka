import { z } from "zod";
import type { Group, Member } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { DomainError, notFound } from "@/lib/errors";
import { hashPin, newGroupId, verifyPin } from "@/lib/ids";
import { pinLimiter } from "@/lib/pin-limiter";
import { isValidTimezone } from "@/lib/schedule";

/** zod: IANA timezone name. */
export const timezoneSchema = z.string().min(1).max(64).refine(isValidTimezone, "Invalid timezone");

/** zod: member name. */
export const memberNameSchema = z.string().trim().min(1).max(50);

/** zod: optional CSS colour. */
export const colourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected #rrggbb")
  .nullish();

/** zod: input of createGroup(). */
export const createGroupInput = z.object({
  name: z.string().trim().min(1).max(80),
  timezone: timezoneSchema.default("UTC"),
  members: z
    .array(z.object({ name: memberNameSchema, colour: colourSchema }))
    .max(50)
    .default([]),
  joinFromTag: z.boolean().optional(),
});

/** zod: patch accepted by updateGroup(). */
export const updateGroupInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: timezoneSchema.optional(),
  joinFromTag: z.boolean().optional(),
  undoSeconds: z.number().int().min(0).max(600).optional(),
  debounceMinutes: z.number().int().min(0).max(1440).optional(),
});

/** A group as sent to clients: never includes the PIN hash. */
export type PublicGroup = Omit<Group, "settingsPin"> & { hasSettingsPin: boolean };

/** Strip secrets from a group row before returning it to a client. */
export function toPublicGroup<G extends Group>(group: G): Omit<G, "settingsPin"> & { hasSettingsPin: boolean } {
  const { settingsPin, ...rest } = group;
  return { ...rest, hasSettingsPin: Boolean(settingsPin) };
}

/** Load a non-deleted group or null. */
export async function findGroup(groupId: string): Promise<Group | null> {
  return prisma.group.findFirst({ where: { id: groupId, deletedAt: null } });
}

/** Load a non-deleted group or throw NOT_FOUND ("GROUP_NOT_FOUND"). */
export async function requireGroup(groupId: string): Promise<Group> {
  const group = await findGroup(groupId);
  if (!group) throw notFound("GROUP_NOT_FOUND");
  return group;
}

/** A group with all of its members (archived included, oldest first). */
export async function getGroupWithMembers(groupId: string): Promise<Group & { members: Member[] }> {
  const group = await prisma.group.findFirst({
    where: { id: groupId, deletedAt: null },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!group) throw notFound("GROUP_NOT_FOUND");
  return group;
}

/** Create a group with its initial members. */
export async function createGroup(input: z.input<typeof createGroupInput>, actor?: Actor) {
  const data = createGroupInput.parse(input);
  const id = newGroupId();
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: {
        id,
        name: data.name,
        timezone: data.timezone,
        joinFromTag: data.joinFromTag ?? env().ALLOW_JOIN_FROM_TAG_DEFAULT,
      },
    });
    // Sequential so createdAt (rotation order) follows the given order.
    const members: Member[] = [];
    for (const [i, m] of data.members.entries()) {
      members.push(
        await tx.member.create({
          data: { groupId: id, name: m.name, colour: m.colour ?? null, createdAt: new Date(group.createdAt.getTime() + i) },
        }),
      );
    }
    await logActivity(tx, {
      groupId: id,
      type: "group.created",
      actor,
      data: { name: group.name, members: members.map((m) => m.name) },
    });
    return { ...group, members };
  });
}

/** Update group settings. Throws FORBIDDEN ("PIN_REQUIRED"/"PIN_INVALID") if a settings PIN is set and not given. */
export async function updateGroup(
  groupId: string,
  patch: z.input<typeof updateGroupInput>,
  opts: { actor?: Actor; pin?: string | null; client?: string } = {},
) {
  const data = updateGroupInput.parse(patch);
  const group = await requireGroup(groupId);
  await assertSettingsPin(group, opts.pin, { client: opts.client });
  const changed = Object.keys(data).filter(
    (k) => data[k as keyof typeof data] !== undefined && data[k as keyof typeof data] !== group[k as keyof Group],
  );
  if (changed.length === 0) return group;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.group.update({ where: { id: groupId }, data });
    await logActivity(tx, { groupId, type: "group.updated", actor: opts.actor, data: { changed } });
    return updated;
  });
}

/** Who is trying a PIN, for the attempt limiter (src/lib/pin-limiter.ts). */
export interface PinAttemptContext {
  /** Client IP (tRPC ctx.clientIp). Missing = one shared "unknown" client. */
  client?: string;
  now?: number;
}

/**
 * Throw unless `pin` matches the group's settings PIN (no-op when the group
 * has no PIN). Wrong PINs are rate limited per group and per client:
 * TOO_MANY_REQUESTS "PIN_LOCKED" (with retryAfterSeconds) while locked out.
 */
export async function assertSettingsPin(
  group: Pick<Group, "id" | "settingsPin">,
  pin: string | null | undefined,
  attempt: PinAttemptContext = {},
) {
  if (!group.settingsPin) return;
  if (!pin) throw new DomainError("FORBIDDEN", "PIN_REQUIRED");
  const client = attempt.client ?? "unknown";
  const check = pinLimiter.check(group.id, client, attempt.now);
  if (!check.allowed) {
    throw new DomainError("TOO_MANY_REQUESTS", "PIN_LOCKED", "Too many wrong PINs", check.retryAfterSeconds);
  }
  if (!(await verifyPin(pin, group.settingsPin))) {
    pinLimiter.fail(group.id, client, attempt.now);
    throw new DomainError("FORBIDDEN", "PIN_INVALID");
  }
  pinLimiter.succeed(group.id, client);
}

/** Set (or clear with null) the settings PIN. Requires the current PIN if one is set. */
export async function setSettingsPin(
  groupId: string,
  input: { currentPin?: string | null; newPin: string | null },
  actor?: Actor,
  attempt: PinAttemptContext = {},
) {
  const group = await requireGroup(groupId);
  await assertSettingsPin(group, input.currentPin, attempt);
  if (input.newPin !== null && !/^\d{4,8}$/.test(input.newPin)) throw new DomainError("BAD_REQUEST", "PIN_FORMAT");
  const settingsPin = input.newPin === null ? null : await hashPin(input.newPin);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.group.update({ where: { id: groupId }, data: { settingsPin } });
    await logActivity(tx, { groupId, type: "group.updated", actor, data: { changed: ["settingsPin"] } });
    return updated;
  });
}

/** Soft-delete a group (purged later by cron). FORBIDDEN when ENABLE_GROUP_DELETION is off. */
export async function softDeleteGroup(
  groupId: string,
  opts: { actor?: Actor; pin?: string | null; client?: string } = {},
) {
  if (!env().ENABLE_GROUP_DELETION) throw new DomainError("FORBIDDEN", "GROUP_DELETION_DISABLED");
  const group = await requireGroup(groupId);
  await assertSettingsPin(group, opts.pin, { client: opts.client });
  return prisma.$transaction(async (tx) => {
    await logActivity(tx, { groupId, type: "group.deleted", actor: opts.actor });
    return tx.group.update({ where: { id: groupId }, data: { deletedAt: new Date() } });
  });
}
