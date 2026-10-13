"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useNow, useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { ChoreCard } from "./chore-card";
import { ChoreSheet } from "./chore-sheet";
import { useGroup } from "./group-context";
import { useGroupIdentity } from "./group-shell";
import { MemberAvatar } from "./member-avatar";
import { useChoreActions } from "./use-chore-actions";

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
      {/* Suspense, not `if (!data)`: the prefetch may still be streaming
          during SSR, and rendering a placeholder there but the strip on the
          client is a hydration mismatch. */}
      <Suspense fallback={<div className="h-10" />}>
        <TalliesStrip />
      </Suspense>

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

/** Who has done how much this week: a compact strip of avatars and counts. */
function TalliesStrip() {
  const t = useTranslations("group.chores");
  const trpc = useTRPC();
  const group = useGroup();
  const { me } = useGroupIdentity();
  const { data } = useSuspenseQuery(trpc.groups.members.tallies.queryOptions({ groupId: group.id }));
  const byId = new Map(data.tallies.map((x) => [x.memberId, x.week]));
  const members = group.members.filter((m) => !m.archivedAt || (byId.get(m.id) ?? 0) > 0);
  if (members.length === 0) return null;
  const total = [...byId.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="flex items-center gap-3 overflow-x-auto rounded-xl bg-muted/50 px-3 py-2 [scrollbar-width:none]">
      <span className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("thisWeek")}</span>
      {total === 0 ? (
        <span className="text-sm text-muted-foreground">{t("statsEmpty")}</span>
      ) : (
        members
          .map((m) => ({ m, n: byId.get(m.id) ?? 0 }))
          .sort((a, b) => b.n - a.n)
          .map(({ m, n }) => (
            <span
              key={m.id}
              className={cn("flex shrink-0 items-center gap-1.5 text-sm", m.id === me?.id && "font-semibold")}
              title={m.name}
            >
              <MemberAvatar member={m} size="xs" />
              <span className="max-w-20 truncate">{m.name}</span>
              <span className="tabular-nums text-muted-foreground">{n}</span>
            </span>
          ))
      )}
    </div>
  );
}
