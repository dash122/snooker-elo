import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

export const PLAY_MIGRATION = "20261004010000_play_v1";
export const DROP_MIGRATION = "20261004020000_drop_legacy_matchmaking";
export const LEGACY_MIGRATIONS = [
  "20260830052006_matchmaking_formation_mvp",
  "20260831000000_matchmaking_option_a_two_player",
  "20260908021904_matchmaking_marketplace_mvp",
  "20260908030256_matchmaking_marketplace_runtime",
];

const HOUR = 3_600_000;
/** All test times hang off the real clock, because the database's own `now()` guards run against it. */
export const at = (hours, from = Date.now()) => new Date(from + hours * HOUR).toISOString();

/** Upstream tables the play schema depends on, as minimal stand-ins. `venues` has the shape it had
    before 20261004010000 extended it. */
const UPSTREAM = `CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE state_players(id text PRIMARY KEY, name text, rating numeric, active boolean DEFAULT true);
  CREATE TABLE members(state_player_id text, active boolean DEFAULT true);
  CREATE TABLE venues(id text PRIMARY KEY NOT NULL, name text NOT NULL, district text NOT NULL DEFAULT '', tables jsonb NOT NULL DEFAULT '{}'::jsonb, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE state_matches(id text PRIMARY KEY, player_a text, player_b text, status text, played_on date);
  INSERT INTO venues(id,name,district) VALUES ('venue-scaa','SCAA','灣仔');
  INSERT INTO state_players(id,name,rating) SELECT 'p'||i,'球員'||i,1500+i*10 FROM generate_series(1,8) AS i;
  INSERT INTO members(state_player_id) SELECT id FROM state_players;`;

const LEGACY_STUBS = `
  CREATE TABLE availability_slots(id text PRIMARY KEY, player_id text REFERENCES state_players(id), start_at timestamptz, end_at timestamptz, venue_id text REFERENCES venues(id), commitment text DEFAULT 'going', conditions jsonb DEFAULT '{}', cancelled_at timestamptz, updated_at timestamptz DEFAULT now());
  CREATE TABLE open_calls(id text PRIMARY KEY, start_at timestamptz, end_at timestamptz, status text);
  CREATE TABLE open_call_players(call_id text REFERENCES open_calls(id), player_id text REFERENCES state_players(id));
  CREATE TABLE availability_recurrence(id text PRIMARY KEY);
  CREATE TABLE club_presence(id text PRIMARY KEY);
  CREATE TABLE match_intents(id text PRIMARY KEY);
  CREATE TABLE match_invites(id text PRIMARY KEY);
  CREATE TABLE match_offers(id text PRIMARY KEY);`;

export function wrap(client) {
  return { query: async (text, params = []) => (await client.query(text, params)).rows };
}

/** A fresh in-memory database with the play schema applied. `legacy: true` first builds the old
    matchmaking tables, so the drop migration can be exercised against what production has. */
export async function fixture({ legacy = false, play = true } = {}) {
  const pg = new PGlite();
  const db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
  await pg.exec(UPSTREAM);
  if (legacy) {
    await pg.exec(LEGACY_STUBS);
    for (const name of LEGACY_MIGRATIONS) await pg.exec(migration(name));
  }
  if (play) await pg.exec(migration(PLAY_MIGRATION));
  return { pg, db, migration };
}
