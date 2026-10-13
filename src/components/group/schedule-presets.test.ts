import { describe, expect, it } from "vitest";
import { validateRRule } from "@/lib/schedule";
import { buildRRule, defaultPreset, parseRRule, PRESET_KINDS, type SchedulePreset } from "./schedule-presets";

describe("buildRRule", () => {
  it("builds each preset", () => {
    expect(buildRRule({ kind: "once" })).toBeNull();
    expect(buildRRule({ kind: "daily" })).toBe("FREQ=DAILY");
    expect(buildRRule({ kind: "everyNDays", interval: 3 })).toBe("FREQ=DAILY;INTERVAL=3");
    expect(buildRRule({ kind: "everyNDays", interval: 1 })).toBe("FREQ=DAILY");
    expect(buildRRule({ kind: "weekly", interval: 1, weekdays: ["FR", "MO"] })).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
    expect(buildRRule({ kind: "weekly", interval: 2, weekdays: ["SA"] })).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    expect(buildRRule({ kind: "monthly", interval: 1, day: 15 })).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(buildRRule({ kind: "monthly", interval: 3, day: -1 })).toBe("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1");
    expect(buildRRule({ kind: "custom", rrule: " RRULE:FREQ=YEARLY " })).toBe("FREQ=YEARLY");
    expect(buildRRule({ kind: "custom", rrule: "  " })).toBeNull();
  });

  it("clamps silly numbers", () => {
    expect(buildRRule({ kind: "everyNDays", interval: 0 })).toBe("FREQ=DAILY");
    expect(buildRRule({ kind: "everyNDays", interval: Number.NaN })).toBe("FREQ=DAILY");
    expect(buildRRule({ kind: "monthly", interval: 1, day: 40 })).toBe("FREQ=MONTHLY;BYMONTHDAY=31");
  });

  it("rejects weekly without weekdays", () => {
    expect(() => buildRRule({ kind: "weekly", interval: 1, weekdays: [] })).toThrow();
  });

  it("produces valid RRULEs", () => {
    for (const kind of PRESET_KINDS) {
      const r = buildRRule(defaultPreset(kind));
      if (r) expect(validateRRule(r).ok).toBe(true);
    }
  });
});

describe("parseRRule", () => {
  it("recognises presets", () => {
    expect(parseRRule(null)).toEqual({ kind: "once" });
    expect(parseRRule("")).toEqual({ kind: "once" });
    expect(parseRRule("FREQ=DAILY")).toEqual({ kind: "daily" });
    expect(parseRRule("FREQ=DAILY;INTERVAL=1")).toEqual({ kind: "daily" });
    expect(parseRRule("freq=daily;interval=4")).toEqual({ kind: "everyNDays", interval: 4 });
    expect(parseRRule("FREQ=WEEKLY;BYDAY=SU,MO")).toEqual({ kind: "weekly", interval: 1, weekdays: ["MO", "SU"] });
    expect(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")).toEqual({ kind: "weekly", interval: 2, weekdays: ["TU"] });
    expect(parseRRule("FREQ=MONTHLY;BYMONTHDAY=-1")).toEqual({ kind: "monthly", interval: 1, day: -1 });
    expect(parseRRule("RRULE:FREQ=MONTHLY;BYMONTHDAY=5")).toEqual({ kind: "monthly", interval: 1, day: 5 });
  });

  it("falls back to custom", () => {
    for (const r of [
      "FREQ=WEEKLY",
      "FREQ=WEEKLY;BYDAY=1MO",
      "FREQ=MONTHLY;BYDAY=1MO",
      "FREQ=DAILY;BYHOUR=9",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=YEARLY",
      "FREQ=HOURLY;INTERVAL=6",
      "garbage",
    ]) {
      expect(parseRRule(r)).toEqual({ kind: "custom", rrule: r });
    }
  });

  it("round-trips", () => {
    const presets: SchedulePreset[] = [
      { kind: "daily" },
      { kind: "everyNDays", interval: 10 },
      { kind: "weekly", interval: 1, weekdays: ["MO", "WE", "FR"] },
      { kind: "weekly", interval: 3, weekdays: ["SU"] },
      { kind: "monthly", interval: 2, day: 28 },
      { kind: "custom", rrule: "FREQ=YEARLY;BYMONTH=3" },
    ];
    for (const p of presets) expect(parseRRule(buildRRule(p))).toEqual(p);
  });
});
