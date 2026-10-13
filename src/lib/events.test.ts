import { describe, expect, it } from "vitest";
import { parseWebhookEvents, serializeWebhookEvents } from "./events";

describe("webhook event lists", () => {
  it("round-trips and drops unknown or duplicate types", () => {
    expect(parseWebhookEvents("chore.completed, chore.due,bogus,chore.due")).toEqual(["chore.completed", "chore.due"]);
    expect(parseWebhookEvents("")).toEqual([]);
    expect(parseWebhookEvents(null)).toEqual([]);
    expect(serializeWebhookEvents(["chore.overdue", "chore.overdue", "chore.completed"])).toBe("chore.overdue,chore.completed");
  });
});
