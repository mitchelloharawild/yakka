/** Member lookup for REST/hook requests. OWNED BY: Agent C. */
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { matchMember } from "@/lib/integrations/member-match";

/** Resolve a member id or name (case-insensitive) within a group, or throw MEMBER_NOT_FOUND / MEMBER_AMBIGUOUS. */
export async function resolveApiMember(groupId: string, value: string): Promise<string> {
  const members = await prisma.member.findMany({ where: { groupId } });
  const match = matchMember(members, value);
  if (!match.ok) throw new DomainError(match.reason === "MEMBER_AMBIGUOUS" ? "BAD_REQUEST" : "NOT_FOUND", match.reason);
  return match.member.id;
}
