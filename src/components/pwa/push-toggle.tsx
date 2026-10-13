"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useDeviceId } from "@/lib/client/local-groups";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { getServiceWorkerRegistration, isIos, isPushSupported, isStandalone, urlBase64ToUint8Array } from "./platform";

type Support = "checking" | "unsupported" | "ios-install" | "no-sw" | "ready";

/**
 * Turn Web Push on or off for this device, for `memberId` in `groupId`.
 * Handles permission prompts, iOS (push only works from the Home Screen app,
 * iOS 16.4+), unsupported browsers and servers without VAPID keys.
 *
 * Drop it into the group settings page: `<PushToggle groupId={id} memberId={memberId} />`.
 */
export function PushToggle({
  groupId,
  memberId,
  className,
}: {
  groupId: string;
  memberId: string | null;
  className?: string;
}) {
  const t = useTranslations("pwa.push");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const deviceId = useDeviceId();
  const switchId = useId();

  const [support, setSupport] = useState<Support>("checking");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let next: Support;
      let reg: ServiceWorkerRegistration | null = null;
      let sub: PushSubscription | null = null;
      if (isIos() && !isStandalone()) next = "ios-install";
      else if (!isPushSupported()) next = "unsupported";
      else {
        reg = await getServiceWorkerRegistration();
        next = reg ? "ready" : "no-sw";
        sub = (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
      }
      if (!alive) return;
      setSupport(next);
      setRegistration(reg);
      setEndpoint(sub?.endpoint ?? null);
      if ("Notification" in window) setPermission(Notification.permission);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const vapid = useQuery({ ...trpc.push.vapidPublicKey.queryOptions(), enabled: support === "ready" });
  const statusInput = { endpoint: endpoint ?? "", memberId: memberId ?? "" };
  const status = useQuery({
    ...trpc.push.status.queryOptions(statusInput),
    enabled: support === "ready" && !!endpoint && !!memberId,
  });
  const invalidateStatus = useCallback(
    () => queryClient.invalidateQueries({ queryKey: trpc.push.status.queryKey() }),
    [queryClient, trpc],
  );

  const subscribe = useMutation(trpc.push.subscribe.mutationOptions());
  const unsubscribe = useMutation(trpc.push.unsubscribe.mutationOptions());

  const checked = !!endpoint && status.data?.subscribedHere === true;

  async function turnOn() {
    if (!registration || !memberId || !deviceId || !vapid.data) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") return;
    const sub =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.data),
      }));
    const json = sub.toJSON();
    await subscribe.mutateAsync({
      groupId,
      memberId,
      deviceId,
      subscription: {
        endpoint: sub.endpoint,
        expirationTime: sub.expirationTime,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      },
    });
    setEndpoint(sub.endpoint);
    toast.success(t("enabled"));
  }

  async function turnOff() {
    if (!registration) return;
    const sub = await registration.pushManager.getSubscription();
    if (sub) {
      await unsubscribe.mutateAsync({ endpoint: sub.endpoint });
      await sub.unsubscribe().catch(() => false);
    }
    setEndpoint(null);
    toast.success(t("disabled"));
  }

  async function onCheckedChange(on: boolean) {
    setBusy(true);
    try {
      if (on) await turnOn();
      else await turnOff();
      await invalidateStatus();
    } catch (e) {
      console.warn("Push toggle failed", e);
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  let hint: string | null = null;
  if (support === "ios-install") hint = t("iosInstall");
  else if (support === "unsupported") hint = t("unsupported");
  else if (support === "no-sw") hint = t("noServiceWorker");
  else if (support === "ready" && vapid.isSuccess && !vapid.data) hint = t("notConfigured");
  else if (permission === "denied") hint = t("denied");
  else if (!memberId) hint = t("pickMember");
  else if (status.data?.subscribedElsewhere) hint = t("elsewhere");

  const disabled =
    busy ||
    support !== "ready" ||
    !vapid.data ||
    !memberId ||
    !deviceId ||
    (permission === "denied" && !checked);

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex flex-col gap-1">
        <label htmlFor={switchId} className="text-sm font-medium">
          {t("label")}
        </label>
        <p className="text-sm text-muted-foreground">{hint ?? t("description")}</p>
      </div>
      <Switch
        id={switchId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={checked ? t("disable") : t("enable")}
      />
    </div>
  );
}
