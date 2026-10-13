"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  Share2Icon,
  SmartphoneIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { exportLocalData, importLocalData, removeLocalGroup, useHydrated } from "@/lib/client/local-groups";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { errorReason, useActor, useErrorMessage, useGroup } from "./group-context";
import { useGroupIdentity } from "./group-shell";
import { MemberAvatar } from "./member-avatar";
import { QrCode } from "./qr-code";
import { TimezoneSelect } from "./timezone-select";

function Section({
  title,
  hint,
  icon,
  children,
  className,
}: {
  title: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-4", className)}>
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          {icon}
          {title}
        </h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SettingsView() {
  const group = useGroup();
  // The unlocked settings PIN, kept only in memory for this page.
  const [pin, setPin] = useState<string | null>(null);
  const locked = group.hasSettingsPin && pin === null;
  const onPinRejected = () => setPin(null);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {locked && <UnlockCard onUnlock={setPin} />}
      <GeneralSettings key={group.updatedAt.getTime()} pin={pin} locked={locked} onPinRejected={onPinRejected} />
      <PinSettings pin={pin} locked={locked} onPinChange={setPin} />
      <ShareSettings />
      <TransferSettings />
      <LocalDataSettings />
      <DeleteGroup pin={pin} locked={locked} />
    </div>
  );
}

function UnlockCard({ onUnlock }: { onUnlock: (pin: string) => void }) {
  const t = useTranslations("group.settings");
  const trpc = useTRPC();
  const group = useGroup();
  const errorMessage = useErrorMessage();
  const [value, setValue] = useState("");
  const verify = useMutation(trpc.groups.verifyPin.mutationOptions());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await verify.mutateAsync({ groupId: group.id, pin: value });
      onUnlock(value);
    } catch (err) {
      toast.error(errorMessage(err));
      setValue("");
    }
  }
  return (
    <Section title={t("locked")} hint={t("lockedHint")} icon={<LockIcon className="size-4" />} className="border-primary/40">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d*"
          maxLength={8}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          placeholder={t("pin")}
          aria-label={t("pin")}
          className="h-11 text-center text-lg tracking-[0.4em]"
        />
        <Button type="submit" size="lg" className="h-11" disabled={value.length < 4 || verify.isPending}>
          {verify.isPending && <Loader2Icon className="animate-spin" />}
          {t("unlock")}
        </Button>
      </form>
    </Section>
  );
}

function GeneralSettings({
  pin,
  locked,
  onPinRejected,
}: {
  pin: string | null;
  locked: boolean;
  onPinRejected: () => void;
}) {
  const t = useTranslations("group.settings");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const group = useGroup();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const [f, setF] = useState({
    name: group.name,
    timezone: group.timezone,
    joinFromTag: group.joinFromTag,
    undoSeconds: String(group.undoSeconds),
    debounceMinutes: String(group.debounceMinutes),
  });
  const update = useMutation(trpc.groups.update.mutationOptions());
  const dirty =
    f.name.trim() !== group.name ||
    f.timezone !== group.timezone ||
    f.joinFromTag !== group.joinFromTag ||
    Number(f.undoSeconds) !== group.undoSeconds ||
    Number(f.debounceMinutes) !== group.debounceMinutes;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const updated = await update.mutateAsync({
        groupId: group.id,
        pin,
        actor: actor(),
        patch: {
          name: f.name.trim(),
          timezone: f.timezone,
          joinFromTag: f.joinFromTag,
          undoSeconds: Math.round(Number(f.undoSeconds)),
          debounceMinutes: Math.round(Number(f.debounceMinutes)),
        },
      });
      qc.setQueryData(trpc.groups.get.queryKey({ groupId: group.id }), (old) => (old ? { ...old, ...updated } : old));
      await qc.invalidateQueries(trpc.groups.pathFilter());
      toast.success(t("saved"));
    } catch (err) {
      const reason = errorReason(err);
      if (reason === "PIN_INVALID" || reason === "PIN_REQUIRED") onPinRejected();
      toast.error(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="contents">
      <fieldset disabled={locked} className="contents">
        <Section title={t("general")}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">{t("name")}</Label>
            <Input
              id="group-name"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              maxLength={80}
              required
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-tz">{t("timezone")}</Label>
            <TimezoneSelect id="group-tz" value={f.timezone} onChange={(timezone) => setF({ ...f, timezone })} disabled={locked} />
          </div>
        </Section>
        <Section title={t("tagsSection")}>
          <label className="flex items-start justify-between gap-4">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("joinFromTag")}</span>
              <span className="text-xs text-muted-foreground">{t("joinFromTagHint")}</span>
            </span>
            <Switch
              checked={f.joinFromTag}
              onCheckedChange={(joinFromTag) => setF({ ...f, joinFromTag })}
              disabled={locked}
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="undo-seconds">{t("undoSeconds")}</Label>
              <Input
                id="undo-seconds"
                type="number"
                inputMode="numeric"
                min={0}
                max={600}
                value={f.undoSeconds}
                onChange={(e) => setF({ ...f, undoSeconds: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="debounce-minutes">{t("debounceMinutes")}</Label>
              <Input
                id="debounce-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={1440}
                value={f.debounceMinutes}
                onChange={(e) => setF({ ...f, debounceMinutes: e.target.value })}
                className="h-10"
              />
            </div>
          </div>
          <Button type="submit" size="lg" className="h-11" disabled={locked || !dirty || update.isPending}>
            {update.isPending && <Loader2Icon className="animate-spin" />}
            {t("save")}
          </Button>
        </Section>
      </fieldset>
    </form>
  );
}

function PinSettings({
  pin,
  locked,
  onPinChange,
}: {
  pin: string | null;
  locked: boolean;
  onPinChange: (pin: string | null) => void;
}) {
  const t = useTranslations("group.settings");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const group = useGroup();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const setPinM = useMutation(trpc.groups.setPin.mutationOptions());
  const mismatch = confirm.length > 0 && next !== confirm;
  const validNew = /^\d{4,8}$/.test(next) && next === confirm;

  async function save(newPin: string | null) {
    try {
      const updated = await setPinM.mutateAsync({ groupId: group.id, currentPin: pin, newPin, actor: actor() });
      qc.setQueryData(trpc.groups.get.queryKey({ groupId: group.id }), (old) => (old ? { ...old, ...updated } : old));
      onPinChange(newPin);
      setNext("");
      setConfirm("");
      toast.success(newPin ? t("pinSaved") : t("pinCleared"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);

  return (
    <Section
      title={t("pinSection")}
      hint={
        <>
          {t("pinHint")} <strong className="font-medium">{group.hasSettingsPin ? t("pinIsSet") : t("pinNotSet")}</strong>
        </>
      }
      icon={<KeyRoundIcon className="size-4" />}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validNew) void save(next);
        }}
        className="flex flex-col gap-3"
      >
        <fieldset disabled={locked} className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-pin">{t("newPin")}</Label>
            <Input
              id="new-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(digits(e.target.value))}
              className="h-10 tracking-widest"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-pin">{t("confirmPin")}</Label>
            <Input
              id="confirm-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(digits(e.target.value))}
              aria-invalid={mismatch}
              className="h-10 tracking-widest"
            />
          </div>
        </fieldset>
        {mismatch && <p className="text-sm text-destructive">{t("pinMismatch")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={locked || !validNew || setPinM.isPending}>
            {setPinM.isPending && <Loader2Icon className="animate-spin" />}
            {group.hasSettingsPin ? t("changePin") : t("setPin")}
          </Button>
          {group.hasSettingsPin && (
            <Button type="button" variant="outline" disabled={locked || setPinM.isPending} onClick={() => save(null)}>
              {t("clearPin")}
            </Button>
          )}
        </div>
      </form>
    </Section>
  );
}

function useGroupUrl() {
  const group = useGroup();
  const hydrated = useHydrated();
  return hydrated ? `${window.location.origin}/groups/${group.id}` : "";
}

function ShareSettings() {
  const t = useTranslations("group.settings");
  const group = useGroup();
  const url = useGroupUrl();
  const canShare = url !== "" && typeof navigator.share === "function";
  return (
    <Section title={t("share")} hint={t("shareHint")} icon={<Share2Icon className="size-4" />}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {url && <QrCode value={url} label={t("share")} />}
        <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
          <Input readOnly value={url} onFocus={(e) => e.target.select()} className="h-10 font-mono text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={async () => (await copy(url)) && toast.success(t("linkCopied"))}
              disabled={!url}
            >
              <CopyIcon /> {t("copyLink")}
            </Button>
            {canShare && (
              <Button
                type="button"
                variant="outline"
                onClick={() => navigator.share({ title: group.name, url }).catch(() => {})}
              >
                <Share2Icon /> {t("shareNative")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

function TransferSettings() {
  const t = useTranslations("group.settings");
  const group = useGroup();
  const url = useGroupUrl();
  const { me } = useGroupIdentity();
  const [chosen, setChosen] = useState<string | null>(null);
  const memberId = chosen ?? me?.id ?? null;
  const member = group.members.find((m) => m.id === memberId);
  const active = group.members.filter((m) => !m.archivedAt);
  const link = url && memberId ? `${url}?as=${encodeURIComponent(memberId)}` : "";
  return (
    <Section
      title={t("transfer")}
      hint={member ? t("transferHint", { name: member.name }) : t("transferNoIdentity")}
      icon={<SmartphoneIcon className="size-4" />}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm text-muted-foreground">{t("transferAs")}</span>
        <Select value={memberId ?? undefined} onValueChange={setChosen}>
          <SelectTrigger className="h-10 flex-1">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {active.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <MemberAvatar member={m} size="xs" /> {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {link && (
        <div className="flex flex-col items-center gap-2">
          <QrCode value={link} label={t("transfer")} className="w-56" />
          <Button type="button" variant="ghost" size="sm" onClick={async () => (await copy(link)) && toast.success(t("linkCopied"))}>
            <CopyIcon /> {t("copyLink")}
          </Button>
        </div>
      )}
    </Section>
  );
}

function LocalDataSettings() {
  const t = useTranslations("group.settings");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const file = useRef<HTMLInputElement>(null);

  function download() {
    const blob = new Blob([exportLocalData()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yakka-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function doImport(json: string) {
    try {
      const n = importLocalData(json, mode);
      setText("");
      toast.success(t("imported", { count: n }));
    } catch {
      toast.error(t("importInvalid"));
    }
  }

  return (
    <Section title={t("localData")} hint={t("localDataHint")} icon={<DownloadIcon className="size-4" />}>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={download}>
          <DownloadIcon /> {t("download")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={async () => (await copy(exportLocalData())) && toast.success(t("exportCopied"))}
        >
          <CopyIcon /> {t("export")}
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="import-data">{t("import")}</Label>
        <Textarea
          id="import-data"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("importPlaceholder")}
          className="min-h-20 font-mono text-xs"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as "merge" | "replace")}>
            <SelectTrigger className="h-9 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="merge">{t("importMerge")}</SelectItem>
              <SelectItem value="replace">{t("importReplace")}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" onClick={() => doImport(text)} disabled={!text.trim()}>
            <UploadIcon /> {t("import")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => file.current?.click()}>
            {t("importFile")}
          </Button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) doImport(await f.text());
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </Section>
  );
}

function DeleteGroup({ pin, locked }: { pin: string | null; locked: boolean }) {
  const t = useTranslations("group.settings");
  const tc = useTranslations("common.actions");
  const trpc = useTRPC();
  const router = useRouter();
  const group = useGroup();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const { data: config } = useSuspenseQuery(trpc.groups.config.queryOptions());
  const del = useMutation(trpc.groups.delete.mutationOptions());
  if (!config.enableGroupDeletion) return null;

  async function confirm() {
    try {
      await del.mutateAsync({ groupId: group.id, pin, actor: actor() });
      removeLocalGroup(group.id);
      toast.success(t("deleted"));
      router.replace("/");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Section title={t("danger")} hint={t("deleteHint")} className="border-destructive/40">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={locked || del.isPending} className="self-start">
            <Trash2Icon /> {t("delete")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle", { name: group.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirm}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
