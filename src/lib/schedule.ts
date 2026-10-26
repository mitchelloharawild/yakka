/**
 * Schedule computation. The next due date of a chore is never stored: it is
 * computed on read from the chore's RRULE, its anchor, the group timezone and
 * the latest non-undone completion. Pure functions only (no DB access).
 *
 * Time model: RRULEs are evaluated in the group's timezone as *wall-clock*
 * time ("every Monday at 09:00 in Australia/Sydney"), so DST transitions do
 * not shift the time of day. Internally we run rrule.js in UTC on "floating"
 * dates whose UTC fields equal the local wall-clock fields, and convert back
 * to real instants with @date-fns/tz.
 *
 * Semantics (documented in docs/DEVELOPMENT.md):
 *  - DTSTART is `chore.startsAt`, or 00:00 local on the day the chore was
 *    created when startsAt is null.
 *  - No completion yet: the first occurrence at/after DTSTART is due.
 *  - Anchor DUE_DATE: a completion satisfies the earliest occurrence that
 *    isn't satisfied yet. For a completion C, let P be the latest occurrence
 *    <= C and N the first occurrence > C:
 *      - no P (before the first occurrence): C satisfies N (early) if
 *        within EARLY_WINDOW of it, and changes nothing otherwise;
 *      - P not yet satisfied: C is a (late or on-time) completion of P, so N
 *        is next. Exception: C within EARLY_WINDOW of N (a quarter of the
 *        interval, at most 12 h) counts as an early completion of N, and P
 *        is simply missed;
 *      - P already satisfied (by an earlier completion): C in the second
 *        half of [P, N) is an early completion of N; in the first half it's
 *        an extra completion of P and changes nothing;
 *      - N already satisfied: C changes nothing.
 *    Completions are folded oldest first, so this needs a little history:
 *    pass `previousCompletions` (SCHEDULE_HISTORY of them is plenty). For
 *    the oldest one given, "was P satisfied?" is unknown unless
 *    `completeHistory` says nothing came before; it's then assumed
 *    satisfied (the plain midpoint rule).
 *  - Anchor COMPLETION: the rule is re-anchored on the completion: DTSTART'
 *    is C's local date at DTSTART's time of day (or C itself for HOURLY and
 *    finer rules), and the next due is the first occurrence after DTSTART'.
 *    COUNT is ignored for re-anchored rules.
 *  - Roll-forward: if more occurrences of the rule have since started (the
 *    chore was neglected), nextDueAt is the latest occurrence <= now and
 *    `missedCount` counts the skipped ones. Missed occurrences are never
 *    owed: one completion catches the chore up.
 *  - Anchor ADAPTIVE ("adaptive schedule"): the interval is learnt from the
 *    gaps between the latest ADAPTIVE_WINDOW + 1 completions. Once there
 *    are at least ADAPTIVE_MIN_GAPS gaps, nextDueAt = C + the median gap and
 *    overdueAt = C + the 80th percentile gap (graceMinutes is ignored).
 *    Until then the rrule, if any, is a starting guess evaluated like the
 *    COMPLETION anchor (with graceMinutes); without an rrule the chore is
 *    "unscheduled" while it learns. There's no roll-forward: missedCount is
 *    always 0 once learnt.
 *  - One-off chores (rrule null, startsAt set): due at startsAt until any
 *    completion, then "done".
 *  - rrule null and startsAt null: "unscheduled" (can be completed any time).
 *  - status: upcoming (now < nextDueAt), due (nextDueAt <= now < overdueAt),
 *    overdue (now >= overdueAt), where overdueAt = nextDueAt + graceMinutes
 *    (learnt ADAPTIVE chores: see above).
 *    With graceMinutes = 0 a chore goes straight from upcoming to overdue.
 *    A chore with missedCount > 0 is always overdue.
 */
import { TZDate } from "@date-fns/tz";
import { Frequency, RRule, type Options } from "rrule";

/** Mirrors the Prisma ScheduleAnchor enum (kept as a string union so this file stays DB-free). */
export type ScheduleAnchorValue = "DUE_DATE" | "COMPLETION" | "ADAPTIVE";

/** Computed status of a chore. */
export type ScheduleStatus = "upcoming" | "due" | "overdue" | "done" | "unscheduled";

/** The chore fields the schedule depends on (a Prisma `Chore` satisfies this). */
export interface ScheduleChore {
  rrule: string | null;
  anchor: ScheduleAnchorValue;
  startsAt: Date | null;
  graceMinutes: number;
  createdAt: Date;
}

/** Minimal completion shape; pass the latest NON-undone completion. */
export interface ScheduleCompletion {
  completedAt: Date;
}

/** ADAPTIVE: how many of the most recent gaps between completions are learnt from. */
export const ADAPTIVE_WINDOW = 10;
/** ADAPTIVE: gaps needed before the learnt interval replaces the starting guess. */
export const ADAPTIVE_MIN_GAPS = 3;
/** ADAPTIVE: quantiles of the gaps at which a chore becomes due and overdue. */
export const ADAPTIVE_DUE_QUANTILE = 0.5;
export const ADAPTIVE_OVERDUE_QUANTILE = 0.8;

/** DUE_DATE: how many completions before the latest one the fold looks at. */
const DUE_DATE_HISTORY = 3;

/** How many non-undone completions before the latest one callers should pass as `previousCompletions`. */
export const SCHEDULE_HISTORY = Math.max(DUE_DATE_HISTORY, ADAPTIVE_WINDOW);

/** Input for computeSchedule(). */
export interface ScheduleInput<C extends ScheduleCompletion = ScheduleCompletion> {
  chore: ScheduleChore;
  /** IANA timezone of the group, e.g. "Australia/Sydney". */
  timezone: string;
  /** The latest completion that has not been undone, or null. */
  lastCompletion: C | null;
  /**
   * The non-undone completions before `lastCompletion`, newest first (up
   * to SCHEDULE_HISTORY). DUE_DATE uses them to tell a late completion of a
   * missed occurrence from an early completion of the next one; ADAPTIVE
   * learns its interval from them.
   */
  previousCompletions?: ScheduleCompletion[];
  /** True when there are no completions older than those given (e.g. fewer than requested came back). */
  completeHistory?: boolean;
  /** Defaults to new Date(). Pass explicitly in tests and in the cron job. */
  now?: Date;
}

/** Result of computeSchedule(). */
export interface Schedule<C extends ScheduleCompletion = ScheduleCompletion> {
  status: ScheduleStatus;
  /** When the chore is (or was) next due; null for done/unscheduled. */
  nextDueAt: Date | null;
  /** nextDueAt + graceMinutes; null when nextDueAt is null. */
  overdueAt: Date | null;
  /** Whether nextDueAt falls on today's local date (or earlier) in the group timezone. */
  dueToday: boolean;
  /** Whether the chore repeats (has an RRULE, or learns its interval). */
  recurring: boolean;
  /** Recurring only: occurrences that started and were skipped before nextDueAt (0 normally). */
  missedCount: number;
  lastCompletion: C | null;
  /** ADAPTIVE anchor only (null otherwise): what has been learnt so far. */
  adaptive: AdaptiveStats | null;
}

/** What an ADAPTIVE chore has learnt from its completion history. */
export interface AdaptiveStats {
  /** Gaps between completions learnt from (at most ADAPTIVE_WINDOW). */
  gaps: number;
  /** Whether there are enough gaps (ADAPTIVE_MIN_GAPS) for the learnt interval to apply. */
  learned: boolean;
  /** Median gap: the chore is due this long after the last completion. null until learned. */
  dueAfterMs: number | null;
  /** 80th percentile gap: overdue this long after the last completion. null until learned. */
  overdueAfterMs: number | null;
}

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

/** Convert an instant to a floating Date whose UTC fields are the wall-clock time in `tz`. */
export function toWallClock(instant: Date, tz: string): Date {
  const z = new TZDate(instant.getTime(), tz);
  return new Date(
    Date.UTC(
      z.getFullYear(),
      z.getMonth(),
      z.getDate(),
      z.getHours(),
      z.getMinutes(),
      z.getSeconds(),
      z.getMilliseconds(),
    ),
  );
}

/**
 * Convert a floating wall-clock Date (UTC fields = local fields) back to the
 * real instant in `tz`. Non-existent local times (DST gaps) move forward.
 */
export function fromWallClock(wall: Date, tz: string): Date {
  const z = new TZDate(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds(),
    tz,
  );
  return new Date(z.getTime());
}

/** The instant of 00:00 local time on the day containing `instant` in `tz`. */
export function startOfLocalDay(instant: Date, tz: string): Date {
  const w = toWallClock(instant, tz);
  return fromWallClock(new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate())), tz);
}

/** Whether `tz` is a valid IANA timezone name. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// RRULE helpers
// ---------------------------------------------------------------------------

/**
 * Normalise an RRULE string to its body, e.g. "RRULE:FREQ=DAILY" or a
 * multi-line "DTSTART:...\nRRULE:FREQ=DAILY" both become "FREQ=DAILY".
 * DTSTART is dropped because it comes from the chore (startsAt/createdAt).
 */
export function normalizeRRule(rrule: string): string {
  const lines = rrule
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const ruleLine = lines.find((l) => /^RRULE:/i.test(l)) ?? lines.find((l) => /(^|;)FREQ=/i.test(l) && !/^DTSTART/i.test(l));
  if (!ruleLine) throw new Error("No RRULE found");
  return ruleLine.replace(/^RRULE:/i, "").trim();
}

function parseOptions(rrule: string): Partial<Options> {
  const body = normalizeRRule(rrule);
  const opts = RRule.parseString(body);
  if (opts.freq === undefined) throw new Error("RRULE must include FREQ");
  delete opts.dtstart;
  delete opts.tzid;
  return opts;
}

/** Validate an RRULE string. Returns the normalised body on success. */
export function validateRRule(rrule: string): { ok: true; rrule: string } | { ok: false; error: string } {
  try {
    const body = normalizeRRule(rrule);
    const opts = parseOptions(body);
    // Make sure it produces at least one occurrence and doesn't throw.
    new RRule({ ...opts, dtstart: new Date(Date.UTC(2000, 0, 1)) }).after(new Date(Date.UTC(2000, 0, 1)), true);
    return { ok: true, rrule: body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** English description of an RRULE, e.g. "every week on Monday". Falls back to the raw rule. */
export function describeRRule(rrule: string): string {
  try {
    return new RRule(parseOptions(rrule)).toText();
  } catch {
    return rrule;
  }
}

/** DTSTART of a chore as a floating wall-clock date in the group timezone. */
function dtstartWall(chore: ScheduleChore, tz: string): Date {
  if (chore.startsAt) return toWallClock(chore.startsAt, tz);
  const w = toWallClock(chore.createdAt, tz);
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()));
}

function buildRule(opts: Partial<Options>, dtstart: Date): RRule {
  return new RRule({ ...opts, dtstart, tzid: null });
}

/** Cap on how many missed occurrences are counted (MINUTELY rules could be huge). */
const MAX_MISSED = 999;

/**
 * Next due occurrence (floating wall-clock) for a recurring chore and the
 * rule it belongs to, or null if the series has ended. Before roll-forward.
 */
function firstUnsatisfied(
  chore: ScheduleChore,
  tz: string,
  last: ScheduleCompletion | null,
  history: { previous: ScheduleCompletion[]; complete: boolean } = { previous: [], complete: false },
): { wall: Date; rule: RRule } | null {
  const opts = parseOptions(chore.rrule!);
  const dt = dtstartWall(chore, tz);
  const rule = buildRule(opts, dt);
  const result = (wall: Date | null, r: RRule = rule) => (wall ? { wall, rule: r } : null);

  if (!last) return result(rule.after(dt, true));

  const c = toWallClock(last.completedAt, tz);

  if (chore.anchor === "COMPLETION") {
    const fine =
      opts.freq === Frequency.HOURLY || opts.freq === Frequency.MINUTELY || opts.freq === Frequency.SECONDLY;
    const anchor = fine
      ? c
      : new Date(
          Date.UTC(
            c.getUTCFullYear(),
            c.getUTCMonth(),
            c.getUTCDate(),
            dt.getUTCHours(),
            dt.getUTCMinutes(),
            dt.getUTCSeconds(),
          ),
        );
    const reOpts = { ...opts };
    delete reOpts.count;
    const reRule = buildRule(reOpts, anchor);
    return result(reRule.after(anchor, false), reRule);
  }

  // DUE_DATE anchor: fold the completions oldest first.
  const walls = [...history.previous]
    .filter((x) => x.completedAt.getTime() <= last.completedAt.getTime())
    .reverse()
    .map((x) => toWallClock(x.completedAt, tz));
  walls.push(c);
  let satisfied: Date | null = null;
  walls.forEach((cw, i) => {
    satisfied = satisfyDueDate(rule, cw, satisfied, i === 0 && !history.complete);
  });
  if (!satisfied) return result(rule.after(c, false));
  return result(rule.after(satisfied, false));
}

/** Early-completion window before an occurrence, as a share of the interval and in absolute terms. */
const EARLY_WINDOW_SHARE = 0.25;
const EARLY_WINDOW_MAX_MS = 12 * 60 * MINUTE;
const earlyWindowMs = (interval: number) => Math.min(interval * EARLY_WINDOW_SHARE, EARLY_WINDOW_MAX_MS);

/**
 * DUE_DATE: the latest satisfied occurrence (wall clock) after completion
 * `c`, given the latest satisfied occurrence before it. `assumePrevious`:
 * nothing is known about earlier completions, so treat P as satisfied.
 */
function satisfyDueDate(rule: RRule, c: Date, satisfied: Date | null, assumePrevious: boolean): Date | null {
  const n = rule.after(c, false);
  const p = rule.before(c, true);
  const later = (a: Date | null, b: Date) => (a && a.getTime() > b.getTime() ? a : b);
  const untilN = n ? n.getTime() - c.getTime() : Infinity;
  if (!p) {
    // Before the first occurrence: an early completion of it only within the early window.
    if (!n) return satisfied;
    const following = rule.after(n, false);
    const interval = following ? following.getTime() - n.getTime() : Infinity;
    return untilN <= earlyWindowMs(interval) ? later(satisfied, n) : satisfied;
  }
  const pSatisfied = assumePrevious || (satisfied !== null && satisfied.getTime() >= p.getTime());
  if (!n) return later(satisfied, p); // series ended after P
  if (satisfied && satisfied.getTime() >= n.getTime()) return satisfied; // N already covered
  const interval = n.getTime() - p.getTime();
  const inWindow = untilN <= earlyWindowMs(interval);
  if (!pSatisfied) return inWindow ? n : p; // late (or on-time) completion of P, unless right before N
  const secondHalf = c.getTime() >= p.getTime() + interval / 2;
  return secondHalf || inWindow ? n : later(satisfied, p);
}

/** Next due instant for a recurring chore after roll-forward, plus missed count; null if the series ended. */
function nextRecurringDue(
  chore: ScheduleChore,
  tz: string,
  last: ScheduleCompletion | null,
  now: Date,
  history?: { previous: ScheduleCompletion[]; complete: boolean },
): { due: Date; missed: number } | null {
  const first = firstUnsatisfied(chore, tz, last, history);
  if (!first) return null;
  const nowWall = toWallClock(now, tz);
  const latest = first.rule.before(nowWall, true);
  if (!latest || latest <= first.wall) return { due: fromWallClock(first.wall, tz), missed: 0 };
  const between = first.rule.between(first.wall, latest, true, (_d, i) => i <= MAX_MISSED);
  return { due: fromWallClock(latest, tz), missed: Math.max(between.length - 1, 1) };
}

/**
 * Next `count` occurrences of a chore's rule at or after `from` (ignores
 * completions). Useful for previews in the chore editor.
 */
export function upcomingOccurrences(
  chore: Pick<ScheduleChore, "rrule" | "startsAt" | "createdAt">,
  timezone: string,
  from: Date,
  count: number,
): Date[] {
  if (!chore.rrule) return chore.startsAt && chore.startsAt >= from ? [chore.startsAt] : [];
  const rule = buildRule(parseOptions(chore.rrule), dtstartWall({ ...chore, anchor: "DUE_DATE", graceMinutes: 0 }, timezone));
  const out: Date[] = [];
  let cursor = toWallClock(from, timezone);
  let inclusive = true;
  while (out.length < count) {
    const next = rule.after(cursor, inclusive);
    if (!next) break;
    out.push(fromWallClock(next, timezone));
    cursor = next;
    inclusive = false;
  }
  return out;
}

/**
 * When `startsAt` isn't itself an occurrence of `rrule` (e.g. a start on a
 * Friday for a Wednesday rule), the first occurrence after it; null when it
 * is, or the rule is invalid. INTERVAL counts from the week (month, …) of
 * the start, so an off-schedule start can silently shift which weeks are
 * due. For the chore editor.
 */
export function offScheduleStart(rrule: string, startsAt: Date, timezone: string): Date | null {
  try {
    const [first] = upcomingOccurrences({ rrule, startsAt, createdAt: startsAt }, timezone, startsAt, 1);
    return first && first.getTime() !== startsAt.getTime() ? first : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adaptive schedule
// ---------------------------------------------------------------------------

/** Quantile `p` (0..1) of ascending `sorted` values, linearly interpolated (R type 7). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("quantile of an empty list");
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Learn an ADAPTIVE chore's interval from its latest completion and those before it. */
export function adaptiveStats(last: ScheduleCompletion | null, previous: ScheduleCompletion[]): AdaptiveStats {
  const none = { dueAfterMs: null, overdueAfterMs: null };
  if (!last) return { gaps: 0, learned: false, ...none };
  const times = [last, ...previous]
    .map((c) => c.completedAt.getTime())
    .filter((t) => t <= last.completedAt.getTime())
    .sort((a, b) => b - a)
    .slice(0, ADAPTIVE_WINDOW + 1);
  const gaps = times
    .slice(1)
    .map((t, i) => times[i] - t)
    .sort((a, b) => a - b);
  if (gaps.length < ADAPTIVE_MIN_GAPS) return { gaps: gaps.length, learned: false, ...none };
  return {
    gaps: gaps.length,
    learned: true,
    dueAfterMs: Math.round(quantile(gaps, ADAPTIVE_DUE_QUANTILE)),
    overdueAfterMs: Math.round(quantile(gaps, ADAPTIVE_OVERDUE_QUANTILE)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a chore's next due date and status. See the file header for the
 * exact semantics. Throws if the chore's rrule is invalid (validate on write
 * with validateRRule()).
 */
export function computeSchedule<C extends ScheduleCompletion>(input: ScheduleInput<C>): Schedule<C> {
  const { chore, timezone, lastCompletion } = input;
  const now = input.now ?? new Date();
  const previous = input.previousCompletions ?? [];
  const adaptive = chore.anchor === "ADAPTIVE" ? adaptiveStats(lastCompletion, previous) : null;
  const recurring = Boolean(chore.rrule) || adaptive !== null;

  let nextDueAt: Date | null;
  let overdueAt: Date;
  let missedCount = 0;
  if (adaptive?.learned && lastCompletion) {
    nextDueAt = new Date(lastCompletion.completedAt.getTime() + adaptive.dueAfterMs!);
    overdueAt = new Date(lastCompletion.completedAt.getTime() + adaptive.overdueAfterMs!);
  } else if (chore.rrule) {
    // Until an ADAPTIVE chore has learnt, its rrule is a guess counted from the last completion.
    const ruleChore: ScheduleChore = adaptive ? { ...chore, anchor: "COMPLETION" } : chore;
    const next = nextRecurringDue(ruleChore, timezone, lastCompletion, now, {
      previous: previous.slice(0, DUE_DATE_HISTORY),
      complete: (input.completeHistory ?? false) && previous.length <= DUE_DATE_HISTORY,
    });
    if (!next) return finish("done", null);
    nextDueAt = next.due;
    missedCount = next.missed;
    overdueAt = new Date(nextDueAt.getTime() + chore.graceMinutes * MINUTE);
  } else if (adaptive) {
    return finish("unscheduled", null);
  } else if (chore.startsAt) {
    if (lastCompletion) return finish("done", null);
    nextDueAt = chore.startsAt;
    overdueAt = new Date(nextDueAt.getTime() + chore.graceMinutes * MINUTE);
  } else {
    return finish("unscheduled", null);
  }

  const status: ScheduleStatus =
    missedCount > 0 || now >= overdueAt ? "overdue" : now < nextDueAt ? "upcoming" : "due";
  return finish(status, nextDueAt, overdueAt);

  function finish(status: ScheduleStatus, next: Date | null, overdue: Date | null = null): Schedule<C> {
    return {
      status,
      nextDueAt: next,
      overdueAt: overdue,
      dueToday: next ? next <= now || sameLocalDay(next, now, timezone) : false,
      recurring,
      missedCount,
      lastCompletion,
      adaptive,
    };
  }
}

/** Whether two instants fall on the same local calendar date in `tz`. */
export function sameLocalDay(a: Date, b: Date, tz: string): boolean {
  const wa = toWallClock(a, tz);
  const wb = toWallClock(b, tz);
  return (
    wa.getUTCFullYear() === wb.getUTCFullYear() &&
    wa.getUTCMonth() === wb.getUTCMonth() &&
    wa.getUTCDate() === wb.getUTCDate()
  );
}

/** A threshold crossed by a chore: it became due, or became overdue. */
export interface ScheduleTransition {
  kind: "due" | "overdue";
  /** The occurrence's due time (schedule.nextDueAt). Use as ChoreNotice.dueAt. */
  dueAt: Date;
  /** When the occurrence becomes overdue (schedule.overdueAt). */
  overdueAt: Date;
  /** When the threshold was crossed (dueAt, or overdueAt for "overdue"). */
  at: Date;
}

/**
 * Thresholds a chore crossed in the window (since, now]. For the cron job:
 * run every few minutes with `since` = last run (or now - a few hours), then
 * insert a ChoreNotice per transition (unique on choreId+kind+dueAt) and only
 * notify when the insert succeeded, which makes the job idempotent. A chore
 * whose overdueAt equals its nextDueAt (e.g. graceMinutes = 0) yields both
 * "due" and "overdue" at the same instant.
 */
export function scheduleTransitions(
  input: ScheduleInput & { since: Date },
): ScheduleTransition[] {
  const now = input.now ?? new Date();
  const s = computeSchedule({ ...input, now });
  const out: ScheduleTransition[] = [];
  if (!s.nextDueAt || !s.overdueAt) return out;
  const base = { dueAt: s.nextDueAt, overdueAt: s.overdueAt };
  if (s.nextDueAt > input.since && s.nextDueAt <= now) out.push({ kind: "due", ...base, at: s.nextDueAt });
  if (s.overdueAt > input.since && s.overdueAt <= now) out.push({ kind: "overdue", ...base, at: s.overdueAt });
  return out;
}

/** Sort key for chore lists: overdue first, then due, upcoming by date, then unscheduled, done last. */
export function compareSchedules(a: Schedule, b: Schedule): number {
  const rank: Record<ScheduleStatus, number> = { overdue: 0, due: 1, upcoming: 2, unscheduled: 3, done: 4 };
  const r = rank[a.status] - rank[b.status];
  if (r !== 0) return r;
  return (a.nextDueAt?.getTime() ?? Infinity) - (b.nextDueAt?.getTime() ?? Infinity);
}
