import { describe, expect, it } from "vitest";
import {
  adaptiveStats,
  computeSchedule,
  describeRRule,
  fromWallClock,
  normalizeRRule,
  offScheduleStart,
  quantile,
  SCHEDULE_HISTORY,
  scheduleTransitions,
  startOfLocalDay,
  toWallClock,
  upcomingOccurrences,
  validateRRule,
  type ScheduleChore,
} from "./schedule";

const SYD = "Australia/Sydney"; // DST starts 2026-10-04 02:00 (+10 -> +11)
const NY = "America/New_York"; // DST starts 2026-03-08 02:00, ends 2026-11-01 02:00

function chore(partial: Partial<ScheduleChore>): ScheduleChore {
  return {
    rrule: null,
    anchor: "DUE_DATE",
    startsAt: null,
    graceMinutes: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  };
}
const at = (iso: string) => new Date(iso);
const done = (iso: string) => ({ completedAt: at(iso) });

describe("timezone helpers", () => {
  it("round-trips wall clock times", () => {
    const instant = at("2026-06-15T03:45:00Z");
    expect(fromWallClock(toWallClock(instant, SYD), SYD)).toEqual(instant);
    expect(toWallClock(instant, SYD).toISOString()).toBe("2026-06-15T13:45:00.000Z");
  });

  it("moves non-existent DST-gap times forward", () => {
    // 02:30 on 2026-10-04 does not exist in Sydney; becomes 03:30 AEDT.
    expect(fromWallClock(new Date(Date.UTC(2026, 9, 4, 2, 30)), SYD).toISOString()).toBe(
      "2026-10-03T16:30:00.000Z",
    );
  });

  it("computes start of local day", () => {
    expect(startOfLocalDay(at("2026-06-15T20:00:00Z"), SYD).toISOString()).toBe("2026-06-15T14:00:00.000Z");
  });
});

describe("rrule helpers", () => {
  it("normalises prefixes and strips DTSTART", () => {
    expect(normalizeRRule("RRULE:FREQ=DAILY")).toBe("FREQ=DAILY");
    expect(normalizeRRule("DTSTART:20260101T000000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(normalizeRRule("FREQ=MONTHLY")).toBe("FREQ=MONTHLY");
  });

  it("validates", () => {
    expect(validateRRule("FREQ=WEEKLY;BYDAY=MO")).toEqual({ ok: true, rrule: "FREQ=WEEKLY;BYDAY=MO" });
    expect(validateRRule("nonsense").ok).toBe(false);
    expect(validateRRule("BYDAY=MO").ok).toBe(false);
  });

  it("describes", () => {
    expect(describeRRule("FREQ=WEEKLY;BYDAY=MO")).toBe("every week on Monday");
  });
});

describe("computeSchedule: unscheduled and one-off", () => {
  it("is unscheduled without rrule or startsAt", () => {
    const s = computeSchedule({ chore: chore({}), timezone: "UTC", lastCompletion: null, now: at("2026-02-01T00:00:00Z") });
    expect(s).toMatchObject({ status: "unscheduled", nextDueAt: null, recurring: false });
    const s2 = computeSchedule({ chore: chore({}), timezone: "UTC", lastCompletion: done("2026-01-05T00:00:00Z") });
    expect(s2.status).toBe("unscheduled");
    expect(s2.lastCompletion).toEqual(done("2026-01-05T00:00:00Z"));
  });

  it("one-off is due at startsAt until completed", () => {
    const c = chore({ startsAt: at("2026-03-01T10:00:00Z"), graceMinutes: 30 });
    const base = { chore: c, timezone: "UTC", lastCompletion: null };
    expect(computeSchedule({ ...base, now: at("2026-03-01T09:00:00Z") }).status).toBe("upcoming");
    expect(computeSchedule({ ...base, now: at("2026-03-01T10:00:00Z") }).status).toBe("due");
    expect(computeSchedule({ ...base, now: at("2026-03-01T10:29:59Z") }).status).toBe("due");
    const late = computeSchedule({ ...base, now: at("2026-03-01T10:30:00Z") });
    expect(late.status).toBe("overdue");
    expect(late.overdueAt).toEqual(at("2026-03-01T10:30:00Z"));
    const finished = computeSchedule({ ...base, lastCompletion: done("2026-03-01T11:00:00Z") });
    expect(finished).toMatchObject({ status: "done", nextDueAt: null, overdueAt: null });
  });

  it("grace 0 goes straight from upcoming to overdue", () => {
    const c = chore({ startsAt: at("2026-03-01T10:00:00Z") });
    expect(computeSchedule({ chore: c, timezone: "UTC", lastCompletion: null, now: at("2026-03-01T10:00:00Z") }).status).toBe(
      "overdue",
    );
  });
});

describe("computeSchedule: recurring, DUE_DATE anchor", () => {
  // Weekly on Monday 09:00 Sydney time, starting Mon 2026-06-01.
  const weekly = chore({
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    startsAt: fromWallClock(new Date(Date.UTC(2026, 5, 1, 9)), SYD), // 2026-05-31T23:00Z
    graceMinutes: 60,
  });

  it("first occurrence is DTSTART when never completed", () => {
    const s = computeSchedule({ chore: weekly, timezone: SYD, lastCompletion: null, now: at("2026-05-30T00:00:00Z") });
    expect(s.status).toBe("upcoming");
    expect(s.nextDueAt).toEqual(at("2026-05-31T23:00:00Z"));
  });

  it("rolls forward to the latest started occurrence when neglected", () => {
    // Sat 20 June: occurrences on 1, 8 and 15 June have started; 15 June is current.
    const s = computeSchedule({ chore: weekly, timezone: SYD, lastCompletion: null, now: at("2026-06-20T00:00:00Z") });
    expect(s.status).toBe("overdue");
    expect(s.nextDueAt).toEqual(at("2026-06-14T23:00:00Z"));
    expect(s.missedCount).toBe(2);
  });

  it("is overdue when an occurrence was missed even within the current grace period", () => {
    // Mon 8 June 09:30 local: 1 June missed, 8 June started 30 min ago (grace 60).
    const s = computeSchedule({ chore: weekly, timezone: SYD, lastCompletion: null, now: at("2026-06-07T23:30:00Z") });
    expect(s.nextDueAt).toEqual(at("2026-06-07T23:00:00Z"));
    expect(s.missedCount).toBe(1);
    expect(s.status).toBe("overdue");
  });

  it("rolls forward after an old completion", () => {
    const s = computeSchedule({
      chore: weekly,
      timezone: SYD,
      lastCompletion: done("2026-06-02T00:00:00Z"), // satisfies 1 June
      now: at("2026-06-16T00:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-06-14T23:00:00Z"));
    expect(s.missedCount).toBe(1);
  });

  it("has no missed occurrences when on time", () => {
    const s = computeSchedule({ chore: weekly, timezone: SYD, lastCompletion: null, now: at("2026-05-31T23:30:00Z") });
    expect(s).toMatchObject({ status: "due", missedCount: 0 });
  });

  it("late completion (first half of interval) satisfies the previous occurrence", () => {
    // Completed Wed 3 June -> next is Mon 8 June 09:00.
    const s = computeSchedule({
      chore: weekly,
      timezone: SYD,
      lastCompletion: done("2026-06-03T02:00:00Z"),
      now: at("2026-06-04T00:00:00Z"),
    });
    expect(s.status).toBe("upcoming");
    expect(s.nextDueAt).toEqual(at("2026-06-07T23:00:00Z"));
  });

  it("early completion (second half) satisfies the upcoming occurrence", () => {
    // Completed Sun 7 June evening -> Mon 8 June is covered, next is Mon 15 June.
    const s = computeSchedule({
      chore: weekly,
      timezone: SYD,
      lastCompletion: done("2026-06-07T08:00:00Z"),
      now: at("2026-06-07T09:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-06-14T23:00:00Z"));
  });

  it("completion long before the first occurrence doesn't satisfy it", () => {
    const s = computeSchedule({
      chore: weekly,
      timezone: SYD,
      lastCompletion: done("2026-05-20T00:00:00Z"),
      now: at("2026-05-21T00:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-05-31T23:00:00Z"));
  });

  it("completion within the early window before the first occurrence satisfies it", () => {
    // Sun 31 May 22:00 local, 11 h before the first occurrence.
    const s = computeSchedule({
      chore: weekly,
      timezone: SYD,
      lastCompletion: done("2026-05-31T12:00:00Z"),
      now: at("2026-05-31T13:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-06-07T23:00:00Z"));
  });

  it("completion on a weekday skipped by an off-schedule start doesn't skip the first occurrence", () => {
    // Fortnightly on Wednesday 18:00, but starting on Friday 6 March: that
    // week's Wednesday is before the start, so the first occurrence is
    // Wednesday 18 March. Done on Wednesday 4 March, two weeks early.
    const fortnightly = chore({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
      startsAt: at("2026-03-06T18:00:00Z"),
    });
    const s = computeSchedule({
      chore: fortnightly,
      timezone: "UTC",
      lastCompletion: done("2026-03-04T16:00:00Z"),
      previousCompletions: [],
      completeHistory: true,
      now: at("2026-03-10T00:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-03-18T18:00:00Z"));
    expect(s.status).toBe("upcoming");
  });

  it("completion exactly at the due time satisfies it", () => {
    const s = computeSchedule({
      chore: weekly,
      timezone: SYD,
      lastCompletion: done("2026-05-31T23:00:00Z"),
      now: at("2026-06-01T00:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-06-07T23:00:00Z"));
  });

  it("keeps local time of day across DST start (Sydney)", () => {
    // Daily 09:00 local. 3 Oct is AEST (+10), 4 Oct onward AEDT (+11).
    const daily = chore({ rrule: "FREQ=DAILY", startsAt: at("2026-10-01T23:00:00Z") });
    const s = computeSchedule({
      chore: daily,
      timezone: SYD,
      lastCompletion: done("2026-10-03T00:00:00Z"), // 10:00 local on 3 Oct
      now: at("2026-10-03T01:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-10-03T22:00:00Z")); // 09:00 AEDT on 4 Oct
    expect(toWallClock(s.nextDueAt!, SYD).getUTCHours()).toBe(9);
  });

  it("keeps local time of day across DST end (New York)", () => {
    const daily = chore({ rrule: "FREQ=DAILY", startsAt: at("2026-10-30T12:00:00Z") }); // 08:00 EDT
    const occ = upcomingOccurrences(daily, NY, at("2026-10-31T00:00:00Z"), 3);
    expect(occ.map((d) => d.toISOString())).toEqual([
      "2026-10-31T12:00:00.000Z", // 08:00 EDT
      "2026-11-01T13:00:00.000Z", // 08:00 EST
      "2026-11-02T13:00:00.000Z",
    ]);
  });

  it("handles occurrences inside a DST gap", () => {
    // Daily 02:30 local in New York: 8 March 2026 has no 02:30, so it moves to 03:30 EDT.
    const daily = chore({ rrule: "FREQ=DAILY", startsAt: at("2026-03-06T07:30:00Z") }); // 02:30 EST
    const occ = upcomingOccurrences(daily, NY, at("2026-03-07T00:00:00Z"), 3);
    expect(occ.map((d) => d.toISOString())).toEqual([
      "2026-03-07T07:30:00.000Z",
      "2026-03-08T07:30:00.000Z", // 03:30 EDT
      "2026-03-09T06:30:00.000Z", // 02:30 EDT
    ]);
  });

  it("uses local midnight of the creation day when startsAt is null", () => {
    const c = chore({ rrule: "FREQ=DAILY", createdAt: at("2026-06-15T05:00:00Z") }); // 15:00 local on the 15th
    const s = computeSchedule({ chore: c, timezone: SYD, lastCompletion: null, now: at("2026-06-15T06:00:00Z") });
    expect(s.nextDueAt).toEqual(at("2026-06-14T14:00:00Z")); // 00:00 local 15th
    expect(s.dueToday).toBe(true);
  });

  it("reports done when the series has ended", () => {
    const c = chore({ rrule: "FREQ=DAILY;COUNT=2", startsAt: at("2026-01-01T09:00:00Z") });
    const s = computeSchedule({
      chore: c,
      timezone: "UTC",
      lastCompletion: done("2026-01-02T09:00:00Z"),
      now: at("2026-01-03T00:00:00Z"),
    });
    expect(s.status).toBe("done");
  });

  it("monthly on the 31st skips short months", () => {
    const c = chore({ rrule: "FREQ=MONTHLY;BYMONTHDAY=31", startsAt: at("2026-01-31T09:00:00Z") });
    const s = computeSchedule({
      chore: c,
      timezone: "UTC",
      lastCompletion: done("2026-01-31T10:00:00Z"),
      now: at("2026-02-01T00:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-03-31T09:00:00Z"));
  });
});

describe("computeSchedule: DUE_DATE completions satisfy the earliest unsatisfied occurrence", () => {
  // Weekly on Monday (00:00 UTC, "any time that day"), starting Mon 7 Sep 2026.
  const mondays = chore({ rrule: "FREQ=WEEKLY;BYDAY=MO", startsAt: at("2026-09-07T00:00:00Z"), graceMinutes: 1440 });
  const next = (last: string, previous: string[], now: string, completeHistory = false) =>
    computeSchedule({
      chore: mondays,
      timezone: "UTC",
      lastCompletion: done(last),
      previousCompletions: previous.map(done),
      completeHistory,
      now: at(now),
    });

  it("late: done Friday after missing Monday satisfies that Monday, not the next one", () => {
    // Overdue since Mon 5 Oct, done Fri 9 Oct: next due is Mon 12 Oct (it used to skip to 19 Oct).
    const s = next("2026-10-09T10:00:00Z", ["2026-09-28T10:00:00Z"], "2026-10-09T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-12T00:00:00Z"));
    expect(s.status).toBe("upcoming");
  });

  it("late: the same when it's the first completion ever", () => {
    const s = next("2026-10-09T10:00:00Z", [], "2026-10-09T11:00:00Z", true);
    expect(s.nextDueAt).toEqual(at("2026-10-12T00:00:00Z"));
  });

  it("without history it falls back to the midpoint rule", () => {
    const s = computeSchedule({
      chore: mondays,
      timezone: "UTC",
      lastCompletion: done("2026-10-09T10:00:00Z"),
      now: at("2026-10-09T11:00:00Z"),
    });
    expect(s.nextDueAt).toEqual(at("2026-10-19T00:00:00Z"));
  });

  it("on time: done on the Monday", () => {
    const s = next("2026-10-05T10:00:00Z", ["2026-09-28T10:00:00Z"], "2026-10-05T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-12T00:00:00Z"));
  });

  it("early: done Saturday after this week's Monday was done counts for next Monday", () => {
    const s = next("2026-10-10T10:00:00Z", ["2026-10-05T10:00:00Z", "2026-09-28T10:00:00Z"], "2026-10-10T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-19T00:00:00Z"));
  });

  it("early, every week: a chain of Saturday completions keeps counting for the following Monday", () => {
    const s = next("2026-10-10T10:00:00Z", ["2026-10-03T10:00:00Z", "2026-09-26T10:00:00Z"], "2026-10-10T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-19T00:00:00Z"));
  });

  it("early window: done the evening before Monday counts for that Monday even if last week was missed", () => {
    // Sun 11 Oct 15:00 is 9 h before Mon 12 Oct (window: min(7 d / 4, 12 h) = 12 h).
    const s = next("2026-10-11T15:00:00Z", ["2026-09-28T10:00:00Z"], "2026-10-11T16:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-19T00:00:00Z"));
  });

  it("multiple missed: one completion catches up the latest missed occurrence only", () => {
    // Last done 14 Sep; 21 Sep, 28 Sep and 5 Oct were missed. Done Fri 9 Oct: next is 12 Oct.
    const s = next("2026-10-09T10:00:00Z", ["2026-09-14T10:00:00Z"], "2026-10-09T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-12T00:00:00Z"));
    expect(s.missedCount).toBe(0);
    // ... and if 12 Oct is missed too, it rolls forward as usual.
    const later = next("2026-10-09T10:00:00Z", ["2026-09-14T10:00:00Z"], "2026-10-20T10:00:00Z");
    expect(later.nextDueAt).toEqual(at("2026-10-19T00:00:00Z"));
    expect(later.missedCount).toBe(1);
  });

  it("an extra completion early in the week changes nothing", () => {
    const s = next("2026-10-06T10:00:00Z", ["2026-10-05T10:00:00Z"], "2026-10-06T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-12T00:00:00Z"));
  });

  it("a second early completion doesn't pre-pay a further week", () => {
    const s = next("2026-10-11T10:00:00Z", ["2026-10-10T10:00:00Z", "2026-10-05T10:00:00Z"], "2026-10-11T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-19T00:00:00Z"));
  });

  it("ignores previous completions newer than the last one", () => {
    const s = next("2026-10-09T10:00:00Z", ["2026-10-10T10:00:00Z", "2026-09-28T10:00:00Z"], "2026-10-09T11:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-10-12T00:00:00Z"));
  });
});

describe("computeSchedule: recurring, COMPLETION anchor", () => {
  const every3 = chore({
    rrule: "FREQ=DAILY;INTERVAL=3",
    anchor: "COMPLETION",
    startsAt: at("2026-06-01T09:00:00Z"),
  });

  it("first due is DTSTART", () => {
    const s = computeSchedule({ chore: every3, timezone: "UTC", lastCompletion: null, now: at("2026-05-01T00:00:00Z") });
    expect(s.nextDueAt).toEqual(at("2026-06-01T09:00:00Z"));
  });

  it("counts from the completion date at DTSTART's time of day", () => {
    const late = computeSchedule({ chore: every3, timezone: "UTC", lastCompletion: done("2026-06-10T20:00:00Z"), now: at("2026-06-10T20:00:00Z") });
    expect(late.nextDueAt).toEqual(at("2026-06-13T09:00:00Z"));
    const earlyInDay = computeSchedule({ chore: every3, timezone: "UTC", lastCompletion: done("2026-06-10T07:00:00Z"), now: at("2026-06-10T07:00:00Z") });
    expect(earlyInDay.nextDueAt).toEqual(at("2026-06-13T09:00:00Z"));
  });

  it("uses local dates in the group timezone", () => {
    const c = chore({ rrule: "FREQ=DAILY;INTERVAL=2", anchor: "COMPLETION", startsAt: at("2026-06-01T23:00:00Z") }); // 09:00 Sydney
    // 2026-06-10T15:00Z is 01:00 on 11 June in Sydney -> next 13 June 09:00 local.
    const s = computeSchedule({ chore: c, timezone: SYD, lastCompletion: done("2026-06-10T15:00:00Z"), now: at("2026-06-10T15:00:00Z") });
    expect(s.nextDueAt).toEqual(at("2026-06-12T23:00:00Z"));
  });

  it("hourly rules count from the exact completion time", () => {
    const c = chore({ rrule: "FREQ=HOURLY;INTERVAL=4", anchor: "COMPLETION", startsAt: at("2026-06-01T00:00:00Z") });
    const s = computeSchedule({ chore: c, timezone: SYD, lastCompletion: done("2026-06-10T10:17:00Z"), now: at("2026-06-10T10:17:00Z") });
    expect(s.nextDueAt).toEqual(at("2026-06-10T14:17:00Z"));
  });

  it("ignores COUNT once re-anchored", () => {
    const c = chore({ rrule: "FREQ=WEEKLY;COUNT=1", anchor: "COMPLETION", startsAt: at("2026-06-01T09:00:00Z") });
    const s = computeSchedule({ chore: c, timezone: "UTC", lastCompletion: done("2026-06-03T09:00:00Z"), now: at("2026-06-03T09:00:00Z") });
    expect(s.nextDueAt).toEqual(at("2026-06-10T09:00:00Z"));
  });
});

describe("computeSchedule: ADAPTIVE anchor", () => {
  const DAY = 24 * 3_600_000;
  const learner = chore({ anchor: "ADAPTIVE", startsAt: at("2026-06-01T09:00:00Z"), graceMinutes: 60 });
  // Completions newest first, `gaps` days apart going back from `last`.
  const history = (last: string, gapsDays: number[]) => {
    let t = at(last).getTime();
    const out = [{ completedAt: new Date(t) }];
    for (const g of gapsDays) out.push({ completedAt: new Date((t -= g * DAY)) });
    return out;
  };
  const sched = (c: ScheduleChore, completions: { completedAt: Date }[], now: string) =>
    computeSchedule({
      chore: c,
      timezone: "UTC",
      lastCompletion: completions[0] ?? null,
      previousCompletions: completions.slice(1),
      now: at(now),
    });

  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.8)).toBeCloseTo(4.2);
    expect(quantile([7], 0.8)).toBe(7);
  });

  it("is due at the median gap and overdue at the 80th percentile", () => {
    const h = history("2026-06-20T10:00:00Z", [3, 4, 5, 4, 9]); // sorted 3 4 4 5 9: median 4, p80 5.8
    const s = sched(learner, h, "2026-06-21T00:00:00Z");
    expect(s.adaptive).toEqual({ gaps: 5, learned: true, dueAfterMs: 4 * DAY, overdueAfterMs: 5.8 * DAY });
    expect(s.nextDueAt).toEqual(at("2026-06-24T10:00:00Z"));
    expect(s.overdueAt).toEqual(new Date(at("2026-06-20T10:00:00Z").getTime() + 5.8 * DAY));
    expect(s.status).toBe("upcoming");
    expect(s.recurring).toBe(true);
    expect(sched(learner, h, "2026-06-25T00:00:00Z").status).toBe("due");
    const late = sched(learner, h, "2026-06-30T00:00:00Z");
    expect(late.status).toBe("overdue");
    expect(late.missedCount).toBe(0);
  });

  it("learns only from the latest ADAPTIVE_WINDOW gaps", () => {
    const h = history("2026-06-20T10:00:00Z", [...Array(10).fill(2), 30, 30, 30]);
    expect(h.length - 1).toBeGreaterThan(SCHEDULE_HISTORY);
    expect(adaptiveStats(h[0], h.slice(1))).toMatchObject({ gaps: 10, dueAfterMs: 2 * DAY, overdueAfterMs: 2 * DAY });
  });

  it("is unscheduled while learning without a starting rule", () => {
    expect(sched(learner, [], "2026-06-21T00:00:00Z")).toMatchObject({
      status: "unscheduled",
      nextDueAt: null,
      recurring: true,
      adaptive: { gaps: 0, learned: false, dueAfterMs: null },
    });
    const two = sched(learner, history("2026-06-20T10:00:00Z", [3, 4]), "2026-06-21T00:00:00Z");
    expect(two.status).toBe("unscheduled");
    expect(two.adaptive).toMatchObject({ gaps: 2, learned: false });
  });

  it("uses the rule as a starting guess, counted from the last completion, until learnt", () => {
    const guess = { ...learner, rrule: "FREQ=DAILY;INTERVAL=7" };
    const s = sched(guess, history("2026-06-20T10:00:00Z", [3, 4]), "2026-06-21T00:00:00Z");
    expect(s.nextDueAt).toEqual(at("2026-06-27T09:00:00Z"));
    expect(s.overdueAt).toEqual(at("2026-06-27T10:00:00Z")); // graceMinutes applies to the guess
    const learnt = sched(guess, history("2026-06-20T10:00:00Z", [3, 4, 3]), "2026-06-21T00:00:00Z");
    expect(learnt.nextDueAt).toEqual(at("2026-06-23T10:00:00Z"));
  });

  it("ignores completions newer than lastCompletion", () => {
    const h = history("2026-06-20T10:00:00Z", [2, 2, 2]);
    expect(adaptiveStats(h[1], [h[0], ...h.slice(2)])).toMatchObject({ gaps: 2, learned: false });
  });

  it("emits transitions at the learnt thresholds", () => {
    const h = history("2026-06-20T10:00:00Z", [4, 4, 4, 4, 4]);
    const t = scheduleTransitions({
      chore: learner,
      timezone: "UTC",
      lastCompletion: h[0],
      previousCompletions: h.slice(1),
      since: at("2026-06-24T09:55:00Z"),
      now: at("2026-06-24T10:00:00Z"),
    });
    const due = at("2026-06-24T10:00:00Z");
    expect(t).toEqual([
      { kind: "due", dueAt: due, overdueAt: due, at: due },
      { kind: "overdue", dueAt: due, overdueAt: due, at: due },
    ]);
  });
});

describe("scheduleTransitions", () => {
  const c = chore({ rrule: "FREQ=DAILY", startsAt: at("2026-06-01T09:00:00Z"), graceMinutes: 30 });
  const base = { chore: c, timezone: "UTC", lastCompletion: done("2026-06-01T09:10:00Z") };

  it("reports due when nextDueAt is in the window", () => {
    expect(scheduleTransitions({ ...base, since: at("2026-06-02T08:55:00Z"), now: at("2026-06-02T09:00:00Z") })).toEqual([
      { kind: "due", dueAt: at("2026-06-02T09:00:00Z"), overdueAt: at("2026-06-02T09:30:00Z"), at: at("2026-06-02T09:00:00Z") },
    ]);
  });

  it("reports overdue when overdueAt is in the window", () => {
    expect(scheduleTransitions({ ...base, since: at("2026-06-02T09:25:00Z"), now: at("2026-06-02T09:30:00Z") })).toEqual([
      { kind: "overdue", dueAt: at("2026-06-02T09:00:00Z"), overdueAt: at("2026-06-02T09:30:00Z"), at: at("2026-06-02T09:30:00Z") },
    ]);
  });

  it("reports both when the window covers both thresholds", () => {
    const t = scheduleTransitions({ ...base, since: at("2026-06-02T08:00:00Z"), now: at("2026-06-02T10:00:00Z") });
    expect(t.map((x) => x.kind)).toEqual(["due", "overdue"]);
  });

  it("reports nothing outside the window or once completed", () => {
    expect(scheduleTransitions({ ...base, since: at("2026-06-02T09:30:00Z"), now: at("2026-06-02T10:00:00Z") })).toEqual([]);
    expect(
      scheduleTransitions({
        ...base,
        lastCompletion: done("2026-06-02T09:05:00Z"),
        since: at("2026-06-02T08:00:00Z"),
        now: at("2026-06-02T10:00:00Z"),
      }),
    ).toEqual([]);
  });

  it("fires for each new occurrence of a neglected chore", () => {
    const neglected = { ...base, lastCompletion: done("2026-05-20T09:00:00Z") };
    const t = scheduleTransitions({ ...neglected, since: at("2026-06-05T08:55:00Z"), now: at("2026-06-05T09:00:00Z") });
    expect(t).toEqual([
      { kind: "due", dueAt: at("2026-06-05T09:00:00Z"), overdueAt: at("2026-06-05T09:30:00Z"), at: at("2026-06-05T09:00:00Z") },
    ]);
  });
});

describe("offScheduleStart", () => {
  it("is null when the start is an occurrence", () => {
    expect(offScheduleStart("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", at("2026-03-04T18:00:00Z"), "UTC")).toBeNull();
    expect(offScheduleStart("FREQ=DAILY", at("2026-03-06T18:00:00Z"), "UTC")).toBeNull();
  });

  it("returns the first occurrence when the start is on another day", () => {
    expect(offScheduleStart("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", at("2026-03-06T18:00:00Z"), "UTC")).toEqual(
      at("2026-03-18T18:00:00Z"),
    );
    expect(offScheduleStart("FREQ=MONTHLY;BYMONTHDAY=1", at("2026-03-06T18:00:00Z"), "UTC")).toEqual(
      at("2026-04-01T18:00:00Z"),
    );
  });

  it("works in wall-clock time of the timezone", () => {
    // Mon 1 June 09:00 Sydney is 2026-05-31T23:00Z.
    expect(offScheduleStart("FREQ=WEEKLY;BYDAY=MO", at("2026-05-31T23:00:00Z"), SYD)).toBeNull();
  });

  it("is null for an invalid rule", () => {
    expect(offScheduleStart("NOT A RULE", at("2026-03-06T18:00:00Z"), "UTC")).toBeNull();
  });
});
