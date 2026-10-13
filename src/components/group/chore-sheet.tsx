"use client";

/** Bottom sheet to create or edit a chore, with its completion history. */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, CheckIcon, Loader2Icon, Undo2Icon } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { StatusBadge, useDueText } from "./chore-card";
import { EmojiPicker } from "./emoji-picker";
import { useActor, useErrorMessage, useGroup } from "./group-context";
import { MemberAvatar } from "./member-avatar";
import { ScheduleEditor, scheduleResult } from "./schedule-editor";
import { parseRRule, type SchedulePreset } from "./schedule-presets";
import { fromLocalInputValue, toLocalInputValue, weekdayIn } from "./time";
import { useChoreActions, type ChoreItem } from "./use-chore-actions";

const GRACE_OPTIONS = [0, 30, 60, 120, 360, 720, 1440, 2880, 10080] as const;
type AssigneeMode = ChoreItem["assigneeMode"];
type Anchor = ChoreItem["anchor"];

interface FormState {
  title: string;
  description: string;
  icon: string | null;
  preset: SchedulePreset;
  startsAt: string;
  anchor: Anchor;
  anchorTouched: boolean;
  assigneeMode: AssigneeMode;
  assigneeId: string | null;
  graceMinutes: number;
}

function initialState(chore: ChoreItem | null, timezone: string): FormState {
  if (chore) {
    return {
      title: chore.title,
      description: chore.description ?? "",
      icon: chore.icon,
      preset: parseRRule(chore.rrule),
      startsAt: chore.startsAt ? toLocalInputValue(chore.startsAt, timezone) : "",
      anchor: chore.anchor,
      anchorTouched: true,
      assigneeMode: chore.assigneeMode,
      assigneeId: chore.assigneeId,
      graceMinutes: chore.graceMinutes,
    };
  }
  // New chore: weekly on today's weekday, 09:00 local.
  const now = new Date();
  const today = toLocalInputValue(now, timezone).slice(0, 10);
  return {
    title: "",
    description: "",
    icon: null,
    preset: { kind: "weekly", interval: 1, weekdays: [weekdayIn(now, timezone)] },
    startsAt: `${today}T09:00`,
    anchor: "DUE_DATE",
    anchorTouched: false,
    assigneeMode: "ANYONE",
    assigneeId: null,
    graceMinutes: 720,
  };
}

/** Anchor that suits a preset when the user hasn't picked one. */
function suggestedAnchor(p: SchedulePreset): Anchor {
  return p.kind === "everyNDays" ? "COMPLETION" : "DUE_DATE";
}

export function ChoreSheet({
  open,
  onOpenChange,
  chore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new chore. */
  chore: ChoreItem | null;
}) {
  const t = useTranslations("group.editor");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full gap-0 overflow-y-auto rounded-t-2xl p-0 sm:max-w-xl"
      >
        <SheetHeader className="sticky top-0 z-10 border-b bg-popover/95 px-4 py-3 backdrop-blur">
          <SheetTitle>{chore ? t("editTitle") : t("newTitle")}</SheetTitle>
          <SheetDescription className="sr-only">{chore?.title ?? t("newTitle")}</SheetDescription>
        </SheetHeader>
        {open && <ChoreForm chore={chore} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function ChoreForm({ chore, onDone }: { chore: ChoreItem | null; onDone: () => void }) {
  const t = useTranslations("group.editor");
  const tc = useTranslations("common.actions");
  const group = useGroup();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const { completeChore, completingId } = useChoreActions();
  const dueText = useDueText();
  const now = useNow({ updateInterval: 30_000 });
  const tz = group.timezone;
  const [f, setF] = useState<FormState>(() => initialState(chore, tz));
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const activeMembers = group.members.filter((m) => !m.archivedAt || m.id === f.assigneeId);
  const sched = scheduleResult(f.preset);
  const needsMember = f.assigneeMode === "FIXED" && !f.assigneeId;
  const valid = f.title.trim().length > 0 && !sched.error && !needsMember;

  const onSaved = () => qc.invalidateQueries(trpc.groups.pathFilter());
  const create = useMutation(trpc.groups.chores.create.mutationOptions({ onSuccess: onSaved }));
  const update = useMutation(trpc.groups.chores.update.mutationOptions({ onSuccess: onSaved }));
  const archive = useMutation(trpc.groups.chores.setArchived.mutationOptions({ onSuccess: onSaved }));
  const saving = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const data = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      icon: f.icon,
      rrule: sched.rrule,
      startsAt: fromLocalInputValue(f.startsAt, tz),
      anchor: f.anchor,
      assigneeMode: f.assigneeMode,
      assigneeId: f.assigneeMode === "ANYONE" ? null : f.assigneeId,
      graceMinutes: f.graceMinutes,
    };
    try {
      if (chore) {
        await update.mutateAsync({ groupId: group.id, choreId: chore.id, patch: data, actor: actor() });
        toast.success(t("saved"));
      } else {
        await create.mutateAsync({ groupId: group.id, chore: data, actor: actor() });
        toast.success(t("createdToast", { title: data.title }));
      }
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function setArchived(archived: boolean) {
    if (!chore) return;
    try {
      await archive.mutateAsync({ groupId: group.id, choreId: chore.id, archived, actor: actor() });
      toast.success(t(archived ? "archivedToast" : "restoredToast", { title: chore.title }));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const graceOptions: number[] = GRACE_OPTIONS.includes(f.graceMinutes as (typeof GRACE_OPTIONS)[number])
    ? [...GRACE_OPTIONS]
    : [...GRACE_OPTIONS, f.graceMinutes].sort((a, b) => a - b);

  const due = chore ? dueText(chore, now, tz) : null;

  return (
    <div className="flex flex-col gap-5 p-4 pb-8">
      {chore && !chore.archivedAt && (
        <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
          <StatusBadge status={chore.schedule.status} />
          <span className="min-w-0 flex-1 truncate text-sm" title={due?.title} suppressHydrationWarning>
            {due?.text}
          </span>
          <Button
            type="button"
            size="lg"
            onClick={() => completeChore(chore.id)}
            disabled={completingId === chore.id}
          >
            {completingId === chore.id ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {t("doneNow")}
          </Button>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-5" id="chore-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chore-title">{t("title")}</Label>
          <div className="flex gap-2">
            <EmojiPicker value={f.icon} onChange={(icon) => set({ icon })} />
            <Input
              id="chore-title"
              value={f.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder={t("titlePlaceholder")}
              maxLength={100}
              required
              autoFocus={!chore}
              className="h-11 text-base"
            />
          </div>
        </div>

        <ScheduleEditor
          preset={f.preset}
          onPresetChange={(preset) =>
            set({ preset, ...(f.anchorTouched ? {} : { anchor: suggestedAnchor(preset) }) })
          }
          startsAt={f.startsAt}
          onStartsAtChange={(startsAt) => set({ startsAt })}
          timezone={tz}
        />

        {f.preset.kind !== "once" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t("anchor")}</legend>
            {(["DUE_DATE", "COMPLETION"] as const).map((a) => (
              <label
                key={a}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                  f.anchor === a ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="anchor"
                  className="mt-1 accent-primary"
                  checked={f.anchor === a}
                  onChange={() => set({ anchor: a, anchorTouched: true })}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {a === "DUE_DATE" ? t("anchorDueDate") : t("anchorCompletion")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a === "DUE_DATE" ? t("anchorDueDateHint") : t("anchorCompletionHint")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex flex-col gap-2">
          <Label>{t("assignee")}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={f.assigneeMode}
            onValueChange={(v) => v && set({ assigneeMode: v as AssigneeMode })}
            className="w-full"
          >
            {(["ANYONE", "FIXED", "ROUND_ROBIN"] as const).map((m) => (
              <ToggleGroupItem key={m} value={m} className="h-10 flex-1">
                {t(`assigneeModes.${m}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {f.assigneeMode !== "ANYONE" && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-sm text-muted-foreground">
                {f.assigneeMode === "FIXED" ? t("fixedMember") : t("rotationStart")}
              </span>
              <Select
                value={f.assigneeId ?? "__none"}
                onValueChange={(v) => set({ assigneeId: v === "__none" ? null : v })}
              >
                <SelectTrigger className={cn("h-10 flex-1", needsMember && "border-destructive")}>
                  <SelectValue placeholder={t("pickMember")} />
                </SelectTrigger>
                <SelectContent>
                  {f.assigneeMode === "ROUND_ROBIN" ? (
                    <SelectItem value="__none">{t("rotationAnyone")}</SelectItem>
                  ) : (
                    !f.assigneeId && (
                      <SelectItem value="__none" disabled>
                        {t("pickMember")}
                      </SelectItem>
                    )
                  )}
                  {activeMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <MemberAvatar member={m} size="xs" /> {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {(f.preset.kind !== "once" || f.startsAt) && (
          <div className="flex items-center gap-2">
            <Label className="w-28 shrink-0">{t("grace")}</Label>
            <Select value={String(f.graceMinutes)} onValueChange={(v) => set({ graceMinutes: Number(v) })}>
              <SelectTrigger className="h-10 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {graceOptions.map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    {t.has(`graceOptions.${g}` as never)
                      ? t(`graceOptions.${g}` as never)
                      : t("graceCustom", { minutes: g })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chore-description">{t("description")}</Label>
          <Textarea
            id="chore-description"
            value={f.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder={t("descriptionPlaceholder")}
            maxLength={2000}
            className="min-h-16"
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" className="h-11 flex-1" onClick={onDone}>
            {tc("cancel")}
          </Button>
          <Button type="submit" size="lg" className="h-11 flex-[2]" disabled={!valid || saving}>
            {saving && <Loader2Icon className="animate-spin" />}
            {saving ? t("saving") : chore ? t("save") : t("create")}
          </Button>
        </div>
      </form>

      {chore && (
        <>
          <Separator />
          <ChoreHistory choreId={chore.id} />
          <Separator />
          {chore.archivedAt ? (
            <Button variant="outline" onClick={() => setArchived(false)} disabled={archive.isPending}>
              <ArchiveRestoreIcon /> {t("restore")}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={archive.isPending}>
                  <ArchiveIcon /> {t("archive")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("archiveConfirmTitle", { title: chore.title })}</AlertDialogTitle>
                  <AlertDialogDescription>{t("archiveConfirmBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setArchived(true)}>{t("archive")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </>
      )}
    </div>
  );
}

function ChoreHistory({ choreId }: { choreId: string }) {
  const t = useTranslations("group.editor");
  const tc = useTranslations("common.actions");
  const group = useGroup();
  const trpc = useTRPC();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const { undoCompletion, undoingId } = useChoreActions();
  const q = useInfiniteQuery(
    trpc.groups.completions.list.infiniteQueryOptions(
      { groupId: group.id, choreId, limit: 10 },
      { getNextPageParam: (last) => last.nextCursor },
    ),
  );
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("history")}</h3>
      {q.isPending ? (
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((c) => {
            const m = c.memberId ? (group.members.find((x) => x.id === c.memberId) ?? c.member) : null;
            const undone = Boolean(c.undoneAt);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <MemberAvatar member={m} size="sm" />
                <div className={cn("flex min-w-0 flex-1 flex-col", undone && "opacity-60")}>
                  <span className={cn("truncate text-sm font-medium", undone && "line-through")}>
                    {m ? m.name : t("historyAnon")}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {t(`sources.${c.source}`)}</span>
                  </span>
                  <span
                    className="text-xs text-muted-foreground"
                    title={format.dateTime(c.completedAt, { timeZone: group.timezone, dateStyle: "full", timeStyle: "short" })}
                    suppressHydrationWarning
                  >
                    {format.relativeTime(c.completedAt, now)}
                    {undone && ` · ${t("historyUndone")}`}
                  </span>
                </div>
                {!undone && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => undoCompletion(c.id)}
                    disabled={undoingId === c.id}
                  >
                    {undoingId === c.id ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />}
                    {tc("undo")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {q.hasNextPage && (
        <Button variant="ghost" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
          {t("loadMore")}
        </Button>
      )}
    </section>
  );
}
