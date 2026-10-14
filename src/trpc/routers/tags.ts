/**
 * Tags (QR and/or NFC) and the tap-to-complete flow. OWNED BY: Agent B.
 * Thin wrappers over src/lib/services/tags.ts.
 *
 *  - Group-scoped procedures (groupProcedure: the group id is the secret):
 *    list, update, qr; create, revoke and rotate also need the settings
 *    PIN when the group has one (groupPinProcedure), as they hand out or
 *    withdraw credentials.
 *  - Tag-scoped procedures (baseProcedure, token only): resolve, complete,
 *    undo, createMember. They can only touch the tag's own chore and never
 *    return the group id (see src/lib/tags.ts for the fingerprint design).
 */
import { z } from "zod";
import {
  completeViaTag,
  completeViaTagInput,
  createMemberViaTag,
  createMemberViaTagInput,
  createTag,
  createTagInput,
  listTags,
  resolveTag,
  revokeTag,
  rotateTag,
  tagQr,
  tagTokenSchema,
  undoViaTag,
  undoViaTagInput,
  updateTag,
  updateTagInput,
} from "@/lib/services/tags";
import { baseProcedure, createTRPCRouter, groupPinProcedure, groupProcedure } from "@/trpc/init";

const id = z.string().min(1).max(64);

export const tagsRouter = createTRPCRouter({
  // --- group-scoped -------------------------------------------------------
  /** Tags of the group with chore summary and URL (revoked included unless activeOnly). */
  list: groupProcedure
    .input(z.object({ activeOnly: z.boolean().optional() }))
    .query(({ ctx, input }) => listTags(ctx.group.id, { activeOnly: input.activeOnly })),
  create: groupPinProcedure
    .input(createTagInput)
    .mutation(({ ctx, input }) =>
      createTag(
        ctx.group.id,
        { choreId: input.choreId, qr: input.qr, nfc: input.nfc, label: input.label },
        ctx.actor,
      ),
    ),
  revoke: groupPinProcedure
    .input(z.object({ tagId: id }))
    .mutation(({ ctx, input }) => revokeTag(ctx.group.id, input.tagId, ctx.actor)),
  /** Revoke and replace with a new token (same chore, capabilities and label). Returns the new tag. */
  rotate: groupPinProcedure
    .input(z.object({ tagId: id }))
    .mutation(({ ctx, input }) => rotateTag(ctx.group.id, input.tagId, ctx.actor)),
  /** Change the label and/or the QR / NFC capabilities (omitted fields unchanged). */
  update: groupProcedure
    .input(updateTagInput.extend({ tagId: id }))
    .mutation(({ ctx, input }) =>
      updateTag(ctx.group.id, input.tagId, { label: input.label, qr: input.qr, nfc: input.nfc }, ctx.actor),
    ),
  /** `{ url, svg }`: server-generated QR code for one tag. */
  qr: groupProcedure.input(z.object({ tagId: id })).query(({ ctx, input }) => tagQr(ctx.group.id, input.tagId)),

  // --- tag-scoped (public) ------------------------------------------------
  /** Read-only: chore + group name + fingerprint (+ members when allowed). Never records anything. */
  resolve: baseProcedure
    .input(z.object({ token: tagTokenSchema, groupId: id.nullish() }))
    .query(({ input }) => resolveTag({ token: input.token, groupId: input.groupId })),
  complete: baseProcedure.input(completeViaTagInput).mutation(({ input }) => completeViaTag(input)),
  undo: baseProcedure.input(undoViaTagInput).mutation(({ input }) => undoViaTag(input)),
  createMember: baseProcedure.input(createMemberViaTagInput).mutation(({ input }) => createMemberViaTag(input)),
});
