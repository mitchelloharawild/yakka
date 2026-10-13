"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** QR code rendered client-side to inline SVG (dark modules on white, so it scans in dark mode too). */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [svg, setSvg] = useState<{ value: string; svg: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: "svg", margin: 2, errorCorrectionLevel: "M" })
      .then((s) => !cancelled && setSvg({ value, svg: s }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!svg || svg.value !== value) return <Skeleton className={cn("aspect-square w-48 rounded-xl", className)} />;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("aspect-square w-48 overflow-hidden rounded-xl bg-white p-1 [&_svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: svg.svg }}
    />
  );
}
