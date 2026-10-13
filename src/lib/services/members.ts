import { z } from "zod";
import type { Member } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { colourSchema, memberNameSchema, requireGroup } from "@/lib/services/groups";

/** zod: input of addMember(). */
export const addMemberInput = z.object({ name: memberNameSchema, colour: colourSchema });

/** zod: patch accepted by updateMember(). */
export const updateMemberInput = z.object({ name: memberNameSchema.optional(), colour: colourSchema });

/** Load a member of the group (archived included) or throw NOT_FOUND ("MEMBER_NOT_FOUND"). */
export async function requireMember(groupId: string, memberId: string): Promise<Member> {
  const member = await prisma.member.findFirst({ where: { id: memberId, groupId } });
  if (!member) throw notFound("MEMBER_NOT_FOUND");
  return member;
}

/** Members of a group, oldest first. */
export async function listMembers(groupId: string, opts: { includeArchived?: boolean } = {}) {
  return prisma.member.findMany({
    where: { groupId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** Add a member ("I'm new"). */
export async function addMember(groupId: string, input: z.input<typeof addMemberInput>, actor?: Actor) {
  const data = addMemberInput.parse(input);
  await requireGroup(groupId);
  return prisma.$transaction(async (tx) => {
    const member = await tx.member.create({ data: { groupId, name: data.name, colour: data.colour ?? null } });
    // The new member is usually the actor themself.
    await logActivity(tx, {
      groupId,
      type: "member.created",
      actor: { memberId: actor?.memberId ?? member.id, deviceId: actor?.deviceId },
      data: { memberId: member.id, name: member.name },
    });
    return member;
  });
}

/** Rename or recolour a member. */
export async function updateMember(
  groupId: string,
  memberId: string,
  patch: z.input<typeof updateMemberInput>,
  actor?: Actor,
) {
  const data = updateMemberInput.parse(patch);
  const before = await requireMember(groupId, memberId);
  return prisma.$transaction(async (tx) => {
    const member = await tx.member.update({
      where: { id: memberId },
      data: { name: data.name, colour: data.colour === undefined ? undefined : data.colour },
    });
    await logActivity(tx, {
      groupId,
      type: "member.updated",
      actor,
      data: { memberId, from: before.name, to: member.name },
    });
    return member;
  });
}

/** Archive (archived = true) or restore (false) a member. Archived members leave rotations. */
export async function setMemberArchived(groupId: string, memberId: string, archived: boolean, actor?: Actor) {
  const before = await requireMember(groupId, memberId);
  if (Boolean(before.archivedAt) === archived) return before;
  return prisma.$transaction(async (tx) => {
    const member = await tx.member.update({
      where: { id: memberId },
      data: { archivedAt: archived ? new Date() : null },
    });
    await logActivity(tx, {
      groupId,
      type: archived ? "member.archived" : "member.restored",
      actor,
      data: { memberId, name: member.name },
    });
    return member;
  });
}
