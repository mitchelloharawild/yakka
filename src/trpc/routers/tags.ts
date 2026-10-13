/**
 * Tags (QR/NFC) and the tap-to-complete flow. OWNED BY: Agent B.
 * Placeholder procedure only; replace freely.
 */
import { baseProcedure, createTRPCRouter } from "@/trpc/init";

export const tagsRouter = createTRPCRouter({
  _placeholder: baseProcedure.query(() => "tags" as const),
});
