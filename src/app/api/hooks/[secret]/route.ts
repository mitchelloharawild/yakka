/**
 * POST /api/hooks/{secret} — complete the hook's chore. Any body is accepted;
 * a JSON (or form) body with `member` (id or name) overrides the default
 * member. Unknown/revoked secrets get 404.
 *
 * Only POST has side effects. GET is answered with 405 without looking the
 * secret up: link previewers, chat unfurlers, browser prefetch and crawlers
 * issue GETs on any URL they see, and they must never tick off a chore.
 */
import { errorResponse, handle, json, readLenientMember, serializeCompletion } from "@/lib/integrations/api";
import { triggerInboundHook } from "@/lib/integrations/hooks";

export async function POST(request: Request, ctx: RouteContext<"/api/hooks/[secret]">) {
  return handle(async () => {
    const { secret } = await ctx.params;
    const member = await readLenientMember(request);
    const res = await triggerInboundHook(secret, { member });
    return json(
      {
        ok: true,
        deduplicated: res.deduplicated,
        completion: serializeCompletion(res.completion),
        chore: {
          id: res.chore.id,
          title: res.chore.title,
          status: res.chore.schedule.status,
          nextDueAt: res.chore.schedule.nextDueAt?.toISOString() ?? null,
        },
      },
      { status: res.deduplicated ? 200 : 201 },
    );
  });
}

export function GET() {
  return errorResponse(405, "METHOD_NOT_ALLOWED", "Use POST: hooks only act on POST so link previews can't trigger them.", {
    Allow: "POST",
  });
}
