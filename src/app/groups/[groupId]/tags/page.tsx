/** /groups/{groupId}/tags: manage a group's QR / NFC tags. OWNED BY: Agent B. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TagManager } from "@/components/tag/tag-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { findGroup } from "@/lib/services/groups";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Tags",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function TagsPage({ params }: PageProps<"/groups/[groupId]/tags">) {
  return (
    <Suspense fallback={<ManagerSkeleton />}>
      <Tags params={params} />
    </Suspense>
  );
}

async function Tags({ params }: { params: PageProps<"/groups/[groupId]/tags">["params"] }) {
  const { groupId } = await params;
  if (!(await findGroup(groupId))) notFound();
  await prefetch(trpc.tags.list.queryOptions({ groupId }));
  await prefetch(trpc.groups.chores.list.queryOptions({ groupId }));
  return (
    <HydrateClient>
      <TagManager groupId={groupId} />
    </HydrateClient>
  );
}

function ManagerSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
