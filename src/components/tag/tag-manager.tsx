"use client";

/**
 * Group-side tag management (/groups/{groupId}/tags): tags per chore,
 * create (with QR / NFC toggles), copy link, QR code, write NFC, print label,
 * edit, replace (rotate), revoke.
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
import { createContext, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { useErrorMessage } from "@/components/group/group-context";
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
import { Switch } from "@/components/ui/switch";
import { getActor } from "@/lib/client/local-groups";
import type { TagListItem } from "@/lib/services/tags";
import { useTRPC } from "@/trpc/client";

/** What a tag's label offers: a QR code, an NFC tag, both, or neither (just a link). */
function capability(tag: { qr: boolean; nfc: boolean }): "QR" | "NFC" | "both" | "none" {
  return tag.qr && tag.nfc ? "both" : tag.qr ? "QR" : tag.nfc ? "NFC" : "none";
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof TRPCClientError ? err.message : fallback;
}

/** The settings PIN typed on this page ("" when none), sent with create/rotate/revoke. */
const PinContext = createContext("");

/** Toast for tag mutations: translated PIN errors, otherwise the server message. */
function useTagErrorToast() {
  const errorMessage = useErrorMessage();
  return (e: unknown) => {
    const reason = (e as { data?: { reason?: string | null } }).data?.reason;
    toast.error(reason?.startsWith("PIN_") ? errorMessage(e) : errorText(e, "Error"));
  };
}

export function TagManager({ groupId }: { groupId: string }) {
  const t = useTranslations("tag.manage");
  const trpc = useTRPC();
  const { data: tags } = useSuspenseQuery(trpc.tags.list.queryOptions({ groupId }));
  const { data: chores } = useSuspenseQuery(trpc.groups.chores.list.queryOptions({ groupId }));
  const group = useQuery(trpc.groups.get.queryOptions({ groupId }));
  const [creating, setCreating] = useState(false);
  const [pin, setPin] = useState("");

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
    <PinContext.Provider value={pin}>
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
              {active.some((tag) => (tag.qr || tag.nfc) && !tag.chore.archivedAt) && (
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

        {group.data?.hasSettingsPin && (
          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3">
            <Label htmlFor="tags-pin">{t("pinLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("pinHelp")}</p>
            <Input
              id="tags-pin"
              className="max-w-40"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder={t("pinPlaceholder")}
              value={pin}
              maxLength={8}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}

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
    </PinContext.Provider>
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
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const pin = useContext(PinContext);
  const onError = useTagErrorToast();

  const revoke = useMutation(
    trpc.tags.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("revokedToast"));
        void invalidate();
      },
      onError,
    }),
  );
  const rotate = useMutation(
    trpc.tags.rotate.mutationOptions({
      onSuccess: () => {
        toast.success(t("rotated"));
        void invalidate();
      },
      onError,
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
            <span className="font-medium">{tag.label || t(`caps.${capability(tag)}`)}</span>
            {tag.qr && (
              <Badge variant="outline">
                <QrCode aria-hidden />
                {t("caps.QR")}
              </Badge>
            )}
            {tag.nfc && (
              <Badge variant="outline">
                <Nfc aria-hidden />
                {t("caps.NFC")}
              </Badge>
            )}
            {!tag.qr && !tag.nfc && <Badge variant="outline">{t("caps.none")}</Badge>}
            {isRevoked && <Badge variant="destructive">{t("revoked")}</Badge>}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{tag.url}</p>
          <p className="text-xs text-muted-foreground">
            {tag.lastUsedAt ? t("lastUsed", { when: format.relativeTime(tag.lastUsedAt, now) }) : t("neverUsed")}
          </p>
        </div>
        {!isRevoked && (
          <div className="flex shrink-0 items-center gap-1">
            {(tag.qr || tag.nfc) && !tag.chore.archivedAt && (
              <Button asChild variant="ghost" size="icon" aria-label={t("printLabel")}>
                <Link href={`/groups/${groupId}/tags/print?tag=${tag.id}`}>
                  <Printer aria-hidden />
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("more")}>
                  <MoreVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onSelect={() => void copy()}>
                  <Copy aria-hidden />
                  {t("copy")}
                </DropdownMenuItem>
                {tag.qr && (
                  <DropdownMenuItem onSelect={() => setQrOpen(true)}>
                    <QrCode aria-hidden />
                    {t("showQr")}
                  </DropdownMenuItem>
                )}
                {tag.nfc && (
                  <DropdownMenuItem onSelect={() => setNfcOpen(true)}>
                    <Nfc aria-hidden />
                    {t("writeNfc")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  {t("edit")}
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
      <EditTagDialog groupId={groupId} tag={tag} open={editing} onOpenChange={setEditing} />
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "rotate" ? t("rotateTitle") : t("revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "rotate" ? t("rotateBody") : t("revokeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "revoke" ? "destructive" : "default"}
              onClick={() => {
                const input = { groupId, tagId: tag.id, actor: getActor(groupId), pin: pin || null };
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

/** The QR / NFC switches shared by the create and edit dialogs. */
function CapabilityFields({
  qr,
  nfc,
  onChange,
}: {
  qr: boolean;
  nfc: boolean;
  onChange: (next: { qr: boolean; nfc: boolean }) => void;
}) {
  const t = useTranslations("tag.manage");
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">{t("capabilities")}</legend>
      <label className="flex items-start justify-between gap-4">
        <span className="flex gap-2">
          <QrCode className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t("qrToggle")}</span>
            <span className="text-xs text-muted-foreground">{t("qrToggleHint")}</span>
          </span>
        </span>
        <Switch checked={qr} onCheckedChange={(v) => onChange({ qr: v, nfc })} />
      </label>
      <label className="flex items-start justify-between gap-4">
        <span className="flex gap-2">
          <Nfc className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t("nfcToggle")}</span>
            <span className="text-xs text-muted-foreground">{t("nfcToggleHint")}</span>
          </span>
        </span>
        <Switch checked={nfc} onCheckedChange={(v) => onChange({ qr, nfc: v })} />
      </label>
      {!qr && !nfc && <p className="text-xs text-muted-foreground">{t("noCapabilityHint")}</p>}
    </fieldset>
  );
}

function EditTagDialog({
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
  const [caps, setCaps] = useState({ qr: tag.qr, nfc: tag.nfc });
  const update = useMutation(
    trpc.tags.update.mutationOptions({
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
        if (o) {
          setLabel(tag.label ?? "");
          setCaps({ qr: tag.qr, nfc: tag.nfc });
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              groupId,
              tagId: tag.id,
              label: label.trim() || null,
              ...caps,
              actor: getActor(groupId),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`tag-label-${tag.id}`}>{t("label")}</Label>
            <Input
              id={`tag-label-${tag.id}`}
              autoFocus
              maxLength={60}
              value={label}
              placeholder={t("labelPlaceholder")}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <CapabilityFields qr={caps.qr} nfc={caps.nfc} onChange={setCaps} />
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {t("saveChanges")}
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
  const [caps, setCaps] = useState({ qr: true, nfc: false });
  const [label, setLabel] = useState("");
  const pin = useContext(PinContext);
  const onError = useTagErrorToast();

  const reset = () => {
    setChoreId("");
    setCaps({ qr: true, nfc: false });
    setLabel("");
  };
  const create = useMutation(
    trpc.tags.create.mutationOptions({
      onSuccess: () => {
        void invalidate();
        reset();
        onOpenChange(false);
      },
      onError,
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
            create.mutate({
              groupId,
              choreId,
              ...caps,
              label: label.trim() || null,
              actor: getActor(groupId),
              pin: pin || null,
            });
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
            <Label htmlFor="tag-label">{t("label")}</Label>
            <Input
              id="tag-label"
              maxLength={60}
              value={label}
              placeholder={t("labelPlaceholder")}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <CapabilityFields qr={caps.qr} nfc={caps.nfc} onChange={setCaps} />
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
