import test from "node:test";
import assert from "node:assert/strict";
import { DROP_MIGRATION, PLAY_MIGRATION, fixture } from "./play-fixture.mjs";

const LEGACY_TABLES = [
  "matchmaking_results", "matchmaking_delivery", "matchmaking_session_members", "matchmaking_sessions", "matchmaking_pair_preferences",
  "open_call_players", "open_calls", "availability_slots", "availability_recurrence", "club_presence", "match_intents", "match_invites", "match_offers",
];
const LEGACY_FUNCTIONS = ["lock_matchmaking_write", "protect_marketplace_availability", "check_marketplace_integrity", "default_matchmaking_venue_scope"];
const KEPT = ["state_players", "members", "venues", "state_matches", "play_intents", "play_avoids", "play_sessions", "play_session_members", "play_session_results"];

const exists = async (pg, table) => (await pg.query(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`)).rows[0].ok;
const fnExists = async (pg, fn) => (await pg.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname=$1`, [fn])).rows[0].n > 0;

test("the play migration is idempotent and extends venues without losing the existing venue", async () => {
  const { pg, migration } = await fixture();
  await pg.exec(migration(PLAY_MIGRATION));
  const venue = (await pg.query(`SELECT city,tz,status,lat FROM venues WHERE id='venue-scaa'`)).rows[0];
  assert.deepEqual([venue.city, venue.tz, venue.status, venue.lat], ["hong-kong", "Asia/Hong_Kong", "verified", null]);
});

test("play tables deny the data-API roles", async () => {
  const { pg } = await fixture();
  const rows = (await pg.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'play\\_%' AND c.relkind='r' AND NOT c.relrowsecurity`)).rows;
  assert.deepEqual(rows, [], "every play table has row level security enabled");
  const policies = (await pg.query(`SELECT tablename FROM pg_policies WHERE policyname='deny_data_api_clients' AND tablename LIKE 'play\\_%'`)).rows;
  assert.equal(policies.length, 5);
});

test("the drop migration removes only the legacy matchmaking objects and keeps everything else", async () => {
  const { pg, migration } = await fixture({ legacy: true });
  for (const table of LEGACY_TABLES) assert.equal(await exists(pg, table), true, `${table} exists before the drop`);
  for (const fn of LEGACY_FUNCTIONS) assert.equal(await fnExists(pg, fn), true, `${fn} exists before the drop`);

  await pg.exec(`INSERT INTO play_sessions(id,city,start_at,end_at) VALUES ('s1','hong-kong',now()+interval '1 hour',now()+interval '3 hours')`);
  const before = (await pg.query(`SELECT (SELECT count(*) FROM state_players)::int AS players,(SELECT count(*) FROM venues)::int AS venues`)).rows[0];

  await pg.exec(migration(DROP_MIGRATION));
  for (const table of LEGACY_TABLES) assert.equal(await exists(pg, table), false, `${table} is gone`);
  for (const fn of LEGACY_FUNCTIONS) assert.equal(await fnExists(pg, fn), false, `${fn} is gone`);
  for (const table of KEPT) assert.equal(await exists(pg, table), true, `${table} is kept`);

  const after = (await pg.query(`SELECT (SELECT count(*) FROM state_players)::int AS players,(SELECT count(*) FROM venues)::int AS venues,(SELECT count(*) FROM play_sessions)::int AS sessions`)).rows[0];
  assert.deepEqual([after.players, after.venues, after.sessions], [before.players, before.venues, 1]);

  await pg.exec(migration(DROP_MIGRATION));
});

test("player deletion is no longer blocked by legacy RESTRICT references", async () => {
  const { pg, migration } = await fixture({ legacy: true });
  await pg.exec(`INSERT INTO availability_slots(id,player_id,start_at,end_at,venue_id) VALUES ('a1','p1',now(),now()+interval '1 hour','venue-scaa')`);
  await assert.rejects(pg.exec(`DELETE FROM state_players WHERE id='p1'`), /foreign key|violates/i);
  await pg.exec(migration(DROP_MIGRATION));
  await pg.exec(`DELETE FROM state_players WHERE id='p1'`);
});
