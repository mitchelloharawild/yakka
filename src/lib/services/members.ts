import { z } from "zod";
import type { Member } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { fromWallClock, toWallClock } from "@/lib/schedule";
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

/** Start of the current week (Monday 00:00) and month in `tz`, as instants. */
export function periodStarts(now: Date, tz: string): { week: Date; month: Date } {
  const w = toWallClock(now, tz);
  const daysSinceMonday = (w.getUTCDay() + 6) % 7;
  return {
    week: fromWallClock(new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() - daysSinceMonday)), tz),
    month: fromWallClock(new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 1)), tz),
  };
}

/**
 * Non-undone completions per member this week (from Monday) and this month,
 * in the group's timezone. memberId null = automations / unknown.
 */
export async function memberTallies(groupId: string, now = new Date()) {
  const group = await requireGroup(groupId);
  const { week, month } = periodStarts(now, group.timezone);
  const count = (since: Date) =>
    prisma.completion.groupBy({
      by: ["memberId"],
      where: { chore: { groupId }, undoneAt: null, completedAt: { gte: since } },
      _count: { _all: true },
    });
  const [w, m] = await Promise.all([count(week), count(month)]);
  const out = new Map<string | null, { memberId: string | null; week: number; month: number }>();
  for (const r of m) out.set(r.memberId, { memberId: r.memberId, week: 0, month: r._count._all });
  for (const r of w) {
    const e = out.get(r.memberId) ?? { memberId: r.memberId, week: 0, month: 0 };
    out.set(r.memberId, { ...e, week: r._count._all });
  }
  return { weekStart: week, monthStart: month, tallies: [...out.values()] };
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
