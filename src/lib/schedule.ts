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
 *      - no P (before the first occurrence): C satisfies N (early);
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
 *  - One-off chores (rrule null, startsAt set): due at startsAt until any
 *    completion, then "done".
 *  - rrule null and startsAt null: "unscheduled" (can be completed any time).
 *  - status: upcoming (now < nextDueAt), due (nextDueAt <= now < overdueAt),
 *    overdue (now >= overdueAt), where overdueAt = nextDueAt + graceMinutes.
 *    With graceMinutes = 0 a chore goes straight from upcoming to overdue.
 *    A chore with missedCount > 0 is always overdue.
 */
import { TZDate } from "@date-fns/tz";
import { Frequency, RRule, type Options } from "rrule";

/** Mirrors the Prisma ScheduleAnchor enum (kept as a string union so this file stays DB-free). */
export type ScheduleAnchorValue = "DUE_DATE" | "COMPLETION";

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

/** How many non-undone completions before the latest one callers should pass as `previousCompletions`. */
export const SCHEDULE_HISTORY = 3;

/** Input for computeSchedule(). */
export interface ScheduleInput<C extends ScheduleCompletion = ScheduleCompletion> {
  chore: ScheduleChore;
  /** IANA timezone of the group, e.g. "Australia/Sydney". */
  timezone: string;
  /** The latest completion that has not been undone, or null. */
  lastCompletion: C | null;
  /**
   * DUE_DATE anchor: the non-undone completions before `lastCompletion`,
   * newest first (up to SCHEDULE_HISTORY). Used to tell a late completion
   * of a missed occurrence from an early completion of the next one.
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
  /** Whether the chore has an RRULE. */
  recurring: boolean;
  /** Recurring only: occurrences that started and were skipped before nextDueAt (0 normally). */
  missedCount: number;
  lastCompletion: C | null;
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

/**
 * DUE_DATE: the latest satisfied occurrence (wall clock) after completion
 * `c`, given the latest satisfied occurrence before it. `assumePrevious`:
 * nothing is known about earlier completions, so treat P as satisfied.
 */
function satisfyDueDate(rule: RRule, c: Date, satisfied: Date | null, assumePrevious: boolean): Date | null {
  const n = rule.after(c, false);
  const p = rule.before(c, true);
  const later = (a: Date | null, b: Date) => (a && a.getTime() > b.getTime() ? a : b);
  if (!p) return n ? later(satisfied, n) : satisfied; // before the first occurrence: early completion of it
  const pSatisfied = assumePrevious || (satisfied !== null && satisfied.getTime() >= p.getTime());
  if (!n) return later(satisfied, p); // series ended after P
  if (satisfied && satisfied.getTime() >= n.getTime()) return satisfied; // N already covered
  const interval = n.getTime() - p.getTime();
  const untilN = n.getTime() - c.getTime();
  const inWindow = untilN <= Math.min(interval * EARLY_WINDOW_SHARE, EARLY_WINDOW_MAX_MS);
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
  const recurring = Boolean(chore.rrule);

  let nextDueAt: Date | null;
  let missedCount = 0;
  if (recurring) {
    const next = nextRecurringDue(chore, timezone, lastCompletion, now, {
      previous: input.previousCompletions ?? [],
      complete: input.completeHistory ?? false,
    });
    if (!next) return finish("done", null);
    nextDueAt = next.due;
    missedCount = next.missed;
  } else if (chore.startsAt) {
    if (lastCompletion) return finish("done", null);
    nextDueAt = chore.startsAt;
  } else {
    return finish("unscheduled", null);
  }

  const overdueAt = new Date(nextDueAt.getTime() + chore.graceMinutes * MINUTE);
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
  /** When the threshold was crossed (dueAt, or overdueAt for "overdue"). */
  at: Date;
}

/**
 * Thresholds a chore crossed in the window (since, now]. For the cron job:
 * run every few minutes with `since` = last run (or now - a few hours), then
 * insert a ChoreNotice per transition (unique on choreId+kind+dueAt) and only
 * notify when the insert succeeded, which makes the job idempotent. A chore
 * with graceMinutes = 0 yields both "due" and "overdue" at the same instant.
 */
export function scheduleTransitions(
  input: ScheduleInput & { since: Date },
): ScheduleTransition[] {
  const now = input.now ?? new Date();
  const s = computeSchedule({ ...input, now });
  const out: ScheduleTransition[] = [];
  if (!s.nextDueAt || !s.overdueAt) return out;
  if (s.nextDueAt > input.since && s.nextDueAt <= now) out.push({ kind: "due", dueAt: s.nextDueAt, at: s.nextDueAt });
  if (s.overdueAt > input.since && s.overdueAt <= now)
    out.push({ kind: "overdue", dueAt: s.nextDueAt, at: s.overdueAt });
  return out;
}

/** Sort key for chore lists: overdue first, then due, upcoming by date, then unscheduled, done last. */
export function compareSchedules(a: Schedule, b: Schedule): number {
  const rank: Record<ScheduleStatus, number> = { overdue: 0, due: 1, upcoming: 2, unscheduled: 3, done: 4 };
  const r = rank[a.status] - rank[b.status];
  if (r !== 0) return r;
  return (a.nextDueAt?.getTime() ?? Infinity) - (b.nextDueAt?.getTime() ?? Infinity);
}
