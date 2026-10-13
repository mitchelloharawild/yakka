import { z } from "zod";

/** Parses "true"/"1"/"yes" (case-insensitive) as true; anything else set is false. */
const bool = (defaultValue: boolean | (() => boolean)) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ""
        ? typeof defaultValue === "function"
          ? defaultValue()
          : defaultValue
        : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase()),
    );

/** Running on Vercel (it sets VERCEL=1): a public, multi-tenant style deployment. */
export function isVercel(): boolean {
  return Boolean(process.env.VERCEL?.trim());
}

/** Empty strings in .env files count as "not set". */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Postgres URL, or `file:...` for SQLite. Only required when the DB is used. */
  DATABASE_URL: optionalString,
  /** Public origin of the app, without trailing slash. Used to build tag/group URLs. */
  BASE_URL: optionalString.transform((v) => (v ?? "http://localhost:3000").replace(/\/+$/, "")),
  /** Shared secret for /api/cron/* (`Authorization: Bearer <CRON_SECRET>`). */
  CRON_SECRET: optionalString,
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: optionalString,
  /** Whether groups may be (soft-)deleted from the UI. */
  ENABLE_GROUP_DELETION: bool(true),
  /** Default for Group.joinFromTag on new groups. */
  ALLOW_JOIN_FROM_TAG_DEFAULT: bool(true),
  /** "plausible" or "umami" (with ANALYTICS_SITE_ID); undefined disables analytics. Read by src/lib/analytics.ts. */
  ANALYTICS_PROVIDER: optionalString,
  /**
   * Outbound webhooks may target private/LAN addresses (e.g. Home Assistant).
   * Default: true when self-hosted, false on Vercel. Set false on any public
   * instance where untrusted people can create groups.
   */
  WEBHOOK_ALLOW_PRIVATE_NETWORKS: bool(() => !isVercel()),
  /**
   * Extra Web Push service hosts to accept subscriptions for, comma-separated
   * ("push.example.com,*.push.example.net"), on top of FCM, Mozilla, Apple
   * and WNS. "*" accepts any public https host (not recommended).
   */
  PUSH_ALLOWED_HOSTS: optionalString,
  /** Optional ntfy topic URL (e.g. https://ntfy.sh/my-topic) that also receives due/overdue notices. */
  NTFY_URL: optionalString,
  /** Optional ntfy access token (sent as `Authorization: Bearer`). */
  NTFY_TOKEN: optionalString,
  /** Optional Apprise API notify URL (e.g. http://apprise:8000/notify/yakka) for due/overdue notices. */
  APPRISE_URL: optionalString,
});

/** Typed server environment. */
export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Typed, validated server environment, parsed lazily on first use so a
 * missing optional variable never breaks `next build`. Server-only: never
 * import into client components (values would be undefined there anyway).
 */
export function env(): ServerEnv {
  if (!cached) cached = serverEnvSchema.parse(process.env);
  return cached;
}

/** DATABASE_URL or throw a helpful error. */
export function requireDatabaseUrl(): string {
  const url = env().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return url;
}

/** True when both VAPID keys are configured, i.e. Web Push can be sent. */
export function isPushConfigured(): boolean {
  const e = env();
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}

/** Test helper: forget the cached env so the next env() call re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
