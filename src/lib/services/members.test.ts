import { describe, expect, it } from "vitest";
import { periodStarts } from "./members";

describe("periodStarts", () => {
  it("uses Monday and the 1st in the group timezone", () => {
    // Wed 14 Oct 2026 08:00 in Sydney (AEDT, UTC+11) = Tue 13 Oct 21:00 UTC.
    const now = new Date("2026-10-13T21:00:00Z");
    const { week, month } = periodStarts(now, "Australia/Sydney");
    expect(week.toISOString()).toBe("2026-10-11T13:00:00.000Z"); // Mon 12 Oct 00:00 AEDT
    expect(month.toISOString()).toBe("2026-09-30T14:00:00.000Z"); // 1 Oct 00:00 AEST (+10)
  });
  it("treats Monday itself as the week start", () => {
    const { week } = periodStarts(new Date("2026-10-12T10:00:00Z"), "UTC");
    expect(week.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});
