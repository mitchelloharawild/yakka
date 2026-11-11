"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { ChoreCard, useDueText } from "./chore-card";
import { ChoreSheet } from "./chore-sheet";
import { useGroup } from "./group-context";
import { useGroupIdentity } from "./group-shell";
import { OPTIMISTIC_ID, useChoreActions, type ChoreItem } from "./use-chore-actions";

/** The chores dashboard (default group tab). */
export function ChoresView() {
  const t = useTranslations("group.chores");
  const trpc = useTRPC();
  const group = useGroup();
  const now = useNow({ updateInterval: 30_000 });
  const [showArchived, setShowArchived] = useState(false);
  const { data: active } = useSuspenseQuery(trpc.groups.chores.list.queryOptions({ groupId: group.id }));
  const archivedQ = useQuery({
    ...trpc.groups.chores.list.queryOptions({ groupId: group.id, includeArchived: true }),
    enabled: showArchived,
  });
  const archived = (archivedQ.data ?? []).filter((c) => c.archivedAt);
  const { completeChore, completingId } = useChoreActions();
  const [sheet, setSheet] = useState<{ open: boolean; choreId: string | null }>({ open: false, choreId: null });
  const all = [...active, ...archived];
  const selected = sheet.choreId ? (all.find((c) => c.id === sheet.choreId) ?? null) : null;

  const openChore = (choreId: string | null) => setSheet({ open: true, choreId });

  return (
    <div className="flex flex-col gap-4">
      <MyChores chores={active} now={now} onOpen={openChore} onDone={completeChore} completingId={completingId} />

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <span className="text-5xl" aria-hidden>
            🧹
          </span>
          <h2 className="font-heading text-lg font-semibold">{t("emptyTitle")}</h2>
          <p className="max-w-xs text-sm text-muted-foreground">{t("emptyBody")}</p>
          <Button size="lg" className="mt-2 h-11" onClick={() => openChore(null)}>
            <PlusIcon /> {t("new")}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((c) => (
            <ChoreCard
              key={c.id}
              chore={c}
              members={group.members}
              timezone={group.timezone}
              now={now}
              onOpen={() => openChore(c.id)}
              onDone={() => completeChore(c.id)}
              pending={completingId === c.id}
            />
          ))}
        </ul>
      )}

      {showArchived && archived.length > 0 && (
        <ul className="flex flex-col gap-2">
          {archived.map((c) => (
            <ChoreCard
              key={c.id}
              chore={c}
              members={group.members}
              timezone={group.timezone}
              now={now}
              onOpen={() => openChore(c.id)}
              onDone={() => {}}
              pending={false}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? t("hideArchived") : t("showArchived")}
        </Button>
      </div>

      {active.length > 0 && (
        <Button
          size="lg"
          onClick={() => openChore(null)}
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-14 rounded-full px-5 text-base shadow-lg sm:right-[max(1rem,calc((100vw-48rem)/2+1rem))]"
        >
          <PlusIcon className="size-5" /> {t("new")}
        </Button>
      )}

      <ChoreSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        chore={selected}
      />
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The active member's chores due within the next week (or overdue) that aren't ticked off yet. */
function MyChores({
  chores,
  now,
  onOpen,
  onDone,
  completingId,
}: {
  chores: readonly ChoreItem[];
  now: Date;
  onOpen: (id: string) => void;
  onDone: (id: string) => void;
  completingId: string | null | undefined;
}) {
  const t = useTranslations("group.chores");
  const group = useGroup();
  const { me } = useGroupIdentity();
  const dueText = useDueText();
  if (!me) return null;
  const horizon = now.getTime() + WEEK_MS;
  const mine = chores
    .filter((c) => {
      const s = c.schedule;
      if (c.archivedAt || !s.nextDueAt || s.status === "done" || s.status === "unscheduled") return false;
      if (s.lastCompletion?.id === OPTIMISTIC_ID) return false;
      if (c.currentAssigneeId && c.currentAssigneeId !== me.id) return false;
      return s.nextDueAt.getTime() <= horizon;
    })
    .sort((a, b) => a.schedule.nextDueAt!.getTime() - b.schedule.nextDueAt!.getTime());

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t("mineTitle", { name: me.name })}
      </h2>
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("mineEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {mine.map((c) => {
            const due = dueText(c, now, group.timezone);
            const overdue = c.schedule.status === "overdue";
            return (
              <li key={c.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="text-xl" aria-hidden>
                    {c.icon || "🧹"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.title}</span>
                    <span
                      title={due.title}
                      suppressHydrationWarning
                      className={cn(
                        "block text-xs text-muted-foreground",
                        overdue && "font-medium text-red-700 dark:text-red-300",
                      )}
                    >
                      {due.text}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDone(c.id)}
                  disabled={completingId === c.id}
                  aria-label={t("markDone", { title: c.title })}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 bg-background outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90 disabled:pointer-events-none"
                >
                  {completingId === c.id ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <CheckIcon className="size-4" strokeWidth={3} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
