"use client";

/**
 * Client side of /t/{token} (docs/ARCHITECTURE.md §3).
 *
 * The server only renders a read-only shell; NOTHING is recorded on GET.
 * Here, once the page is actually visible to a person (not prerendered,
 * not a background tab), we:
 *
 *  0. if the chore has a checklist, show it first: nothing is recorded until
 *     the person taps "Tick it off", ticked or not (ticks are kept
 *     in sessionStorage so a reload mid-chore doesn't lose them), then
 *  1. match the tag's group fingerprint against the group ids this browser
 *     holds (src/lib/tags.ts), then
 *  2. identity known → POST tags.complete straight away;
 *     no identity → "Who are you?" (one tap = pick + complete);
 *     joinFromTag off and group unknown → "Open the group link first".
 *
 * Identity storage: if the browser holds the group id, the choice goes into
 * local-groups.ts (setIdentity) and the group is touched in recents. If it
 * doesn't, the choice is stored by fingerprint (tag-identity.ts) and the
 * group is NOT added to recents, because the tag never reveals the group id.
 */
import { TRPCClientError } from "@trpc/client";
import { Check, Loader2, Undo2, WifiOff } from "lucide-react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { IdentityPicker } from "@/components/identity-picker";
import { BigCheck } from "@/components/tag/big-check";
import { resolveTagContext, setTagIdentity, type TagContext } from "@/components/tag/tag-identity";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getDeviceId, setIdentity, touchGroup } from "@/lib/client/local-groups";
import { isNetworkError } from "@/lib/client/network-error";
import { enqueueCompletion } from "@/lib/client/offline-queue";
import type { ResolvedTag, TagCompletionResult, TagMember } from "@/lib/services/tags";
import { cn } from "@/lib/utils";
import { useTRPCClient } from "@/trpc/client";

type Phase =
  | { kind: "init" }
  | { kind: "checklist" }
  | { kind: "completing" }
  | { kind: "pick"; members: TagMember[] | null; canCreate: boolean }
  | { kind: "needsLink" }
  | { kind: "done"; result: TagCompletionResult; memberName: string | null; groupId: string | null; undoDeadline: number }
  | { kind: "undoing"; result: TagCompletionResult; memberName: string | null; groupId: string | null }
  | { kind: "undone" }
  | { kind: "offline" }
  | { kind: "error"; reason: string | null; retry: boolean };

/** Reasons after which the stored identity is stale and the picker should be shown. */
const STALE_IDENTITY = new Set(["MEMBER_NOT_FOUND", "MEMBER_ARCHIVED"]);
/** Reasons that mean the tag itself is unusable. */
const FATAL = new Set(["TAG_NOT_FOUND", "TAG_REVOKED", "CHORE_ARCHIVED", "GROUP_MISMATCH"]);

function reasonOf(err: unknown): string | null {
  if (err instanceof TRPCClientError) {
    const data = err.data as { reason?: string | null } | undefined;
    return data?.reason ?? null;
  }
  return null;
}

/** Resolves once the page is really in front of a person (not prerendering, not hidden). */
function whenVisible(): Promise<void> {
  return new Promise((resolve) => {
    const doc = document as Document & { prerendering?: boolean };
    const ready = () => !doc.prerendering && doc.visibilityState === "visible";
    if (ready()) return resolve();
    const check = () => {
      if (!ready()) return;
      doc.removeEventListener("visibilitychange", check);
      doc.removeEventListener("prerenderingchange", check);
      resolve();
    };
    doc.addEventListener("visibilitychange", check);
    doc.addEventListener("prerenderingchange", check);
  });
}

export function TagTap({ token, initial }: { token: string; initial: ResolvedTag }) {
  const t = useTranslations("tag");
  const client = useTRPCClient();
  const [phase, setPhase] = useState<Phase>({ kind: "init" });
  const ctxRef = useRef<TagContext | null>(null);
  const started = useRef(false);
  const fingerprint = initial.group.fingerprint;

  const forgetIdentity = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx?.groupId) setIdentity(ctx.groupId, null);
    setTagIdentity(fingerprint, null);
    if (ctx) ctx.memberId = null;
  }, [fingerprint]);

  const showPicker = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx?.groupId && !initial.group.joinFromTag) return setPhase({ kind: "needsLink" });
    if (initial.members && !ctx?.groupId) {
      return setPhase({ kind: "pick", members: initial.members, canCreate: true });
    }
    setPhase({ kind: "pick", members: null, canCreate: true });
    try {
      const res = await client.tags.resolve.query({ token, groupId: ctx?.groupId ?? null });
      setPhase({ kind: "pick", members: res.members ?? [], canCreate: true });
    } catch (err) {
      setPhase({ kind: "error", reason: reasonOf(err), retry: !FATAL.has(reasonOf(err) ?? "") });
    }
  }, [client, initial.group.joinFromTag, initial.members, token]);

  const complete = useCallback(
    async (memberId: string, memberName: string | null) => {
      const ctx = ctxRef.current;
      const deviceId = getDeviceId();
      const completedAt = new Date();
      setPhase({ kind: "completing" });
      try {
        const result = await client.tags.complete.mutate({
          token,
          memberId,
          deviceId,
          groupId: ctx?.groupId ?? null,
          completedAt,
        });
        if (ctx?.groupId) touchGroup({ id: ctx.groupId, name: initial.group.name });
        setPhase({
          kind: "done",
          result,
          memberName: memberName ?? result.completion.member?.name ?? null,
          groupId: ctx?.groupId ?? null,
          undoDeadline: Date.now() + (result.undoable ? result.undoRemainingMs : 0),
        });
      } catch (err) {
        if (isNetworkError(err)) {
          await enqueueCompletion({ token, memberId, deviceId, completedAt: completedAt.toISOString() });
          return setPhase({ kind: "offline" });
        }
        const reason = reasonOf(err);
        if (reason && STALE_IDENTITY.has(reason)) {
          forgetIdentity();
          return showPicker();
        }
        setPhase({ kind: "error", reason, retry: !FATAL.has(reason ?? "") });
      }
    },
    [client, forgetIdentity, initial.group.name, showPicker, token],
  );

  const start = useCallback(() => {
    const ctx = resolveTagContext(fingerprint);
    ctxRef.current = ctx;
    if (ctx.memberId) {
      const known = initial.members?.find((m) => m.id === ctx.memberId);
      void complete(ctx.memberId, known?.name ?? null);
    } else {
      void showPicker();
    }
  }, [complete, fingerprint, initial.members, showPicker]);

  useEffect(() => {
    // `started` is set only when we actually run, and never reset: StrictMode's
    // double effects, dependency changes and <Activity> re-shows must not
    // complete twice.
    if (started.current) return;
    let cancelled = false;
    void whenVisible().then(() => {
      if (cancelled || started.current) return;
      started.current = true;
      if (initial.chore.archived) setPhase({ kind: "error", reason: "CHORE_ARCHIVED", retry: false });
      else if (initial.chore.checklist.length > 0) setPhase({ kind: "checklist" });
      else start();
    });
    return () => {
      cancelled = true;
    };
  }, [initial.chore.archived, initial.chore.checklist.length, start]);

  const finishChecklist = () => {
    clearChecklistTicks(token);
    start();
  };

  const pick = (m: TagMember) => {
    const ctx = ctxRef.current;
    if (ctx?.groupId) setIdentity(ctx.groupId, m.id, initial.group.name);
    else setTagIdentity(fingerprint, m.id);
    if (ctx) ctx.memberId = m.id;
    void complete(m.id, m.name);
  };

  const create = async (name: string) => {
    const ctx = ctxRef.current;
    setPhase({ kind: "completing" });
    try {
      const m = await client.tags.createMember.mutate({
        token,
        name,
        deviceId: getDeviceId(),
        groupId: ctx?.groupId ?? null,
      });
      pick(m);
    } catch (err) {
      setPhase({ kind: "error", reason: reasonOf(err), retry: true });
    }
  };

  const undo = async (p: Extract<Phase, { kind: "done" }>, thenPick = false) => {
    setPhase({ kind: "undoing", result: p.result, memberName: p.memberName, groupId: p.groupId });
    try {
      await client.tags.undo.mutate({ token, completionId: p.result.completion.id, deviceId: getDeviceId() });
      if (thenPick) {
        forgetIdentity();
        return showPicker();
      }
      setPhase({ kind: "undone" });
    } catch (err) {
      setPhase({ kind: "error", reason: reasonOf(err), retry: false });
    }
  };

  const retry = () => {
    const memberId = ctxRef.current?.memberId;
    if (memberId) void complete(memberId, null);
    else void showPicker();
  };

  switch (phase.kind) {
    case "init":
    case "completing":
      return (
        <Centered>
          <Loader2 className="size-12 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground" role="status">
            {phase.kind === "init" ? t("tap.loading") : t("tap.recording")}
          </p>
        </Centered>
      );
    case "checklist":
      return <ChecklistView token={token} items={initial.chore.checklist} onDone={finishChecklist} />;
    case "pick":
      return phase.members === null ? (
        <Centered>
          <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />
        </Centered>
      ) : (
        <WhoAreYou
          members={phase.members}
          onPick={pick}
          onCreate={phase.canCreate ? (name) => void create(name) : undefined}
        />
      );
    case "needsLink":
      return (
        <Centered>
          <h2 className="font-heading text-2xl font-semibold">{t("needsLink.title")}</h2>
          <p className="max-w-prose text-muted-foreground">{t("needsLink.body", { group: initial.group.name })}</p>
        </Centered>
      );
    case "done":
    case "undoing":
      return (
        <DoneView
          phase={phase}
          timezone={initial.group.timezone}
          groupId={phase.groupId}
          onUndo={(thenPick) => phase.kind === "done" && void undo(phase, thenPick)}
        />
      );
    case "undone":
      return (
        <Centered>
          <BigCheck muted />
          <p className="text-lg">{t("tap.undone")}</p>
          <Button size="lg" className="h-12 px-6 text-base" onClick={retry}>
            {t("tap.doAgain")}
          </Button>
        </Centered>
      );
    case "offline":
      return (
        <Centered>
          <BigCheck muted />
          <h2 className="flex items-center gap-2 font-heading text-2xl font-semibold">
            <WifiOff className="size-6" aria-hidden />
            {t("tap.offlineTitle")}
          </h2>
          <p className="text-muted-foreground">{t("tap.offlineBody")}</p>
        </Centered>
      );
    case "error": {
      const known = phase.reason && phase.reason in ERROR_KEYS;
      return (
        <Centered>
          <h2 className="font-heading text-2xl font-semibold">{t("tap.failed")}</h2>
          <p className="max-w-prose text-muted-foreground">
            {known ? t(`errors.${phase.reason as keyof typeof ERROR_KEYS}`) : t("errors.generic")}
          </p>
          {phase.retry && (
            <Button size="lg" className="h-12 px-6 text-base" onClick={retry}>
              {t("tap.retry")}
            </Button>
          )}
        </Centered>
      );
    }
  }
}

const ERROR_KEYS = {
  TAG_NOT_FOUND: 1,
  TAG_REVOKED: 1,
  CHORE_ARCHIVED: 1,
  GROUP_MISMATCH: 1,
  JOIN_FROM_TAG_DISABLED: 1,
  UNDO_NOT_ALLOWED: 1,
  UNDO_WINDOW_EXPIRED: 1,
  MEMBER_ARCHIVED: 1,
  MEMBER_NOT_FOUND: 1,
} as const;

/** "Who are you?" for a tag: one tap on a chip picks the identity AND completes. */
function WhoAreYou({
  members,
  onPick,
  onCreate,
}: {
  members: TagMember[];
  onPick: (member: TagMember) => void;
  onCreate?: (name: string) => void;
}) {
  const t = useTranslations("tag.who");
  return (
    <div className="flex w-full flex-col gap-4">
      {members.length > 0 && (
        <div className="text-center">
          <h2 className="font-heading text-2xl font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      )}
      <IdentityPicker
        members={members}
        size="lg"
        labels={{ imNew: t("new"), newName: t("namePlaceholder"), join: t("join"), noMembers: t("noMembers"), back: t("cancel") }}
        onPick={(id) => {
          const m = members.find((x) => x.id === id);
          if (m) onPick(m);
        }}
        onCreate={onCreate}
      />
    </div>
  );
}

const ticksKey = (token: string) => `yakka:checklist:${token}`;

/** Ticked items (by text, so an edited checklist doesn't tick the wrong ones). */
function loadChecklistTicks(token: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(ticksKey(token));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveChecklistTicks(token: string, ticked: Set<string>) {
  try {
    sessionStorage.setItem(ticksKey(token), JSON.stringify([...ticked]));
  } catch {
    // Private mode or storage blocked: ticks just won't survive a reload.
  }
}

function clearChecklistTicks(token: string) {
  try {
    sessionStorage.removeItem(ticksKey(token));
  } catch {
    // ignore
  }
}

/** The chore's sub-tasks. Ticking is a guide only: "Tick it off" always works. */
function ChecklistView({ token, items, onDone }: { token: string; items: string[]; onDone: () => void }) {
  const t = useTranslations("tag.checklist");
  const [ticked, setTicked] = useState<Set<string>>(() => loadChecklistTicks(token));
  const count = items.filter((i) => ticked.has(i)).length;

  const toggle = (item: string, on: boolean) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(item);
      else next.delete(item);
      saveChecklistTicks(token, next);
      return next;
    });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="text-center">
        <h2 className="font-heading text-2xl font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground" role="status">
          {t("progress", { done: count, total: items.length })}
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-xl border">
        {items.map((item, i) => {
          const on = ticked.has(item);
          const id = `checklist-${i}`;
          return (
            <li key={`${i}-${item}`}>
              <label
                htmlFor={id}
                className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <Checkbox id={id} checked={on} onCheckedChange={(v) => toggle(item, v === true)} className="size-6" />
                <span className={cn("text-base", on && "text-muted-foreground line-through")}>{item}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <Button size="lg" className="h-14 text-lg" onClick={onDone}>
        <Check aria-hidden />
        {t("done")}
      </Button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-4 py-6 text-center">{children}</div>;
}

function DoneView({
  phase,
  timezone,
  groupId,
  onUndo,
}: {
  phase: Extract<Phase, { kind: "done" | "undoing" }>;
  timezone: string;
  groupId: string | null;
  onUndo: (thenPick: boolean) => void;
}) {
  const t = useTranslations("tag.tap");
  const format = useFormatter();
  const now = useNow({ updateInterval: 250 });
  const { result, memberName } = phase;
  const remaining = phase.kind === "done" ? Math.max(0, phase.undoDeadline - now.getTime()) : 0;
  const canUndo = phase.kind === "undoing" || remaining > 0;
  const next = result.chore.nextDueAt;

  return (
    <Centered>
      <BigCheck />
      <h2 className="font-heading text-3xl font-bold tracking-tight" role="status">
        {result.deduplicated
          ? result.completion.member?.name && result.completion.member.name !== memberName
            ? t("alreadyRecordedBy", { name: result.completion.member.name })
            : t("alreadyRecorded")
          : memberName
            ? t("onya", { name: memberName })
            : t("onyaAnon")}
      </h2>
      <p className="text-lg text-muted-foreground">
        {next
          ? t("nextDue", {
              when: format.dateTime(next, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
                timeZone: timezone,
              }),
            })
          : t("noNextDue")}
        {next && <span className="block text-sm">({format.relativeTime(next, now)})</span>}
      </p>
      {canUndo && (
        <div className="flex flex-col items-center gap-2">
          <Button
            size="lg"
            variant="outline"
            className="h-12 min-w-40 px-6 text-base"
            disabled={phase.kind === "undoing"}
            onClick={() => onUndo(false)}
          >
            {phase.kind === "undoing" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Undo2 aria-hidden />
            )}
            {phase.kind === "undoing" ? t("undoing") : t("undo", { seconds: Math.ceil(remaining / 1000) })}
          </Button>
          {memberName && phase.kind === "done" && !result.deduplicated && (
            <Button variant="link" size="sm" onClick={() => onUndo(true)}>
              {t("notYou", { name: memberName })}
            </Button>
          )}
        </div>
      )}
      {groupId && (
        <Button asChild variant="ghost">
          <Link href={`/groups/${groupId}`}>{t("openGroup")}</Link>
        </Button>
      )}
    </Centered>
  );
}
