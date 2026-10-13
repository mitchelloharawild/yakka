import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toSqliteSchema } from "../../scripts/sqlite-schema.mjs";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("SQLite schema", () => {
  it("is in sync with prisma/schema.prisma (run `npm run db:sqlite:schema`)", () => {
    expect(read("prisma/sqlite/schema.prisma")).toBe(toSqliteSchema(read("prisma/schema.prisma")));
  });

  it("only swaps the provider and client output", () => {
    const out: string = toSqliteSchema(read("prisma/schema.prisma"));
    expect(out).toContain('provider = "sqlite"');
    expect(out).toContain('output   = "../../src/generated/prisma-sqlite"');
    expect(out).not.toContain("postgresql");
  });

  it("has its own migrations directory locked to sqlite", () => {
    expect(read("prisma/sqlite/migrations/migration_lock.toml")).toContain('provider = "sqlite"');
  });
});
