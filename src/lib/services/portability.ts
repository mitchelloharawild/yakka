/**
 * Group export / import: a versioned JSON document that moves one group
 * between Yakka instances (e.g. from a hosted server to a self-hosted one).
 *
 * Exported: group settings, members, chores, tags and every completion.
 * Completions are not optional: next due dates, round-robin turns and
 * ADAPTIVE intervals are all derived from them on read, never stored.
 *
 * Not exported: the settings PIN hash (a 4-8 digit PIN is trivial to brute
 * force offline), API tokens, inbound hooks and webhooks (credentials bound to
 * this instance's URLs), push subscriptions (bound to its VAPID keys), the
 * activity log, notices, deliveries and device ids.
 *
 * Import always creates a NEW group with a fresh id (the id is the access
 * secret, so a file must not choose it) and fresh row ids. Tag tokens are
 * kept when free on this instance, so labels keep working if the domain moves
 * with the data; tokens already taken are reissued and those labels need
 * reprinting.
 */
import { z, ZodError } from "zod";
import type { Chore, Completion, Group, Member, Tag } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { isPlausibleTagToken, newGroupId, newTagToken } from "@/lib/ids";
import { parseChecklist, serializeChecklist } from "@/lib/checklist";
import { createChoreInput } from "@/lib/services/chores";
import { colourSchema, memberNameSchema, requireGroup, timezoneSchema, updateGroupInput } from "@/lib/services/groups";

/** `format` field of an export document. */
export const GROUP_EXPORT_FORMAT = "yakka.group";
/** Current export version. Bump it (and add an upgrade step) when the shape changes incompatibly. */
export const GROUP_EXPORT_VERSION = 1;

/** Largest import accepted, per collection. */
export const IMPORT_LIMITS = { members: 200, chores: 500, tags: 1000, completions: 100_000 } as const;

const ref = z.string().min(1).max(64);
const date = z.coerce.date();
const optionalDate = z.coerce.date().nullish();

const memberSchema = z.object({
  id: ref,
  name: memberNameSchema,
  colour: colourSchema,
  createdAt: date,
  archivedAt: optionalDate,
});

const choreSchema = createChoreInput.extend({
  id: ref,
  assigneeId: ref.nullish(),
  createdAt: date,
  archivedAt: optionalDate,
});

const tagSchema = z.object({
  id: ref,
  token: z.string().min(1).max(64),
  choreId: ref,
  qr: z.boolean().default(true),
  nfc: z.boolean().default(false),
  label: z.string().trim().max(60).nullish(),
  createdAt: date,
  lastUsedAt: optionalDate,
  revokedAt: optionalDate,
});

const completionSchema = z.object({
  choreId: ref,
  memberId: ref.nullish(),
  source: z.enum(["TAG", "MANUAL", "API", "WEBHOOK"]),
  tagId: ref.nullish(),
  note: z.string().max(500).nullish(),
  completedAt: date,
  createdAt: date,
  undoneAt: optionalDate,
});

/** zod: a version-1 export document, with cross-references checked. */
export const groupExportSchema = z
  .object({
    format: z.literal(GROUP_EXPORT_FORMAT),
    version: z.literal(GROUP_EXPORT_VERSION),
    exportedAt: optionalDate,
    group: updateGroupInput.extend({
      name: updateGroupInput.shape.name.unwrap(),
      timezone: timezoneSchema.default("UTC"),
      createdAt: optionalDate,
    }),
    members: z.array(memberSchema).max(IMPORT_LIMITS.members).default([]),
    chores: z.array(choreSchema).max(IMPORT_LIMITS.chores).default([]),
    tags: z.array(tagSchema).max(IMPORT_LIMITS.tags).default([]),
    completions: z.array(completionSchema).max(IMPORT_LIMITS.completions).default([]),
  })
  .superRefine((doc, ctx) => {
    const ids = (rows: { id: string }[], path: string) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (seen.has(r.id)) ctx.addIssue({ code: "custom", path: [path, i, "id"], message: "Duplicate id" });
        seen.add(r.id);
      });
      return seen;
    };
    const members = ids(doc.members, "members");
    const chores = ids(doc.chores, "chores");
    const tags = ids(doc.tags, "tags");
    const check = (ok: boolean, path: (string | number)[], what: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path, message: `Unknown ${what}` });
    };
    doc.chores.forEach((c, i) => check(!c.assigneeId || members.has(c.assigneeId), ["chores", i, "assigneeId"], "member"));
    const tokens = new Set<string>();
    doc.tags.forEach((t, i) => {
      check(chores.has(t.choreId), ["tags", i, "choreId"], "chore");
      if (tokens.has(t.token)) ctx.addIssue({ code: "custom", path: ["tags", i, "token"], message: "Duplicate token" });
      tokens.add(t.token);
    });
    doc.completions.forEach((c, i) => {
      check(chores.has(c.choreId), ["completions", i, "choreId"], "chore");
      check(!c.memberId || members.has(c.memberId), ["completions", i, "memberId"], "member");
      check(!c.tagId || tags.has(c.tagId), ["completions", i, "tagId"], "tag");
    });
  });

/** A parsed, validated export document. */
export type GroupExport = z.output<typeof groupExportSchema>;

/**
 * Validate an export document. Throws BAD_REQUEST "IMPORT_VERSION_UNSUPPORTED"
 * for a file from a newer Yakka, or "IMPORT_INVALID" (message says where).
 */
export function parseGroupExport(input: unknown): GroupExport {
  if (input && typeof input === "object" && "format" in input && input.format === GROUP_EXPORT_FORMAT) {
    const version = (input as { version?: unknown }).version;
    if (typeof version === "number" && version > GROUP_EXPORT_VERSION) {
      throw new DomainError("BAD_REQUEST", "IMPORT_VERSION_UNSUPPORTED", `Export version ${version} is newer than this server supports`);
    }
  }
  try {
    return groupExportSchema.parse(input);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    const issue = e.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new DomainError("BAD_REQUEST", "IMPORT_INVALID", `${where}${issue?.message ?? "invalid"}`);
  }
}

/** Rows of one group, as loaded by exportGroup(). */
export interface GroupRows {
  group: Group;
  members: Member[];
  chores: Chore[];
  tags: Tag[];
  completions: Completion[];
}

/** Build the export document from a group's rows. Pure; leaves out secrets and instance-bound data. */
export function toGroupExport(rows: GroupRows, now = new Date()) {
  const { group } = rows;
  return {
    format: GROUP_EXPORT_FORMAT,
    version: GROUP_EXPORT_VERSION,
    exportedAt: now,
    group: {
      name: group.name,
      timezone: group.timezone,
      joinFromTag: group.joinFromTag,
      undoSeconds: group.undoSeconds,
      debounceMinutes: group.debounceMinutes,
      createdAt: group.createdAt,
    },
    members: rows.members.map((m) => ({
      id: m.id,
      name: m.name,
      colour: m.colour,
      createdAt: m.createdAt,
      archivedAt: m.archivedAt,
    })),
    chores: rows.chores.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      icon: c.icon,
      checklist: parseChecklist(c.checklist),
      rrule: c.rrule,
      startsAt: c.startsAt,
      anchor: c.anchor,
      assigneeMode: c.assigneeMode,
      assigneeId: c.assigneeId,
      graceMinutes: c.graceMinutes,
      sortOrder: c.sortOrder,
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
    })),
    tags: rows.tags.map((t) => ({
      id: t.id,
      token: t.token,
      choreId: t.choreId,
      qr: t.qr,
      nfc: t.nfc,
      label: t.label,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      revokedAt: t.revokedAt,
    })),
    completions: rows.completions.map((c) => ({
      choreId: c.choreId,
      memberId: c.memberId,
      source: c.source,
      tagId: c.tagId,
      note: c.note,
      completedAt: c.completedAt,
      createdAt: c.createdAt,
      undoneAt: c.undoneAt,
    })),
  };
}

/** The export document of a group (see toGroupExport). */
export type GroupExportDocument = ReturnType<typeof toGroupExport>;

/** Export a (non-deleted) group. Callers check the settings PIN. */
export async function exportGroup(groupId: string): Promise<GroupExportDocument> {
  const group = await requireGroup(groupId);
  const [members, chores, tags, completions] = await Promise.all([
    prisma.member.findMany({ where: { groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.chore.findMany({ where: { groupId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    prisma.tag.findMany({ where: { groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.completion.findMany({ where: { chore: { groupId } }, orderBy: [{ completedAt: "asc" }, { id: "asc" }] }),
  ]);
  return toGroupExport({ group, members, chores, tags, completions });
}

/** Completions per createMany call (keeps SQLite under its bound-variable limit). */
const COMPLETION_CHUNK = 1000;

/**
 * Create a new group from an export document. Returns the new group id and
 * name, its members (for the identity picker) and how many tag tokens had to
 * be reissued because they were taken on this instance.
 */
export async function importGroup(input: unknown, actor?: Actor) {
  const doc = parseGroupExport(input);
  const id = newGroupId();
  return prisma.$transaction(
    async (tx) => {
      const group = await tx.group.create({
        data: {
          id,
          name: doc.group.name,
          timezone: doc.group.timezone,
          joinFromTag: doc.group.joinFromTag,
          undoSeconds: doc.group.undoSeconds,
          debounceMinutes: doc.group.debounceMinutes,
          createdAt: doc.group.createdAt ?? undefined,
        },
      });

      // Row by row so each new id is known for remapping references.
      const memberIds = new Map<string, string>();
      const members: Member[] = [];
      for (const m of doc.members) {
        const row = await tx.member.create({
          data: { groupId: id, name: m.name, colour: m.colour ?? null, createdAt: m.createdAt, archivedAt: m.archivedAt ?? null },
        });
        memberIds.set(m.id, row.id);
        members.push(row);
      }
      const member = (old: string | null | undefined) => (old ? (memberIds.get(old) ?? null) : null);

      const choreIds = new Map<string, string>();
      for (const c of doc.chores) {
        const { id: oldId, assigneeId, checklist, ...fields } = c;
        const row = await tx.chore.create({
          data: {
            ...fields,
            checklist: serializeChecklist(checklist ?? []),
            archivedAt: c.archivedAt ?? null,
            groupId: id,
            assigneeId: member(assigneeId),
          },
        });
        choreIds.set(oldId, row.id);
      }

      const wanted = doc.tags.map((t) => t.token).filter(isPlausibleTagToken);
      const taken = new Set(
        wanted.length
          ? (await tx.tag.findMany({ where: { token: { in: wanted } }, select: { token: true } })).map((t) => t.token)
          : [],
      );
      const tagIds = new Map<string, string>();
      let reissuedTags = 0;
      for (const t of doc.tags) {
        const keep = isPlausibleTagToken(t.token) && !taken.has(t.token);
        if (!keep) reissuedTags++;
        const row = await tx.tag.create({
          data: {
            token: keep ? t.token : newTagToken(),
            groupId: id,
            choreId: choreIds.get(t.choreId)!,
            qr: t.qr,
            nfc: t.nfc,
            label: t.label ?? null,
            createdAt: t.createdAt,
            lastUsedAt: t.lastUsedAt ?? null,
            revokedAt: t.revokedAt ?? null,
          },
        });
        tagIds.set(t.id, row.id);
      }

      for (let i = 0; i < doc.completions.length; i += COMPLETION_CHUNK) {
        await tx.completion.createMany({
          data: doc.completions.slice(i, i + COMPLETION_CHUNK).map((c) => ({
            choreId: choreIds.get(c.choreId)!,
            memberId: member(c.memberId),
            source: c.source,
            tagId: c.tagId ? (tagIds.get(c.tagId) ?? null) : null,
            note: c.note ?? null,
            completedAt: c.completedAt,
            createdAt: c.createdAt,
            undoneAt: c.undoneAt ?? null,
          })),
        });
      }

      await logActivity(tx, {
        groupId: id,
        type: "group.imported",
        actor,
        data: {
          name: group.name,
          exportedAt: doc.exportedAt?.toISOString() ?? null,
          chores: doc.chores.length,
          completions: doc.completions.length,
        },
      });
      return { id: group.id, name: group.name, members, reissuedTags };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
