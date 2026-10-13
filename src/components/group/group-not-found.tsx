"use client";

import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { removeLocalGroup, useLocalGroups } from "@/lib/client/local-groups";

/** Friendly page for an unknown or deleted group. Offers to forget it locally. */
export function GroupNotFound() {
  const t = useTranslations("group.notFound");
  const pathname = usePathname();
  const groupId = /^\/groups\/([^/]+)/.exec(pathname ?? "")?.[1];
  const known = useLocalGroups().some((g) => g.id === groupId);
  return (
    <section className="flex flex-col items-center gap-4 py-16 text-center">
      <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-muted">
        <SearchXIcon className="size-8 text-muted-foreground" />
      </span>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-sm text-muted-foreground">{t("body")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild size="lg">
          <Link href="/">{t("home")}</Link>
        </Button>
        {known && groupId && (
          <Button variant="outline" size="lg" onClick={() => removeLocalGroup(groupId)}>
            {t("removeLocal")}
          </Button>
        )}
      </div>
    </section>
  );
}
