import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ChoresView } from "@/components/group/chores-view";
import { ListSkeleton } from "@/components/group/skeletons";
import { ensureGroup } from "@/components/group/server";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

export async function generateMetadata() {
  const t = await getTranslations("group.nav");
  return { title: t("chores") };
}

export default function ChoresPage({ params }: PageProps<"/groups/[groupId]">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <Chores params={params} />
    </Suspense>
  );
}

async function Chores({ params }: { params: PageProps<"/groups/[groupId]">["params"] }) {
  const { groupId } = await params;
  await ensureGroup(groupId);
  await prefetch(trpc.groups.chores.list.queryOptions({ groupId }));
  await prefetch(trpc.groups.members.tallies.queryOptions({ groupId }));
  return (
    <HydrateClient>
      <ChoresView />
    </HydrateClient>
  );
}
