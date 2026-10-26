"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { describeRRule, offScheduleStart, upcomingOccurrences, validateRRule } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { alignStart, candidateCount, candidates, picksFirstDue } from "./first-due";
import {
  buildRRule,
  defaultPreset,
  PRESET_KINDS,
  WEEKDAYS,
  type PresetKind,
  type SchedulePreset,
  type Weekday,
} from "./schedule-presets";
import { fromLocalInputValue, monthDayIn, toLocalInputValue, weekdayIn } from "./time";

/** Result of checking the editor state: the RRULE to save, or an error to show. */
export function scheduleResult(preset: SchedulePreset): { rrule: string | null; error: string | null } {
  try {
    const rrule = buildRRule(preset);
    if (rrule === null) return { rrule, error: null };
    const v = validateRRule(rrule);
    return v.ok ? { rrule: v.rrule, error: null } : { rrule: null, error: v.error };
  } catch (e) {
    return { rrule: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const numberInput = "h-9 w-20 text-center";

/**
 * `startsAt` (datetime-local value) moved onto a day `preset` produces, for
 * presets with a first due picker; unchanged otherwise. An empty value
 * becomes 09:00 today first.
 */
export function alignedStartsAt(
  preset: SchedulePreset,
  startsAt: string,
  timezone: string,
  opts: { isNew: boolean; now: Date },
): string {
  if (!picksFirstDue(preset)) return startsAt;
  const { rrule } = scheduleResult(preset);
  const value = startsAt || `${toLocalInputValue(opts.now, timezone).slice(0, 10)}T09:00`;
  const start = fromLocalInputValue(value, timezone);
  if (!rrule || !start) return value;
  return toLocalInputValue(alignStart(rrule, start, timezone, opts), timezone);
}

export function ScheduleEditor({
  preset,
  onPresetChange,
  startsAt,
  onStartsAtChange,
  timezone,
  isNew,
}: {
  preset: SchedulePreset;
  onPresetChange: (p: SchedulePreset) => void;
  /** datetime-local value in the group timezone ("" = none). */
  startsAt: string;
  onStartsAtChange: (v: string) => void;
  timezone: string;
  /** A chore being created: it has no history, so its first due date can't be in the past. */
  isNew: boolean;
}) {
  const t = useTranslations("group.editor");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const start = fromLocalInputValue(startsAt, timezone);
  const { rrule, error } = scheduleResult(preset);
  const firstDue = picksFirstDue(preset);

  /** Change the schedule and/or start, keeping the start on a day the schedule produces. */
  function apply(next: SchedulePreset, nextStartsAt: string) {
    const value = alignedStartsAt(next, nextStartsAt, timezone, { isNew, now: new Date() });
    if (next !== preset) onPresetChange(next);
    if (value !== startsAt) onStartsAtChange(value);
  }
  const changePreset = (p: SchedulePreset) => apply(p, startsAt);

  const weekdayLabels = useMemo(
    () =>
      Object.fromEntries(
        WEEKDAYS.map((d, i) => [
          d,
          format.dateTime(new Date(Date.UTC(2024, 0, 1 + i)), { weekday: "short", timeZone: "UTC" }),
        ]),
      ) as Record<Weekday, string>,
    [format],
  );

  const preview = useMemo(() => {
    if (error) return null;
    const now = new Date();
    try {
      return upcomingOccurrences({ rrule, startsAt: start, createdAt: now }, timezone, now, 3);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rrule, startsAt, timezone, error]);

  const offSchedule = useMemo(
    () => (rrule && start && !error ? offScheduleStart(rrule, start, timezone) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rrule, startsAt, timezone, error],
  );

  // First due options: one cycle of upcoming days, plus the current start if it isn't one of them.
  const firstDueOptions = useMemo(() => {
    if (!firstDue || !rrule || !start) return [];
    const list = candidates(rrule, start, timezone, now, candidateCount(preset));
    if (!list.some((d) => d.getTime() === start.getTime())) list.push(start);
    return list.sort((a, b) => a.getTime() - b.getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDue, rrule, startsAt, timezone, now]);

  function changeKind(kind: PresetKind) {
    const ref = start ?? new Date();
    changePreset(
      defaultPreset(kind, {
        weekday: weekdayIn(ref, timezone),
        monthDay: monthDayIn(ref, timezone),
        rrule: rrule ?? undefined,
      }),
    );
  }

  const fmt = (d: Date) =>
    format.dateTime(d, { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const fmtDay = (d: Date) => format.dateTime(d, { timeZone: timezone, weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{t("schedule")}</Label>
        <Select value={preset.kind} onValueChange={(v) => changeKind(v as PresetKind)}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`presets.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preset.kind === "everyNDays" && (
        <div className="flex items-center gap-2 text-sm">
          {t("every")}
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={366}
            className={numberInput}
            value={preset.interval}
            onChange={(e) => changePreset({ ...preset, interval: Number(e.target.value) })}
          />
          {t("days", { count: preset.interval })}
        </div>
      )}

      {preset.kind === "weekly" && (
        <>
          <div className="flex items-center gap-2 text-sm">
            {t("every")}
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={52}
              className={numberInput}
              value={preset.interval}
              onChange={(e) => changePreset({ ...preset, interval: Number(e.target.value) })}
            />
            {t("weeks", { count: preset.interval })}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">{t("onDays")}</span>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => {
                const on = preset.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      changePreset({
                        ...preset,
                        weekdays: on ? preset.weekdays.filter((x) => x !== d) : [...preset.weekdays, d],
                      })
                    }
                    className={cn(
                      "h-10 rounded-lg border text-sm font-medium transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {weekdayLabels[d]}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {preset.kind === "monthly" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {t("every")}
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={24}
            className={numberInput}
            value={preset.interval}
            onChange={(e) => changePreset({ ...preset, interval: Number(e.target.value) })}
          />
          {t("months", { count: preset.interval })}, {t("onDay").toLowerCase()}
          <Select
            value={String(preset.day)}
            onValueChange={(v) => changePreset({ ...preset, day: Number(v) })}
          >
            <SelectTrigger className="h-9 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 31 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </SelectItem>
              ))}
              <SelectItem value="-1">{t("lastDay")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {preset.kind === "custom" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rrule">{t("rrule")}</Label>
          <Textarea
            id="rrule"
            value={preset.rrule}
            onChange={(e) => changePreset({ kind: "custom", rrule: e.target.value })}
            className="min-h-16 font-mono text-sm"
            spellCheck={false}
            autoCapitalize="characters"
          />
          <p className="text-xs text-muted-foreground">{t("rruleHint")}</p>
        </div>
      )}

      {firstDue ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dueTime">{t("time")}</Label>
            <Input
              id="dueTime"
              type="time"
              value={startsAt.slice(11, 16)}
              onChange={(e) => e.target.value && apply(preset, `${startsAt.slice(0, 10)}T${e.target.value}`)}
              className="h-10 w-36"
            />
            <p className="text-xs text-muted-foreground">{t("timeHint", { timezone })}</p>
          </div>
          {firstDueOptions.length > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">{t("firstDue")}</legend>
              <div className="flex flex-col divide-y rounded-xl border">
                {firstDueOptions.map((d) => {
                  const selected = start !== null && d.getTime() === start.getTime();
                  return (
                    <label key={d.getTime()} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="firstDue"
                        className="accent-primary"
                        checked={selected}
                        onChange={() => onStartsAtChange(toLocalInputValue(d, timezone))}
                      />
                      <span className={cn("flex-1", selected && "font-medium")}>{fmtDay(d)}</span>
                      <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                        {format.relativeTime(d, now)}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="firstDueOther" className="shrink-0 font-normal text-muted-foreground">
                  {t("firstDueOther")}
                </Label>
                <Input
                  id="firstDueOther"
                  type="date"
                  value=""
                  onChange={(e) => {
                    const from = fromLocalInputValue(`${e.target.value}T00:00`, timezone);
                    const [d] = rrule && start && from ? candidates(rrule, start, timezone, from, 1) : [];
                    if (d) onStartsAtChange(toLocalInputValue(d, timezone));
                  }}
                  className="h-9 w-44"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("firstDueHint")}</p>
            </fieldset>
          )}
        </>
      ) : (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="startsAt">{preset.kind === "once" ? t("due") : t("starts")}</Label>
        <div className="flex gap-2">
          <Input
            id="startsAt"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => onStartsAtChange(e.target.value)}
            className="h-10 flex-1"
          />
          {preset.kind === "once" && startsAt && (
            <Button type="button" variant="ghost" className="h-10" onClick={() => onStartsAtChange("")}>
              {t("clearDate")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {preset.kind === "once" ? t("dueHint", { timezone }) : t("startsHint", { timezone })}
        </p>
        {offSchedule && (
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {t("startsOffSchedule", { first: fmt(offSchedule) })}
          </p>
        )}
      </div>
      )}

      {error ? (
        <p className="text-sm text-destructive">{t("rruleInvalid", { error })}</p>
      ) : (
        (rrule || start) && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {rrule && <span className="block font-medium text-foreground first-letter:uppercase">{describeRRule(rrule)}</span>}
            {preview && preview.length > 0 ? t("preview", { dates: preview.map(fmt).join(" · ") }) : t("previewNone")}
          </p>
        )
      )}
    </div>
  );
}
