/**
 * Root router. Each sub-router lives in its own file owned by one area, so
 * this file should not need editing. Add procedures to the sub-routers.
 */
import { createCallerFactory, createTRPCRouter } from "@/trpc/init";
import { groupsRouter } from "@/trpc/routers/groups";
import { integrationsRouter } from "@/trpc/routers/integrations";
import { pushRouter } from "@/trpc/routers/push";
import { tagsRouter } from "@/trpc/routers/tags";

export const appRouter = createTRPCRouter({
  groups: groupsRouter,
  tags: tagsRouter,
  integrations: integrationsRouter,
  push: pushRouter,
});

/** Type of the root router; import with `import type` on the client. */
export type AppRouter = typeof appRouter;

/** Server-side caller factory: `createCaller(await createTRPCContext())`. */
export const createCaller = createCallerFactory(appRouter);
