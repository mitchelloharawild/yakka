"use client";

/**
 * "Who are you?" for the tag page: one tap on a member chip picks the
 * identity AND completes the chore (iOS asks again in Safari after a PWA
 * install, so this must stay one tap). Plus "I'm new".
 *
 * NOTE for the integrator: Agent A may ship a group-side picker in
 * src/components/group/identity-picker.tsx; this one is tag-specific
 * (members come from the tag token, "I'm new" goes through tags.createMember)
 * and can be merged with it later.
 */
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TagMember } from "@/lib/services/tags";

export function TagIdentityPicker({
  members,
  busy,
  onPick,
  onCreate,
}: {
  members: TagMember[];
  busy: boolean;
  onPick: (member: TagMember) => void;
  /** Omit to hide "I'm new". */
  onCreate?: (name: string) => void;
}) {
  const t = useTranslations("tag.who");
  const [adding, setAdding] = useState(members.length === 0);
  const [name, setName] = useState("");

  if (adding && onCreate) {
    return (
      <form
        className="flex w-full flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(name.trim());
        }}
      >
        <label htmlFor="tag-new-name" className="text-lg font-medium">
          {members.length === 0 ? t("noMembers") : t("newTitle")}
        </label>
        <Input
          id="tag-new-name"
          autoFocus
          autoComplete="given-name"
          maxLength={50}
          placeholder={t("namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-12 text-lg"
        />
        <div className="flex gap-2">
          {members.length > 0 && (
            <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setAdding(false)}>
              {t("cancel")}
            </Button>
          )}
          <Button type="submit" className="h-12 flex-[2] text-base" disabled={busy || !name.trim()}>
            {t("join")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="text-center">
        <h2 className="font-heading text-2xl font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(m)}
              className="flex h-16 w-full items-center gap-3 rounded-2xl border bg-card px-4 text-left text-lg font-medium shadow-xs transition active:scale-95 disabled:opacity-50"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white"
                style={{ backgroundColor: m.colour ?? "var(--muted-foreground)" }}
              >
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{m.name}</span>
            </button>
          </li>
        ))}
        {onCreate && (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAdding(true)}
              className="flex h-16 w-full items-center gap-3 rounded-2xl border border-dashed px-4 text-left text-lg font-medium text-muted-foreground transition active:scale-95 disabled:opacity-50"
            >
              <UserPlus className="size-6" />
              {t("new")}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
