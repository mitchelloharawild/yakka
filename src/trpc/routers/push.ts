/**
 * Web Push subscriptions (save/delete). OWNED BY: Agent D.
 * Placeholder procedure only; replace freely.
 */
import { baseProcedure, createTRPCRouter } from "@/trpc/init";

export const pushRouter = createTRPCRouter({
  _placeholder: baseProcedure.query(() => "push" as const),
});
