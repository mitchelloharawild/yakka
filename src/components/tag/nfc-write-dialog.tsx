"use client";

/**
 * "Write this tag" with Web NFC (NDEFReader: Chrome on Android only).
 * Elsewhere (iOS, desktop) shows how to write the URL with an app.
 */
import { Nfc } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Minimal Web NFC typing (not in lib.dom). */
interface NDEFWriter {
  write(message: { records: { recordType: "url"; data: string }[] }, opts?: { signal?: AbortSignal }): Promise<void>;
}
declare global {
  interface Window {
    NDEFReader?: new () => NDEFWriter;
  }
}

const noop = () => () => {};
function useHasWebNfc(): boolean {
  return useSyncExternalStore(
    noop,
    () => typeof window.NDEFReader === "function",
    () => false,
  );
}

type State = { kind: "idle" } | { kind: "writing" } | { kind: "written" } | { kind: "failed"; error: string };

export function NfcWriteDialog({
  url,
  open,
  onOpenChange: setOpen,
}: {
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("tag.manage");
  const supported = useHasWebNfc();
  const [state, setState] = useState<State>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      abort.current?.abort();
      setState({ kind: "idle" });
    }
  };

  const write = async () => {
    if (!window.NDEFReader) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ kind: "writing" });
    try {
      await new window.NDEFReader().write({ records: [{ recordType: "url", data: url }] }, { signal: ctrl.signal });
      setState({ kind: "written" });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setState({ kind: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supported ? t("nfcTitle") : t("nfcUnsupportedTitle")}</DialogTitle>
          {!supported && <DialogDescription>{t("nfcUnsupported")}</DialogDescription>}
        </DialogHeader>
        {supported ? (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <Nfc
              className={`size-16 ${state.kind === "writing" ? "animate-pulse text-primary" : "text-muted-foreground"}`}
              aria-hidden
            />
            <p role="status" className="min-h-6">
              {state.kind === "writing" && t("nfcReady")}
              {state.kind === "written" && t("nfcWritten")}
              {state.kind === "failed" && t("nfcFailed", { error: state.error })}
            </p>
            {state.kind !== "writing" && (
              <Button size="lg" onClick={() => void write()}>
                {t("nfcStart")}
              </Button>
            )}
          </div>
        ) : (
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        )}
      </DialogContent>
    </Dialog>
  );
}
