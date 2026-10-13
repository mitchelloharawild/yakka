/** GET /api/v1/groups/{gid}/members — members (oldest first). `?archived=true` includes archived. */
import { prisma } from "@/lib/db";
import { handle, json, requireApiGroup } from "@/lib/integrations/api";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/groups/[gid]/members">) {
  return handle(async () => {
    const { gid } = await ctx.params;
    const group = await requireApiGroup(request, gid);
    const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
    const members = await prisma.member.findMany({
      where: { groupId: group.id, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return json({
      members: members.map((m) => ({ id: m.id, name: m.name, colour: m.colour, archived: Boolean(m.archivedAt) })),
    });
  });
}
