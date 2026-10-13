"use client";

import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { Loader2Icon, SmartphoneIcon } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { toWallClock } from "@/lib/schedule";
import { useTRPC } from "@/trpc/client";
import { useGroup } from "./group-context";
import { ACTIVITY_PAGE_SIZE } from "./constants";
import { MemberAvatar } from "./member-avatar";
import { shortDeviceId } from "./time";

type Data = Record<string, unknown> | null;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function ActivityView() {
  const t = useTranslations("group.activity");
  const trpc = useTRPC();
  const group = useGroup();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const q = useSuspenseInfiniteQuery(
    trpc.groups.activity.list.infiniteQueryOptions(
      { groupId: group.id, limit: ACTIVITY_PAGE_SIZE },
      { getNextPageParam: (last) => last.nextCursor },
    ),
  );
  const items = q.data.pages.flatMap((p) => p.items);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (items.length === 0) {
    return <p className="py-12 text-center text-muted-foreground">{t("empty")}</p>;
  }

  const members = new Map(group.members.map((m) => [m.id, m]));
  const dayKey = (d: Date) => toWallClock(d, group.timezone).toISOString().slice(0, 10);

  function message(type: string, data: Data, actorId: string | null) {
    const args = {
      title: str(data?.title),
      name: str(data?.name),
      from: str(data?.from),
      to: str(data?.to),
    };
    if (type === "member.created" && actorId && actorId === data?.memberId) return t("types.member.joined");
    const key = `types.${type}`;
    const loose = t as unknown as (k: string, v: Record<string, string>) => string;
    // Unknown types (e.g. added by another area later) fall back to the raw type.
    return t.has(key as never) ? loose(key, args) : type || t("types.unknown");
  }

  return (
    <div className="flex flex-col">
      <ol className="flex flex-col">
        {items.map((a, i) => {
          const data = (a.data && typeof a.data === "object" && !Array.isArray(a.data) ? a.data : null) as Data;
          const actor = a.memberId ? (members.get(a.memberId) ?? null) : null;
          const day = dayKey(a.createdAt);
          const header =
            i === 0 || dayKey(items[i - 1].createdAt) !== day ? (
              <li
                key={`d-${day}`}
                className="sticky top-[7.75rem] z-10 -mx-1 bg-background/95 px-1 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur"
              >
                {format.dateTime(a.createdAt, { timeZone: group.timezone, weekday: "long", day: "numeric", month: "long" })}
              </li>
            ) : null;
          const source = str(data?.source);
          const via = source && t.has(`via.${source}` as never) ? t(`via.${source}` as never) : "";
          const device = shortDeviceId(a.deviceId);
          return [
            header,
            <li key={a.id} className="flex items-start gap-3 border-b py-3 last:border-b-0">
              <MemberAvatar member={actor} size="md" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm">
                  <span className="font-semibold">{actor?.name ?? t("someone")}</span> {message(a.type, data, a.memberId)}
                  {via && <span className="text-muted-foreground"> {via}</span>}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <time
                    dateTime={a.createdAt.toISOString()}
                    title={format.dateTime(a.createdAt, { timeZone: group.timezone, dateStyle: "full", timeStyle: "medium" })}
                    suppressHydrationWarning
                  >
                    {format.relativeTime(a.createdAt, now)}
                  </time>
                  {device && (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <SmartphoneIcon className="size-3" />
                      {t("device", { id: device })}
                    </span>
                  )}
                </p>
              </div>
            </li>,
          ];
        })}
      </ol>
      <div ref={sentinel} className="flex justify-center py-4">
        {hasNextPage ? (
          <Button variant="ghost" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage && <Loader2Icon className="animate-spin" />}
            {t("loadMore")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t("end")}</span>
        )}
      </div>
    </div>
  );
}
