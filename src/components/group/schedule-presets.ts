/**
 * Pure helpers for the chore schedule editor: turn a friendly preset into an
 * RRULE body (no DTSTART) and back. Anything the presets can't express
 * round-trips through `{ kind: "custom" }` unchanged.
 */

/** RRULE weekday codes, Monday first. */
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
/** An RRULE weekday code. */
export type Weekday = (typeof WEEKDAYS)[number];

/** A schedule as edited in the UI. */
export type SchedulePreset =
  /** No RRULE: a one-off chore (with a start date) or unscheduled. */
  | { kind: "once" }
  | { kind: "daily" }
  | { kind: "everyNDays"; interval: number }
  | { kind: "weekly"; interval: number; weekdays: Weekday[] }
  /** `day` is 1..31, or -1 for the last day of the month. */
  | { kind: "monthly"; interval: number; day: number }
  | { kind: "custom"; rrule: string };

/** The preset kinds, in the order the editor shows them. */
export const PRESET_KINDS = ["once", "daily", "everyNDays", "weekly", "monthly", "custom"] as const;
/** A preset kind. */
export type PresetKind = (typeof PRESET_KINDS)[number];

const clampInt = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? Math.round(n) : min));

/** Sort and dedupe weekdays into Monday-first order. */
export function sortWeekdays(days: readonly string[]): Weekday[] {
  return WEEKDAYS.filter((d) => days.includes(d));
}

/**
 * RRULE body for a preset, or null for "once". Throws for an invalid preset
 * (e.g. weekly with no weekdays).
 */
export function buildRRule(p: SchedulePreset): string | null {
  switch (p.kind) {
    case "once":
      return null;
    case "daily":
      return "FREQ=DAILY";
    case "everyNDays": {
      const n = clampInt(p.interval, 1, 366);
      return n === 1 ? "FREQ=DAILY" : `FREQ=DAILY;INTERVAL=${n}`;
    }
    case "weekly": {
      const days = sortWeekdays(p.weekdays);
      if (days.length === 0) throw new Error("Pick at least one weekday");
      const n = clampInt(p.interval, 1, 52);
      return `FREQ=WEEKLY${n > 1 ? `;INTERVAL=${n}` : ""};BYDAY=${days.join(",")}`;
    }
    case "monthly": {
      const day = p.day === -1 ? -1 : clampInt(p.day, 1, 31);
      const n = clampInt(p.interval, 1, 24);
      return `FREQ=MONTHLY${n > 1 ? `;INTERVAL=${n}` : ""};BYMONTHDAY=${day}`;
    }
    case "custom": {
      const body = p.rrule.trim().replace(/^RRULE:/i, "");
      return body === "" ? null : body;
    }
  }
}

/** Parse "A=1;B=2" into an upper-cased key map; null if malformed. */
function parts(rrule: string): Map<string, string> | null {
  const map = new Map<string, string>();
  for (const seg of rrule.trim().replace(/^RRULE:/i, "").split(";")) {
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq <= 0) return null;
    map.set(seg.slice(0, eq).trim().toUpperCase(), seg.slice(eq + 1).trim().toUpperCase());
  }
  return map;
}

function positiveInt(v: string | undefined, fallback = 1): number | null {
  if (v === undefined) return fallback;
  return /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null;
}

/** The preset that produces `rrule`, falling back to custom. */
export function parseRRule(rrule: string | null | undefined): SchedulePreset {
  if (!rrule || !rrule.trim()) return { kind: "once" };
  const custom: SchedulePreset = { kind: "custom", rrule: rrule.trim() };
  const m = parts(rrule);
  if (!m) return custom;
  const freq = m.get("FREQ");
  const keys = [...m.keys()].filter((k) => k !== "FREQ" && k !== "INTERVAL");
  const interval = positiveInt(m.get("INTERVAL"));
  if (interval === null) return custom;

  if (freq === "DAILY" && keys.length === 0) {
    return interval === 1 ? { kind: "daily" } : { kind: "everyNDays", interval };
  }
  if (freq === "WEEKLY" && keys.length === 1 && keys[0] === "BYDAY") {
    const days = m.get("BYDAY")!.split(",");
    if (days.length === 0 || !days.every((d) => (WEEKDAYS as readonly string[]).includes(d))) return custom;
    return { kind: "weekly", interval, weekdays: sortWeekdays(days) };
  }
  if (freq === "MONTHLY" && keys.length === 1 && keys[0] === "BYMONTHDAY") {
    const raw = m.get("BYMONTHDAY")!;
    const day = raw === "-1" ? -1 : positiveInt(raw);
    if (day === null || day > 31) return custom;
    return { kind: "monthly", interval, day };
  }
  return custom;
}

/** A sensible default preset when switching the editor to `kind`. */
export function defaultPreset(kind: PresetKind, ctx: { weekday?: Weekday; monthDay?: number; rrule?: string } = {}) {
  switch (kind) {
    case "once":
      return { kind } as const;
    case "daily":
      return { kind } as const;
    case "everyNDays":
      return { kind, interval: 2 } as const;
    case "weekly":
      return { kind, interval: 1, weekdays: [ctx.weekday ?? "MO"] } satisfies SchedulePreset;
    case "monthly":
      return { kind, interval: 1, day: ctx.monthDay ?? 1 } as const;
    case "custom":
      return { kind, rrule: ctx.rrule ?? "FREQ=WEEKLY;BYDAY=MO" } as const;
  }
}
