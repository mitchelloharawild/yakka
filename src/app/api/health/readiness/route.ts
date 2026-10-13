/**
 * GET /api/health/readiness: 200 when the database answers, 503 otherwise.
 */
import { connection } from "next/server";
import { databaseProvider, prisma } from "@/lib/db";

const TIMEOUT_MS = 3000;

export async function GET() {
  await connection(); // per request, never prerendered
  const headers = { "Cache-Control": "no-store" };
  const database = databaseProvider();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRawUnsafe("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      }),
    ]);
    return Response.json({ status: "ok", database }, { headers });
  } catch (e) {
    console.error("readiness: database check failed", e);
    return Response.json({ status: "unavailable", database }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
