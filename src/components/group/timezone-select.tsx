"use client";

import { useMemo } from "react";
import { useHydrated } from "@/lib/client/local-groups";
import { cn } from "@/lib/utils";

function allTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/**
 * Native <select> of IANA timezones (best on phones: the OS picker is
 * searchable and fast). Always includes `value` and UTC.
 */
export function TimezoneSelect({
  value,
  onChange,
  id,
  disabled,
  className,
}: {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  // The server's and browser's ICU data may differ: only list all zones after hydration.
  const hydrated = useHydrated();
  const zones = useMemo(() => {
    const set = new Set(hydrated ? allTimezones() : []);
    set.add("UTC");
    if (value) set.add(value);
    return [...set].sort();
  }, [value, hydrated]);
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
        className,
      )}
    >
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

/** The browser's timezone, or UTC. Browser-only (call in handlers/after hydration). */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
