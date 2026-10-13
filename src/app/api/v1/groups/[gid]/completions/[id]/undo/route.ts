/** POST /api/v1/groups/{gid}/completions/{id}/undo — undo a completion (idempotent, no time limit). */
import { handle, json, requireApiGroup, serializeChore, serializeCompletion } from "@/lib/integrations/api";
import { undoCompletion } from "@/lib/services/completions";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/groups/[gid]/completions/[id]/undo">) {
  return handle(async () => {
    const { gid, id } = await ctx.params;
    const group = await requireApiGroup(request, gid);
    const res = await undoCompletion({ completionId: id, groupId: group.id, enforceWindow: false });
    return json({
      completion: serializeCompletion(res.completion),
      alreadyUndone: res.alreadyUndone,
      nextDueAt: res.chore.schedule.nextDueAt?.toISOString() ?? null,
      chore: serializeChore(res.chore),
    });
  });
}
