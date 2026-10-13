/**
 * POST /api/offline/replay: replays completions queued in IndexedDB while
 * offline. Contract in ./protocol.ts; idempotency notes in ./replay.ts.
 */
// TODO(merge): add `import "@/lib/integrations/listeners";` (Agent C) so
// replayed completions trigger immediate webhook delivery. Not on this branch.
import { MAX_REPLAY_BATCH, type ReplayResponse } from "./protocol";
import { replayItem } from "./replay";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_BODY" }, { status: 400, headers: noStore });
  }
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_REPLAY_BATCH) {
    return Response.json({ error: "INVALID_BODY" }, { status: 400, headers: noStore });
  }
  // Sequential on purpose: order matters for round-robin assignees, and it
  // keeps the serializable transactions in completeChore from conflicting.
  const results = [];
  for (const item of items) results.push(await replayItem(item));
  return Response.json({ results } satisfies ReplayResponse, { headers: noStore });
}
