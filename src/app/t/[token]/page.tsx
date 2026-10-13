/**
 * /t/{token}: the page a QR code / NFC tag opens (docs/ARCHITECTURE.md §3).
 *
 * This GET is strictly read-only: link previewers, the iOS QR preview and
 * NFC prefetchers load it too. The server renders a shell (chore + group
 * name) and the client component decides whether to record a completion.
 * The response is per-request (DB read inside Suspense), so Next sends it
 * with `Cache-Control: private, no-cache, no-store`.
 */
import type { Metadata } from "next";
import { io } from "next/cache";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TagTap } from "@/components/tag/tag-tap";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainError } from "@/lib/errors";
import { resolveTag, type ResolvedTag } from "@/lib/services/tags";

export const metadata: Metadata = {
  title: "Tap",
  robots: { index: false, follow: false, nocache: true },
  // Don't leak the tag token to other sites through the Referer header.
  referrer: "no-referrer",
};

export default function TagPage({ params }: PageProps<"/t/[token]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <TagShell params={params} />
    </Suspense>
  );
}

async function TagShell({ params }: { params: PageProps<"/t/[token]">["params"] }) {
  const { token } = await params;
  await io();
  let resolved: ResolvedTag;
  try {
    resolved = await resolveTag({ token });
  } catch (err) {
    if (err instanceof DomainError) return <TagError reason={err.reason} />;
    throw err;
  }
  const { chore, group, tag } = resolved;
  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-4">
      <header className="flex flex-col items-center gap-1 text-center">
        <div className="text-6xl leading-none" aria-hidden>
          {chore.icon || "✅"}
        </div>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">{chore.title}</h1>
        <p className="text-sm text-muted-foreground">
          {group.name}
          {tag.label ? ` · ${tag.label}` : ""}
        </p>
      </header>
      <TagTap token={token} initial={resolved} />
    </section>
  );
}

async function TagError({ reason }: { reason: string }) {
  const t = await getTranslations("tag.errors");
  const message =
    reason === "TAG_REVOKED" ? t("TAG_REVOKED") : reason === "TAG_NOT_FOUND" ? t("TAG_NOT_FOUND") : t("generic");
  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-16 text-center">
      <div className="text-6xl" aria-hidden>
        🏷️
      </div>
      <h1 className="font-heading text-2xl font-semibold">{t("titleBroken")}</h1>
      <p className="text-muted-foreground">{message}</p>
    </section>
  );
}

function ShellSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-4">
      <Skeleton className="size-16 rounded-full" />
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-6 size-40 rounded-full" />
    </div>
  );
}
