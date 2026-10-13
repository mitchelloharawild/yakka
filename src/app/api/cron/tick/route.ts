/**
 * GET|POST /api/cron/tick — run the periodic jobs (due/overdue notices,
 * webhook deliveries, purge). Vercel Cron sends GET with
 * `Authorization: Bearer ${CRON_SECRET}`.
 */
import { handle, json } from "@/lib/integrations/api";
import { runCronTick } from "@/lib/integrations/cron";
import { checkCronAuth } from "@/lib/integrations/cron-auth";

export const maxDuration = 60;

async function tick(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  return handle(async () => json(await runCronTick()));
}

export const GET = tick;
export const POST = tick;
