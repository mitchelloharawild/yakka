/**
 * In-process cron for self-hosted (Docker) installs. OWNED BY: Agent D.
 * Loaded from src/instrumentation.ts in the Node.js runtime only.
 *
 * Runs `runCronTick()` (Agent C, src/lib/integrations/cron.ts) every 5
 * minutes when ENABLE_INTERNAL_CRON is true. Never on Vercel (functions
 * don't live long enough; use Vercel Cron). Overlapping runs are skipped.
 * With several replicas, every replica runs the tick; the jobs are
 * idempotent (ChoreNotice unique key, delivery row claims), so that only
 * costs some duplicate work. Also enables WAL mode for SQLite.
 */
import "server-only";

const SCHEDULE = "*/5 * * * *";
const globalForCron = globalThis as unknown as { yakkaCronStarted?: boolean };

function flag(value: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export async function startInternalCron(): Promise<void> {
  if (globalForCron.yakkaCronStarted) return; // HMR / double register
  globalForCron.yakkaCronStarted = true;

  await enableSqliteWal();

  if (!flag(process.env.ENABLE_INTERNAL_CRON) || process.env.VERCEL) return;
  // Not during `next build` (instrumentation also runs while prerendering).
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const [{ schedule }, { runCronTick }] = await Promise.all([import("node-cron"), import("@/lib/integrations/cron")]);
  schedule(
    SCHEDULE,
    async () => {
      try {
        await runCronTick();
      } catch (e) {
        console.error("[cron] tick failed", e);
      }
    },
    { name: "yakka-tick", noOverlap: true },
  );
  console.log(`[cron] internal scheduler started (${SCHEDULE})`);
}

/** SQLite: WAL lets readers proceed during writes. Persistent per database file. */
async function enableSqliteWal() {
  const { databaseProvider, prisma } = await import("@/lib/db");
  if (databaseProvider() !== "sqlite" || process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  } catch (e) {
    console.warn("[db] could not enable SQLite WAL mode", e);
  }
}
