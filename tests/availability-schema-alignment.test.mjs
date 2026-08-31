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
