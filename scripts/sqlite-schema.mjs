#!/usr/bin/env node
/**
 * Derives prisma/sqlite/schema.prisma from prisma/schema.prisma.
 *
 *   node scripts/sqlite-schema.mjs          # write the SQLite schema
 *   node scripts/sqlite-schema.mjs --check  # exit 1 if it is out of date
 *
 * Prisma 7 bakes the datasource provider into the generated client, so
 * SQLite needs its own schema file (and its own migrations). The main schema
 * is kept portable (see its header comment), so the only changes are the
 * provider and the generator output path: the SQLite client goes to
 * src/generated/prisma-sqlite, next to the Postgres one, and src/lib/db.ts
 * picks one at runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "prisma/schema.prisma");
const target = path.join(root, "prisma/sqlite/schema.prisma");

/** Pure transform, exported for the drift test. */
export function toSqliteSchema(schema) {
  let out = schema;
  const replace = (pattern, replacement, what) => {
    if (!pattern.test(out)) throw new Error(`sqlite-schema: could not find ${what} in prisma/schema.prisma`);
    out = out.replace(pattern, replacement);
  };
  replace(/(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"postgresql"/, '$1"sqlite"', 'provider = "postgresql"');
  replace(
    /(generator\s+client\s*\{[^}]*?output\s*=\s*)"\.\.\/src\/generated\/prisma"/,
    '$1"../../src/generated/prisma-sqlite"',
    'output = "../src/generated/prisma"',
  );
  const code = out.replace(/\/\/.*$/gm, "");
  if (/@db\./.test(code)) throw new Error("sqlite-schema: native types (@db.*) are not portable to SQLite");
  return (
    "// GENERATED from prisma/schema.prisma by scripts/sqlite-schema.mjs. Do not edit.\n" +
    "// Regenerate with `npm run db:sqlite:schema` after changing the main schema.\n\n" +
    out
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const next = toSqliteSchema(fs.readFileSync(source, "utf8"));
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (process.argv.includes("--check")) {
    if (current !== next) {
      console.error("prisma/sqlite/schema.prisma is out of date: run `npm run db:sqlite:schema`.");
      process.exit(1);
    }
    console.log("prisma/sqlite/schema.prisma is up to date.");
  } else if (current !== next) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
    console.log("Wrote prisma/sqlite/schema.prisma");
  }
}
