/** Authorisation for /api/cron/* (`Authorization: Bearer ${CRON_SECRET}`). OWNED BY: Agent C. */
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/ids";
import { errorResponse } from "@/lib/integrations/api";
import { parseBearer } from "@/lib/integrations/bearer";

/** Returns an error Response when the request isn't authorised, else null. */
export function checkCronAuth(request: Request): Response | null {
  const secret = env().CRON_SECRET;
  if (!secret) return errorResponse(503, "CRON_NOT_CONFIGURED", "Set CRON_SECRET to enable /api/cron/*.");
  const token = parseBearer(request.headers.get("authorization"));
  if (!token || !safeEqual(token, secret)) return errorResponse(401, "UNAUTHORIZED", "Invalid cron secret.");
  return null;
}
