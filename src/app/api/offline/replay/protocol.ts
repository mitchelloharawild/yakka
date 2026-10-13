/**
 * Wire format of `POST /api/offline/replay`, shared by the route handler and
 * the client queue (src/lib/client/offline-queue.ts, type-only import).
 *
 * Request:  { items: ReplayItem[] }               (1..MAX_REPLAY_BATCH items)
 * Response: 200 { results: ReplayResult[] }        (one per item, same order)
 *           400 { error: "INVALID_BODY" }          (not JSON / no items array)
 *
 * Items are validated one by one, so one malformed item is "rejected"
 * without blocking the rest of the queue.
 */
import { z } from "zod";

export const MAX_REPLAY_BATCH = 50;

const common = {
  /** Client-generated id (UUID). Echoed back so the client can drop the item. */
  id: z.string().min(1).max(64),
  memberId: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(64),
  /** When the chore was actually done (ISO 8601). Backdated up to 14 days. */
  completedAt: z.iso.datetime({ offset: true }),
};

export const replayItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tag"),
    ...common,
    token: z.string().min(1).max(64),
    /** Optional: if sent, must match the tag's chore. */
    choreId: z.string().min(1).max(64).optional(),
  }),
  z.object({
    kind: z.literal("manual"),
    ...common,
    groupId: z.string().min(1).max(64),
    choreId: z.string().min(1).max(64),
  }),
]);

export type ReplayItem = z.infer<typeof replayItemSchema>;

export type ReplayStatus =
  /** A new completion was recorded. */
  | "created"
  /** Already recorded (an earlier replay of this item, or a completion within the debounce window). */
  | "duplicate"
  /** Can never succeed (revoked tag, unknown member, too old, malformed...). Drop it. */
  | "rejected"
  /** Transient server failure. Keep it and try again later. */
  | "retry";

export interface ReplayResult {
  id: string;
  status: ReplayStatus;
  /** DomainError reason (e.g. "TAG_REVOKED") or "INVALID_ITEM" / "SERVER_ERROR". */
  reason?: string;
  completionId?: string;
}

export interface ReplayResponse {
  results: ReplayResult[];
}
