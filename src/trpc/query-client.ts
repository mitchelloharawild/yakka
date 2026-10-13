import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";
import superjson from "superjson";

/** QueryClient used on both server (RSC prefetch) and client. */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR we usually want to avoid refetching immediately on the client.
        staleTime: 30 * 1000,
        // No realtime layer: refetching on focus keeps household devices in sync.
        refetchOnWindowFocus: true,
      },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  });
}
