import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/** A Prisma client or an interactive-transaction client; accept this in services. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Pick the driver adapter from DATABASE_URL. Postgres is the default.
 *
 * TODO(Agent D / SQLite): `file:` URLs should use PrismaBetterSqlite3 from
 * @prisma/adapter-better-sqlite3. With the `prisma-client` generator the
 * provider is baked into the generated client, so SQLite also needs a client
 * generated from a SQLite copy of schema.prisma; swap the import accordingly.
 */
function createAdapter(url: string | undefined) {
  if (url?.startsWith("file:")) {
    throw new Error("SQLite DATABASE_URL (file:...) is not supported yet; see the TODO in src/lib/db.ts");
  }
  return new PrismaPg({ connectionString: url });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The shared Prisma client. Constructing it does not connect, so importing
 * this module is safe at build time. Server-only.
 */
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: createAdapter(process.env.DATABASE_URL) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
