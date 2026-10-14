import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Markdown } from "@/components/docs/markdown";
import { DOCS, findDoc, loadDoc, REPO_URL } from "@/lib/docs";

type Props = PageProps<"/docs/[slug]">;

export function generateStaticParams() {
  return DOCS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = findDoc((await params).slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocPage({ params }: Props) {
  const doc = findDoc((await params).slug);
  if (!doc) notFound();
  const [markdown, t] = await Promise.all([loadDoc(doc), getTranslations("common.docs")]);
  return (
    <article className="flex flex-col gap-8">
      <Markdown>{markdown}</Markdown>
      <footer className="border-t pt-4 text-sm text-muted-foreground">
        <a href={`${REPO_URL}/edit/main/docs/${doc.file}`} className="underline underline-offset-4 hover:text-foreground">
          {t("edit")}
        </a>
      </footer>
    </article>
  );
}
