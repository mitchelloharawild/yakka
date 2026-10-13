"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Reloads the page (the offline fallback's "Try again"). */
export function ReloadButton({ children }: { children: React.ReactNode }) {
  return (
    <Button onClick={() => window.location.reload()}>
      <RefreshCw aria-hidden />
      {children}
    </Button>
  );
}
