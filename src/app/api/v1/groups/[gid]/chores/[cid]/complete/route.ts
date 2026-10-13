/**
 * POST /api/v1/groups/{gid}/chores/{cid}/complete — mark a chore done.
 * Body (optional): { member?: string (id or name) | null, completedAt?: ISO string, note?: string }
 */
import { z } from "zod";
import { handle, json, readJson, requireApiGroup, serializeChore, serializeCompletion } from "@/lib/integrations/api";
import { resolveApiMember } from "@/lib/integrations/api-members";
import { completeChore } from "@/lib/services/completions";

const body = z.object({
  member: z.string().trim().max(100).nullish(),
  completedAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).nullish(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/v1/groups/[gid]/chores/[cid]/complete">) {
  return handle(async () => {
    const { gid, cid } = await ctx.params;
    const group = await requireApiGroup(request, gid);
    const input = await readJson(request, body);
    const memberId = input.member ? await resolveApiMember(group.id, input.member) : null;
    const res = await completeChore({
      choreId: cid,
      groupId: group.id,
      memberId,
      source: "API",
      note: input.note,
      completedAt: input.completedAt ? new Date(input.completedAt) : undefined,
    });
    return json(
      {
        completion: serializeCompletion(res.completion),
        deduplicated: res.deduplicated,
        nextDueAt: res.chore.schedule.nextDueAt?.toISOString() ?? null,
        chore: serializeChore(res.chore),
      },
      { status: res.deduplicated ? 200 : 201 },
    );
  });
}
