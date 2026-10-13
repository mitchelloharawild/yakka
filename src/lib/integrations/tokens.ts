/**
 * Group API tokens. OWNED BY: Agent C.
 *
 * A token (`yk_…`) grants REST access to exactly one group. Only its SHA-256
 * hash and a short display prefix are stored; the plaintext is returned once
 * by createApiToken().
 */
import { z } from "zod";
import type { Group } from "@/generated/prisma/client";
import { logActivity, type Actor } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { hashToken, newApiToken, safeEqual } from "@/lib/ids";
import { parseBearer } from "@/lib/integrations/bearer";

/** zod: name of a token / hook / webhook. */
export const integrationNameSchema = z.string().trim().min(1).max(60);

/** Public fields of an API token (never the hash). */
const tokenSelect = { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true } as const;

/** Tokens of a group, newest first (revoked included, flagged by revokedAt). */
export async function listApiTokens(groupId: string) {
  return prisma.apiToken.findMany({ where: { groupId }, select: tokenSelect, orderBy: { createdAt: "desc" } });
}

/** Create a token. The returned `token` is the only time the plaintext exists. */
export async function createApiToken(groupId: string, name: string, actor?: Actor) {
  const parsedName = integrationNameSchema.parse(name);
  const { token, hash, prefix } = newApiToken();
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.apiToken.create({ data: { groupId, name: parsedName, hash, prefix }, select: tokenSelect });
    await logActivity(tx, { groupId, type: "apiToken.created", actor, data: { name: parsedName, prefix } });
    return created;
  });
  return { ...row, token };
}

/** Revoke a token (idempotent). */
export async function revokeApiToken(groupId: string, tokenId: string, actor?: Actor) {
  const existing = await prisma.apiToken.findFirst({ where: { id: tokenId, groupId }, select: tokenSelect });
  if (!existing) throw notFound("TOKEN_NOT_FOUND");
  if (existing.revokedAt) return existing;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() }, select: tokenSelect });
    await logActivity(tx, { groupId, type: "apiToken.revoked", actor, data: { name: existing.name, prefix: existing.prefix } });
    return updated;
  });
}

/** Outcome of authenticateBearer(). */
export type BearerAuth =
  | { ok: true; group: Group; tokenId: string }
  | { ok: false; reason: "TOKEN_MISSING" | "TOKEN_INVALID" };

/**
 * Authenticate an `Authorization` header. The token is hashed and looked up
 * by its (unique) hash, so lookup time doesn't depend on how many leading
 * characters match; the hash is then compared in constant time. Revoked
 * tokens and tokens of deleted groups are invalid. Updates lastUsedAt.
 */
export async function authenticateBearer(header: string | null, now = new Date()): Promise<BearerAuth> {
  const token = parseBearer(header);
  if (!token) return { ok: false, reason: "TOKEN_MISSING" };
  const hash = hashToken(token);
  const row = await prisma.apiToken.findUnique({ where: { hash }, include: { group: true } });
  if (!row || !safeEqual(row.hash, hash) || row.revokedAt || row.group.deletedAt) {
    return { ok: false, reason: "TOKEN_INVALID" };
  }
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  return { ok: true, group: row.group, tokenId: row.id };
}
