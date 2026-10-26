import { describe, expect, it } from "vitest";
import { offScheduleStart, upcomingOccurrences } from "@/lib/schedule";
import { alignStart, candidateCount, cycleLength, picksFirstDue } from "./first-due";

const at = (iso: string) => new Date(iso);
// March 2026: Sun 1, Mon 2, Wed 4, Fri 6.
const FORTNIGHTLY_WE = "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE";

describe("picksFirstDue", () => {
  it("is true for the structured repeating presets only", () => {
    expect(picksFirstDue({ kind: "daily" })).toBe(true);
    expect(picksFirstDue({ kind: "everyNDays", interval: 3 })).toBe(true);
    expect(picksFirstDue({ kind: "weekly", interval: 2, weekdays: ["WE"] })).toBe(true);
    expect(picksFirstDue({ kind: "monthly", interval: 1, day: 1 })).toBe(true);
    expect(picksFirstDue({ kind: "once" })).toBe(false);
    expect(picksFirstDue({ kind: "custom", rrule: "FREQ=YEARLY" })).toBe(false);
  });
});

describe("cycleLength / candidateCount", () => {
  it("covers one full cycle, between 2 and 6 options", () => {
    expect(cycleLength({ kind: "weekly", interval: 2, weekdays: ["WE"] })).toBe(2);
    expect(cycleLength({ kind: "weekly", interval: 2, weekdays: ["MO", "WE"] })).toBe(4);
    expect(cycleLength({ kind: "everyNDays", interval: 3 })).toBe(3);
    expect(candidateCount({ kind: "daily" })).toBe(2);
    expect(candidateCount({ kind: "weekly", interval: 4, weekdays: ["MO", "WE", "FR"] })).toBe(6);
  });
});

describe("alignStart", () => {
  const now = at("2026-03-02T10:00:00Z");

  it("keeps a start the rule produces", () => {
    const start = at("2026-03-04T18:00:00Z");
    expect(alignStart(FORTNIGHTLY_WE, start, "UTC", { isNew: true, now })).toEqual(start);
    expect(alignStart(FORTNIGHTLY_WE, start, "UTC", { isNew: false, now })).toEqual(start);
  });

  it("new chore: an off-schedule or past start becomes the first upcoming day", () => {
    expect(alignStart(FORTNIGHTLY_WE, at("2026-03-06T18:00:00Z"), "UTC", { isNew: true, now })).toEqual(
      at("2026-03-04T18:00:00Z"),
    );
    expect(alignStart(FORTNIGHTLY_WE, at("2026-02-25T18:00:00Z"), "UTC", { isNew: true, now })).toEqual(
      at("2026-03-04T18:00:00Z"),
    );
  });

  it("existing chore: an off-schedule start moves within its week, keeping which weeks are due", () => {
    const start = at("2026-02-27T18:00:00Z"); // Friday, before now
    const aligned = alignStart(FORTNIGHTLY_WE, start, "UTC", { isNew: false, now });
    expect(aligned).toEqual(at("2026-02-25T18:00:00Z"));
    expect(offScheduleStart(FORTNIGHTLY_WE, aligned, "UTC")).toBeNull();
    const from = at("2026-03-01T00:00:00Z");
    expect(upcomingOccurrences({ rrule: FORTNIGHTLY_WE, startsAt: aligned, createdAt: start }, "UTC", from, 3)).toEqual(
      upcomingOccurrences({ rrule: FORTNIGHTLY_WE, startsAt: start, createdAt: start }, "UTC", from, 3),
    );
  });

  it("existing chore: falls forward to the next day the rule produces when its week has none earlier", () => {
    const start = at("2026-03-02T18:00:00Z"); // Monday; the rule is on Fridays
    expect(alignStart("FREQ=WEEKLY;BYDAY=FR", start, "UTC", { isNew: false, now })).toEqual(at("2026-03-06T18:00:00Z"));
  });
});
