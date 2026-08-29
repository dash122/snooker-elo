import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { stringify } from "../node_modules/postgres/src/types.js";

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

// Mirrors putState: `stamped` adds the column to the row, `stampedSet` extends the SET clause.
const upsert = hasUpdatedAt => {
  const stampedSet = hasUpdatedAt ? sql`,updated_at=excluded.updated_at` : sql``;
  const rows = [hasUpdatedAt ? { ...playerRow(), updated_at: new Date() } : playerRow()];
  return render(sql`INSERT INTO state_players ${sql(rows)}
    ON CONFLICT (id) DO UPDATE SET name=excluded.name,last_change=excluded.last_change,form=excluded.form${stampedSet}`);
};

test("the conditional ON CONFLICT fragment is spliced as SQL, not bound as a parameter", () => {
  for (const hasUpdatedAt of [true, false]) {
    const statement = upsert(hasUpdatedAt);
    const setClause = statement.slice(statement.indexOf("ON CONFLICT"));
    // The exact shape of the production failure: a bind placeholder welded onto a column name.
    assert.doesNotMatch(setClause, /excluded\.\w+\$\d/, `hasUpdatedAt=${hasUpdatedAt}`);
    assert.match(setClause, /form=excluded\.form/, `hasUpdatedAt=${hasUpdatedAt}`);
  }
});

test("updated_at is set in the same branches that write the column, and no others", () => {
  const withColumn = upsert(true);
  assert.match(withColumn, /"updated_at"/, "column must be in the INSERT list");
  assert.match(withColumn, /updated_at=excluded\.updated_at/, "and in the SET clause");

  const withoutColumn = upsert(false);
  assert.doesNotMatch(withoutColumn, /updated_at/, "degraded path must not mention the column at all");
});

test("a plain string in that slot would have been caught", () => {
  // Guards the guard: if postgres.js ever changed how it treats strings, the assertions above
  // would silently stop testing anything. This pins the behaviour they rely on.
  const bad = render(sql`INSERT INTO state_players ${sql([playerRow()])}
    ON CONFLICT (id) DO UPDATE SET form=excluded.form${",updated_at=excluded.updated_at"}`);
  assert.match(bad, /excluded\.form\$\d+/, "a raw string must still compile to a bind placeholder");
});
