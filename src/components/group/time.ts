/**
 * Pure time helpers for the group UI (no React, no DB). Wall-clock
 * conversions use the group timezone via src/lib/schedule.ts.
 */
import { fromWallClock, toWallClock } from "@/lib/schedule";

/** Unit of a compact duration. */
export type CompactUnit = "minute" | "hour" | "day" | "week";

/**
 * Round a duration to one compact unit, e.g. 3h 20m -> { value: 3, unit: "hour" }.
 * Negative durations are treated as positive. Under a minute rounds up to 1m.
 */
export function compactDuration(ms: number): { value: number; unit: CompactUnit } {
  const abs = Math.abs(ms);
  const min = abs / 60_000;
  if (min < 60) return { value: Math.max(1, Math.floor(min)), unit: "minute" };
  const h = min / 60;
  if (h < 24) return { value: Math.floor(h), unit: "hour" };
  const d = h / 24;
  if (d < 14) return { value: Math.floor(d), unit: "day" };
  return { value: Math.floor(d / 7), unit: "week" };
}

/**
 * A duration in the largest sensible unit, to one decimal place, e.g. 5.8
 * days -> { value: 5.8, unit: "day" }. For "usually every …" text, where
 * compactDuration()'s rounding down would mislead.
 */
export function approxDuration(ms: number): { value: number; unit: CompactUnit } {
  const { unit } = compactDuration(ms);
  const size = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[unit];
  return { value: Math.round((Math.abs(ms) / size) * 10) / 10, unit };
}

/** Format an instant as the value of an <input type="datetime-local"> in `tz`. */
export function toLocalInputValue(instant: Date, tz: string): string {
  const w = toWallClock(instant, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}T${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`;
}

/** Parse an <input type="datetime-local"> value as wall-clock time in `tz`; null if invalid. */
export function fromLocalInputValue(value: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return fromWallClock(new Date(Date.UTC(y, mo - 1, d, h, mi)), tz);
}

/** RRULE weekday code (MO..SU) of an instant in `tz`. */
export function weekdayIn(instant: Date, tz: string): "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU" {
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
  return codes[toWallClock(instant, tz).getUTCDay()];
}

/** Day of month (1..31) of an instant in `tz`. */
export function monthDayIn(instant: Date, tz: string): number {
  return toWallClock(instant, tz).getUTCDate();
}

/** Short form of a device id for the audit log (first 6 characters). */
export function shortDeviceId(id: string | null | undefined): string | null {
  return id ? id.replace(/-/g, "").slice(0, 6) : null;
}

/** Initials for an avatar: first letters of the first two words, upper-cased. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const chars = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return chars.join("").toUpperCase();
}
