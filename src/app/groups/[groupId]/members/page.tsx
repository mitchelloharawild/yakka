import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MembersView } from "@/components/group/members-view";
import { ListSkeleton } from "@/components/group/skeletons";
import { ensureGroup } from "@/components/group/server";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

export async function generateMetadata() {
  const t = await getTranslations("group.nav");
  return { title: t("members") };
}

export default function MembersPage({ params }: PageProps<"/groups/[groupId]/members">) {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Members params={params} />
    </Suspense>
  );
}

async function Members({ params }: { params: PageProps<"/groups/[groupId]/members">["params"] }) {
  const { groupId } = await params;
  await ensureGroup(groupId);
  await prefetch(trpc.groups.members.tallies.queryOptions({ groupId }));
  return (
    <HydrateClient>
      <MembersView />
    </HydrateClient>
  );
}
