/** GET|POST /api/cron/purge-deleted-groups — hard-delete groups soft-deleted over 30 days ago (also part of /api/cron/tick). */
import { handle, json } from "@/lib/integrations/api";
import { purgeDeletedGroups } from "@/lib/integrations/cron";
import { checkCronAuth } from "@/lib/integrations/cron-auth";

async function purge(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  return handle(async () => json({ purgedGroups: await purgeDeletedGroups() }));
}

export const GET = purge;
export const POST = purge;
