import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* The 約戰 tab's first paint reads `/api/matchmaking/week`, so anything that route touches sits in
 * front of the whole tab. `db/presence.pg.ts` used to run `CREATE TABLE IF NOT EXISTS club_presence`
 * plus `CREATE INDEX IF NOT EXISTS` on every cold start. That was survivable only while presence was
 * read by `/api/room`, which nothing rendered; once the band read presence on first paint, the DDL
 * ran on the hot path and — with the pool capped at four connections and this route fanning out —
 * the request hung and the tab showed a blank card with no way back.
 *
 * `club_presence` is owned by `supabase/migrations/20260810000000_baseline.sql`. Same rule as
 * `tests/auth-hot-path-ddl.test.mjs`: schema belongs to migrations, not to a request. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("club_presence is owned by a migration, not by runtime DDL", () => {
  assert.match(read("../supabase/migrations/20260810000000_baseline.sql"), /club_presence/,
    "the baseline migration must still create the table this module stopped creating");
});

/** Comments explaining why the DDL was removed are not DDL; match the code only. */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("reading presence never runs DDL", () => {
  const source = code(read("../db/presence.pg.ts"));
  assert.doesNotMatch(source, /CREATE\s+TABLE/i, "no CREATE TABLE on a path the 約戰 tab awaits");
  assert.doesNotMatch(source, /CREATE\s+INDEX/i, "CREATE INDEX locks the table it builds on");
  assert.doesNotMatch(source, /ALTER\s+TABLE/i, "ALTER TABLE needs ACCESS EXCLUSIVE");
});

test("the week route keeps its fan-out under the pool's connection cap", () => {
  const pool = read("../db/sql.ts");
  const max = Number(/max:\s*(\d+)/.exec(pool)?.[1]);
  assert.ok(Number.isFinite(max), "the pool must declare a max");

  const route = read("../app/api/matchmaking/week/route.ts");
  /* Count the widest single Promise.all — one wave may not outnumber the connections available to
     it, or the route contends with itself before it contends with anybody else. */
  const waves = [...route.matchAll(/Promise\.all\(\[([\s\S]*?)\]\)/g)]
    .map(match => match[1].split("\n").filter(line => /^\s*(me\?|member\?|listAvailability|livePresence|clubPublishedThisWeek)/.test(line)).length);
  assert.ok(waves.length > 0, "the route should still batch its reads");
  for (const wave of waves) {
    assert.ok(wave <= max, `a wave of ${wave} queries exceeds the pool's ${max} connections`);
  }
});
