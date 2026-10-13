import { useTranslations } from "next-intl";

// Placeholder home page. Agent A (group UI) builds this out: create group,
// recent/starred groups from localStorage (src/lib/client/local-groups.ts).
export default function Home() {
  const t = useTranslations("common.home");
  return (
    <section className="flex flex-col gap-3 py-10">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-prose text-muted-foreground">{t("intro")}</p>
    </section>
  );
}
