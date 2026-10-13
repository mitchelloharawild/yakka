import "server-only";

/**
 * tRPC from React Server Components.
 *
 *  - Prefetch for a client component (hydrated through HydrateClient):
 *      prefetch(trpc.groups.get.queryOptions({ groupId }));
 *      return <HydrateClient><GroupView groupId={groupId} /></HydrateClient>;
 *  - Read data directly in an RSC:
 *      const group = await caller().groups.get({ groupId });
 *
 * With cacheComponents, these are uncached DB reads: render them inside a
 * <Suspense> boundary (see docs/DEVELOPMENT.md).
 */
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCOptionsProxy, type TRPCQueryOptions } from "@trpc/tanstack-react-query";
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

/** Direct server-side caller (no HTTP). */
export const caller = cache(async () => createCaller(await createTRPCContext()));

/** Wrap client components that use prefetched queries. */
export function HydrateClient({ children }: { children: React.ReactNode }) {
  return <HydrationBoundary state={dehydrate(getQueryClient())}>{children}</HydrationBoundary>;
}

/** Start a prefetch (not awaited: pending queries are streamed to the client). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(queryOptions: T) {
  const queryClient = getQueryClient();
  if (queryOptions.queryKey[1]?.type === "infinite") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void queryClient.prefetchInfiniteQuery(queryOptions as any);
  } else {
    void queryClient.prefetchQuery(queryOptions);
  }
}
