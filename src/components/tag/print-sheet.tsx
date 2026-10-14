"use client";

/**
 * Printable sheet of tag labels (A4 grid). Each label shows what the tag
 * offers: a QR code (SVG generated on the server), an NFC tap mark, or both.
 */
import { ArrowLeft, Nfc, Printer, QrCode } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface PrintableLabel {
  id: string;
  url: string;
  /** QR code SVG; null when the tag has no QR code. */
  svg: string | null;
  qr: boolean;
  nfc: boolean;
  label: string | null;
  chore: { title: string; icon: string | null };
}

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 10mm; }
  html, body { background: #fff !important; color: #000 !important; color-scheme: light; }
  body header, [data-print-hide] { display: none !important; }
  main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
}
`;

export function PrintSheet({
  groupId,
  labels,
  initialSelected,
}: {
  groupId: string;
  labels: PrintableLabel[];
  /** Ids to select at first (default: all). */
  initialSelected?: string[] | null;
}) {
  const t = useTranslations("tag.print");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected ?? labels.map((l) => l.id)),
  );
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div data-print-hide className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={`/groups/${groupId}/tags`}>
            <ArrowLeft aria-hidden />
            {t("back")}
          </Link>
        </Button>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("subtitle")}</p>
        {labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => window.print()} disabled={selected.size === 0}>
              <Printer aria-hidden />
              {t("printButton")}
            </Button>
            <Button variant="outline" onClick={() => setSelected(new Set(labels.map((l) => l.id)))}>
              {t("selectAll")}
            </Button>
            <Button variant="outline" onClick={() => setSelected(new Set())}>
              {t("selectNone")}
            </Button>
            <span className="text-sm text-muted-foreground">{t("selected", { count: selected.size })}</span>
          </div>
        )}
      </div>

      {labels.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-0">
          {labels.map((l) => {
            const on = selected.has(l.id);
            return (
              <li
                key={l.id}
                className={`relative break-inside-avoid ${on ? "" : "opacity-40 print:hidden"}`}
              >
                <label
                  data-print-hide
                  className="absolute top-2 left-2 z-10 flex size-8 items-center justify-center rounded-md bg-background/90"
                >
                  <Checkbox checked={on} onCheckedChange={(v) => toggle(l.id, v === true)} aria-label={l.chore.title} />
                </label>
                <TagLabel label={l} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One cut-out label: a QR code and/or NFC tap mark, the chore, then how to use it. */
function TagLabel({ label: l }: { label: PrintableLabel }) {
  const t = useTranslations("tag.print");
  const hint = l.qr && l.nfc ? "both" : l.qr ? "QR" : "NFC";
  return (
    <div className="flex h-full flex-col items-center gap-1.5 rounded-lg border bg-white p-3 text-center text-black print:rounded-none print:border-dashed print:border-neutral-400 print:p-[4mm]">
      {l.svg ? (
        <div
          className="aspect-square w-full max-w-44 print:w-[42mm] [&>svg]:size-full"
          // Server-generated SVG (qrcode) of our own URL.
          dangerouslySetInnerHTML={{ __html: l.svg }}
        />
      ) : (
        <div className="flex aspect-square w-full max-w-44 flex-col items-center justify-center gap-2 rounded-full border-[3px] border-dashed border-black print:w-[42mm]">
          <Nfc className="size-16 print:size-[18mm]" strokeWidth={1.5} aria-hidden />
          <span className="text-sm font-semibold">{t("tapHere")}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-base leading-tight font-semibold">
        {l.chore.icon && <span aria-hidden>{l.chore.icon}</span>}
        <span>{l.chore.title}</span>
      </div>
      {l.label && <div className="text-xs text-neutral-600">{l.label}</div>}
      <div className="flex items-center gap-1.5">
        {l.qr && (
          <span className="inline-flex items-center gap-1 rounded-full border border-black px-2 py-0.5 text-[11px] font-medium">
            <QrCode className="size-3" aria-hidden />
            {t("scan")}
          </span>
        )}
        {l.nfc && (
          <span className="inline-flex items-center gap-1 rounded-full border border-black px-2 py-0.5 text-[11px] font-medium">
            <Nfc className="size-3" aria-hidden />
            {t("tap")}
          </span>
        )}
      </div>
      <div className="text-[10px] text-neutral-600">{t(`hint.${hint}`)}</div>
      <div className="mt-auto font-mono text-[8px] break-all text-neutral-500">{l.url}</div>
    </div>
  );
}
