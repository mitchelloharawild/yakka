import { getRequestConfig } from "next-intl/server";
import { defaultLocale, LOCALE_COOKIE, locales, namespaces, resolveLocale, type Locale } from "@/i18n/config";

/** Load and merge all namespace files for a locale: messages/<locale>/<ns>.json -> { [ns]: ... }. */
export async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    namespaces.map(async (ns) => [ns, (await import(`../../messages/${locale}/${ns}.json`)).default] as const),
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async () => {
  // With a single locale we don't read cookies/headers at all, so pages can
  // still be prerendered under cacheComponents. Once a second locale exists,
  // reading them makes rendering request-time: the root layout then needs
  // its locale-dependent parts inside <Suspense>.
  let locale: Locale = defaultLocale;
  if (locales.length > 1) {
    const { cookies, headers } = await import("next/headers");
    const [c, h] = await Promise.all([cookies(), headers()]);
    locale = resolveLocale(c.get(LOCALE_COOKIE)?.value, h.get("accept-language"));
  }
  return {
    locale,
    messages: await loadMessages(locale),
    // Render dates in an explicit zone (the group's, passed per call) rather
    // than the server's; UTC is only the fallback.
    timeZone: "UTC",
  };
});
