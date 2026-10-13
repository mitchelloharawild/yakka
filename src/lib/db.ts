import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaClient as SqlitePrismaClient } from "@/generated/prisma-sqlite/client";

/** A Prisma client or an interactive-transaction client; accept this in services. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** "sqlite" when DATABASE_PROVIDER=sqlite or DATABASE_URL is a `file:` URL; otherwise "postgresql". */
export function databaseProvider(
  url: string | undefined = process.env.DATABASE_URL,
  provider: string | undefined = process.env.DATABASE_PROVIDER,
): "postgresql" | "sqlite" {
  return provider === "sqlite" || url?.startsWith("file:") ? "sqlite" : "postgresql";
}

/**
 * Create the client for DATABASE_URL.
 *
 * Prisma 7 bakes the provider into the generated client, so there are two:
 * `src/generated/prisma` (Postgres, from prisma/schema.prisma) and
 * `src/generated/prisma-sqlite` (from prisma/sqlite/schema.prisma, which
 * scripts/sqlite-schema.mjs derives from the main schema). Both are generated
 * on install, so one build/image serves either database. Their model types
 * are identical and the error classes come from the shared Prisma runtime
 * (so `instanceof Prisma.PrismaClientKnownRequestError` works for both); the
 * rest of the app keeps importing types from `@/generated/prisma/client`.
 * The provider-specific query engine is only loaded on first query.
 *
 * Caveat: Postgres-only query features (e.g. `mode: "insensitive"`) type-check
 * but fail at runtime on SQLite. Don't use them.
 */
function createClient(url: string | undefined): PrismaClient {
  if (databaseProvider(url) === "sqlite") {
    const adapter = new PrismaBetterSqlite3({ url: url ?? "file:./data/yakka.db", timeout: 10_000 });
    return new SqlitePrismaClient({ adapter }) as unknown as PrismaClient;
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The shared Prisma client. Constructing it does not connect, so importing
 * this module is safe at build time. Server-only.
 */
export const prisma = globalForPrisma.prisma ?? createClient(process.env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
