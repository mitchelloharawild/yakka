/** GET /api/v1/groups/{gid}/export — the group as a portable JSON export (see src/lib/services/portability.ts). */
import { handle, json, requireApiGroup } from "@/lib/integrations/api";
import { exportGroup } from "@/lib/services/portability";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/groups/[gid]/export">) {
  return handle(async () => {
    const { gid } = await ctx.params;
    const group = await requireApiGroup(request, gid);
    return json(await exportGroup(group.id));
  });
}
