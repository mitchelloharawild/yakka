/**
 * Tags (QR / NFC / URL) and the tap-to-complete flow. OWNED BY: Agent B.
 *
 * Two kinds of callers:
 *
 *  - **Group-scoped** (the caller holds the group id = full access): list,
 *    create, revoke, rotate, relabel, QR codes.
 *  - **Tag-scoped** (the caller holds only a tag token): resolve, complete,
 *    undo, createMember. A tag token can complete ITS OWN chore and nothing
 *    else. These functions never return the group id; see the fingerprint
 *    design in src/lib/tags.ts. The pure authorisation rules live there too
 *    (and are unit-tested); this file feeds them DB rows.
 */
import QRCode from "qrcode";
import { z } from "zod";
import type { Tag, TagKind } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { DomainError, notFound } from "@/lib/errors";
import { isPlausibleTagToken, newTagToken } from "@/lib/ids";
import { getChoreView } from "@/lib/services/chores";
import { requireGroup } from "@/lib/services/groups";
import { addMember } from "@/lib/services/members";
import { completeChore, undoCompletion } from "@/lib/services/completions";
import {
  canUseMembers,
  checkGroupClaim,
  checkTagUndo,
  checkTagUsable,
  groupFingerprint,
  tagPath,
  undoRemainingMs,
  type TagDecision,
} from "@/lib/tags";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Full public URL of a tag: `${BASE_URL}/t/${token}`. */
export function tagUrl(token: string): string {
  return `${env().BASE_URL}${tagPath(token)}`;
}

/** SVG markup of a QR code for `text` (server-generated; safe to inline). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

function enforce(decision: TagDecision): void {
  if (decision.ok) return;
  const code = decision.reason === "TAG_NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN";
  throw new DomainError(code, decision.reason);
}

/** zod: tag label. */
export const tagLabelSchema = z.string().trim().max(60).nullish();
/** zod: tag kind. */
export const tagKindSchema = z.enum(["QR", "NFC", "URL"]);
/** zod: a tag token (shape only). */
export const tagTokenSchema = z.string().min(1).max(64);

const choreSummarySelect = { id: true, title: true, icon: true, archivedAt: true } as const;

// ---------------------------------------------------------------------------
// Group-scoped management
// ---------------------------------------------------------------------------

/** A tag as shown in group management, with its URL and chore summary. */
export type TagListItem = Tag & {
  url: string;
  chore: { id: string; title: string; icon: string | null; archivedAt: Date | null };
};

/** Tags of a group (newest first), with chore and URL. Revoked tags included unless `activeOnly`. */
export async function listTags(groupId: string, opts: { activeOnly?: boolean } = {}): Promise<TagListItem[]> {
  const tags = await prisma.tag.findMany({
    where: { groupId, ...(opts.activeOnly ? { revokedAt: null } : {}) },
    include: { chore: { select: choreSummarySelect } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return tags.map((t) => ({ ...t, url: tagUrl(t.token) }));
}

async function requireGroupTag(groupId: string, tagId: string) {
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, groupId },
    include: { chore: { select: choreSummarySelect } },
  });
  if (!tag) throw notFound("TAG_NOT_FOUND");
  return tag;
}

/** zod: input of createTag(). */
export const createTagInput = z.object({
  choreId: z.string().min(1).max(64),
  kind: tagKindSchema.default("QR"),
  label: tagLabelSchema,
});

/** Create a tag for a chore of the group. */
export async function createTag(
  groupId: string,
  input: z.input<typeof createTagInput>,
  actor?: Actor,
): Promise<TagListItem> {
  const data = createTagInput.parse(input);
  await requireGroup(groupId);
  const chore = await prisma.chore.findFirst({ where: { id: data.choreId, groupId }, select: choreSummarySelect });
  if (!chore) throw notFound("CHORE_NOT_FOUND");
  if (chore.archivedAt) throw new DomainError("BAD_REQUEST", "CHORE_ARCHIVED");
  const tag = await prisma.$transaction(async (tx) => {
    const tag = await tx.tag.create({
      data: { token: newTagToken(), groupId, choreId: chore.id, kind: data.kind, label: data.label || null },
    });
    await logActivity(tx, {
      groupId,
      type: "tag.created",
      actor,
      choreId: chore.id,
      data: { tagId: tag.id, kind: tag.kind, label: tag.label, title: chore.title },
    });
    return tag;
  });
  return { ...tag, chore, url: tagUrl(tag.token) };
}

/** Revoke a tag (idempotent). Its URL stops working immediately. */
export async function revokeTag(groupId: string, tagId: string, actor?: Actor): Promise<TagListItem> {
  const tag = await requireGroupTag(groupId, tagId);
  if (tag.revokedAt) return { ...tag, url: tagUrl(tag.token) };
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.tag.update({ where: { id: tag.id }, data: { revokedAt: new Date() } });
    await logActivity(tx, {
      groupId,
      type: "tag.revoked",
      actor,
      choreId: tag.choreId,
      data: { tagId: tag.id, label: tag.label, title: tag.chore.title },
    });
    return updated;
  });
  return { ...updated, chore: tag.chore, url: tagUrl(updated.token) };
}

/**
 * Rotate a tag after its code leaked: revoke it and create a replacement
 * with a new token for the same chore, kind and label. Returns the new tag
 * (the physical QR/NFC tag must be reprinted/rewritten).
 */
export async function rotateTag(groupId: string, tagId: string, actor?: Actor): Promise<TagListItem> {
  const old = await requireGroupTag(groupId, tagId);
  if (old.chore.archivedAt) throw new DomainError("BAD_REQUEST", "CHORE_ARCHIVED");
  const now = new Date();
  const tag = await prisma.$transaction(async (tx) => {
    if (!old.revokedAt) {
      await tx.tag.update({ where: { id: old.id }, data: { revokedAt: now } });
      await logActivity(tx, {
        groupId,
        type: "tag.revoked",
        actor,
        choreId: old.choreId,
        data: { tagId: old.id, label: old.label, title: old.chore.title, rotated: true },
      });
    }
    const tag = await tx.tag.create({
      data: { token: newTagToken(), groupId, choreId: old.choreId, kind: old.kind, label: old.label },
    });
    await logActivity(tx, {
      groupId,
      type: "tag.created",
      actor,
      choreId: old.choreId,
      data: { tagId: tag.id, kind: tag.kind, label: tag.label, title: old.chore.title, rotatedFrom: old.id },
    });
    return tag;
  });
  return { ...tag, chore: old.chore, url: tagUrl(tag.token) };
}

/** Change a tag's label (null/empty clears it). */
export async function relabelTag(
  groupId: string,
  tagId: string,
  label: string | null | undefined,
  actor?: Actor,
): Promise<TagListItem> {
  const next = tagLabelSchema.parse(label) || null;
  const tag = await requireGroupTag(groupId, tagId);
  if (tag.label === next) return { ...tag, url: tagUrl(tag.token) };
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.tag.update({ where: { id: tag.id }, data: { label: next } });
    await logActivity(tx, {
      groupId,
      type: "tag.updated",
      actor,
      choreId: tag.choreId,
      data: { tagId: tag.id, from: tag.label, to: next, title: tag.chore.title },
    });
    return updated;
  });
  return { ...updated, chore: tag.chore, url: tagUrl(updated.token) };
}

/** URL and QR SVG of one tag of the group. */
export async function tagQr(groupId: string, tagId: string): Promise<{ url: string; svg: string }> {
  const tag = await requireGroupTag(groupId, tagId);
  const url = tagUrl(tag.token);
  return { url, svg: await qrSvg(url) };
}

/** Active tags of the group with QR SVGs, for the printable sheet. */
export async function printableTags(groupId: string) {
  const tags = await listTags(groupId, { activeOnly: true });
  return Promise.all(
    tags.filter((t) => !t.chore.archivedAt).map(async (t) => ({ ...t, svg: await qrSvg(t.url) })),
  );
}

// ---------------------------------------------------------------------------
// Tag-scoped (public, token only)
// ---------------------------------------------------------------------------

/** Load a tag by token and check it's usable (else NOT_FOUND TAG_NOT_FOUND / FORBIDDEN TAG_REVOKED). */
async function loadUsableTag(token: string) {
  const tag = isPlausibleTagToken(token)
    ? await prisma.tag.findUnique({
        where: { token },
        include: {
          group: {
            select: { id: true, name: true, timezone: true, joinFromTag: true, undoSeconds: true, deletedAt: true },
          },
          chore: { select: choreSummarySelect },
        },
      })
    : null;
  enforce(checkTagUsable(tag && { ...tag, groupDeletedAt: tag.group.deletedAt }));
  return tag!;
}

/** A group member as revealed to a tag page (only when allowed). */
export interface TagMember {
  id: string;
  name: string;
  colour: string | null;
}

/** What a tag page learns from its token. Deliberately has no group id. */
export interface ResolvedTag {
  tag: { label: string | null; kind: TagKind };
  chore: {
    title: string;
    icon: string | null;
    archived: boolean;
    status: string;
    nextDueAt: Date | null;
    overdueAt: Date | null;
    lastCompletedAt: Date | null;
  };
  group: {
    name: string;
    timezone: string;
    /** Non-secret fingerprint of the group id (src/lib/tags.ts). */
    fingerprint: string;
    joinFromTag: boolean;
    undoSeconds: number;
  };
  /** True when the client sent the matching group id. */
  groupVerified: boolean;
  /** Active members, oldest first; null unless joinFromTag or groupVerified. */
  members: TagMember[] | null;
}

/**
 * Resolve a tag token for the tap page. Pass `groupId` when the browser
 * already holds it (matched by fingerprint): if it matches, members are
 * returned even when joinFromTag is off; if it doesn't, FORBIDDEN GROUP_MISMATCH.
 * Read-only: never records anything.
 */
export async function resolveTag(input: { token: string; groupId?: string | null; now?: Date }): Promise<ResolvedTag> {
  const tag = await loadUsableTag(input.token);
  enforce(checkGroupClaim(tag.groupId, input.groupId));
  const groupVerified = input.groupId != null;
  const showMembers = canUseMembers({ joinFromTag: tag.group.joinFromTag, groupVerified });
  const [view, members] = await Promise.all([
    getChoreView(tag.choreId, { now: input.now }),
    showMembers
      ? prisma.member.findMany({
          where: { groupId: tag.groupId, archivedAt: null },
          select: { id: true, name: true, colour: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : Promise.resolve(null),
  ]);
  return {
    tag: { label: tag.label, kind: tag.kind },
    chore: {
      title: view.title,
      icon: view.icon,
      archived: Boolean(view.archivedAt),
      status: view.schedule.status,
      nextDueAt: view.schedule.nextDueAt,
      overdueAt: view.schedule.overdueAt,
      lastCompletedAt: view.schedule.lastCompletion?.completedAt ?? null,
    },
    group: {
      name: tag.group.name,
      timezone: tag.group.timezone,
      fingerprint: groupFingerprint(tag.groupId),
      joinFromTag: tag.group.joinFromTag,
      undoSeconds: tag.group.undoSeconds,
    },
    groupVerified,
    members,
  };
}

/** zod: input of completeViaTag(). */
export const completeViaTagInput = z.object({
  token: tagTokenSchema,
  memberId: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(64),
  /** The group id the browser holds, if any; verified against the tag. */
  groupId: z.string().min(1).max(64).nullish(),
  /** When it was done; set by offline-queue replays. Defaults to now. */
  completedAt: z.coerce.date().optional(),
});

/** Result of completeViaTag(). No group id, no full chore row. */
export interface TagCompletionResult {
  completion: {
    id: string;
    completedAt: Date;
    createdAt: Date;
    member: { id: string; name: string; colour: string | null } | null;
  };
  deduplicated: boolean;
  /** Whether this device may still undo it through this tag, and for how long (server clock). */
  undoable: boolean;
  undoRemainingMs: number;
  chore: { status: string; nextDueAt: Date | null; overdueAt: Date | null };
}

/**
 * Complete the tag's chore as `memberId`. The member must be an active
 * member of the tag's group (MEMBER_NOT_FOUND / MEMBER_ARCHIVED otherwise).
 * Debounced by completeChore (deduplicated: true). Updates tag.lastUsedAt.
 */
export async function completeViaTag(
  input: z.input<typeof completeViaTagInput> & { now?: Date },
): Promise<TagCompletionResult> {
  const data = completeViaTagInput.parse(input);
  const now = input.now ?? new Date();
  const tag = await loadUsableTag(data.token);
  enforce(checkGroupClaim(tag.groupId, data.groupId));

  const res = await completeChore({
    choreId: tag.choreId,
    groupId: tag.groupId,
    memberId: data.memberId,
    deviceId: data.deviceId,
    source: "TAG",
    tagId: tag.id,
    completedAt: data.completedAt,
    now,
  });
  // completeChore only touches lastUsedAt for new completions; a debounced
  // re-scan still counts as using the tag.
  if (res.deduplicated) await prisma.tag.update({ where: { id: tag.id }, data: { lastUsedAt: now } });

  const c = res.completion;
  const undo = checkTagUndo({ tag, completion: c, deviceId: data.deviceId, undoSeconds: tag.group.undoSeconds, now });
  return {
    completion: { id: c.id, completedAt: c.completedAt, createdAt: c.createdAt, member: c.member },
    deduplicated: res.deduplicated,
    undoable: undo.ok && !c.undoneAt,
    undoRemainingMs: undo.ok ? undoRemainingMs(c.createdAt, tag.group.undoSeconds, now) : 0,
    chore: {
      status: res.chore.schedule.status,
      nextDueAt: res.chore.schedule.nextDueAt,
      overdueAt: res.chore.schedule.overdueAt,
    },
  };
}

/** zod: input of undoViaTag(). */
export const undoViaTagInput = z.object({
  token: tagTokenSchema,
  completionId: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(64),
});

/**
 * Undo a completion through the tag page: only completions made via this
 * tag, from this device, within group.undoSeconds (FORBIDDEN
 * UNDO_NOT_ALLOWED / UNDO_WINDOW_EXPIRED). Idempotent.
 */
export async function undoViaTag(input: z.input<typeof undoViaTagInput> & { now?: Date }) {
  const data = undoViaTagInput.parse(input);
  const now = input.now ?? new Date();
  const tag = await loadUsableTag(data.token);
  const completion = await prisma.completion.findFirst({
    where: { id: data.completionId, tagId: tag.id, chore: { groupId: tag.groupId } },
  });
  enforce(checkTagUndo({ tag, completion, deviceId: data.deviceId, undoSeconds: tag.group.undoSeconds, now }));
  const res = await undoCompletion({
    completionId: completion!.id,
    groupId: tag.groupId,
    actor: { memberId: completion!.memberId, deviceId: data.deviceId },
    enforceWindow: true,
    now,
  });
  return {
    alreadyUndone: res.alreadyUndone,
    chore: {
      status: res.chore.schedule.status,
      nextDueAt: res.chore.schedule.nextDueAt,
      overdueAt: res.chore.schedule.overdueAt,
    },
  };
}

/** zod: input of createMemberViaTag(). */
export const createMemberViaTagInput = z.object({
  token: tagTokenSchema,
  name: z.string().trim().min(1).max(50),
  deviceId: z.string().min(1).max(64),
  groupId: z.string().min(1).max(64).nullish(),
});

/**
 * "I'm new" from a tag page. Allowed when the group has joinFromTag on, or
 * when the client proved it holds the group id (FORBIDDEN
 * JOIN_FROM_TAG_DISABLED otherwise).
 */
export async function createMemberViaTag(input: z.input<typeof createMemberViaTagInput>): Promise<TagMember> {
  const data = createMemberViaTagInput.parse(input);
  const tag = await loadUsableTag(data.token);
  enforce(checkGroupClaim(tag.groupId, data.groupId));
  if (!canUseMembers({ joinFromTag: tag.group.joinFromTag, groupVerified: data.groupId != null })) {
    throw new DomainError("FORBIDDEN", "JOIN_FROM_TAG_DISABLED");
  }
  const m = await addMember(tag.groupId, { name: data.name }, { deviceId: data.deviceId });
  return { id: m.id, name: m.name, colour: m.colour };
}
