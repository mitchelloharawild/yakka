"use client";

import { ThemeProvider } from "next-themes";
import { useSyncExternalStore } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TRPCReactProvider } from "@/trpc/client";

/** All client-side providers, mounted once in the root layout. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TRPCReactProvider>
        <TooltipProvider>
          {children}
          <ResponsiveToaster />
        </TooltipProvider>
      </TRPCReactProvider>
    </ThemeProvider>
  );
}

const PHONE = "(max-width: 639px)";
const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * Toasts at the bottom on phones (thumb reach, and clear of the sticky app
 * and group headers), at the top-centre on larger screens.
 */
function ResponsiveToaster() {
  const phone = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
  return (
    <Toaster
      richColors
      position={phone ? "bottom-center" : "top-center"}
      mobileOffset={{ bottom: "max(16px, env(safe-area-inset-bottom))", left: 16, right: 16 }}
      visibleToasts={3}
    />
  );
}
