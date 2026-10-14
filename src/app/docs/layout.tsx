import { DocsNav } from "@/components/docs/docs-nav";
import { DOCS } from "@/lib/docs";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="flex flex-col gap-6 pb-8">
      <DocsNav docs={DOCS.map(({ slug, title }) => ({ slug, title }))} />
      {children}
    </div>
  );
}
