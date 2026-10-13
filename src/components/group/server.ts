import "server-only";
import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";
import { isPlausibleGroupId } from "@/lib/ids";
import { getQueryClient, prefetch, trpc } from "@/trpc/server";

/**
 * Load the group into the request's QueryClient (deduplicated between the
 * layout and the page, which render in parallel), or render the group
 * not-found page. Call before prefetching anything else for the group.
 */
export async function ensureGroup(groupId: string) {
  if (!isPlausibleGroupId(groupId)) notFound();
  const options = trpc.groups.get.queryOptions({ groupId });
  await prefetch(options);
  try {
    return await getQueryClient().fetchQuery(options);
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
