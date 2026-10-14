import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DOCS, REPO_URL } from "@/lib/docs";

export async function generateMetadata() {
  const t = await getTranslations("common.docs");
  return { title: t("title"), description: t("description") };
}

export default async function DocsIndexPage() {
  const t = await getTranslations("common.docs");
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          {t.rich("intro", {
            github: (chunks) => (
              <a href={REPO_URL} className="font-medium text-primary underline underline-offset-4">
                {chunks}
              </a>
            ),
          })}
        </p>
      </section>
      <ul className="flex flex-col gap-2">
        {DOCS.map((doc) => (
          <li key={doc.slug}>
            <Link
              href={`/docs/${doc.slug}`}
              className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted"
            >
              <div className="flex flex-1 flex-col gap-1">
                <span className="font-heading font-semibold">{doc.title}</span>
                <span className="text-sm text-muted-foreground">{doc.description}</span>
              </div>
              <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
