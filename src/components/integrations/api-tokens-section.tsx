"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useContext, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";
import {
  ago,
  CodeValue,
  ConfirmButton,
  IntegrationsContext,
  SecretDialog,
  useErrorToast,
  useMutationBase,
} from "@/components/integrations/shared";

/** API tokens: create (shown once), list, revoke. */
export function ApiTokensSection({ apiBase, exampleChoreId }: { apiBase: string; exampleChoreId?: string }) {
  const t = useTranslations("integrations");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { groupId } = useContext(IntegrationsContext);
  const base = useMutationBase();
  const onError = useErrorToast();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const tokens = useQuery(trpc.integrations.tokens.list.queryOptions({ groupId }));
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.integrations.tokens.list.queryKey({ groupId }) });
  const create = useMutation(
    trpc.integrations.tokens.create.mutationOptions({
      onSuccess: (res) => {
        setCreated(res.token);
        setName("");
        void invalidate();
      },
      onError,
    }),
  );
  const revoke = useMutation(trpc.integrations.tokens.revoke.mutationOptions({ onSuccess: invalidate, onError }));

  const all = tokens.data ?? [];
  const active = all.filter((x) => !x.revokedAt);
  const revoked = all.filter((x) => x.revokedAt);
  const visible = showRevoked ? all : active;
  const curl = `curl -X POST ${apiBase}/chores/${exampleChoreId ?? "<choreId>"}/complete \\
  -H "Authorization: Bearer ${created ?? "<token>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"member": "Alex"}'`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" />
          {t("tokens.title")}
        </CardTitle>
        <CardDescription>{t("tokens.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ ...base(), name: name.trim() });
          }}
        >
          <Input
            aria-label={t("common.name")}
            placeholder={t("tokens.namePlaceholder")}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? t("common.creating") : t("tokens.new")}
          </Button>
        </form>

        {tokens.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : active.length === 0 && !showRevoked ? (
          <p className="text-sm text-muted-foreground">{t("tokens.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {visible.map((tok) => (
              <li key={tok.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="truncate">{tok.name}</span>
                    {tok.revokedAt && <Badge variant="secondary">{t("common.revoked")}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <code className="font-mono">{tok.prefix}…</code> ·{" "}
                    {tok.lastUsedAt ? t("common.lastUsed", { when: ago(tok.lastUsedAt) }) : t("common.neverUsed")}
                  </div>
                </div>
                {!tok.revokedAt && (
                  <ConfirmButton
                    message={t("common.revokeConfirm", { name: tok.name })}
                    confirmLabel={t("common.revoke")}
                    disabled={revoke.isPending}
                    onConfirm={() => revoke.mutate({ ...base(), tokenId: tok.id })}
                  >
                    {t("common.revoke")}
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {revoked.length > 0 && !showRevoked && (
          <Button variant="link" size="sm" className="self-start px-0" onClick={() => setShowRevoked(true)}>
            {t("tokens.showRevoked", { count: revoked.length })}
          </Button>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("tokens.exampleTitle")}</summary>
          <div className="mt-2">
            <CodeValue value={curl} multiline />
          </div>
        </details>
      </CardContent>

      <SecretDialog open={created !== null} onClose={() => setCreated(null)} title={t("tokens.createdTitle")} secret={created}>
        <p className="text-sm text-muted-foreground">{t("tokens.exampleTitle")}</p>
        <CodeValue value={curl} multiline />
      </SecretDialog>
    </Card>
  );
}
