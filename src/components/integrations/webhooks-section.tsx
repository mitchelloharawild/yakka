"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useContext, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EventType } from "@/lib/events";
import { useTRPC } from "@/trpc/client";
import {
  ago,
  ConfirmButton,
  IntegrationsContext,
  SecretDialog,
  useErrorToast,
  useMutationBase,
} from "@/components/integrations/shared";

const ALL_EVENTS: EventType[] = ["chore.completed", "chore.undone", "chore.due", "chore.overdue"];
// next-intl keys can't contain ".".
const EVENT_KEYS = {
  "chore.completed": "completed",
  "chore.undone": "undone",
  "chore.due": "due",
  "chore.overdue": "overdue",
} as const satisfies Record<EventType, string>;

/** Outbound webhooks: create, list with recent deliveries, test, enable/disable, secrets, delete. */
export function WebhooksSection() {
  const t = useTranslations("integrations");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { groupId } = useContext(IntegrationsContext);
  const base = useMutationBase();
  const onError = useErrorToast();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [events, setEvents] = useState<EventType[]>(["chore.completed"]);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);

  const listOpts = trpc.integrations.webhooks.list.queryOptions({ groupId });
  const hooks = useQuery({ ...listOpts, refetchInterval: 15_000 });
  const invalidate = () => qc.invalidateQueries({ queryKey: listOpts.queryKey });

  const create = useMutation(
    trpc.integrations.webhooks.create.mutationOptions({
      onSuccess: (res) => {
        setUrl("");
        setName("");
        setEvents(["chore.completed"]);
        setSecret({ title: t("webhooks.createdTitle"), value: res.secret });
        void invalidate();
      },
      onError,
    }),
  );
  const setEnabled = useMutation(trpc.integrations.webhooks.setEnabled.mutationOptions({ onSuccess: invalidate, onError }));
  const remove = useMutation(trpc.integrations.webhooks.delete.mutationOptions({ onSuccess: invalidate, onError }));
  const reveal = useMutation(
    trpc.integrations.webhooks.revealSecret.mutationOptions({
      onSuccess: (res) => setSecret({ title: t("webhooks.secret"), value: res.secret }),
      onError,
    }),
  );
  const rotate = useMutation(
    trpc.integrations.webhooks.rotateSecret.mutationOptions({
      onSuccess: (res) => setSecret({ title: t("webhooks.secret"), value: res.secret }),
      onError,
    }),
  );
  const test = useMutation(
    trpc.integrations.webhooks.test.mutationOptions({
      onSuccess: (res) =>
        res.ok
          ? toast.success(t("webhooks.testOk", { status: res.status ?? 0, ms: res.durationMs }))
          : toast.error(t("webhooks.testFailed", { error: res.error ?? "?" })),
      onError,
    }),
  );

  const toggle = (e: EventType, on: boolean) =>
    setEvents((prev) => (on ? [...new Set([...prev, e])] : prev.filter((x) => x !== e)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SendIcon className="size-4" />
          {t("webhooks.title")}
        </CardTitle>
        <CardDescription>{t("webhooks.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ ...base(), webhook: { url: url.trim(), name: name.trim() || null, events } });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-url">{t("webhooks.url")}</Label>
              <Input
                id="wh-url"
                type="url"
                inputMode="url"
                required
                placeholder={t("webhooks.urlPlaceholder")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-name">
                {t("common.name")} <span className="text-muted-foreground">({t("common.optional")})</span>
              </Label>
              <Input id="wh-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("webhooks.events")}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ALL_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={events.includes(ev)} onCheckedChange={(c) => toggle(ev, c === true)} />
                  {t(`webhooks.eventNames.${EVENT_KEYS[ev]}`)} <code className="text-xs text-muted-foreground">{ev}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" className="self-start" disabled={!url.trim() || events.length === 0 || create.isPending}>
            {create.isPending ? t("common.creating") : t("webhooks.new")}
          </Button>
        </form>

        {hooks.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (hooks.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("webhooks.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {hooks.data!.map((w) => {
              const busy = setEnabled.isPending || remove.isPending;
              return (
                <li key={w.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{w.name ?? new URL(w.url).host}</span>
                    {w.disabledAt ? (
                      <Badge variant="destructive">{t("webhooks.disabled")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("webhooks.enabled")}</Badge>
                    )}
                    {w.failCount > 0 && (
                      <span className="text-xs text-destructive">{t("webhooks.failures", { count: w.failCount })}</span>
                    )}
                  </div>
                  <code className="font-mono text-xs break-all text-muted-foreground">{w.url}</code>
                  <div className="flex flex-wrap gap-1">
                    {w.events.map((ev) => (
                      <Badge key={ev} variant="outline">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                  {w.disabledAt && w.failCount > 0 && (
                    <p className="text-xs text-destructive">{t("webhooks.autoDisabled")}</p>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {w.lastDeliveredAt && t("webhooks.lastDelivered", { when: ago(w.lastDeliveredAt) })}
                    {w.lastError && (
                      <span className="block break-all">{t("webhooks.lastError", { error: w.lastError })}</span>
                    )}
                  </div>

                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{t("webhooks.recent")}</summary>
                    {w.deliveries.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">{t("webhooks.noDeliveries")}</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1 text-xs">
                        {w.deliveries.map((d) => {
                          const state = d.deliveredAt
                            ? "delivered"
                            : d.failedAt
                              ? "failed"
                              : d.attempts > 0
                                ? "retrying"
                                : "pending";
                          return (
                            <li key={d.id} className="flex flex-wrap items-center gap-x-2">
                              <Badge
                                variant={state === "delivered" ? "secondary" : state === "failed" ? "destructive" : "outline"}
                              >
                                {t(`webhooks.status.${state}`)}
                              </Badge>
                              <code>{d.event}</code>
                              <span className="text-muted-foreground">
                                {ago(d.createdAt)} · {t("webhooks.attempts", { count: d.attempts })}
                                {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
                              </span>
                              {d.lastError && !d.deliveredAt && (
                                <span className="w-full break-all text-muted-foreground">{d.lastError}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </details>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={test.isPending}
                      onClick={() => test.mutate({ ...base(), webhookId: w.id })}
                    >
                      {t("webhooks.test")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setEnabled.mutate({ ...base(), webhookId: w.id, enabled: Boolean(w.disabledAt) })}
                    >
                      {w.disabledAt ? t("webhooks.enable") : t("webhooks.disable")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reveal.mutate({ ...base(), webhookId: w.id })}>
                      {t("webhooks.reveal")}
                    </Button>
                    <ConfirmButton
                      variant="outline"
                      message={t("webhooks.rotateConfirm")}
                      confirmLabel={t("webhooks.rotate")}
                      onConfirm={() => rotate.mutate({ ...base(), webhookId: w.id })}
                    >
                      {t("webhooks.rotate")}
                    </ConfirmButton>
                    <ConfirmButton
                      message={t("webhooks.deleteConfirm")}
                      confirmLabel={t("common.delete")}
                      disabled={busy}
                      onConfirm={() => remove.mutate({ ...base(), webhookId: w.id })}
                    >
                      {t("common.delete")}
                    </ConfirmButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <SecretDialog open={secret !== null} onClose={() => setSecret(null)} title={secret?.title ?? ""} secret={secret?.value ?? null}
        description={t("webhooks.secretHelp")}
      />
    </Card>
  );
}
