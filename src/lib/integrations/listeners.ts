/**
 * In-process event listeners. OWNED BY: Agent C.
 *
 * Import this module (for its side effect) from every server entry point that
 * can emit events: the integrations tRPC router (so all tRPC calls register
 * it), the REST routes, the inbound hook route and the cron route.
 *
 * After any event, deliver that group's due webhook rows straight away
 * instead of waiting for the next cron tick. Inside a request this runs via
 * `after()` (once the response is sent; on Vercel it extends the function
 * with waitUntil); outside a request scope (node-cron, scripts) it runs
 * fire-and-forget. Deliveries are claimed atomically, so racing the cron
 * sweep is harmless.
 */
import { after } from "next/server";
import { onEvent } from "@/lib/events";
import { processDueDeliveries } from "@/lib/integrations/webhooks";

let registered = false;

function kick(groupId: string) {
  const run = () =>
    processDueDeliveries({ groupId }).catch((err) => console.error("[webhooks] immediate delivery failed", err));
  try {
    after(run);
  } catch {
    // Not in a request scope.
    void run();
  }
}

/** Register the listeners once per module instance (idempotent). */
export function registerIntegrationListeners() {
  if (registered) return;
  registered = true;
  onEvent("*", (_event, { groupId }) => kick(groupId));
}

registerIntegrationListeners();
