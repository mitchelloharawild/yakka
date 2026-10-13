"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { looksLikeEmoji, searchEmoji, type EmojiEntry } from "./emoji-search";

/** Household-ish emoji offered in the chore icon picker. */
export const CHORE_EMOJI = [
  "🧹", "🧽", "🧼", "🪣", "🧺", "👕", "🛏️", "🛁",
  "🚿", "🚽", "🪥", "🍽️", "🍳", "🥘", "🛒", "🧊",
  "🗑️", "♻️", "📦", "🪴", "🌱", "🌻", "🍂", "❄️",
  "🐈", "🐕", "🐟", "🐦", "💊", "🩺", "💧", "🔋",
  "💡", "🔧", "🪛", "🚗", "🚲", "📬", "💸", "📅",
  "🪟", "🛋️", "🧸", "👶", "📚", "🎒", "☕", "🔥",
] as const;

// ~120 KB, so only fetched once someone opens the picker.
let emojiData: Promise<readonly EmojiEntry[]> | undefined;
const loadEmojiData = () =>
  (emojiData ??= import("./emoji-data.json").then((m) => m.default as unknown as EmojiEntry[]));

/** Button that opens a grid of emoji, searchable by name; also accepts a typed emoji. */
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
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<readonly EmojiEntry[] | null>(null);

  useEffect(() => {
    if (!open || entries) return;
    let live = true;
    loadEmojiData().then(
      (d) => live && setEntries(d),
      () => {
        emojiData = undefined; // retry on the next open
      },
    );
    return () => {
      live = false;
    };
  }, [open, entries]);

  const q = query.trim();
  const results = useMemo<readonly string[] | null>(() => {
    if (!q) return CHORE_EMOJI;
    if (looksLikeEmoji(q)) return [q];
    return entries ? searchEmoji(entries, q) : null;
  }, [q, entries]);

  const choose = (e: string | null) => {
    onChange(e);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
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
      <PopoverContent
        align="start"
        className="w-72 p-2"
        // On phones, focusing the search would raise the keyboard over the grid.
        onOpenAutoFocus={(e) => {
          if (window.matchMedia("(pointer: coarse)").matches) e.preventDefault();
        }}
      >
        <div className="flex gap-1">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Not a <form>: React would bubble its submit to the chore form.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (q && results?.[0]) choose(results[0]);
            }}
            maxLength={32}
            placeholder={t("searchIcons")}
            aria-label={t("searchIcons")}
            enterKeyHint="done"
            autoComplete="off"
            className="h-8"
          />
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => choose(null)}>
            {t("noIcon")}
          </Button>
        </div>
        {results === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("loadingIcons")}</p>
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("noIconResults")}</p>
        ) : (
          <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
            {results.map((e) => (
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
        )}
      </PopoverContent>
    </Popover>
  );
}
