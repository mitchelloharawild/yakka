/** /groups/{groupId}/tags/print: printable A4 sheet of QR labels. OWNED BY: Agent B. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintSheet } from "@/components/tag/print-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { findGroup } from "@/lib/services/groups";
import { printableTags } from "@/lib/services/tags";

export const metadata: Metadata = {
  title: "Print QR codes",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PrintPage({ params }: PageProps<"/groups/[groupId]/tags/print">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Sheet params={params} />
    </Suspense>
  );
}

async function Sheet({ params }: { params: PageProps<"/groups/[groupId]/tags/print">["params"] }) {
  const { groupId } = await params;
  if (!(await findGroup(groupId))) notFound();
  const tags = await printableTags(groupId);
  return (
    <PrintSheet
      groupId={groupId}
      labels={tags.map((t) => ({
        id: t.id,
        url: t.url,
        svg: t.svg,
        label: t.label,
        chore: { title: t.chore.title, icon: t.chore.icon },
      }))}
    />
  );
}
