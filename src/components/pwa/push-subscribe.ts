import { urlBase64ToUint8Array } from "./platform";

/**
 * Ask for notification permission and get (or create) this device's push
 * subscription. Returns null if permission wasn't granted, along with the
 * resulting permission so callers can reflect it.
 */
export async function requestPushSubscription(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<{ permission: NotificationPermission; subscription: PushSubscription | null }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { permission, subscription: null };
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  return { permission, subscription };
}

/** A PushSubscription in the shape `push.subscribe` expects. */
export function subscriptionInput(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}
