/**
 * API tokens, inbound hooks and outbound webhook management. OWNED BY: Agent C.
 * Placeholder procedure only; replace freely.
 */
import { baseProcedure, createTRPCRouter } from "@/trpc/init";

export const integrationsRouter = createTRPCRouter({
  _placeholder: baseProcedure.query(() => "integrations" as const),
});
