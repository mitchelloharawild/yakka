/** /groups/[groupId]/integrations — API tokens, inbound hooks, outbound webhooks. OWNED BY: Agent C. */
import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsView } from "@/components/integrations/integrations-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Integrations", robots: { index: false } };

export default function IntegrationsPage({ params }: PageProps<"/groups/[groupId]/integrations">) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Integrations params={params} />
    </Suspense>
  );
}

async function Integrations({ params }: { params: PageProps<"/groups/[groupId]/integrations">["params"] }) {
  const { groupId } = await params;
  return <IntegrationsView groupId={groupId} />;
}
