"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WebhookIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useContext, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTRPC } from "@/trpc/client";
import {
  ago,
  CodeValue,
  ConfirmButton,
  IntegrationsContext,
  useErrorToast,
  useMutationBase,
} from "@/components/integrations/shared";

const NOBODY = "__automation";

/** Inbound hook URLs: one per chore, with optional default member. */
export function InboundHooksSection({
  chores,
  members,
}: {
  chores: { id: string; title: string; icon: string | null }[];
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("integrations");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { groupId } = useContext(IntegrationsContext);
  const base = useMutationBase();
  const onError = useErrorToast();
  const [choreId, setChoreId] = useState("");
  const [memberId, setMemberId] = useState(NOBODY);
  const [name, setName] = useState("");

  const hooks = useQuery(trpc.integrations.hooks.list.queryOptions({ groupId }));
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.integrations.hooks.list.queryKey({ groupId }) });
  const create = useMutation(
    trpc.integrations.hooks.create.mutationOptions({
      onSuccess: () => {
        setName("");
        setChoreId("");
        setMemberId(NOBODY);
        void invalidate();
      },
      onError,
    }),
  );
  const revoke = useMutation(trpc.integrations.hooks.revoke.mutationOptions({ onSuccess: invalidate, onError }));

  const active = (hooks.data ?? []).filter((h) => !h.revokedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WebhookIcon className="size-4" />
          {t("hooks.title")}
        </CardTitle>
        <CardDescription>{t("hooks.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {chores.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("hooks.noChores")}</p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!choreId) return;
              create.mutate({
                ...base(),
                choreId,
                name: name.trim() || null,
                defaultMemberId: memberId === NOBODY ? null : memberId,
              });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hook-chore">{t("hooks.chore")}</Label>
              <Select value={choreId} onValueChange={setChoreId}>
                <SelectTrigger id="hook-chore" className="w-full">
                  <SelectValue placeholder={t("hooks.chooseChore")} />
                </SelectTrigger>
                <SelectContent>
                  {chores.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hook-member">{t("hooks.defaultMember")}</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger id="hook-member" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOBODY}>{t("hooks.automation")}</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="hook-name">
                {t("common.name")} <span className="text-muted-foreground">({t("common.optional")})</span>
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="hook-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                <Button type="submit" disabled={!choreId || create.isPending}>
                  {create.isPending ? t("common.creating") : t("hooks.new")}
                </Button>
              </div>
            </div>
          </form>
        )}

        {hooks.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("hooks.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {active.map((h) => (
              <li key={h.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {h.chore.title}
                    {h.name ? <span className="text-muted-foreground"> · {h.name}</span> : null}
                  </span>
                  {h.chore.archivedAt && <Badge variant="secondary">{t("hooks.archived")}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {t("hooks.recordedAs", { name: h.defaultMember?.name ?? t("hooks.automation") })} ·{" "}
                    {h.lastUsedAt ? t("common.lastUsed", { when: ago(h.lastUsedAt) }) : t("common.neverUsed")}
                  </span>
                  <div className="ml-auto">
                    <ConfirmButton
                      message={t("common.revokeConfirm", { name: h.name ?? h.chore.title })}
                      confirmLabel={t("common.revoke")}
                      disabled={revoke.isPending}
                      onConfirm={() => revoke.mutate({ ...base(), hookId: h.id })}
                    >
                      {t("common.revoke")}
                    </ConfirmButton>
                  </div>
                </div>
                <CodeValue value={h.url} />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{t("common.example")}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <CodeValue value={`curl -X POST ${h.url}`} />
                    <p className="text-xs text-muted-foreground">
                      {t("hooks.memberOverride", { json: '{"member": "Alex"}' })} {t("hooks.postOnly")}
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
