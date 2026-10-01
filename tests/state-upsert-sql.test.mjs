import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { stringify } from "../node_modules/postgres/src/types.js";
import { changedStateUpsert } from "../db/state-upsert.ts";

/* Renders a postgres.js tagged template to the SQL it would actually send, without a database.
 *
 * This exists because of a bug neither TypeScript nor any other test here could see. putState's
 * upserts append ",updated_at=excluded.updated_at" to their ON CONFLICT clause only when the
 * column exists, and that fragment was a plain JS string:
 *
 *   sql`... ON CONFLICT (id) DO UPDATE SET form=excluded.form${",updated_at=excluded.updated_at"}`
 *
 * postgres.js interpolates a string as a *bind parameter*, not as SQL, so the statement compiled
 * to `form=excluded.form$469` and every save failed with "column excluded.form$469 does not
 * exist". Both branches type-check, and the suite has no database, so it reached production.
 * Only a value that is itself a Query gets spliced in as SQL — see stringifyValue in
 * postgres/src/types.js — which is what the fragments below assert. */
const sql = postgres("postgres://user:pass@127.0.0.1:5432/db", { ssl: false });
const options = { transform: { undefined: null, column: {}, value: {}, row: {} } };
const render = query => stringify(query, query.strings[0], query.args[0], [], [], options);

const playerRow = () => ({
  id: "p1", name: "A", short: "A", handicap: null, rating: 1500, colour: null, avatar: null,
  initial_rating: 1500, preliminary_rating: null, active: true, wins: 0, losses: 0, draws: 0,
  frames_won: 0, frames_lost: 0, last_change: 0, form: sql.json([]),
});

// Exercise the production upsert builder in both migration-probe branches.
const upsert = hasUpdatedAt => {
  const rows = [hasUpdatedAt ? { ...playerRow(), updated_at: new Date() } : playerRow()];
  return render(changedStateUpsert(sql, "state_players", rows));
};

test("the conditional ON CONFLICT fragment is spliced as SQL, not bound as a parameter", () => {
  for (const hasUpdatedAt of [true, false]) {
    const statement = upsert(hasUpdatedAt);
    const setClause = statement.slice(statement.indexOf("ON CONFLICT"));
    // The exact shape of the production failure: a bind placeholder welded onto a column name.
    assert.doesNotMatch(setClause, /excluded\.(?:\w+|"\w+")\$\d/, `hasUpdatedAt=${hasUpdatedAt}`);
    assert.match(setClause, /"form"=excluded\."form"/, `hasUpdatedAt=${hasUpdatedAt}`);
  }
});

test("updated_at is set in the same branches that write the column, and no others", () => {
  const withColumn = upsert(true);
  assert.match(withColumn, /"updated_at"/, "column must be in the INSERT list");
  assert.match(withColumn, /"updated_at"=excluded\."updated_at"/, "and in the SET clause");
  assert.doesNotMatch(withColumn.split("WHERE")[1], /updated_at/, "the timestamp must not make unchanged data look different");

  const withoutColumn = upsert(false);
  assert.doesNotMatch(withoutColumn, /updated_at/, "degraded path must not mention the column at all");
});

test("match creation time remains immutable, while supplied optional tournament columns are compared", () => {
  const match = render(changedStateUpsert(sql, "state_matches", [{ id: "m", score_a: 1, created_at: new Date(), updated_at: new Date() }]));
  assert.doesNotMatch(match.split("ON CONFLICT")[1], /created_at/);
  const tournament = render(changedStateUpsert(sql, "state_tournaments", [{ id: "t", name: "盃賽", arrival_times: sql.json({ a: "18:00" }) }]));
  assert.match(tournament.split("WHERE")[1], /arrival_times/);
  assert.doesNotMatch(tournament, /co_hosts|roster_order/);
});

test("a plain string in that slot would have been caught", () => {
  // Guards the guard: if postgres.js ever changed how it treats strings, the assertions above
  // would silently stop testing anything. This pins the behaviour they rely on.
  const bad = render(sql`INSERT INTO state_players ${sql([playerRow()])}
    ON CONFLICT (id) DO UPDATE SET form=excluded.form${",updated_at=excluded.updated_at"}`);
  assert.match(bad, /excluded\.form\$\d+/, "a raw string must still compile to a bind placeholder");
});
