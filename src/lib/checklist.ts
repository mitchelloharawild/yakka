/**
 * A chore's optional checklist of sub-tasks. Stored in Chore.checklist as
 * one item per line (portable across Postgres/SQLite, like Webhook.events);
 * exposed everywhere else as a string array. Never split by hand.
 */
import { z } from "zod";

export const CHECKLIST_MAX_ITEMS = 30;
export const CHECKLIST_ITEM_MAX = 200;

/** Stored value → items (null/empty → []). */
export function parseChecklist(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return stored
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Items → stored value (no items → null). */
export function serializeChecklist(items: readonly string[]): string | null {
  const clean = items.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  return clean.length ? clean.join("\n") : null;
}

/**
 * zod: a checklist as accepted by the API. Whitespace (including newlines)
 * inside an item collapses to one space and blank items are dropped, so
 * parsing is idempotent; store the result with serializeChecklist() (an
 * empty list clears the checklist).
 */
export const checklistSchema = z
  .array(
    z
      .string()
      .max(CHECKLIST_ITEM_MAX * 2)
      .transform((s) => s.replace(/\s+/g, " ").trim())
      .pipe(z.string().max(CHECKLIST_ITEM_MAX)),
  )
  .max(CHECKLIST_MAX_ITEMS)
  .transform((items) => items.filter(Boolean));
