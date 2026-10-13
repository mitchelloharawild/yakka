"use client";

/**
 * Group-side tag management (/groups/{groupId}/tags): tags per chore,
 * create, copy link, QR code, write NFC, rename, replace (rotate), revoke.
 */
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  MoreVertical,
  Nfc,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Ban,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { NfcWriteDialog } from "@/components/tag/nfc-write-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getActor } from "@/lib/client/local-groups";
import type { TagListItem } from "@/lib/services/tags";
import { useTRPC } from "@/trpc/client";

type Kind = "QR" | "NFC" | "URL";

function errorText(err: unknown, fallback: string): string {
  return err instanceof TRPCClientError ? err.message : fallback;
}

export function TagManager({ groupId }: { groupId: string }) {
  const t = useTranslations("tag.manage");
  const trpc = useTRPC();
  const { data: tags } = useSuspenseQuery(trpc.tags.list.queryOptions({ groupId }));
  const { data: chores } = useSuspenseQuery(trpc.groups.chores.list.queryOptions({ groupId }));
  const [creating, setCreating] = useState(false);

  const active = tags.filter((tag) => !tag.revokedAt);
  const revoked = tags.filter((tag) => tag.revokedAt);
  const byChore = useMemo(() => {
    const map = new Map<string, { chore: TagListItem["chore"]; tags: TagListItem[] }>();
    for (const tag of active) {
      const entry = map.get(tag.choreId) ?? { chore: tag.chore, tags: [] };
      entry.tags.push(tag);
      map.set(tag.choreId, entry);
    }
    return [...map.values()].sort((a, b) => a.chore.title.localeCompare(b.chore.title));
  }, [active]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={`/groups/${groupId}`}>
            <ArrowLeft aria-hidden />
            {t("back")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex gap-2">
            {active.length > 0 && (
              <Button asChild variant="outline">
                <Link href={`/groups/${groupId}/tags/print`}>
                  <Printer aria-hidden />
                  {t("print")}
                </Link>
              </Button>
            )}
            <Button onClick={() => setCreating(true)} disabled={chores.length === 0}>
              <Plus aria-hidden />
              {t("create")}
            </Button>
          </div>
        </div>
      </div>

      {chores.length === 0 && active.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">{t("noChores")}</p>
      ) : active.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {byChore.map(({ chore, tags }) => (
            <li key={chore.id} className="flex flex-col gap-2">
              <h2 className="flex items-center gap-2 font-medium">
                <span aria-hidden className="text-xl">
                  {chore.icon || "✅"}
                </span>
                {chore.title}
                {chore.archivedAt && <Badge variant="secondary">{t("archivedChore")}</Badge>}
              </h2>
              <ul className="flex flex-col gap-2">
                {tags.map((tag) => (
                  <TagRow key={tag.id} groupId={groupId} tag={tag} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group self-start text-muted-foreground">
              <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
              {t("revokedSection", { count: revoked.length })}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-2 opacity-70">
              {revoked.map((tag) => (
                <TagRow key={tag.id} groupId={groupId} tag={tag} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      <CreateTagDialog
        groupId={groupId}
        open={creating}
        onOpenChange={setCreating}
        chores={chores.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, title: c.title, icon: c.icon }))}
      />
    </div>
  );
}

function useInvalidateTags(groupId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: trpc.tags.list.queryKey({ groupId }) });
}

function TagRow({ groupId, tag }: { groupId: string; tag: TagListItem }) {
  const t = useTranslations("tag.manage");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const trpc = useTRPC();
  const invalidate = useInvalidateTags(groupId);
  const [qrOpen, setQrOpen] = useState(false);
  const [nfcOpen, setNfcOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);

  const revoke = useMutation(
    trpc.tags.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("revokedToast"));
        void invalidate();
      },
      onError: (e) => toast.error(errorText(e, "Error")),
    }),
  );
  const rotate = useMutation(
    trpc.tags.rotate.mutationOptions({
      onSuccess: () => {
        toast.success(t("rotated"));
        void invalidate();
      },
      onError: (e) => toast.error(errorText(e, "Error")),
    }),
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tag.url);
      toast.success(t("copied"));
    } catch {
      window.prompt(t("copy"), tag.url);
    }
  };

  const isRevoked = Boolean(tag.revokedAt);
  return (
    <li>
      <Card className="flex flex-row items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{tag.label || t(`kinds.${tag.kind as Kind}`)}</span>
            <Badge variant="outline">{t(`kinds.${tag.kind as Kind}`)}</Badge>
            {isRevoked && <Badge variant="destructive">{t("revoked")}</Badge>}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{tag.url}</p>
          <p className="text-xs text-muted-foreground">
            {tag.lastUsedAt
              ? t("lastUsed", { when: format.relativeTime(tag.lastUsedAt, now) })
              : t("neverUsed")}
          </p>
        </div>
        {!isRevoked && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" aria-label={t("showQr")} onClick={() => setQrOpen(true)}>
              <QrCode aria-hidden />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("more")}>
                  <MoreVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copy()}>
                  <Copy aria-hidden />
                  {t("copy")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setQrOpen(true)}>
                  <QrCode aria-hidden />
                  {t("showQr")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setNfcOpen(true)}>
                  <Nfc aria-hidden />
                  {t("writeNfc")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenaming(true)}>
                  <Pencil aria-hidden />
                  {t("relabel")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConfirm("rotate")}>
                  <RefreshCw aria-hidden />
                  {t("rotate")}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("revoke")}>
                  <Ban aria-hidden />
                  {t("revoke")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </Card>

      <QrDialog groupId={groupId} tag={tag} open={qrOpen} onOpenChange={setQrOpen} />
      <NfcWriteDialog url={tag.url} open={nfcOpen} onOpenChange={setNfcOpen} />
      <RenameDialog groupId={groupId} tag={tag} open={renaming} onOpenChange={setRenaming} />
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "rotate" ? t("rotateTitle") : t("revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "rotate" ? t("rotateBody") : t("revokeBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "revoke" ? "destructive" : "default"}
              onClick={() => {
                const input = { groupId, tagId: tag.id, actor: getActor(groupId) };
                if (confirm === "rotate") rotate.mutate(input);
                else revoke.mutate(input);
                setConfirm(null);
              }}
            >
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function QrDialog({
  groupId,
  tag,
  open,
  onOpenChange,
}: {
  groupId: string;
  tag: TagListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("tag.manage");
  const trpc = useTRPC();
  const qr = useQuery({ ...trpc.tags.qr.queryOptions({ groupId, tagId: tag.id }), enabled: open, staleTime: Infinity });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tag.chore.icon} {tag.chore.title}
            {tag.label ? ` · ${tag.label}` : ""}
          </DialogTitle>
          <DialogDescription>{t("qrHelp")}</DialogDescription>
        </DialogHeader>
        <div className="mx-auto aspect-square w-full max-w-64 rounded-lg bg-white p-2">
          {qr.data ? (
            // Server-generated SVG from our own URL (qrcode); safe to inline.
            <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.data.svg }} />
          ) : (
            <div className="size-full animate-pulse rounded bg-muted" />
          )}
        </div>
        <p className="break-all text-center font-mono text-xs text-muted-foreground">{tag.url}</p>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  groupId,
  tag,
  open,
  onOpenChange,
}: {
  groupId: string;
  tag: TagListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("tag.manage");
  const trpc = useTRPC();
  const invalidate = useInvalidateTags(groupId);
  const [label, setLabel] = useState(tag.label ?? "");
  const relabel = useMutation(
    trpc.tags.relabel.mutationOptions({
      onSuccess: () => {
        void invalidate();
        onOpenChange(false);
      },
      onError: (e) => toast.error(errorText(e, "Error")),
    }),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setLabel(tag.label ?? "");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            relabel.mutate({ groupId, tagId: tag.id, label: label.trim() || null, actor: getActor(groupId) });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("relabelTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={60}
            value={label}
            placeholder={t("labelPlaceholder")}
            onChange={(e) => setLabel(e.target.value)}
          />
          <DialogFooter>
            <Button type="submit" disabled={relabel.isPending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTagDialog({
  groupId,
  chores,
  open,
  onOpenChange,
}: {
  groupId: string;
  chores: { id: string; title: string; icon: string | null }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("tag.manage");
  const trpc = useTRPC();
  const invalidate = useInvalidateTags(groupId);
  const [choreId, setChoreId] = useState("");
  const [kind, setKind] = useState<Kind>("QR");
  const [label, setLabel] = useState("");

  const reset = () => {
    setChoreId("");
    setKind("QR");
    setLabel("");
  };
  const create = useMutation(
    trpc.tags.create.mutationOptions({
      onSuccess: () => {
        void invalidate();
        reset();
        onOpenChange(false);
      },
      onError: (e) => toast.error(errorText(e, "Error")),
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!choreId) return;
            create.mutate({ groupId, choreId, kind, label: label.trim() || null, actor: getActor(groupId) });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tag-chore">{t("chore")}</Label>
            <Select value={choreId} onValueChange={setChoreId}>
              <SelectTrigger id="tag-chore" className="w-full">
                <SelectValue placeholder={t("choosePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {chores.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ""}
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("kind")}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(v) => v && setKind(v as Kind)}
            >
              {(["QR", "NFC", "URL"] as const).map((k) => (
                <ToggleGroupItem key={k} value={k}>
                  {t(`kinds.${k}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tag-label">{t("label")}</Label>
            <Input
              id="tag-label"
              maxLength={60}
              value={label}
              placeholder={t("labelPlaceholder")}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!choreId || create.isPending}>
              {create.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
