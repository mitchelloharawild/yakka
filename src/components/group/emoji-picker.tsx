"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Household-ish emoji offered in the chore icon picker. */
export const CHORE_EMOJI = [
  "🧹", "🧽", "🧼", "🪣", "🧺", "👕", "🛏️", "🛁",
  "🚿", "🚽", "🪥", "🍽️", "🍳", "🥘", "🛒", "🧊",
  "🗑️", "♻️", "📦", "🪴", "🌱", "🌻", "🍂", "❄️",
  "🐈", "🐕", "🐟", "🐦", "💊", "🩺", "💧", "🔋",
  "💡", "🔧", "🪛", "🚗", "🚲", "📬", "💸", "📅",
  "🪟", "🛋️", "🧸", "👶", "📚", "🎒", "☕", "🔥",
] as const;

/** Button that opens a grid of emoji; also accepts any typed emoji. */
export function EmojiPicker({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  className?: string;
}) {
  const t = useTranslations("group.editor");
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const choose = (e: string | null) => {
    onChange(e);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={t("pickIcon")}
          className={cn("size-11 shrink-0 p-0 text-2xl", className)}
        >
          {value || "🧹"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="grid grid-cols-8 gap-1">
          {CHORE_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => choose(e)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-xl hover:bg-muted",
                value === e && "bg-muted ring-2 ring-primary/40",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (custom.trim()) choose(custom.trim());
            setCustom("");
          }}
        >
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            maxLength={16}
            placeholder="😀"
            aria-label={t("icon")}
            className="h-8"
          />
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => choose(null)}>
            {t("noIcon")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
