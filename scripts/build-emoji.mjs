#!/usr/bin/env node
/**
 * Generates src/components/group/emoji-data.json, the searchable emoji list
 * for the chore icon picker, from emojibase-data (CLDR labels + tags).
 *
 * The output is committed: rerun only when bumping emojibase-data. It keeps
 * just what search needs ([emoji, label, tags] per entry, skin-tone variants
 * and the component group dropped), which is ~1/5 of the source size.
 *
 *   node scripts/build-emoji.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = require.resolve("emojibase-data/en/compact.json");
const out = path.join(import.meta.dirname, "../src/components/group/emoji-data.json");

const COMPONENT_GROUP = 2; // skin-tone and hair-style modifiers on their own

const data = JSON.parse(readFileSync(src, "utf8"))
  .filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP)
  .sort((a, b) => a.order - b.order)
  .map((e) => [e.unicode, e.label, (e.tags ?? []).join(" ")]);

writeFileSync(out, JSON.stringify(data) + "\n");
console.log(`Wrote ${data.length} emoji to ${path.relative(process.cwd(), out)}`);
