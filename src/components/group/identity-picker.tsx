"use client";

/**
 * "Who are you?" picker: member chips plus "I'm new". Reusable outside the
 * group pages (the tag page uses the same UX), so it takes plain props and
 * doesn't read the group context.
 *
 *   <IdentityPicker
 *     members={group.members}
 *     onPick={(memberId) => setIdentity(groupId, memberId)}
 *     onCreate={async (name) => { const m = await addMember(name); setIdentity(groupId, m.id); }}
 *   />
 *
 * Archived members are hidden. `onCreate` may return a promise; the input
 * stays disabled until it settles and is cleared on success.
 */
import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "./member-avatar";

/** The member fields the picker needs. */
export interface IdentityPickerMember {
  id: string;
  name: string;
  colour?: string | null;
  archivedAt?: Date | string | null;
}

/** Props of IdentityPicker. */
export interface IdentityPickerProps {
  members: readonly IdentityPickerMember[];
  /** Called when an existing member is tapped. */
  onPick: (memberId: string) => void | Promise<unknown>;
  /** Called with a trimmed name from "I'm new". Omit to hide the option. */
  onCreate?: (name: string) => void | Promise<unknown>;
  /** Highlights the current identity. */
  currentMemberId?: string | null;
  /** Disables all controls (e.g. while a parent mutation runs). */
  disabled?: boolean;
  className?: string;
}

/** Member chips + "I'm new". */
export function IdentityPicker({
  members,
  onPick,
  onCreate,
  currentMemberId,
  disabled,
  className,
}: IdentityPickerProps) {
  const t = useTranslations("group.identity");
  const active = members.filter((m) => !m.archivedAt);
  const [creating, setCreating] = useState(active.length === 0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => void | Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !onCreate) return;
    if (await run("new", () => onCreate(trimmed))) setName("");
  }

  const off = disabled || busy !== null;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {active.length === 0 && <p className="text-sm text-muted-foreground">{t("noMembers")}</p>}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {active.map((m) => {
          const current = m.id === currentMemberId;
          return (
            <li key={m.id}>
              <button
                type="button"
                disabled={off}
                onClick={() => run(m.id, () => onPick(m.id))}
                aria-pressed={current}
                className={cn(
                  "flex h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 text-left text-base font-medium transition-colors",
                  "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-60",
                  current && "border-primary ring-2 ring-primary/30",
                )}
              >
                <MemberAvatar member={m} size="md" />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {busy === m.id ? (
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                ) : current ? (
                  <CheckIcon className="size-4 text-primary" aria-label={t("current")} />
                ) : null}
              </button>
            </li>
          );
        })}
        {onCreate && !creating && (
          <li>
            <button
              type="button"
              disabled={off}
              onClick={() => setCreating(true)}
              className="flex h-14 w-full items-center gap-3 rounded-xl border border-dashed px-3 text-left text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-muted">
                <PlusIcon className="size-4" />
              </span>
              {t("imNew")}
            </button>
          </li>
        )}
      </ul>
      {onCreate && creating && (
        <form onSubmit={submitNew} className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("newName")}
            aria-label={t("newName")}
            maxLength={50}
            disabled={off}
            className="h-11 text-base"
            autoComplete="given-name"
          />
          <Button type="submit" size="lg" className="h-11 px-4" disabled={off || !name.trim()}>
            {busy === "new" ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            {t("join")}
          </Button>
        </form>
      )}
    </div>
  );
}

/** IdentityPicker in a dialog with the standard "Who are you?" heading. */
export function IdentityDialog({
  open,
  onOpenChange,
  ...picker
}: IdentityPickerProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("group.identity");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <IdentityPicker {...picker} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("later")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
