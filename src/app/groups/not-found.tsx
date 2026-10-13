import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GroupNotFound } from "@/components/group/group-not-found";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("group.notFound");
  return { title: t("title") };
}

export default function NotFound() {
  return <GroupNotFound />;
}
