"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, NfcIcon, PlusIcon, RepeatIcon, ShieldCheckIcon, StarIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useNow, useTranslations, useFormatter } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  importLocalData,
  removeLocalGroup,
  renameLocalGroup,
  setStarred,
  sortLocalGroups,
  useHydrated,
  useLocalGroups,
  type LocalGroup,
} from "@/lib/client/local-groups";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** Home page: pitch, create CTA and the groups remembered on this device. */
export function HomeView() {
  const t = useTranslations("group.home");
  const hydrated = useHydrated();
  const groups = sortLocalGroups(useLocalGroups());

  return (
    <div className="flex flex-col gap-8 pb-8">
      <section className="flex flex-col gap-4 pt-4 sm:pt-8">
        <span className="text-xs font-semibold tracking-widest text-primary uppercase">{t("eyebrow")}</span>
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="max-w-prose text-lg text-muted-foreground">{t("pitch")}</p>
        <div>
          <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
            <Link href="/groups/create">
              <PlusIcon className="size-5" /> {t("createGroup")}
            </Link>
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">{t("yourGroups")}</h2>
        {!hydrated ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center">
            <span className="text-4xl" aria-hidden>
              🏠
            </span>
            <p className="font-medium">{t("emptyTitle")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("emptyBody")}</p>
          </div>
        ) : (
          <GroupList groups={groups} />
        )}
      </section>

      <InstallPrompt />

      <section className="grid gap-3 sm:grid-cols-3">
        <Feature icon={<NfcIcon className="size-5" />} title={t("features.tapTitle")} body={t("features.tapBody")} />
        <Feature icon={<RepeatIcon className="size-5" />} title={t("features.fairTitle")} body={t("features.fairBody")} />
        <Feature
          icon={<ShieldCheckIcon className="size-5" />}
          title={t("features.privateTitle")}
          body={t("features.privateBody")}
        />
      </section>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl bg-muted/50 p-4">
      <span className="inline-flex size-9 items-center justify-center rounded-xl bg-background text-primary">{icon}</span>
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function GroupList({ groups }: { groups: LocalGroup[] }) {
  const t = useTranslations("group.home");
  const tc = useTranslations("common.actions");
  const trpc = useTRPC();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const ids = groups.map((g) => g.id);
  const { data: server } = useQuery({
    ...trpc.groups.getMany.queryOptions({ groupIds: ids.slice(0, 100) }),
    enabled: ids.length > 0,
  });
  const byId = server ? new Map(server.map((g) => [g.id, g])) : null;

  // Keep locally cached names in sync with the server.
  useEffect(() => {
    for (const g of server ?? []) {
      const local = groups.find((x) => x.id === g.id);
      if (local && local.name !== g.name) renameLocalGroup(g.id, g.name);
    }
  }, [server, groups]);

  function remove(g: LocalGroup) {
    const backup = JSON.stringify({ version: 1, groups: [g] });
    removeLocalGroup(g.id);
    toast(t("removed", { name: g.name || t("unnamed") }), {
      action: { label: tc("undo"), onClick: () => importLocalData(backup, "merge") },
    });
  }

  return (
    <ul className="flex flex-col gap-2">
      {groups.map((g) => {
        const unavailable = byId !== null && !byId.has(g.id);
        return (
          <li key={g.id} className={cn("flex items-center gap-1 rounded-2xl border bg-card pr-1", unavailable && "opacity-60")}>
            <Link href={`/groups/${g.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3 hover:bg-muted/40">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-heading text-lg font-semibold text-primary">
                {(g.name || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{g.name || t("unnamed")}</span>
                <span className="text-xs text-muted-foreground">
                  {unavailable
                    ? t("unavailable")
                    : g.lastOpened
                      ? t("openedAgo", { when: format.relativeTime(g.lastOpened, now) })
                      : t("neverOpened")}
                </span>
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={g.starred ? t("unstar") : t("star")}
              aria-pressed={g.starred}
              onClick={() => setStarred(g.id, !g.starred)}
            >
              <StarIcon className={cn(g.starred && "fill-amber-400 text-amber-500")} />
            </Button>
            <Button variant="ghost" size="icon-lg" aria-label={t("remove")} onClick={() => remove(g)}>
              <XIcon />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
