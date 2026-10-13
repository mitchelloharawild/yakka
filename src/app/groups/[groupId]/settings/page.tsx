import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SettingsView } from "@/components/group/settings-view";
import { FormSkeleton } from "@/components/group/skeletons";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

export async function generateMetadata() {
  const t = await getTranslations("group.nav");
  return { title: t("settings") };
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<FormSkeleton sections={4} />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await prefetch(trpc.groups.config.queryOptions());
  return (
    <HydrateClient>
      <SettingsView />
    </HydrateClient>
  );
}
