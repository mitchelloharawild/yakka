/** GET /api/v1/groups/{gid}/chores/{cid} — one chore with computed status. */
import { handle, json, requireApiGroup, serializeChore } from "@/lib/integrations/api";
import { getChoreView } from "@/lib/services/chores";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/groups/[gid]/chores/[cid]">) {
  return handle(async () => {
    const { gid, cid } = await ctx.params;
    const group = await requireApiGroup(request, gid);
    const chore = await getChoreView(cid, { groupId: group.id });
    return json({ chore: serializeChore(chore) });
  });
}
