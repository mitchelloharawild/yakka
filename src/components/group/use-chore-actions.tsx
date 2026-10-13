"use client";

/**
 * Complete / undo a chore from the group UI, with an optimistic list update,
 * a toast with Undo, and cache invalidation of everything under `groups`.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { compareSchedules } from "@/lib/schedule";
import { useTRPC } from "@/trpc/client";
import type { AppRouter } from "@/trpc/routers/_app";
import { useActor, useErrorMessage, useGroupId } from "./group-context";
import { useGroupIdentity } from "./group-shell";

type Outputs = inferRouterOutputs<AppRouter>;
/** A chore as listed on the dashboard (with schedule + current assignee). */
export type ChoreItem = Outputs["groups"]["chores"]["list"][number];
/** A completion as listed in chore history. */
export type CompletionItem = Outputs["groups"]["completions"]["list"]["items"][number];

/** Id used for the optimistic placeholder completion. */
export const OPTIMISTIC_ID = "optimistic";

function sortChores(list: ChoreItem[]) {
  return [...list].sort((a, b) => compareSchedules(a.schedule, b.schedule) || a.sortOrder - b.sortOrder);
}

export function useChoreActions() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const groupId = useGroupId();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const t = useTranslations("group.chores");
  const tc = useTranslations("common.actions");
  const { me, requestIdentity } = useGroupIdentity();

  const listFilter = trpc.groups.chores.list.queryFilter();
  const invalidateAll = useCallback(() => qc.invalidateQueries(trpc.groups.pathFilter()), [qc, trpc]);

  const undo = useMutation(
    trpc.groups.chores.undo.mutationOptions({
      onSuccess: (res) => {
        toast(t("undone"), { description: res.chore.title });
      },
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: invalidateAll,
    }),
  );

  const complete = useMutation(
    trpc.groups.chores.complete.mutationOptions({
      onMutate: async (vars) => {
        await qc.cancelQueries(listFilter);
        const snapshot = qc.getQueriesData<ChoreItem[]>(listFilter);
        const now = new Date();
        qc.setQueriesData<ChoreItem[]>(listFilter, (old) =>
          old?.map((c) =>
            c.id !== vars.choreId
              ? c
              : {
                  ...c,
                  schedule: {
                    ...c.schedule,
                    status: c.schedule.recurring ? "upcoming" : "done",
                    missedCount: 0,
                    lastCompletion: {
                      id: OPTIMISTIC_ID,
                      choreId: c.id,
                      memberId: vars.memberId ?? null,
                      source: "MANUAL",
                      tagId: null,
                      deviceId: vars.actor?.deviceId ?? null,
                      note: null,
                      completedAt: now,
                      createdAt: now,
                      undoneAt: null,
                      member: me && me.id === vars.memberId ? { id: me.id, name: me.name, colour: me.colour } : null,
                    },
                  },
                },
          ),
        );
        return { snapshot };
      },
      onError: (e, _vars, ctx) => {
        for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
        toast.error(errorMessage(e));
      },
      onSuccess: (res) => {
        qc.setQueriesData<ChoreItem[]>(listFilter, (old) =>
          old ? sortChores(old.map((c) => (c.id === res.chore.id ? { ...c, ...res.chore } : c))) : old,
        );
        const name = res.completion.member?.name;
        const msg = res.deduplicated
          ? t("alreadyDone")
          : name
            ? t("completedBy", { title: res.chore.title, name })
            : t("completed", { title: res.chore.title });
        toast.success(msg, {
          duration: 8000,
          action: {
            label: tc("undo"),
            onClick: () => undo.mutate({ groupId, completionId: res.completion.id, actor: actor() }),
          },
        });
      },
      onSettled: invalidateAll,
    }),
  );

  /** Complete as the current identity, asking "who are you?" first if needed. */
  const completeChore = useCallback(
    async (choreId: string) => {
      let memberId = me?.id ?? null;
      if (!memberId) {
        memberId = await requestIdentity();
        if (!memberId) return;
      }
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(15);
      complete.mutate({ groupId, choreId, memberId, actor: { ...actor(), memberId } });
    },
    [me, requestIdentity, complete, groupId, actor],
  );

  const undoCompletion = useCallback(
    (completionId: string) => undo.mutate({ groupId, completionId, actor: actor() }),
    [undo, groupId, actor],
  );

  return {
    completeChore,
    undoCompletion,
    completingId: complete.isPending ? complete.variables?.choreId : undefined,
    undoingId: undo.isPending ? undo.variables?.completionId : undefined,
  };
}
