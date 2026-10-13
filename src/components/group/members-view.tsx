"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, CheckIcon, Loader2Icon, MoreVerticalIcon, PencilIcon, PlusIcon, UserCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setIdentity } from "@/lib/client/local-groups";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { useActor, useErrorMessage, useGroup, type GroupMember } from "./group-context";
import { useGroupIdentity } from "./group-shell";
import { MEMBER_COLOURS, MemberAvatar } from "./member-avatar";

export function MembersView() {
  const t = useTranslations("group.members");
  const ti = useTranslations("group.identity");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const group = useGroup();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const { me } = useGroupIdentity();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<GroupMember | null>(null);
  // Suspense query: it is prefetched, and a plain useQuery could render "no
  // tallies" during SSR (still streaming) but tallies on the client.
  const tallies = useSuspenseQuery(trpc.groups.members.tallies.queryOptions({ groupId: group.id })).data;
  const tally = new Map(tallies?.tallies.map((x) => [x.memberId, x]) ?? []);

  const invalidate = () => qc.invalidateQueries(trpc.groups.pathFilter());
  const add = useMutation(trpc.groups.members.add.mutationOptions({ onSettled: invalidate }));
  const setArchived = useMutation(trpc.groups.members.setArchived.mutationOptions({ onSettled: invalidate }));

  const active = group.members.filter((m) => !m.archivedAt);
  const archived = group.members.filter((m) => m.archivedAt);
  const automation = tally.get(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      // The actor is whoever is adding (not the new member).
      const a = actor();
      await add.mutateAsync({ groupId: group.id, name: n, actor: { memberId: a.memberId ?? undefined, deviceId: a.deviceId } });
      setName("");
      toast.success(t("added", { name: n }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function archive(m: GroupMember, value: boolean) {
    try {
      await setArchived.mutateAsync({ groupId: group.id, memberId: m.id, archived: value, actor: actor() });
      toast.success(t(value ? "archivedToast" : "restoredToast", { name: m.name }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const row = (m: GroupMember) => {
    const tl = tally.get(m.id);
    const isMe = m.id === me?.id;
    return (
      <li key={m.id} className={cn("flex items-center gap-3 px-3 py-3", m.archivedAt && "opacity-60")}>
        <MemberAvatar member={m} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 truncate font-medium">
            {m.name}
            {isMe && (
              <span className="rounded-full bg-primary/10 px-2 text-[0.7rem] font-semibold text-primary uppercase">
                {t("you")}
              </span>
            )}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("tallyWeek", { count: tl?.week ?? 0 })} · {t("tallyMonth", { count: tl?.month ?? 0 })}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-lg" aria-label={t("actions", { name: m.name })}>
              <MoreVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(m)}>
              <PencilIcon /> {t("rename")}
            </DropdownMenuItem>
            {!m.archivedAt && !isMe && (
              <DropdownMenuItem
                onSelect={() => {
                  setIdentity(group.id, m.id, group.name);
                  toast.success(ti("youAre", { name: m.name }));
                }}
              >
                <UserCheckIcon /> {t("beMe")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {m.archivedAt ? (
              <DropdownMenuItem onSelect={() => archive(m, false)}>
                <ArchiveRestoreIcon /> {t("restore")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={() => archive(m, true)}>
                <ArchiveIcon /> {t("archive")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("addPlaceholder")}
          aria-label={t("addPlaceholder")}
          maxLength={50}
          className="h-11 text-base"
        />
        <Button type="submit" size="lg" className="h-11 px-4" disabled={!name.trim() || add.isPending}>
          {add.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          {t("add")}
        </Button>
      </form>

      <ul className="flex flex-col divide-y rounded-2xl border bg-card">{active.map(row)}</ul>

      {automation && automation.month > 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          {t("automations")}: {t("tallyWeek", { count: automation.week })} ·{" "}
          {t("tallyMonth", { count: automation.month })}
        </p>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">{t("archivedSection")}</h2>
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">{archived.map(row)}</ul>
        </section>
      )}
      <p className="px-1 text-xs text-muted-foreground">{t("archiveHint")}</p>

      <EditMemberDialog member={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EditMemberDialog({ member, onClose }: { member: GroupMember | null; onClose: () => void }) {
  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">{member && <EditMemberForm member={member} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function EditMemberForm({ member, onClose }: { member: GroupMember; onClose: () => void }) {
  const t = useTranslations("group.members");
  const tc = useTranslations("common.actions");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const group = useGroup();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(member.name);
  const [colour, setColour] = useState<string | null>(member.colour);
  const update = useMutation(
    trpc.groups.members.update.mutationOptions({ onSettled: () => qc.invalidateQueries(trpc.groups.pathFilter()) }),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        groupId: group.id,
        memberId: member.id,
        patch: { name: name.trim(), colour },
        actor: actor(),
      });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("renameTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{member.name}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3">
        <MemberAvatar member={{ id: member.id, name: name || member.name, colour }} size="lg" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          required
          autoFocus
          aria-label={t("rename")}
          className="h-11 text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>{t("colour")}</Label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setColour(null)}
            className={cn(
              "h-9 rounded-full border px-3 text-xs font-medium",
              colour === null && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
          >
            {t("noColour")}
          </button>
          {MEMBER_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColour(c)}
              aria-label={c}
              aria-pressed={colour === c}
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-white",
                colour === c && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: c }}
            >
              {colour === c && <CheckIcon className="size-4" />}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={!name.trim() || update.isPending}>
          {update.isPending && <Loader2Icon className="animate-spin" />}
          {tc("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
