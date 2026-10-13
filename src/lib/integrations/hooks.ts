/**
 * Inbound hook URLs: `POST /api/hooks/{secret}` completes one chore.
 * OWNED BY: Agent C.
 *
 * The secret is stored in clear (unlike API tokens) so the URL can be shown
 * again in the UI. It only grants "complete this one chore".
 */
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { DomainError, notFound } from "@/lib/errors";
import { env } from "@/lib/env";
import { newHookSecret } from "@/lib/ids";
import { resolveApiMember } from "@/lib/integrations/api-members";
import { integrationNameSchema } from "@/lib/integrations/tokens";
import { completeChore } from "@/lib/services/completions";

/** Public URL of a hook. */
export function hookUrl(secret: string): string {
  return `${env().BASE_URL}/api/hooks/${secret}`;
}

/** Hooks of a group with their URL, newest first (revoked included). */
export async function listInboundHooks(groupId: string) {
  const rows = await prisma.inboundHook.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    include: {
      chore: { select: { id: true, title: true, icon: true, archivedAt: true } },
      defaultMember: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({ ...r, url: hookUrl(r.secret) }));
}

/** Create a hook for a chore, optionally recording completions as `defaultMemberId`. */
export async function createInboundHook(
  groupId: string,
  input: { choreId: string; name?: string | null; defaultMemberId?: string | null },
  actor?: Actor,
) {
  const name = input.name ? integrationNameSchema.parse(input.name) : null;
  const chore = await prisma.chore.findFirst({ where: { id: input.choreId, groupId } });
  if (!chore) throw notFound("CHORE_NOT_FOUND");
  if (chore.archivedAt) throw new DomainError("BAD_REQUEST", "CHORE_ARCHIVED");
  if (input.defaultMemberId) {
    const m = await prisma.member.findFirst({ where: { id: input.defaultMemberId, groupId } });
    if (!m) throw notFound("MEMBER_NOT_FOUND");
    if (m.archivedAt) throw new DomainError("BAD_REQUEST", "MEMBER_ARCHIVED");
  }
  const hook = await prisma.$transaction(async (tx) => {
    const created = await tx.inboundHook.create({
      data: { groupId, choreId: chore.id, name, secret: newHookSecret(), defaultMemberId: input.defaultMemberId ?? null },
    });
    await logActivity(tx, { groupId, type: "inboundHook.created", actor, choreId: chore.id, data: { title: chore.title, name } });
    return created;
  });
  return { ...hook, url: hookUrl(hook.secret) };
}

/** Revoke a hook (idempotent). Its URL then returns 404. */
export async function revokeInboundHook(groupId: string, hookId: string, actor?: Actor) {
  const hook = await prisma.inboundHook.findFirst({ where: { id: hookId, groupId }, include: { chore: true } });
  if (!hook) throw notFound("HOOK_NOT_FOUND");
  if (hook.revokedAt) return hook;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.inboundHook.update({ where: { id: hookId }, data: { revokedAt: new Date() } });
    await logActivity(tx, {
      groupId,
      type: "inboundHook.revoked",
      actor,
      choreId: hook.choreId,
      data: { title: hook.chore.title, name: hook.name },
    });
    return updated;
  });
}

/**
 * Handle `POST /api/hooks/{secret}`. `member` (optional, from the body) is a
 * member id or name; without it the hook's default member is used, or null
 * ("Automation"). Throws NOT_FOUND HOOK_NOT_FOUND for unknown/revoked hooks.
 */
export async function triggerInboundHook(secret: string, opts: { member?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (!/^[0-9A-Za-z]{16,64}$/.test(secret)) throw notFound("HOOK_NOT_FOUND");
  const hook = await prisma.inboundHook.findUnique({ where: { secret }, include: { group: true, defaultMember: true } });
  if (!hook || hook.revokedAt || hook.group.deletedAt) throw notFound("HOOK_NOT_FOUND");

  // An archived default member falls back to "Automation" rather than failing the hook.
  let memberId = hook.defaultMember && !hook.defaultMember.archivedAt ? hook.defaultMember.id : null;
  if (opts.member) memberId = await resolveApiMember(hook.groupId, opts.member);
  await prisma.inboundHook.update({ where: { id: hook.id }, data: { lastUsedAt: now } });
  return completeChore({ choreId: hook.choreId, groupId: hook.groupId, memberId, source: "WEBHOOK", now });
}
