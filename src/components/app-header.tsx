import Link from "next/link";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Minimal app header. Pages can render extra controls next to the name via
 * `children` (e.g. a group switcher).
 */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  const t = useTranslations("common.app");
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        <Link href="/" className="font-heading text-lg font-semibold tracking-tight">
          {t("name")}
        </Link>
        <div className="flex flex-1 items-center gap-2">{children}</div>
        <ThemeToggle />
      </div>
    </header>
  );
}
