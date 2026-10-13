import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
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
