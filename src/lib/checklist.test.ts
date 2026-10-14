import { describe, expect, it } from "vitest";
import { checklistSchema, parseChecklist, serializeChecklist } from "./checklist";

describe("chore checklists", () => {
  it("round-trips and drops blank items", () => {
    expect(parseChecklist("Strip the bed\n\n Wash sheets \n")).toEqual(["Strip the bed", "Wash sheets"]);
    expect(parseChecklist(null)).toEqual([]);
    expect(serializeChecklist(["Strip the bed", "  ", "Wash\nsheets"])).toBe("Strip the bed\nWash sheets");
    expect(serializeChecklist([])).toBeNull();
  });

  it("validates API input idempotently", () => {
    expect(checklistSchema.parse(["a, b", " c\nd ", " "])).toEqual(["a, b", "c d"]);
    expect(checklistSchema.parse(checklistSchema.parse(["a, b", " c\nd "]))).toEqual(["a, b", "c d"]);
    expect(checklistSchema.safeParse(Array(31).fill("x")).success).toBe(false);
    expect(checklistSchema.safeParse(["x".repeat(201)]).success).toBe(false);
  });
});
