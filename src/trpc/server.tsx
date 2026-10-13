import "server-only";

/**
 * tRPC from React Server Components.
 *
 *  - Prefetch for a client component (hydrated through HydrateClient):
 *      await prefetch(trpc.groups.get.queryOptions({ groupId }));
 *      return <HydrateClient><GroupView groupId={groupId} /></HydrateClient>;
 *    and in the client component: useSuspenseQuery(trpc.groups.get.queryOptions({ groupId })).
 *  - Read data directly in an RSC:
 *      const api = await caller();
 *      const group = await api.groups.get({ groupId });
 *
 * With cacheComponents these are uncached, per-request reads: the component
 * using them must be inside a <Suspense> boundary. Both helpers first
 * `await io()`, which excludes what follows from prerendering (otherwise
 * Date.now() in TanStack Query / schedule code fails the prerender).
 */
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCOptionsProxy, type TRPCQueryOptions } from "@trpc/tanstack-react-query";
import { io } from "next/cache";
import { cache } from "react";
import { createTRPCContext } from "@/trpc/init";
import { makeQueryClient } from "@/trpc/query-client";
import { appRouter, createCaller } from "@/trpc/routers/_app";

/** One QueryClient per request. */
export const getQueryClient = cache(makeQueryClient);

/** Options proxy for prefetching in RSCs. */
export const trpc = createTRPCOptionsProxy({
  ctx: () => createTRPCContext(),
  router: appRouter,
  queryClient: getQueryClient,
});

/** Direct server-side caller (no HTTP). Awaiting it marks the component as request-time. */
export async function caller() {
  await io();
  return getCaller();
}
const getCaller = cache(async () => createCaller(await createTRPCContext()));

/** Wrap client components that use prefetched queries. */
export function HydrateClient({ children }: { children: React.ReactNode }) {
  return <HydrationBoundary state={dehydrate(getQueryClient())}>{children}</HydrationBoundary>;
}

/**
 * Start a prefetch. Await it (that only awaits io(), not the query: pending
 * queries are streamed to the client through HydrateClient).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(queryOptions: T) {
  await io();
  const queryClient = getQueryClient();
  if (queryOptions.queryKey[1]?.type === "infinite") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void queryClient.prefetchInfiniteQuery(queryOptions as any);
  } else {
    void queryClient.prefetchQuery(queryOptions);
  }
}
