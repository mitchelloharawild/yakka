"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { useDeviceId } from "@/lib/client/local-groups";
import { useTRPC } from "@/trpc/client";
import { getServiceWorkerRegistration, isIos, isPushSupported, isStandalone } from "./platform";
import { requestPushSubscription, subscriptionInput } from "./push-subscribe";

const SNOOZE_KEY = "yakka.pushNudgeSnoozedUntil";
const DAY = 24 * 60 * 60 * 1000;
/** Explicit "Not now" or swipe away. */
const SNOOZE_DISMISSED = 30 * DAY;
/** Ignored until it timed out. */
const SNOOZE_IGNORED = 3 * DAY;
/** Let the page settle (and identity toasts go) before nudging. */
const DELAY_MS = 2500;
const DURATION_MS = 20_000;

/** At most once per page load, across groups. */
let shownThisLoad = false;

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

function snooze(ms: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
  } catch {
    // storage blocked: it'll ask again next load
  }
}

type Nudge =
  | { kind: "install" }
  | { kind: "push"; registration: ServiceWorkerRegistration; vapidPublicKey: string };

/**
 * A one-off toast inside a group suggesting notifications for this device:
 * "Turn on" (asks permission and subscribes for `memberId`) where Web Push
 * works in the browser, or "Add to Home Screen" on iPhone/iPad Safari, where
 * push only works from the installed app. Stays quiet when push is already
 * on (here or for another group/member), blocked, unsupported or not
 * configured on the server, and is snoozed after being dismissed.
 */
export function PushNudge({
  groupId,
  memberId,
  suppressed = false,
}: {
  groupId: string;
  memberId: string | null;
  /** E.g. while the identity picker is open, or on the settings page. */
  suppressed?: boolean;
}) {
  const t = useTranslations("pwa.nudge");
  const tPush = useTranslations("pwa.push");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const deviceId = useDeviceId();
  const { mutateAsync: saveSubscription } = useMutation(trpc.push.subscribe.mutationOptions());

  useEffect(() => {
    if (suppressed || !memberId || !deviceId || shownThisLoad || snoozed()) return;
    let alive = true;

    async function check(): Promise<Nudge | null> {
      if (isIos() && !isStandalone()) return { kind: "install" };
      if (!isPushSupported() || Notification.permission === "denied") return null;
      const registration = await getServiceWorkerRegistration();
      if (!registration) return null;
      const vapidPublicKey = await qc.fetchQuery(trpc.push.vapidPublicKey.queryOptions());
      if (!vapidPublicKey) return null;
      const existing = await registration.pushManager.getSubscription().catch(() => null);
      if (existing) {
        const status = await qc.fetchQuery(
          trpc.push.status.queryOptions({ endpoint: existing.endpoint, memberId: memberId! }),
        );
        // Already on, or deliberately pointed at another member/group: leave it.
        if (status.subscribedHere || status.subscribedElsewhere) return null;
      }
      return { kind: "push", registration, vapidPublicKey };
    }

    async function turnOn(registration: ServiceWorkerRegistration, vapidPublicKey: string) {
      try {
        const { permission, subscription } = await requestPushSubscription(registration, vapidPublicKey);
        if (!subscription) {
          if (permission === "denied") toast.error(tPush("denied"));
          else snooze(SNOOZE_DISMISSED);
          return;
        }
        await saveSubscription({
          groupId,
          memberId: memberId!,
          deviceId: deviceId!,
          subscription: subscriptionInput(subscription),
        });
        await qc.invalidateQueries({ queryKey: trpc.push.status.queryKey() });
        toast.success(tPush("enabled"));
      } catch (e) {
        console.warn("Push nudge failed", e);
        toast.error(tPush("error"));
      }
    }

    const timer = setTimeout(async () => {
      const nudge = await check().catch(() => null);
      if (!alive || !nudge || shownThisLoad || snoozed()) return;
      shownThisLoad = true;
      const common = {
        duration: DURATION_MS,
        cancel: { label: t("notNow"), onClick: () => snooze(SNOOZE_DISMISSED) },
        onDismiss: () => snooze(SNOOZE_DISMISSED),
        onAutoClose: () => snooze(SNOOZE_IGNORED),
      };
      if (nudge.kind === "install") {
        toast(t("installTitle"), { ...common, description: t("installBody") });
      } else {
        toast(t("pushTitle"), {
          ...common,
          description: t("pushBody"),
          action: { label: t("turnOn"), onClick: () => void turnOn(nudge.registration, nudge.vapidPublicKey) },
        });
      }
    }, DELAY_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [suppressed, memberId, deviceId, groupId, qc, trpc, t, tPush, saveSubscription]);

  return null;
}
