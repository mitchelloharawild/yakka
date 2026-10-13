import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupProvider } from "@/components/group/group-context";
import { GroupShell } from "@/components/group/group-shell";
import { GroupShellSkeleton } from "@/components/group/skeletons";
import { ensureGroup } from "@/components/group/server";
import { HydrateClient } from "@/trpc/server";

export const metadata: Metadata = {
  // The URL is the group's secret: keep it out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GroupLayout({ children, params }: LayoutProps<"/groups/[groupId]">) {
  return (
    <Suspense fallback={<GroupShellSkeleton />}>
      <GroupLoader params={params}>{children}</GroupLoader>
    </Suspense>
  );
}

async function GroupLoader({
  params,
  children,
}: {
  params: LayoutProps<"/groups/[groupId]">["params"];
  children: React.ReactNode;
}) {
  const { groupId } = await params;
  await ensureGroup(groupId);
  return (
    <HydrateClient>
      <GroupProvider groupId={groupId}>
        <GroupShell>{children}</GroupShell>
      </GroupProvider>
    </HydrateClient>
  );
}
