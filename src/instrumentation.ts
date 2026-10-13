/**
 * Server start-up hook. OWNED BY: Agent D.
 *
 * Starts the in-process scheduler (src/lib/cron-scheduler.ts) when
 * ENABLE_INTERNAL_CRON=true: the Docker image sets that; on Vercel, Vercel
 * Cron calls the cron endpoint instead (see docs/DEPLOYMENT.md). Node.js
 * runtime only.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startInternalCron } = await import("@/lib/cron-scheduler");
  await startInternalCron();
}
