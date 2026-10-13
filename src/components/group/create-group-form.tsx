"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDeviceId, touchGroup, useHydrated } from "@/lib/client/local-groups";
import { fromWallClock, toWallClock } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { useErrorMessage } from "./group-context";
import { MEMBER_COLOURS } from "./member-avatar";
import { browserTimezone, TimezoneSelect } from "./timezone-select";

/** Starter chores offered on the create form. `hour` is the local time of day it's due. */
const SUGGESTIONS = [
  { key: "bins", icon: "🗑️", rrule: "FREQ=WEEKLY;BYDAY=MO", hour: 19, anchor: "DUE_DATE", grace: 720 },
  { key: "dishes", icon: "🍽️", rrule: "FREQ=DAILY", hour: 20, anchor: "DUE_DATE", grace: 720 },
  { key: "laundry", icon: "🧺", rrule: "FREQ=WEEKLY;BYDAY=SA", hour: 10, anchor: "COMPLETION", grace: 1440 },
  { key: "plants", icon: "🪴", rrule: "FREQ=DAILY;INTERVAL=3", hour: 9, anchor: "COMPLETION", grace: 1440 },
  { key: "vacuum", icon: "🧹", rrule: "FREQ=WEEKLY;BYDAY=SU", hour: 10, anchor: "COMPLETION", grace: 1440 },
  { key: "bathroom", icon: "🛁", rrule: "FREQ=WEEKLY;BYDAY=SA", hour: 10, anchor: "DUE_DATE", grace: 1440 },
  { key: "petFood", icon: "🐈", rrule: "FREQ=DAILY", hour: 7, anchor: "DUE_DATE", grace: 120 },
  { key: "sheets", icon: "🛏️", rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU", hour: 10, anchor: "COMPLETION", grace: 2880 },
] as const;
type SuggestionKey = (typeof SUGGESTIONS)[number]["key"];

/** Today at `hour`:00 in `tz`, as an instant. */
function todayAt(hour: number, tz: string): Date {
  const w = toWallClock(new Date(), tz);
  return fromWallClock(new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), hour)), tz);
}

export function CreateGroupForm() {
  const t = useTranslations("group.create");
  const ts = useTranslations("group.suggestions");
  const trpc = useTRPC();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const hydrated = useHydrated();
  const [name, setName] = useState("");
  // null = the browser's timezone (only known after hydration).
  const [tzChoice, setTzChoice] = useState<string | null>(null);
  const timezone = tzChoice ?? (hydrated ? browserTimezone() : "UTC");
  const [members, setMembers] = useState<string[]>(["", ""]);
  const [picked, setPicked] = useState<SuggestionKey[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const createGroup = useMutation(trpc.groups.create.mutationOptions());
  const createChore = useMutation(trpc.groups.chores.create.mutationOptions());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    setBusy(true);
    try {
      const deviceId = getDeviceId();
      const group = await createGroup.mutateAsync({
        name: name.trim(),
        timezone,
        members: members
          .map((m) => m.trim())
          .filter(Boolean)
          .map((m, i) => ({ name: m, colour: MEMBER_COLOURS[(i * 5) % MEMBER_COLOURS.length] })),
        actor: { deviceId },
      });
      const actor = { deviceId };
      for (const s of SUGGESTIONS.filter((x) => picked.includes(x.key))) {
        await createChore.mutateAsync({
          groupId: group.id,
          actor,
          chore: {
            title: ts(s.key),
            icon: s.icon,
            rrule: s.rrule,
            startsAt: todayAt(s.hour, timezone),
            anchor: s.anchor,
            graceMinutes: s.grace,
          },
        });
      }
      for (const title of custom) {
        await createChore.mutateAsync({ groupId: group.id, actor, chore: { title } });
      }
      touchGroup({ id: group.id, name: group.name });
      toast.success(t("created"));
      router.push(`/groups/${group.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  const setMember = (i: number, v: string) => setMembers((ms) => ms.map((m, j) => (j === i ? v : m)));
  const addCustom = () => {
    const v = customDraft.trim();
    if (v && !custom.includes(v)) setCustom((c) => [...c, v]);
    setCustomDraft("");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 pb-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          maxLength={80}
          required
          autoFocus
          className="h-12 text-base"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tz">{t("timezone")}</Label>
        <TimezoneSelect id="tz" value={timezone} onChange={setTzChoice} />
        <p className="text-xs text-muted-foreground">{t("timezoneHint")}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("members")}</legend>
        <p className="-mt-1 text-xs text-muted-foreground">{t("membersHint")}</p>
        {members.map((m, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={m}
              onChange={(e) => setMember(i, e.target.value)}
              placeholder={t("memberPlaceholder")}
              aria-label={t("memberPlaceholder")}
              maxLength={50}
              className="h-11 text-base"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="size-11"
              aria-label={t("removeMember", { name: m || String(i + 1) })}
              onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}
              disabled={members.length <= 1}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-10 self-start"
          onClick={() => setMembers((ms) => [...ms, ""])}
          disabled={members.length >= 50}
        >
          <PlusIcon /> {t("addMember")}
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("chores")}</legend>
        <p className="-mt-1 text-xs text-muted-foreground">{t("choresHint")}</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => {
            const on = picked.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.key) : [...p, s.key]))}
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                <span aria-hidden>{s.icon}</span>
                {ts(s.key)}
                {on && <CheckIcon className="size-3.5" />}
              </button>
            );
          })}
          {custom.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCustom((cs) => cs.filter((x) => x !== c))}
              className="flex h-10 items-center gap-1.5 rounded-full border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              {c}
              <XIcon className="size-3.5" />
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder={t("customChore")}
            aria-label={t("customChore")}
            maxLength={100}
            className="h-10"
          />
          <Button type="button" variant="outline" className="h-10" onClick={addCustom} disabled={!customDraft.trim()}>
            {t("addChore")}
          </Button>
        </div>
      </fieldset>

      <Button type="submit" size="lg" className="h-12 rounded-full text-base" disabled={busy || !name.trim()}>
        {busy && <Loader2Icon className="animate-spin" />}
        {busy ? t("creating") : t("submit")}
      </Button>
    </form>
  );
}
