"use client";

/** The /groups/[groupId]/integrations page body. OWNED BY: Agent C. */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ApiTokensSection } from "@/components/integrations/api-tokens-section";
import { InboundHooksSection } from "@/components/integrations/inbound-hooks-section";
import { IntegrationsContext } from "@/components/integrations/shared";
import { WebhooksSection } from "@/components/integrations/webhooks-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/trpc/client";

export function IntegrationsView({ groupId }: { groupId: string }) {
  const t = useTranslations("integrations");
  const trpc = useTRPC();
  const [pin, setPin] = useState("");
  const group = useQuery(trpc.groups.get.queryOptions({ groupId }));
  const chores = useQuery(trpc.groups.chores.list.queryOptions({ groupId }));
  const info = useQuery(trpc.integrations.info.queryOptions({ groupId }));
  const ctx = useMemo(() => ({ groupId, pin }), [groupId, pin]);

  const members = (group.data?.members ?? []).filter((m) => !m.archivedAt);
  const choreList = (chores.data ?? []).map((c) => ({ id: c.id, title: c.title, icon: c.icon }));

  return (
    <IntegrationsContext.Provider value={ctx}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Button asChild variant="ghost" size="sm" className="self-start px-1">
            <Link href={`/groups/${groupId}`}>
              <ArrowLeftIcon />
              {t("back")}
            </Link>
          </Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {group.data ? <span className="font-medium text-foreground">{group.data.name}</span> : null}
            {group.data ? " · " : null}
            {t("intro")}
          </p>
        </div>

        {group.error ? (
          <p className="text-sm text-destructive">{group.error.message}</p>
        ) : !group.data || !info.data ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {group.data.hasSettingsPin && (
              <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3">
                <Label htmlFor="integrations-pin">{t("pin.label")}</Label>
                <p className="text-xs text-muted-foreground">{t("pin.help")}</p>
                <Input
                  id="integrations-pin"
                  className="max-w-40"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={t("pin.placeholder")}
                  value={pin}
                  maxLength={8}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            )}
            <ApiTokensSection apiBase={info.data.apiBase} exampleChoreId={choreList[0]?.id} />
            <InboundHooksSection chores={choreList} members={members} />
            <WebhooksSection />
            <p className="text-xs text-muted-foreground">{t("docsHint")}</p>
          </>
        )}
      </div>
    </IntegrationsContext.Provider>
  );
}
