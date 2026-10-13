"use client";

/**
 * Group context for everything under /groups/[groupId]. The layout puts the
 * group id here once, so pages and components don't need to read params.
 */
import { useSuspenseQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext } from "react";
import { getActor } from "@/lib/client/local-groups";
import { useTRPC } from "@/trpc/client";
import type { AppRouter } from "@/trpc/routers/_app";

const GroupIdContext = createContext<string | null>(null);

/** Provides the current group id to the group pages. */
export function GroupProvider({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  return <GroupIdContext.Provider value={groupId}>{children}</GroupIdContext.Provider>;
}

/** The current group's id (throws outside a GroupProvider). */
export function useGroupId(): string {
  const id = useContext(GroupIdContext);
  if (!id) throw new Error("useGroupId() must be used inside <GroupProvider>");
  return id;
}

/** The current group with its members (prefetched by the layout). */
export function useGroup() {
  const trpc = useTRPC();
  const groupId = useGroupId();
  return useSuspenseQuery(trpc.groups.get.queryOptions({ groupId })).data;
}

/** A group member as returned by groups.get. */
export type GroupMember = ReturnType<typeof useGroup>["members"][number];

/** Returns `() => actor` for mutation inputs (reads localStorage at call time). */
export function useActor() {
  const groupId = useGroupId();
  return useCallback(() => getActor(groupId), [groupId]);
}

/** Stable machine-readable reason of a tRPC error (e.g. "PIN_INVALID"), or null. */
export function errorReason(e: unknown): string | null {
  if (e instanceof TRPCClientError) {
    const data = (e as TRPCClientError<AppRouter>).data;
    return data?.reason ?? (data?.code === "BAD_REQUEST" ? "BAD_REQUEST" : null);
  }
  return null;
}

/** Translate a tRPC error into a user-facing message. */
export function useErrorMessage() {
  const t = useTranslations("group.errors");
  return useCallback(
    (e: unknown) => {
      const reason = errorReason(e);
      return reason && t.has(reason as never) ? t(reason as never) : t("generic");
    },
    [t],
  );
}
