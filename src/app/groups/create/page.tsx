import { getTranslations } from "next-intl/server";
import { CreateGroupForm } from "@/components/group/create-group-form";

export async function generateMetadata() {
  const t = await getTranslations("group.create");
  return { title: t("title") };
}

export default function CreateGroupPage() {
  return <CreateGroupForm />;
}
