/**
 * /groups/{groupId}/tags/print: printable A4 sheet of tag labels (QR code
 * and/or NFC tap mark). `?tag={id}` preselects just that tag. OWNED BY: Agent B.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintSheet } from "@/components/tag/print-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { findGroup } from "@/lib/services/groups";
import { printableTags } from "@/lib/services/tags";

export const metadata: Metadata = {
  title: "Print labels",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = PageProps<"/groups/[groupId]/tags/print">;

export default function PrintPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Sheet params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Sheet({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { groupId } = await params;
  const { tag } = await searchParams;
  if (!(await findGroup(groupId))) notFound();
  const tags = await printableTags(groupId);
  const only = typeof tag === "string" && tags.some((t) => t.id === tag) ? [tag] : null;
  return (
    <PrintSheet
      groupId={groupId}
      initialSelected={only}
      labels={tags.map((t) => ({
        id: t.id,
        url: t.url,
        svg: t.svg,
        qr: t.qr,
        nfc: t.nfc,
        label: t.label,
        chore: { title: t.chore.title, icon: t.chore.icon },
      }))}
    />
  );
}
