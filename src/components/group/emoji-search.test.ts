import { describe, expect, it } from "vitest";
import data from "./emoji-data.json";
import { looksLikeEmoji, searchEmoji, type EmojiEntry } from "./emoji-search";

const entries = data as unknown as EmojiEntry[];
// Emojibase includes U+FE0F (emoji presentation) on some, e.g. "🐕️".
const first = (q: string) => searchEmoji(entries, q)[0]?.replace(/\uFE0F/g, "");

describe("searchEmoji", () => {
  it("finds emoji by label", () => {
    expect(first("broom")).toBe("🧹");
    expect(first("wastebasket")).toBe("🗑");
  });

  it("matches word prefixes, case-insensitively, across label and tags", () => {
    expect(first("Shop CART")).toBe("🛒");
    expect(searchEmoji(entries, "clean")).toContain("🧹"); // a tag of broom
    expect(searchEmoji(entries, "toil")).toContain("🚽");
  });

  it("ranks exact label, then label words, then tag-only matches", () => {
    // 🐶 "dog face" comes before 🐕 "dog" in Unicode order.
    const dog = searchEmoji(entries, "dog").map((e) => e.replace(/\uFE0F/g, ""));
    expect(dog[0]).toBe("🐕");
    expect(dog[1]).toBe("🐶");
    // A label hit beats a tag: "can" is a 🗑 tag but the start of 🥫 "canned food".
    const can = searchEmoji(entries, "can").map((e) => e.replace(/\uFE0F/g, ""));
    expect(can.indexOf("🥫")).toBeLessThan(can.indexOf("🗑"));
  });

  it("returns nothing for an empty query or no match, and respects the limit", () => {
    expect(searchEmoji(entries, "  ")).toEqual([]);
    expect(searchEmoji(entries, "zzqxj")).toEqual([]);
    expect(searchEmoji(entries, "face", 10)).toHaveLength(10);
  });
});

describe("looksLikeEmoji", () => {
  it("accepts emoji and flags, rejects words", () => {
    expect(looksLikeEmoji("🧹")).toBe(true);
    expect(looksLikeEmoji("🇦🇺")).toBe(true);
    expect(looksLikeEmoji("broom")).toBe(false);
  });
});
