/** GET /api/v1/groups/{gid}/chores — chores with computed status, most urgent first. `?archived=true` includes archived. */
import { handle, json, requireApiGroup, serializeChore } from "@/lib/integrations/api";
import { listChores } from "@/lib/services/chores";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/groups/[gid]/chores">) {
  return handle(async () => {
    const { gid } = await ctx.params;
    const group = await requireApiGroup(request, gid);
    const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
    const chores = await listChores(group.id, { includeArchived });
    return json({ chores: chores.map(serializeChore) });
  });
}
