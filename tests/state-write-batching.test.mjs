import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BIND_PARAMETERS, insertChunks } from "../lib/bulk-insert.ts";

// Postgres' wire protocol caps a statement at 65535 bind parameters. A club
// crossed that cap at roughly 1,600 recorded matches, after which every save —
// most visibly recording a new match — failed with MAX_PARAMETERS_EXCEEDED.
const matchRow = () => Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`c${i}`, i]));

test("no bulk insert statement can exceed the bind-parameter limit", () => {
  for (const columns of [3, 5, 18, 41]) {
    const row = Object.fromEntries(Array.from({ length: columns }, (_, i) => [`c${i}`, i]));
    const rows = Array.from({ length: 40_000 }, () => row);
    for (const chunk of insertChunks(rows)) assert.ok(chunk.length * columns <= MAX_BIND_PARAMETERS, `${columns} columns`);
  }
});

test("every row is written exactly once, in order", () => {
  const rows = Array.from({ length: 5_000 }, (_, i) => ({ ...matchRow(), id: i }));
  const flattened = insertChunks(rows).flat();
  assert.equal(flattened.length, rows.length);
  assert.deepEqual(flattened.map(r => r.id), rows.map(r => r.id));
});

test("a history small enough for one statement still uses one statement", () => {
  assert.equal(insertChunks(Array.from({ length: 500 }, matchRow)).length, 1);
  assert.equal(insertChunks([]).length, 0);
});
