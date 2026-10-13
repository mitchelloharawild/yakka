import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ActivityView } from "@/components/group/activity-view";
import { ACTIVITY_PAGE_SIZE } from "@/components/group/constants";
import { ListSkeleton } from "@/components/group/skeletons";
import { ensureGroup } from "@/components/group/server";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

export async function generateMetadata() {
  const t = await getTranslations("group.nav");
  return { title: t("activity") };
}

export default function ActivityPage({ params }: PageProps<"/groups/[groupId]/activity">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Activity params={params} />
    </Suspense>
  );
}

async function Activity({ params }: { params: PageProps<"/groups/[groupId]/activity">["params"] }) {
  const { groupId } = await params;
  await ensureGroup(groupId);
  await prefetch(
    trpc.groups.activity.list.infiniteQueryOptions(
      { groupId, limit: ACTIVITY_PAGE_SIZE },
      { getNextPageParam: (last) => last.nextCursor },
    ),
  );
  return (
    <HydrateClient>
      <ActivityView />
    </HydrateClient>
  );
}
