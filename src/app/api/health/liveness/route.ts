/**
 * GET /api/health/liveness: 200 while the process is serving requests. Never
 * touches the database (use readiness for that). Used by the Docker
 * HEALTHCHECK.
 */
import { connection } from "next/server";

export async function GET() {
  await connection(); // per request, never prerendered
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
