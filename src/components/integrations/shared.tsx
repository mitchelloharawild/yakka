"use client";

/** Small building blocks shared by the integrations sections. OWNED BY: Agent C. */
import { formatDistanceToNow } from "date-fns";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorRetryAfter, formatWait } from "@/components/group/group-context";
import { getActor } from "@/lib/client/local-groups";

/** Per-page context: group id and the settings PIN typed by the user (if any). */
export interface IntegrationsContextValue {
  groupId: string;
  pin: string;
}
export const IntegrationsContext = createContext<IntegrationsContextValue>({ groupId: "", pin: "" });

/** `{ groupId, actor, pin }` to spread into every integrations mutation input. */
export function useMutationBase() {
  const { groupId, pin } = useContext(IntegrationsContext);
  return () => ({ groupId, actor: getActor(groupId), pin: pin || null });
}

const KNOWN_ERRORS = {
  PIN_REQUIRED: true,
  PIN_INVALID: true,
  URL_INVALID: true,
  URL_SCHEME_NOT_ALLOWED: true,
  URL_CREDENTIALS_NOT_ALLOWED: true,
  CHORE_ARCHIVED: true,
  MEMBER_ARCHIVED: true,
} as const;

/** Toast a tRPC error, translating known reasons. */
export function useErrorToast() {
  const t = useTranslations("integrations.errors");
  return (err: unknown) => {
    const data = (err as { data?: { reason?: string | null; zodError?: { fieldErrors?: Record<string, string[]> } | null } })
      .data;
    const reason = data?.reason ?? Object.values(data?.zodError?.fieldErrors ?? {}).flat()[0];
    if (reason === "PIN_LOCKED") toast.error(t("PIN_LOCKED", { wait: formatWait(errorRetryAfter(err) ?? 60) }));
    else if (reason && reason in KNOWN_ERRORS) toast.error(t(reason as keyof typeof KNOWN_ERRORS));
    else if (data?.zodError) toast.error(t("invalid"));
    else toast.error(reason ?? ((err as Error).message || t("generic")));
  };
}

/** Copy-to-clipboard button. */
export function CopyButton({ value, label, size = "sm" }: { value: string; label?: string; size?: "sm" | "xs" }) {
  const t = useTranslations("integrations.common");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error(value);
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? t("copied") : (label ?? t("copy"))}
    </Button>
  );
}

/** Monospace, wrapping, selectable value with a copy button. */
export function CodeValue({ value, multiline = false }: { value: string; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <code
        className={
          "min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all select-all " +
          (multiline ? "whitespace-pre-wrap" : "")
        }
      >
        {value}
      </code>
      <CopyButton value={value} size="xs" />
    </div>
  );
}

/** Dialog showing a freshly created secret once. */
export function SecretDialog({
  open,
  onClose,
  title,
  secret,
  description,
  children,
}: {
  description?: string;
  open: boolean;
  onClose: () => void;
  title: string;
  secret: string | null;
  children?: React.ReactNode;
}) {
  const t = useTranslations("integrations.common");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? t("showOnce")}</DialogDescription>
        </DialogHeader>
        {secret && <CodeValue value={secret} />}
        {children}
        <DialogFooter>
          <Button onClick={onClose}>{t("done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "3 minutes ago". */
export function ago(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true });
}

/** A button that asks for confirmation before running `onConfirm`. */
export function ConfirmButton({
  children,
  message,
  confirmLabel,
  onConfirm,
  disabled,
  variant = "destructive",
}: {
  children: React.ReactNode;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "destructive" | "outline";
}) {
  const t = useTranslations("integrations.common");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm" disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{message}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
