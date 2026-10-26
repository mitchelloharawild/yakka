/**
 * Pure helpers for the "first due" picker of the chore schedule editor. For
 * the structured presets the start isn't typed freely: the user picks a
 * time of day and one of the days the rule actually produces, so the start
 * can never fall on a day the schedule skips.
 */
import { firstDueCandidates, offScheduleStart, snapStartToSchedule } from "@/lib/schedule";
import type { SchedulePreset } from "./schedule-presets";

/** A preset whose start is picked as a first due date (time + day), not typed as a date-time. */
export type FirstDuePreset = Extract<SchedulePreset, { kind: "daily" | "everyNDays" | "weekly" | "monthly" }>;

/** Whether the editor shows the first due picker for `p` (once and custom keep a free date-time field). */
export function picksFirstDue(p: SchedulePreset): p is FirstDuePreset {
  return p.kind === "daily" || p.kind === "everyNDays" || p.kind === "weekly" || p.kind === "monthly";
}

/** Days per cycle of `p`: how many first due candidates differ in which days end up due. */
export function cycleLength(p: FirstDuePreset): number {
  switch (p.kind) {
    case "daily":
      return 1;
    case "everyNDays":
    case "monthly":
      return p.interval;
    case "weekly":
      return p.interval * Math.max(p.weekdays.length, 1);
  }
}

/** How many first due candidates to offer: one full cycle, at least 2 and at most 6. */
export function candidateCount(p: FirstDuePreset): number {
  return Math.min(Math.max(cycleLength(p), 2), 6);
}

/** Upcoming first due candidates for `rrule` from `now`, at the time of day of `start`. */
export function candidates(rrule: string, start: Date, timezone: string, now: Date, count: number): Date[] {
  try {
    return firstDueCandidates(rrule, start, timezone, now, count);
  } catch {
    return [];
  }
}

/**
 * Where to move `start` after the schedule or time changes so it's still a
 * day the rule produces. Unchanged when it already is. An existing chore
 * keeps which weeks (months, …) are due: the start moves to the matching day
 * of its own period (snapStartToSchedule), else the next one. A new chore
 * has no history to keep, so it takes the first upcoming candidate, also
 * when its start has already passed.
 */
export function alignStart(rrule: string, start: Date, timezone: string, opts: { isNew: boolean; now: Date }): Date {
  try {
    if (opts.isNew) {
      if (start >= opts.now && !offScheduleStart(rrule, start, timezone)) return start;
      return firstDueCandidates(rrule, start, timezone, opts.now, 1)[0] ?? start;
    }
    if (!offScheduleStart(rrule, start, timezone)) return start;
    const snapped = snapStartToSchedule(rrule, start, timezone);
    return offScheduleStart(rrule, snapped, timezone) ?? snapped;
  } catch {
    return start;
  }
}
