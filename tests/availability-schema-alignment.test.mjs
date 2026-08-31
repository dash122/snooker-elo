import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../db/availability.pg.ts", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test("live availability counts do not depend on the retired posted column", () => {
  for (const name of ["boardOpenCount", "openSlotsCount"]) {
    const body = functionBody(name);
    assert.doesNotMatch(body, /\bposted\s*=/, `${name} must use the unified availability schema`);
    assert.match(body, /cancelled_at\s+IS\s+NULL/);
    assert.match(body, /end_at\s*>\s*now\(\)/);
  }
});

/* --- Every query in the file, against every column the 場次 migration dropped ----------------
 *
 * The narrow check above caught `posted=` in two counters. It did not catch the reason this file
 * broke: `publishAvailability` inserting without `venue_id` (NOT NULL since the migration) and the
 * sessions queries still reading the free-text `venue`. SQL lives in template strings, so neither
 * tsc nor the build sees any of it — a test reading the source is the only thing that can. */

const DROPPED_COLUMNS = ["posted", "fill_rule", "filled_by", "filled_at", "closed_at"];

/* Comments are allowed to name the dropped columns — explaining what was removed and why is the
   point of them. Only executable source is scanned. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("no query still references a column the 場次 migration dropped", () => {
  for (const column of DROPPED_COLUMNS) {
    // Word-boundary match, so `result` inside `RETURNING` or a JS identifier is not a false hit.
    const pattern = new RegExp(`\\b${column}\\b`);
    const offending = code.split("\n").filter((line) => pattern.test(line));
    assert.deepEqual(offending, [], `${column} was dropped by the migration but is still referenced`);
  }
});

/* Only the SQL matters. `venue` is still a perfectly good TypeScript field name — `Session.venue`
   carries the venue's NAME to the client — so scanning the whole file would flag identifiers that
   never reach the database. Template literals are where the columns actually live. */
const sqlLiterals = (code.match(/`[^`]*`/g) ?? []).filter((literal) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(literal));

test("no SQL still selects or writes the free-text venue column", () => {
  assert.ok(sqlLiterals.length > 0, "expected to find SQL to scan");
  for (const literal of sqlLiterals) {
    // `venue_id`, `venues` and the `"venueName"` alias are the survivors.
    assert.doesNotMatch(literal, /\bvenue\b(?!_id|s)(?!")/, `availability_slots.venue is gone: ${literal.slice(0, 90)}`);
  }
});

test("every insert into availability_slots carries venue_id", () => {
  const inserts = code.match(/INSERT INTO availability_slots \(([^)]*)\)/g) ?? [];
  assert.ok(inserts.length > 0, "expected at least one insert to guard");
  for (const statement of inserts) {
    assert.match(statement, /\bvenue_id\b,/, `venue_id is NOT NULL, so this insert would fail: ${statement}`);
  }
});
