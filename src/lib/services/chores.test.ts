import { describe, expect, it, vi } from "vitest";
import type { Chore, Completion } from "@/generated/prisma/client";

// scheduleWithPatch() is pure; the database is never touched.
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { scheduleWithPatch } = await import("./chores");

const at = (iso: string) => new Date(iso);
// Fortnightly on Wednesday 18:00 UTC. March 2026: Wed 4, Fri 6, Wed 18.
const chore = {
  id: "c1",
  rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
  startsAt: at("2026-03-06T18:00:00Z"),
  anchor: "DUE_DATE",
  graceMinutes: 0,
  createdAt: at("2026-03-01T00:00:00Z"),
} as Chore;
const completion = (iso: string) => ({ id: iso, completedAt: at(iso), undoneAt: null }) as Completion;
const now = at("2026-03-10T00:00:00Z");

describe("scheduleWithPatch", () => {
  it("shows how an edit moves the next due date, counting existing completions", () => {
    const patch = { rrule: "FREQ=WEEKLY;BYDAY=WE", startsAt: at("2026-03-04T18:00:00Z") };
    const res = scheduleWithPatch(chore, [completion("2026-03-04T17:00:00Z")], patch, { timezone: "UTC", now });
    // As is, the completion is long before the first occurrence (18 March) and doesn't count.
    expect(res.before).toEqual({ status: "upcoming", nextDueAt: at("2026-03-18T18:00:00Z") });
    // Weekly from 4 March, it covers 4 March, so 11 March is next.
    expect(res.after).toEqual({ status: "upcoming", nextDueAt: at("2026-03-11T18:00:00Z") });
  });

  it("applies every schedule field and keeps undefined ones", () => {
    const res = scheduleWithPatch(chore, [], { rrule: "FREQ=WEEKLY;BYDAY=FR", anchor: undefined }, { timezone: "UTC", now });
    expect(res.after.nextDueAt).toEqual(at("2026-03-06T18:00:00Z"));
    expect(res.after.status).toBe("overdue");
  });

  it("reports a cleared schedule as unscheduled", () => {
    const res = scheduleWithPatch(chore, [], { rrule: null, startsAt: null }, { timezone: "UTC", now });
    expect(res.after).toEqual({ status: "unscheduled", nextDueAt: null });
  });
});
