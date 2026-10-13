/**
 * i18n configuration. No locale prefixes in URLs: the locale comes from the
 * NEXT_LOCALE cookie, then Accept-Language, then the default (like Spliit).
 */

/** Supported locales. Add a locale here and a messages/<locale>/ folder. */
export const locales = ["en"] as const;
/** A supported locale. */
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
/** Cookie that stores an explicit locale choice. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * Message namespaces: one JSON file each in messages/<locale>/<namespace>.json,
 * exposed as `useTranslations("<namespace>")`. Each file is owned by one
 * area so parallel work doesn't collide:
 *  - common: shared UI (app shell, buttons, errors)   - group: group UI (A)
 *  - tag: tags + tap-to-complete (B)                    - integrations: API/webhooks (C)
 *  - pwa: install, offline, push (D)
 */
export const namespaces = ["common", "group", "tag", "integrations", "pwa"] as const;
export type Namespace = (typeof namespaces)[number];

/** Whether `value` is a supported locale. */
export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/**
 * Pick a locale from the cookie value and the Accept-Language header.
 * Matches exact tags first, then the base language ("en-AU" -> "en").
 */
export function resolveLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((p) => p.tag && p.tag !== "*" && !Number.isNaN(p.q))
    .sort((a, b) => b.q - a.q);
  for (const { tag } of prefs) {
    const exact = locales.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const base = locales.find((l) => l.split("-")[0].toLowerCase() === tag.split("-")[0].toLowerCase());
    if (base) return base;
  }
  return defaultLocale;
}
