import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "@/trpc/init";
import { TRPC_MAX_BATCH } from "@/trpc/limits";
import { appRouter } from "@/trpc/routers/_app";

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    // Bounded batches: one HTTP request can't carry an unlimited number of
    // calls (PIN guesses, tag calls). The client's httpBatchLink uses the same limit.
    maxBatchSize: TRPC_MAX_BATCH,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            if (error.code === "INTERNAL_SERVER_ERROR") console.error(`tRPC error on ${path ?? "<no-path>"}:`, error);
          }
        : undefined,
  });
}

export { handler as GET, handler as POST };
