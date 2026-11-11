"use client";

/** Bottom sheet to create or edit a chore, with its completion history. */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  GripVerticalIcon,
  ListChecksIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useRef, useState } from "react";
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
import { currentAssigneeId, rotationOrderAll } from "@/lib/assignee";
import { CHECKLIST_ITEM_MAX, CHECKLIST_MAX_ITEMS } from "@/lib/checklist";
import { ADAPTIVE_MIN_GAPS, startOfLocalDay } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { StatusBadge, useDueText } from "./chore-card";
import { EmojiPicker } from "./emoji-picker";
import { useActor, useErrorMessage, useGroup, type GroupMember } from "./group-context";
import { MemberAvatar } from "./member-avatar";
import { alignedStartsAt, ScheduleEditor, scheduleResult } from "./schedule-editor";
import { parseRRule, type SchedulePreset } from "./schedule-presets";
import { approxDuration, fromLocalInputValue, toLocalInputValue, weekdayIn } from "./time";
import { useChoreActions, type ChoreItem } from "./use-chore-actions";

const GRACE_OPTIONS = [0, 30, 60, 120, 360, 720, 1440, 2880, 10080] as const;
type AssigneeMode = ChoreItem["assigneeMode"];
type Anchor = ChoreItem["anchor"];

interface FormState {
  title: string;
  description: string;
  icon: string | null;
  checklist: string[];
  preset: SchedulePreset;
  startsAt: string;
  anchor: Anchor;
  anchorTouched: boolean;
  assigneeMode: AssigneeMode;
  assigneeId: string | null;
  /** Every member id (archived included) in round-robin order. */
  rotation: string[];
  graceMinutes: number;
}

/**
 * The rotation as the editor shows it: the chore's order, turned so that its
 * "starts with" member (if any) is first. A rotation is cyclic, so this
 * doesn't change who follows whom, and the list's top person is who starts.
 */
function initialRotation(chore: ChoreItem | null, members: GroupMember[]): string[] {
  const all = rotationOrderAll(members, chore?.rotation);
  const start = chore?.assigneeMode === "ROUND_ROBIN" ? chore.assigneeId : null;
  const i = all.findIndex((m) => m.id === start && !m.archivedAt);
  const ids = all.map((m) => m.id);
  return i > 0 ? [...ids.slice(i), ...ids.slice(0, i)] : ids;
}

function initialState(chore: ChoreItem | null, timezone: string, members: GroupMember[]): FormState {
  const now = new Date();
  if (chore) {
    const preset = parseRRule(chore.rrule);
    // A recurring chore without a start runs from 00:00 on the day it was created.
    const start = chore.startsAt ?? (chore.rrule ? startOfLocalDay(chore.createdAt, timezone) : null);
    return {
      title: chore.title,
      description: chore.description ?? "",
      icon: chore.icon,
      checklist: chore.checklist,
      preset,
      startsAt: start ? alignedStartsAt(preset, toLocalInputValue(start, timezone), timezone, { isNew: false, now }) : "",
      anchor: chore.anchor,
      anchorTouched: true,
      assigneeMode: chore.assigneeMode,
      assigneeId: chore.assigneeId,
      rotation: initialRotation(chore, members),
      graceMinutes: chore.graceMinutes,
    };
  }
  // New chore: weekly on today's weekday, 09:00 local (next week's if that has passed).
  const today = toLocalInputValue(now, timezone).slice(0, 10);
  const preset: SchedulePreset = { kind: "weekly", interval: 1, weekdays: [weekdayIn(now, timezone)] };
  return {
    title: "",
    description: "",
    icon: null,
    checklist: [],
    preset,
    startsAt: alignedStartsAt(preset, `${today}T09:00`, timezone, { isNew: true, now }),
    anchor: "DUE_DATE",
    anchorTouched: false,
    assigneeMode: "ANYONE",
    assigneeId: null,
    rotation: initialRotation(null, members),
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
  const [f, setF] = useState<FormState>(() => initialState(chore, tz, group.members));
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

  // Editing the schedule of an existing chore: preview where its next due date moves to.
  const startsAtDate = fromLocalInputValue(f.startsAt, tz);
  const scheduleEdited =
    chore !== null &&
    !sched.error &&
    (sched.rrule !== chore.rrule ||
      (startsAtDate?.getTime() ?? null) !== (chore.startsAt?.getTime() ?? null) ||
      f.anchor !== chore.anchor ||
      f.graceMinutes !== chore.graceMinutes);
  const preview = useQuery({
    ...trpc.groups.chores.previewSchedule.queryOptions({
      groupId: group.id,
      choreId: chore?.id ?? "",
      patch: { rrule: sched.rrule, startsAt: startsAtDate, anchor: f.anchor, graceMinutes: f.graceMinutes },
    }),
    enabled: scheduleEdited,
    placeholderData: keepPreviousData,
  });
  const moved =
    scheduleEdited && preview.data && preview.data.before.nextDueAt?.getTime() !== preview.data.after.nextDueAt?.getTime()
      ? preview.data
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const data = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      icon: f.icon,
      checklist: f.checklist.map((i) => i.trim()).filter(Boolean),
      rrule: sched.rrule,
      startsAt: fromLocalInputValue(f.startsAt, tz),
      anchor: f.anchor,
      assigneeMode: f.assigneeMode,
      // Round-robin starts with the top of the rotation list, so it needs no separate start.
      assigneeId: f.assigneeMode === "FIXED" ? f.assigneeId : null,
      rotation: f.assigneeMode === "ROUND_ROBIN" ? f.rotation : undefined,
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
  const format = useFormatter();
  const dueWhen = (d: Date | null) =>
    d
      ? format.dateTime(d, { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
      : t("scheduleChangeNone");

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
          isNew={!chore}
        />

        {(f.preset.kind !== "once" || f.anchor === "ADAPTIVE") && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t("anchor")}</legend>
            {(["DUE_DATE", "COMPLETION", "ADAPTIVE"] as const).map((a) => (
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
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {t(`anchors.${a}`)}
                    {a === "ADAPTIVE" && <SparklesIcon className="size-3.5 text-primary" aria-hidden />}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(`anchors.${a}Hint`)}</span>
                  {a === "ADAPTIVE" && f.anchor === "ADAPTIVE" && chore?.anchor === "ADAPTIVE" && (
                    <AdaptiveSummary chore={chore} />
                  )}
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
          {f.assigneeMode === "FIXED" && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-sm text-muted-foreground">{t("fixedMember")}</span>
              <Select
                value={f.assigneeId ?? "__none"}
                onValueChange={(v) => set({ assigneeId: v === "__none" ? null : v })}
              >
                <SelectTrigger className={cn("h-10 flex-1", needsMember && "border-destructive")}>
                  <SelectValue placeholder={t("pickMember")} />
                </SelectTrigger>
                <SelectContent>
                  {!f.assigneeId && (
                    <SelectItem value="__none" disabled>
                      {t("pickMember")}
                    </SelectItem>
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
          {f.assigneeMode === "ROUND_ROBIN" && (
            <RotationEditor
              rotation={f.rotation}
              onChange={(rotation) => set({ rotation })}
              lastCompletedBy={chore ? (chore.schedule.lastCompletion?.memberId ?? null) : undefined}
            />
          )}
        </div>

        {(f.preset.kind !== "once" || f.startsAt) && (
          <div className="flex items-center gap-2">
            <Label className="w-28 shrink-0">{f.anchor === "ADAPTIVE" ? t("graceAdaptive") : t("grace")}</Label>
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

        <ChecklistEditor items={f.checklist} onChange={(checklist) => set({ checklist })} />

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

        {moved && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" role="status">
            {t("scheduleChange", { from: dueWhen(moved.before.nextDueAt), to: dueWhen(moved.after.nextDueAt) })}
          </p>
        )}

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

/** Optional sub-tasks; a tag scan shows them and completes the chore once all are ticked. */
function ChecklistEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const t = useTranslations("group.editor");
  const [draft, setDraft] = useState("");
  const full = items.length >= CHECKLIST_MAX_ITEMS;

  const add = () => {
    const item = draft.trim();
    if (!item || full) return;
    onChange([...items, item]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="chore-checklist-new" className="flex items-center gap-1.5">
        <ListChecksIcon className="size-4" aria-hidden />
        {t("checklist")}
      </Label>
      <p className="text-xs text-muted-foreground">{t("checklistHint")}</p>
      {items.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <Input
                value={item}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                maxLength={CHECKLIST_ITEM_MAX}
                aria-label={t("checklistItem", { n: i + 1 })}
                className="h-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={t("checklistRemove", { item })}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {!full && (
        <div className="flex items-center gap-2">
          <Input
            id="chore-checklist-new"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the item instead of submitting the form.
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={items.length ? t("checklistPlaceholderMore") : t("checklistPlaceholder")}
            maxLength={CHECKLIST_ITEM_MAX}
            className="h-10"
          />
          <Button type="button" variant="outline" size="icon" onClick={add} disabled={!draft.trim()} aria-label={t("checklistAdd")}>
            <PlusIcon />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Round-robin order: drag a row by its handle (mouse or touch), or focus the
 * handle and use the arrow keys. Only active members are listed; archived
 * members keep their (hidden) slot in `rotation`.
 */
function RotationEditor({
  rotation,
  onChange,
  lastCompletedBy,
}: {
  rotation: string[];
  onChange: (rotation: string[]) => void;
  /** Who did the existing chore last (marks who is next); undefined for a new chore. */
  lastCompletedBy?: string | null;
}) {
  const t = useTranslations("group.editor");
  const group = useGroup();
  const listRef = useRef<HTMLOListElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(group.members.map((m) => [m.id, m]));
  const active = rotation.map((id) => byId.get(id)).filter((m): m is GroupMember => !!m && !m.archivedAt);
  const nextId =
    lastCompletedBy === undefined
      ? null
      : currentAssigneeId({
          chore: { assigneeMode: "ROUND_ROBIN", assigneeId: null, rotation: rotation.join(",") },
          members: group.members,
          lastCompletedBy,
        });

  /** Move the active member `id` to position `to` among the active members. */
  const move = (id: string, to: number) => {
    const ids = active.map((m) => m.id);
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    let k = 0;
    const isActive = new Set(ids);
    onChange(rotation.map((x) => (isActive.has(x) ? ids[k++] : x)));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId || !listRef.current) return;
    const rows = [...listRef.current.children] as HTMLElement[];
    const over = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY < r.bottom;
    });
    if (over >= 0) move(dragId, over);
    else if (rows.length && e.clientY < rows[0].getBoundingClientRect().top) move(dragId, 0);
    else if (rows.length && e.clientY >= rows[rows.length - 1].getBoundingClientRect().bottom) move(dragId, rows.length - 1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: string, i: number) => {
    const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? active.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    move(id, to);
    // Reordering can move the focused node in the DOM; keep focus on the handle.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-member="${id}"]`)?.focus());
  };

  if (active.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">{t("rotationHint")}</p>
      <ol ref={listRef} className="flex flex-col gap-1.5">
        {active.map((m, i) => (
          <li
            key={m.id}
            className={cn(
              "flex h-11 items-center gap-2 rounded-xl border bg-background pr-3 transition-shadow",
              dragId === m.id && "relative z-10 border-primary shadow-md",
            )}
          >
            <button
              type="button"
              data-member={m.id}
              className="flex h-full cursor-grab touch-none items-center pl-2 text-muted-foreground active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-ring rounded-l-xl"
              aria-label={t("rotationMove", { name: m.name, position: i + 1, count: active.length })}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragId(m.id);
              }}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDragId(null)}
              onPointerCancel={() => setDragId(null)}
              onKeyDown={(e) => onKeyDown(e, m.id, i)}
            >
              <GripVerticalIcon className="size-4" aria-hidden />
            </button>
            <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <MemberAvatar member={m} size="xs" />
            <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
            {m.id === nextId && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t("rotationNext")}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** What an adaptive chore has learnt so far, e.g. "Usually every 4 days, overdue after 6". */
function AdaptiveSummary({ chore }: { chore: ChoreItem }) {
  const t = useTranslations("group.editor");
  const format = useFormatter();
  const a = chore.schedule.adaptive;
  if (!a) return null;
  const duration = (ms: number) => {
    const { value, unit } = approxDuration(ms);
    return format.number(value, { style: "unit", unit, unitDisplay: "long", maximumFractionDigits: 1 });
  };
  return (
    <span className="mt-1.5 text-xs font-medium text-foreground">
      {a.learned && a.dueAfterMs !== null && a.overdueAfterMs !== null
        ? t("adaptiveLearned", { due: duration(a.dueAfterMs), overdue: duration(a.overdueAfterMs), gaps: a.gaps })
        : t("adaptiveLearning", { gaps: a.gaps, needed: ADAPTIVE_MIN_GAPS })}
    </span>
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
