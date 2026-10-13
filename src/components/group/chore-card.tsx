"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ScheduleStatus } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import type { GroupMember } from "./group-context";
import { MemberAvatar } from "./member-avatar";
import { compactDuration } from "./time";
import { OPTIMISTIC_ID, type ChoreItem } from "./use-chore-actions";

/** Badge styles per status (work in light and dark mode). */
export const statusStyles: Record<ScheduleStatus, string> = {
  overdue: "bg-red-500/15 text-red-700 dark:text-red-300",
  due: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  upcoming: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  done: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  unscheduled: "bg-muted text-muted-foreground",
};

const accent: Record<ScheduleStatus, string> = {
  overdue: "before:bg-red-500",
  due: "before:bg-amber-500",
  upcoming: "before:bg-transparent",
  done: "before:bg-transparent",
  unscheduled: "before:bg-transparent",
};

/** Status pill. */
export function StatusBadge({ status, className }: { status: ScheduleStatus; className?: string }) {
  const t = useTranslations("common.status");
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.7rem] font-semibold tracking-wide uppercase",
        statusStyles[status],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}

/** "Due in 2 days" / "Overdue by 3h" / "Whenever", plus the absolute time as a title. */
export function useDueText() {
  const t = useTranslations("group.chores");
  const format = useFormatter();
  return (chore: ChoreItem, now: Date, timezone: string) => {
    const s = chore.schedule;
    if (s.lastCompletion?.id === OPTIMISTIC_ID) return { text: t("justDone"), title: undefined };
    if (!s.nextDueAt) return { text: s.status === "done" ? t("finished") : t("anyTime"), title: undefined };
    const title = format.dateTime(s.nextDueAt, {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    if (s.status === "overdue") {
      const d = compactDuration(now.getTime() - s.nextDueAt.getTime());
      return { text: t("overdueBy", d), title };
    }
    if (s.status === "due") return { text: t("dueAt", { when: format.relativeTime(s.nextDueAt, now) }), title };
    return { text: t("dueIn", { when: format.relativeTime(s.nextDueAt, now) }), title };
  };
}

export function ChoreCard({
  chore,
  members,
  timezone,
  now,
  onOpen,
  onDone,
  pending,
}: {
  chore: ChoreItem;
  members: readonly GroupMember[];
  timezone: string;
  now: Date;
  onOpen: () => void;
  onDone: () => void;
  pending: boolean;
}) {
  const t = useTranslations("group.chores");
  const format = useFormatter();
  const dueText = useDueText();
  const s = chore.schedule;
  const due = dueText(chore, now, timezone);
  const assignee = chore.currentAssigneeId ? members.find((m) => m.id === chore.currentAssigneeId) : null;
  const last = s.lastCompletion;
  const justDone = last?.id === OPTIMISTIC_ID;
  const lastMember = last?.memberId ? (members.find((m) => m.id === last.memberId) ?? last.member) : null;
  const archived = Boolean(chore.archivedAt);
  const urgent = s.status === "overdue" || s.status === "due";
  const finished = s.status === "done" && !s.recurring;

  return (
    <li
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-2xl border bg-card p-3 pl-4 transition-colors",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        accent[s.status],
        archived && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl" aria-hidden>
          {chore.icon || "🧹"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="line-clamp-2 font-medium break-words">{chore.title}</span>
            {archived ? (
              <span className="rounded-full bg-muted px-2 text-[0.7rem] text-muted-foreground">{t("archived")}</span>
            ) : (
              !justDone && <StatusBadge status={s.status} />
            )}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span
              title={due.title}
              suppressHydrationWarning
              className={cn(
                s.status === "overdue" && !justDone && "font-medium text-red-700 dark:text-red-300",
                justDone && "font-medium text-emerald-700 dark:text-emerald-300",
              )}
            >
              {due.text}
            </span>
            {s.missedCount > 0 && !justDone && (
              <span className="text-xs">({t("missed", { count: s.missedCount })})</span>
            )}
            {assignee && (
              <span className="inline-flex items-center gap-1">
                <MemberAvatar member={assignee} size="xs" />
                {t("turn", { name: assignee.name })}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
            {last
              ? lastMember
                ? t("lastDone", { when: format.relativeTime(last.completedAt, now), name: lastMember.name })
                : t("lastDoneAnon", { when: format.relativeTime(last.completedAt, now) })
              : t("neverDone")}
          </span>
        </span>
      </button>
      {!archived && (
        <button
          type="button"
          onClick={onDone}
          disabled={pending || justDone || finished}
          aria-label={t("markDone", { title: chore.title })}
          className={cn(
            "flex size-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full border-2 text-[0.65rem] font-semibold tracking-wide uppercase transition-all",
            "outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90 disabled:pointer-events-none",
            justDone || finished
              ? "border-emerald-500 bg-emerald-500 text-white"
              : urgent
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/85"
                : "border-border bg-background text-foreground hover:bg-muted",
          )}
        >
          {pending ? <Loader2Icon className="size-5 animate-spin" /> : <CheckIcon className="size-5" strokeWidth={3} />}
          {!justDone && !finished && <span>{t("done")}</span>}
        </button>
      )}
    </li>
  );
}
