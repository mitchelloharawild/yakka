import { describe, expect, it } from "vitest";
import { compactDuration, fromLocalInputValue, initials, monthDayIn, shortDeviceId, toLocalInputValue, weekdayIn } from "./time";

const MIN = 60_000;

describe("compactDuration", () => {
  it("picks one unit", () => {
    expect(compactDuration(10_000)).toEqual({ value: 1, unit: "minute" });
    expect(compactDuration(45 * MIN)).toEqual({ value: 45, unit: "minute" });
    expect(compactDuration(-200 * MIN)).toEqual({ value: 3, unit: "hour" });
    expect(compactDuration(26 * 60 * MIN)).toEqual({ value: 1, unit: "day" });
    expect(compactDuration(13 * 24 * 60 * MIN)).toEqual({ value: 13, unit: "day" });
    expect(compactDuration(22 * 24 * 60 * MIN)).toEqual({ value: 3, unit: "week" });
  });
});

describe("local input values", () => {
  const tz = "Australia/Sydney";
  it("round-trips in the group timezone", () => {
    const instant = new Date("2026-03-01T22:30:00Z"); // 09:30 AEDT on 2 March
    expect(toLocalInputValue(instant, tz)).toBe("2026-03-02T09:30");
    expect(fromLocalInputValue("2026-03-02T09:30", tz)?.toISOString()).toBe(instant.toISOString());
    expect(weekdayIn(instant, tz)).toBe("MO");
    expect(monthDayIn(instant, tz)).toBe(2);
  });
  it("rejects junk", () => {
    expect(fromLocalInputValue("", tz)).toBeNull();
    expect(fromLocalInputValue("tomorrow", tz)).toBeNull();
  });
});

describe("misc", () => {
  it("shortens device ids", () => {
    expect(shortDeviceId("0f3a9b2c-1111-4222-8333-444455556666")).toBe("0f3a9b");
    expect(shortDeviceId(null)).toBeNull();
  });
  it("makes initials", () => {
    expect(initials("alex")).toBe("AL");
    expect(initials("Mary Jane Watson")).toBe("MJ");
    expect(initials("  ")).toBe("?");
    expect(initials("Zoë")).toBe("ZO");
  });
});
