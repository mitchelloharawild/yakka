"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Horizontal, scrollable list of the docs, highlighting the current one. */
export function DocsNav({ docs }: { docs: ReadonlyArray<{ slug: string; title: string }> }) {
  const t = useTranslations("common.docs");
  const pathname = usePathname();
  const items = [{ href: "/docs", label: t("overview") }, ...docs.map((d) => ({ href: `/docs/${d.slug}`, label: d.title }))];
  return (
    <nav aria-label={t("nav")} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex w-max gap-1 rounded-full bg-muted p-1 text-sm">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-full px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                  active && "bg-background text-foreground shadow-sm",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
