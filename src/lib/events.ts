/**
 * In-process domain event seam.
 *
 * emitEvent() is called by the services after a write has committed. It:
 *  1. enqueues one WebhookDelivery row per enabled webhook of the group that
 *     subscribes to the event type (the outbox; delivery, HMAC signing and
 *     retries are done by the webhook worker, src/lib/integrations/*), then
 *  2. calls in-process listeners registered with onEvent() (e.g. to kick the
 *     delivery worker immediately, or send Web Push). Listener errors are
 *     logged and swallowed: emitting never fails the caller's request.
 *
 * Payloads intentionally do NOT include the group id (it is the group's
 * access secret and webhooks often go to third parties).
 */
import { customAlphabet } from "nanoid";
import { prisma, type Db } from "@/lib/db";
import { BASE62 } from "@/lib/ids";

/** Event types that outbound webhooks can subscribe to. */
export const WEBHOOK_EVENTS = ["chore.completed", "chore.undone", "chore.due", "chore.overdue"] as const;

/** An event type. */
export type EventType = (typeof WEBHOOK_EVENTS)[number];

/** Chore summary included in every event. */
export interface ChoreRef {
  id: string;
  title: string;
  icon: string | null;
}

/** Member summary; null means nobody / an automation. */
export interface MemberRef {
  id: string;
  name: string;
}

/** `data` of each event type. All dates are ISO 8601 strings. */
export interface EventPayloads {
  "chore.completed": {
    chore: ChoreRef;
    completion: {
      id: string;
      source: "TAG" | "MANUAL" | "API" | "WEBHOOK";
      completedAt: string;
      member: MemberRef | null;
      tagId: string | null;
    };
    nextDueAt: string | null;
  };
  "chore.undone": {
    chore: ChoreRef;
    completion: { id: string; completedAt: string; undoneAt: string; member: MemberRef | null };
    nextDueAt: string | null;
  };
  "chore.due": { chore: ChoreRef; dueAt: string; overdueAt: string; assignee: MemberRef | null };
  "chore.overdue": { chore: ChoreRef; dueAt: string; overdueAt: string; assignee: MemberRef | null };
}

/** The JSON body POSTed to webhooks (stored in WebhookDelivery.payload). */
export interface EventEnvelope<T extends EventType = EventType> {
  /** Unique event id (`evt_...`); receivers can use it for de-duplication. */
  id: string;
  type: T;
  createdAt: string;
  group: { name: string; timezone: string };
  data: EventPayloads[T];
}

/** A listener registered with onEvent(). */
export type EventListener<T extends EventType = EventType> = (
  event: EventEnvelope<T>,
  context: { groupId: string },
) => void | Promise<void>;

const listeners = new Map<EventType | "*", Set<EventListener>>();
const eventId = customAlphabet(BASE62, 20);

/**
 * Register an in-process listener for one event type, or "*" for all.
 * Returns an unsubscribe function. Register from module scope of a file that
 * is imported on the server (e.g. src/instrumentation.ts).
 */
export function onEvent<T extends EventType>(type: T | "*", listener: EventListener<T>): () => void {
  const set = listeners.get(type) ?? new Set();
  set.add(listener as EventListener);
  listeners.set(type, set);
  return () => set.delete(listener as EventListener);
}

/** Parse Webhook.events (comma-separated) into known event types. */
export function parseWebhookEvents(value: string | null | undefined): EventType[] {
  if (!value) return [];
  const known = new Set<string>(WEBHOOK_EVENTS);
  return [...new Set(value.split(",").map((s) => s.trim()))].filter((s): s is EventType => known.has(s));
}

/** Serialise event types for Webhook.events. */
export function serializeWebhookEvents(events: readonly EventType[]): string {
  return [...new Set(events)].join(",");
}

/**
 * Emit a domain event for a group: enqueue webhook deliveries and notify
 * in-process listeners. Call AFTER the write has committed.
 */
export async function emitEvent<T extends EventType>(
  type: T,
  input: { group: { id: string; name: string; timezone: string }; data: EventPayloads[T] },
  db: Db = prisma,
): Promise<{ event: EventEnvelope<T>; deliveries: number }> {
  const event: EventEnvelope<T> = {
    id: `evt_${eventId()}`,
    type,
    createdAt: new Date().toISOString(),
    group: { name: input.group.name, timezone: input.group.timezone },
    data: input.data,
  };

  let deliveries = 0;
  try {
    const hooks = await db.webhook.findMany({
      where: { groupId: input.group.id, disabledAt: null },
      select: { id: true, events: true },
    });
    const targets = hooks.filter((h) => parseWebhookEvents(h.events).includes(type));
    if (targets.length > 0) {
      const res = await db.webhookDelivery.createMany({
        data: targets.map((h) => ({
          webhookId: h.id,
          event: type,
          payload: event as unknown as object,
        })),
      });
      deliveries = res.count;
    }
  } catch (err) {
    console.error(`[events] failed to enqueue webhook deliveries for ${type}`, err);
  }

  const toCall = [...(listeners.get(type) ?? []), ...(listeners.get("*") ?? [])];
  await Promise.all(
    toCall.map(async (l) => {
      try {
        await l(event as EventEnvelope, { groupId: input.group.id });
      } catch (err) {
        console.error(`[events] listener for ${type} failed`, err);
      }
    }),
  );

  return { event, deliveries };
}
