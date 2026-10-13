// Type-safe message keys for next-intl, generated from the English files.
// Adding keys to messages/en/<ns>.json makes them available as
// useTranslations("<ns>")("key") with type checking.
import type common from "../../messages/en/common.json";
import type group from "../../messages/en/group.json";
import type integrations from "../../messages/en/integrations.json";
import type pwa from "../../messages/en/pwa.json";
import type tag from "../../messages/en/tag.json";
import type { Locale } from "@/i18n/config";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: {
      common: typeof common;
      group: typeof group;
      tag: typeof tag;
      integrations: typeof integrations;
      pwa: typeof pwa;
    };
  }
}
