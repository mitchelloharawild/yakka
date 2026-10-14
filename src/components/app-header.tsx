import { BookOpenIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

/**
 * Minimal app header. Pages can render extra controls next to the name via
 * `children` (e.g. a group switcher).
 */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  const t = useTranslations("common");
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        <Link href="/" className="font-heading text-lg font-semibold tracking-tight">
          {t("app.name")}
        </Link>
        <div className="flex flex-1 items-center gap-2">{children}</div>
        <Button asChild variant="ghost" size="icon" className="gap-1.5 sm:w-auto sm:px-3">
          <Link href="/docs" aria-label={t("docs.title")}>
            <BookOpenIcon className="size-5" />
            <span className="hidden sm:inline">{t("docs.title")}</span>
          </Link>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
