"use client";

/**
 * Client-side tRPC + TanStack Query. Usage in a client component:
 *
 *   const trpc = useTRPC();
 *   const chores = useQuery(trpc.groups.chores.list.queryOptions({ groupId }));
 *   const complete = useMutation(trpc.groups.chores.complete.mutationOptions());
 *   const qc = useQueryClient();
 *   qc.invalidateQueries({ queryKey: trpc.groups.chores.list.queryKey({ groupId }) });
 */
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";
import { makeQueryClient } from "@/trpc/query-client";
import type { AppRouter } from "@/trpc/routers/_app";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient(); // server: always new
  return (browserQueryClient ??= makeQueryClient()); // browser: reuse across suspense
}

function getUrl() {
  const base = typeof window !== "undefined" ? "" : `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}/api/trpc`;
}

/** Provides tRPC + QueryClient to the tree. Mounted once in the root layout. */
export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" && op.direction === "down" && op.result instanceof Error,
        }),
        httpBatchLink({ url: getUrl(), transformer: superjson }),
      ],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
