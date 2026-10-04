import { createHash } from "node:crypto";
import type { JSONValue } from "postgres";
import { getSql } from "./sql";
import { insertChunks } from "../lib/bulk-insert";
import { retainedSnapshotIds, sameSnapshotItems, type SnapshotItem } from "../lib/snapshot-policy";
import { changedStateUpsert } from "./state-upsert";

type Player = { id:string; name:string; short:string; handicap:number|null; rating:number; colour?:string; avatar?:string|null; initialRating:number; preliminaryRating?:number|null; active:boolean; wins:number; losses:number; draws:number; framesWon:number; framesLost:number; lastChange:number; form:string[] };
type Match = { id:string; a:string; b:string; a2?:string; b2?:string; mode?:string; teamAName?:string; teamBName?:string; scoreA:number; scoreB:number; playedOn:string; entryMode?:("match"|"aggregate"); frameEvidence?:number; performanceScore?:number; evidenceWeight?:number; handicapAdjustment?:number; overHandicapElo?:number; overHandicapMultiplier?:number; highBreaks?:{playerId:string;value:number}[]; actual:number; giver:string|null; official:number|null; extra:number; expectedA:number; beforeA:number; beforeB:number; beforeA2?:number; beforeB2?:number; afterA:number; afterB:number; afterA2?:number; afterB2?:number; deltaA:number; deltaB?:number; deltaA2?:number; deltaB2?:number; marginMultiplier?:number; status:("confirmed"|"void"); createdAt:string; tournamentId?:string; tournamentRound?:number; tournamentMatchIndex?:number };
type Walkover = { round:number; index:number; winner:string; reason?:string };
type Tournament = { id:string; name:string; handicapMode:"suggested"|"none"; startAt?:string|null; signupDeadline:string; createdAt:string; createdBy?:string; coHosts?:string[]|null; rosterOrder?:string[]|null; signups:string[]; draw?:string[]|null; drawnAt?:string|null; walkovers?:Walkover[]|null; arrivalTimes?:Record<string,string>|null };
type State = { players:Player[]; matches:Match[]; tournaments:Tournament[]; settings:Record<string, unknown>; audits:{id:string;text:string;at:string}[] };
type SnapshotEntity = { entityType: "player"|"match"|"settings"|"tournament"|"audit"; entityId: string; position: number; payload: unknown };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshotHash(entityType: SnapshotEntity["entityType"], entityId: string, payload: unknown) {
  // md5 is used only as a compact content-address key, not as a security
  // primitive. Including the type and id avoids accidental cross-entity
  // collisions when two rows happen to have the same shape.
  return createHash("md5").update(`${entityType}${entityId}${canonicalJson(payload)}`).digest("hex");
}

function snapshotEntities(state: State): SnapshotEntity[] {
  return [
    { entityType: "settings", entityId: "settings", position: 0, payload: state.settings },
    ...state.players.map((payload, position) => ({ entityType: "player" as const, entityId: payload.id, position, payload })),
    ...state.matches.map((payload, position) => ({ entityType: "match" as const, entityId: payload.id, position, payload })),
    ...state.tournaments.map((payload, position) => ({ entityType: "tournament" as const, entityId: payload.id, position, payload })),
    ...state.audits.map((payload, position) => ({ entityType: "audit" as const, entityId: payload.id, position, payload })),
  ];
}

let schemaReady: Promise<unknown> | null = null;
let provisionalDeltaSchemaReady: Promise<unknown> | null = null;
function ensureProvisionalDeltaSchema() {
  // Columns are migration-owned now (see
  // supabase/migrations/20260821000000_auth_schema_runtime_ddl_cleanup.sql),
  // for the same reason ensureStateSchema below is short-circuited: running
  // this on every cold start queued requests on the advisory lock until the
  // pooler's statement_timeout cancelled them.
  return Promise.resolve();

  provisionalDeltaSchemaReady ??= (async () => {
    const sql = getSql();
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(72591005)`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_b numeric`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_a2 numeric`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_b2 numeric`;
      await tx`ALTER TABLE state_players ADD COLUMN IF NOT EXISTS preliminary_rating numeric`;
    });
  })().catch(error => { provisionalDeltaSchemaReady = null; throw error; });
  return provisionalDeltaSchemaReady;
}
export function ensureStateSchema() {
  // State schema changes are migration-owned. Running the historical bootstrap
  // below on every serverless cold start took ACCESS EXCLUSIVE locks and could
  // block all readers (including localhost) for tens of seconds.
  return Promise.resolve();

  schemaReady ??= (async () => {
    const sql = getSql();
    // Serialize concurrent cold starts on a session advisory lock instead of
    // racing for the table locks DDL takes: with a short lock_timeout, the
    // loser of that race got killed outright (55P03) and surfaced as a 500 to
    // whatever request triggered it. Waiting on the advisory lock instead
    // means every instance just blocks until the first one finishes, then
    // finds the tables/columns already exist and returns immediately.
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(72591002)`;
      await tx`CREATE TABLE IF NOT EXISTS app_state_snapshots (id bigserial PRIMARY KEY, state jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now())`;
      await tx`ALTER TABLE app_state_snapshots ALTER COLUMN state DROP NOT NULL`;
      await tx`CREATE TABLE IF NOT EXISTS app_state_snapshot_entities (content_hash text PRIMARY KEY, entity_type text NOT NULL, entity_id text NOT NULL, payload jsonb NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS app_state_snapshot_items (snapshot_id bigint NOT NULL REFERENCES app_state_snapshots(id) ON DELETE CASCADE, entity_type text NOT NULL, entity_id text NOT NULL, content_hash text NOT NULL REFERENCES app_state_snapshot_entities(content_hash), position integer NOT NULL, PRIMARY KEY (snapshot_id, entity_type, entity_id))`;
      await tx`CREATE INDEX IF NOT EXISTS app_state_snapshot_items_lookup_idx ON app_state_snapshot_items (snapshot_id, entity_type, position)`;
      // Convert legacy full-document snapshots once. The UPDATE below makes
      // this backfill self-terminating on future cold starts and releases the
      // large JSONB value after its normalized references are safe.
      await tx`INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
        SELECT md5('settings' || chr(1) || 'settings' || chr(1) || (s.state->'settings')::text), 'settings', 'settings', s.state->'settings'
        FROM app_state_snapshots s
        WHERE s.state IS NOT NULL AND s.state ? 'settings'
        ON CONFLICT (content_hash) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
        SELECT md5('player' || chr(1) || (item->>'id') || chr(1) || item::text), 'player', item->>'id', item
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'players', '[]'::jsonb)) AS rows(item)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (content_hash) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
        SELECT md5('match' || chr(1) || (item->>'id') || chr(1) || item::text), 'match', item->>'id', item
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'matches', '[]'::jsonb)) AS rows(item)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (content_hash) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
        SELECT md5('tournament' || chr(1) || (item->>'id') || chr(1) || item::text), 'tournament', item->>'id', item
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'tournaments', '[]'::jsonb)) AS rows(item)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (content_hash) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
        SELECT md5('audit' || chr(1) || (item->>'id') || chr(1) || item::text), 'audit', item->>'id', item
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'audits', '[]'::jsonb)) AS rows(item)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (content_hash) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
        SELECT s.id, 'settings', 'settings', md5('settings' || chr(1) || 'settings' || chr(1) || (s.state->'settings')::text), 0
        FROM app_state_snapshots s
        WHERE s.state IS NOT NULL AND s.state ? 'settings'
        ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
        SELECT s.id, 'player', item->>'id', md5('player' || chr(1) || (item->>'id') || chr(1) || item::text), rows.ordinality::integer - 1
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'players', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ordinality)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
        SELECT s.id, 'match', item->>'id', md5('match' || chr(1) || (item->>'id') || chr(1) || item::text), rows.ordinality::integer - 1
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'matches', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ordinality)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
        SELECT s.id, 'tournament', item->>'id', md5('tournament' || chr(1) || (item->>'id') || chr(1) || item::text), rows.ordinality::integer - 1
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'tournaments', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ordinality)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING`;
      await tx`INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
        SELECT s.id, 'audit', item->>'id', md5('audit' || chr(1) || (item->>'id') || chr(1) || item::text), rows.ordinality::integer - 1
        FROM app_state_snapshots s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'audits', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ordinality)
        WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
        ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING`;
      await tx`UPDATE app_state_snapshots SET state = NULL WHERE state IS NOT NULL`;
      await tx`CREATE TABLE IF NOT EXISTS state_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
      await tx`CREATE TABLE IF NOT EXISTS state_audits (id text PRIMARY KEY, text text NOT NULL, occurred_at timestamptz NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS state_tournaments (id text PRIMARY KEY, name text NOT NULL, handicap_mode text NOT NULL, start_at timestamptz, signup_deadline timestamptz NOT NULL, created_at timestamptz NOT NULL, created_by text REFERENCES state_players(id) ON DELETE SET NULL, signups jsonb NOT NULL DEFAULT '[]'::jsonb)`;
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS start_at timestamptz`;
      await tx`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'state_tournaments' AND column_name = 'signup_deadline' AND data_type = 'date') THEN ALTER TABLE state_tournaments ALTER COLUMN signup_deadline TYPE timestamptz USING signup_deadline::timestamp AT TIME ZONE 'Asia/Hong_Kong'; END IF; END $$`;
      // Added after the first release — existing deployments get it here rather
      // than depending on a migration having been run by hand.
      await tx`ALTER TABLE state_players ADD COLUMN IF NOT EXISTS avatar text`;
      // Present in the baseline schema, but a deployment created before that baseline
      // (or that had this table hand-rolled) can still be missing it — the upsert below
      // always writes updated_at, so without this every match/player edit on such a
      // deployment fails with "column updated_at does not exist".
      await tx`ALTER TABLE state_players ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS player_a2 text`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS player_b2 text`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS mode text`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS team_a_name text`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS team_b_name text`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS before_a2 numeric`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS before_b2 numeric`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS after_a2 numeric`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS after_b2 numeric`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS tournament_id text REFERENCES state_tournaments(id) ON DELETE SET NULL`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS tournament_round integer`;
      await tx`ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS tournament_match_index integer`;
      // The frozen draw and any walkovers. Without these columns the fields round-tripped through
      // the client but were dropped on save, so a cup could never actually be *drawn*: every client
      // that opened it saw an undrawn cup, re-ran the draw endpoint, and re-notified every entrant.
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS draw jsonb`;
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS drawn_at timestamptz`;
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS walkovers jsonb`;
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS co_hosts jsonb NOT NULL DEFAULT '[]'::jsonb`;
      // Each entrant's own optional "when I'll arrive" — self-reported, keyed by player id.
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS arrival_times jsonb NOT NULL DEFAULT '{}'::jsonb`;
      // Without this, edits that only touch signups (a player joining/withdrawing a cup) left
      // every timestamp state_tournaments had untouched, so the /api/state version fingerprint
      // below didn't move and clients kept serving a stale cached document past a real DB change.
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS updated_at timestamptz`;
    });
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

/** The settings blob alone, for callers that need a handful of numbers (handicap tuning, mostly)
    and nothing else `getState()` carries. `getState()` pulls every player, every match ever played
    and the entire audit log just to reach this same row — fine for the settings page, ruinous for
    an endpoint like `/api/slots` that a client polls every 45 seconds. */
export async function getSettings(): Promise<Record<string, unknown> | null> {
  await ensureStateSchema();
  const sql = getSql();
  const [row] = await sql<{data:Record<string, unknown>}[]>`SELECT data FROM state_settings WHERE id = true`;
  return row?.data ?? null;
}

/** The small roster slice the admin account directory needs.
 *
 * The admin page used to load the complete club document just to resolve
 * member-to-player links. That document includes every match, tournament and
 * audit entry, and its version probes are especially expensive through the
 * transaction pooler. Keep the admin hot path to the three columns it renders.
 */
export type AdminPlayer = { id: string; name: string; active: boolean };
export async function listAdminPlayers(): Promise<AdminPlayer[]> {
  const sql = getSql();
  return sql<AdminPlayer[]>`SELECT id, name, active FROM state_players ORDER BY name`;
}

/** Counts for the admin usage overview, without materialising the club state. */
export type StateSummary = { players: number; matches: number; tournaments: number };
export async function getStateSummary(): Promise<StateSummary> {
  const sql = getSql();
  const [row] = await sql<StateSummary[]>`
    SELECT
      (SELECT count(*)::int FROM state_players) AS players,
      (SELECT count(*)::int FROM state_matches) AS matches,
      (SELECT count(*)::int FROM state_tournaments) AS tournaments`;
  return row ?? { players: 0, matches: 0, tournaments: 0 };
}

/* postgres.js decodes timestamptz to a Date, which JSON.stringify renders as
   `2026-02-01T10:00:00.250Z`. Postgres' own default rendering is `+00:00`, so every timestamp
   below is formatted explicitly to match what callers have always parsed. */
const isoUtc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/* A cheap "has anything changed?" fingerprint, used to answer a conditional GET without
   building the whole document. putState advances state_settings.updated_at only when
   live data changes, including deletions and audit edits; the counts
   and per-table high-water marks are belt and braces for anything that writes a state table
   directly. Rows are tiny, so this is orders of magnitude cheaper than the document query. */
const versionExpression = (hasUpdatedAt: boolean) => `md5(json_build_object(
      'players', (SELECT count(*) FROM state_players),${hasUpdatedAt ? `
      'playersAt', (SELECT max(updated_at) FROM state_players),` : ""}
      'matches', (SELECT count(*) FROM state_matches),${hasUpdatedAt ? `
      'matchesAt', (SELECT max(updated_at) FROM state_matches),` : ""}
      'tournaments', (SELECT count(*) FROM state_tournaments),
      'tournamentsAt', (SELECT greatest(max(created_at), max(drawn_at)${hasUpdatedAt ? ", max(updated_at)" : ""}) FROM state_tournaments),
      'audits', (SELECT count(*) FROM state_audits),
      'auditsAt', (SELECT max(occurred_at) FROM state_audits),
      'settingsAt', (SELECT updated_at FROM state_settings WHERE id = true)
    )::text)`;

/* getStateVersion/getStateDocument read state_players.updated_at, state_matches.updated_at
   and state_tournaments.updated_at; putState writes all three. Those columns are
   migration-owned (see supabase/migrations/20260828010000_state_players_matches_updated_at.sql
   and 20260828000000_state_tournaments_updated_at.sql), but a deployment whose migration
   runner hasn't caught up yet — or a hand-rolled table — can still be missing them.

   This used to paper over that with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at request
   time, which is what took the site down: even a no-op ALTER takes ACCESS EXCLUSIVE on the
   table, so it queued behind whatever readers were in flight and then blocked every reader
   behind *it*. The cache is per-instance, so every serverless cold start ran it again, and
   under load the queue never drained — the logs show readers waiting ~10s for AccessShareLock
   on state_players and then dying with 57014 (statement timeout). A cancelled ALTER also
   cleared the cache, so the next request tried again.

   So: probe the catalog instead. It is a cheap, lock-free read, cached per instance, and the
   schema is left to migrations. When the columns really are missing we degrade — the version
   fingerprint drops those high-water marks (counts plus state_settings.updated_at still move
   on every real state change, since putState advances that marker) and writes simply omit the
   columns. */
let updatedAtColumnsPresent: Promise<boolean> | null = null;
function hasUpdatedAtColumns(): Promise<boolean> {
  updatedAtColumnsPresent ??= (async () => {
    const rows = await getSql()<{ present: boolean }[]>`
      SELECT count(*) = 3 AS present FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'updated_at'
        AND table_name IN ('state_players', 'state_matches', 'state_tournaments')`;
    return rows[0]?.present ?? false;
  })().catch(error => { updatedAtColumnsPresent = null; throw error; });
  return updatedAtColumnsPresent;
}
function isMissingUpdatedAtColumn(error: unknown) {
  return error instanceof Error && /column .*updated_at.* does not exist/i.test(error.message);
}

/* Co-hosts were added after the first tournament schema. Keep the catalog probe lock-free so a
   deployment that has the application code before the migration can still read and write ordinary
   matches; once the migration is present, the same process starts round-tripping co-hosts. */
let tournamentCoHostsPresent: Promise<boolean> | null = null;
function hasTournamentCoHosts(): Promise<boolean> {
  tournamentCoHostsPresent ??= (async () => {
    const rows = await getSql()<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'state_tournaments' AND column_name = 'co_hosts'
      ) AS present`;
    return rows[0]?.present ?? false;
  })().catch(error => { tournamentCoHostsPresent = null; throw error; });
  return tournamentCoHostsPresent;
}

function isMissingTournamentCoHostsColumn(error: unknown) {
  return error instanceof Error && /column .*co_hosts.* does not exist/i.test(error.message);
}

let tournamentRosterOrderPresent: Promise<boolean> | null = null;
function hasTournamentRosterOrder(): Promise<boolean> {
  tournamentRosterOrderPresent ??= (async () => {
    const rows = await getSql()<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'state_tournaments' AND column_name = 'roster_order'
      ) AS present`;
    return rows[0]?.present ?? false;
  })().catch(error => { tournamentRosterOrderPresent = null; throw error; });
  return tournamentRosterOrderPresent;
}

function isMissingTournamentRosterOrderColumn(error: unknown) {
  return error instanceof Error && /column .*roster_order.* does not exist/i.test(error.message);
}

/* Same lock-free probe as co-hosts/roster-order above, and for the same reason: the column is
   migration-owned and can land on the database on its own schedule, independent of when this code
   deploys. Without this guard, a deploy that outruns the migration turns "sign up" into a 500 for
   every member — and once probed, an existing tournament (finished or not) just round-trips an
   empty arrivalTimes map, never an error. */
let tournamentArrivalTimesPresent: Promise<boolean> | null = null;
function hasTournamentArrivalTimes(): Promise<boolean> {
  tournamentArrivalTimesPresent ??= (async () => {
    const rows = await getSql()<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'state_tournaments' AND column_name = 'arrival_times'
      ) AS present`;
    return rows[0]?.present ?? false;
  })().catch(error => { tournamentArrivalTimesPresent = null; throw error; });
  return tournamentArrivalTimesPresent;
}

function isMissingTournamentArrivalTimesColumn(error: unknown) {
  return error instanceof Error && /column .*arrival_times.* does not exist/i.test(error.message);
}

/* The start time migration was deployed after some app instances had already been provisioned.
   Catch up only when the catalog says the column is absent, then cache the result for the lifetime
   of this instance. The advisory lock makes simultaneous first requests safe; normal requests do
   not run ALTER TABLE. */
let tournamentStartAtPresent: Promise<boolean> | null = null;
function hasTournamentStartAt(): Promise<boolean> {
  tournamentStartAtPresent ??= (async () => {
    const rows = await getSql()<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'state_tournaments' AND column_name = 'start_at'
      ) AS present`;
    return rows[0]?.present ?? false;
  })().catch(error => { tournamentStartAtPresent = null; throw error; });
  return tournamentStartAtPresent;
}

function ensureTournamentStartAtSchema() {
  return (async () => {
    if (await hasTournamentStartAt()) return;
    const sql = getSql();
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(72591004)`;
      await tx`ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS start_at timestamptz`;
    });
    tournamentStartAtPresent = null;
    if (!await hasTournamentStartAt()) throw new Error("Unable to add state_tournaments.start_at");
  })();
}

function isMissingTournamentStartAtColumn(error: unknown) {
  return error instanceof Error && /column .*start_at.* does not exist/i.test(error.message);
}

export async function getStateVersion(): Promise<string> {
  const query = (hasUpdatedAt: boolean) => `SELECT ${versionExpression(hasUpdatedAt)} AS version`;
  try {
    const rows = await getSql().unsafe<{ version: string }[]>(query(await hasUpdatedAtColumns()));
    return rows[0]?.version ?? "";
  } catch (error) {
    // The probe can race a migration that drops the column, and it only checks
    // three tables by name. Keep the degrade path as a backstop either way.
    if (!isMissingUpdatedAtColumn(error)) throw error;
    updatedAtColumnsPresent = null;
    const rows = await getSql().unsafe<{ version: string }[]>(query(false));
    return rows[0]?.version ?? "";
  }
}

const stateDocumentQuery = (hasUpdatedAt: boolean, hasCoHosts: boolean, hasRosterOrder: boolean, hasArrivalTimes: boolean) => `
    SELECT json_build_object(
      'players', COALESCE((SELECT json_agg(to_json(p) ORDER BY p.name) FROM (
        SELECT id, name, short, handicap::float8 AS handicap, rating::float8 AS rating, colour, avatar,
               initial_rating::float8 AS "initialRating", preliminary_rating::float8 AS "preliminaryRating",
               active, wins, losses, draws, frames_won AS "framesWon", frames_lost AS "framesLost",
               last_change::float8 AS "lastChange", form
        FROM state_players
      ) p), '[]'::json),
      'matches', COALESCE((SELECT json_agg(to_json(m) ORDER BY m."playedOn", m."createdAt", m.id) FROM (
        SELECT id, player_a AS a, player_b AS b, player_a2 AS a2, player_b2 AS b2, mode,
               team_a_name AS "teamAName", team_b_name AS "teamBName", score_a AS "scoreA", score_b AS "scoreB",
               to_char(played_on, 'YYYY-MM-DD') AS "playedOn", entry_mode AS "entryMode",
               frame_evidence::float8 AS "frameEvidence", performance_score::float8 AS "performanceScore",
               evidence_weight::float8 AS "evidenceWeight", handicap_adjustment::float8 AS "handicapAdjustment",
               over_handicap_elo::float8 AS "overHandicapElo", over_handicap_multiplier::float8 AS "overHandicapMultiplier",
               high_breaks AS "highBreaks", actual::float8 AS actual, giver, official::float8 AS official,
               extra::float8 AS extra, expected_a::float8 AS "expectedA", before_a::float8 AS "beforeA",
               before_b::float8 AS "beforeB", before_a2::float8 AS "beforeA2", before_b2::float8 AS "beforeB2",
               after_a::float8 AS "afterA", after_b::float8 AS "afterB", after_a2::float8 AS "afterA2",
               after_b2::float8 AS "afterB2", delta_a::float8 AS "deltaA", delta_b::float8 AS "deltaB",
               delta_a2::float8 AS "deltaA2", delta_b2::float8 AS "deltaB2",
               margin_multiplier::float8 AS "marginMultiplier", tournament_id AS "tournamentId",
               tournament_round AS "tournamentRound", tournament_match_index AS "tournamentMatchIndex", status,
               ${isoUtc("created_at")} AS "createdAt"
        FROM state_matches
      ) m), '[]'::json),
      'tournaments', COALESCE((SELECT json_agg(to_json(t) ORDER BY t."createdAt" DESC) FROM (
        SELECT id, name, handicap_mode AS "handicapMode",
               to_char(start_at AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-DD"T"HH24:MI') AS "startAt",
               to_char(signup_deadline AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-DD"T"HH24:MI') AS "signupDeadline",
               ${isoUtc("created_at")} AS "createdAt", created_by AS "createdBy", ${hasCoHosts ? `co_hosts AS "coHosts",` : ""}${hasRosterOrder ? ` roster_order AS "rosterOrder",` : ""}
               signups, draw, ${isoUtc("drawn_at")} AS "drawnAt", walkovers${hasArrivalTimes ? `, arrival_times AS "arrivalTimes"` : ""}
        FROM state_tournaments
      ) t), '[]'::json),
      'settings', COALESCE((SELECT data FROM state_settings WHERE id = true), '{}'::jsonb),
      'audits', COALESCE((SELECT json_agg(to_json(a) ORDER BY a.at DESC, a.id DESC) FROM (
        SELECT id, text, ${isoUtc("occurred_at")} AS at
        FROM state_audits
      ) a), '[]'::json)
    )::text AS data,
    (NOT EXISTS (SELECT 1 FROM state_players)
      AND NOT EXISTS (SELECT 1 FROM state_matches)
      AND NOT EXISTS (SELECT 1 FROM state_tournaments)
      AND NOT EXISTS (SELECT 1 FROM state_settings)
      AND NOT EXISTS (SELECT 1 FROM state_audits)) AS empty,
    ${versionExpression(hasUpdatedAt)} AS version
  `;

export async function getStateDocument(): Promise<{ data: string | null; version: string }> {
  const sql = getSql();
  /* One statement, not five.
     
     This used to fire five `SELECT`s through `Promise.all`, which meant five round trips to
     Supabase *and* up to five of the pool's four connections (db/sql.ts) held at once. Every
     page that calls getState() — the home page's /api/state hydration, /p/[id], /m/[id],
     /admin, the sessions API — was therefore competing with itself for the pool while the
     rest of the home page's endpoints queued behind it. Queued time counts against the
     pooler's statement_timeout, which is how a merely slow load turns into a failed one.
     
     Assembling the document in Postgres costs one connection and one round trip, and hands
     back text that needs no JS-side serialize. `to_json` (not `to_jsonb`) keeps the column
     order, so the parsed document is identical to the old one key for key; only
     json_build_object's whitespace between the five top-level keys differs. */
  const run = async (hasUpdatedAt: boolean, hasCoHosts: boolean, hasRosterOrder: boolean, hasArrivalTimes: boolean) => {
    const rows = await sql.unsafe<{ data: string; empty: boolean; version: string }[]>(stateDocumentQuery(hasUpdatedAt, hasCoHosts, hasRosterOrder, hasArrivalTimes));
    const row = rows[0];
    return { data: !row || row.empty ? null : row.data, version: row?.version ?? "" };
  };
  try {
    await ensureTournamentStartAtSchema();
    const [hasUpdatedAt, hasCoHosts, hasRosterOrder, hasArrivalTimes] = await Promise.all([hasUpdatedAtColumns(), hasTournamentCoHosts(), hasTournamentRosterOrder(), hasTournamentArrivalTimes()]);
    return await run(hasUpdatedAt, hasCoHosts, hasRosterOrder, hasArrivalTimes);
  } catch (error) {
    if (isMissingTournamentStartAtColumn(error)) {
      tournamentStartAtPresent = null;
      await ensureTournamentStartAtSchema();
    } else if (!isMissingUpdatedAtColumn(error) && !isMissingTournamentCoHostsColumn(error) && !isMissingTournamentRosterOrderColumn(error) && !isMissingTournamentArrivalTimesColumn(error)) throw error;
    if (isMissingUpdatedAtColumn(error)) updatedAtColumnsPresent = null;
    if (isMissingTournamentCoHostsColumn(error)) tournamentCoHostsPresent = null;
    if (isMissingTournamentRosterOrderColumn(error)) tournamentRosterOrderPresent = null;
    if (isMissingTournamentArrivalTimesColumn(error)) tournamentArrivalTimesPresent = null;
    const [hasUpdatedAt, hasCoHosts, hasRosterOrder, hasArrivalTimes] = await Promise.all([hasUpdatedAtColumns(), hasTournamentCoHosts(), hasTournamentRosterOrder(), hasTournamentArrivalTimes()]);
    return run(hasUpdatedAt, hasCoHosts, hasRosterOrder, hasArrivalTimes);
  }
}

export async function getState(): Promise<string | null> {
  return (await getStateDocument()).data;
}

export async function putState(data: string) {
  // Probed up front, not caught mid-write: this transaction upserts state_players,
  // state_matches and state_tournaments together, so discovering the missing column on the
  // last of the three would roll back the first two. The probe is a lock-free catalog read
  // (see hasUpdatedAtColumns), so unlike the ALTER it replaced it costs the write path
  // nothing and blocks no readers.
  const [, , , hasUpdatedAt, hasCoHosts, hasRosterOrder, hasArrivalTimes] = await Promise.all([ensureStateSchema(), ensureProvisionalDeltaSchema(), ensureTournamentStartAtSchema(), hasUpdatedAtColumns(), hasTournamentCoHosts(), hasTournamentRosterOrder(), hasTournamentArrivalTimes()]);
  const stamped = <T extends Record<string, unknown>>(row: T) => (hasUpdatedAt ? { ...row, updated_at: new Date() } : row);
  const state = JSON.parse(data) as State;
  const sql = getSql();
  await sql.begin(async tx => {
    // The database role can have a short lock_timeout configured globally.
    // State writes are intentionally serialized by the advisory lock below,
    // so inheriting that timeout turns ordinary overlapping saves into 55P03
    // failures (most noticeably when changing a match date recalculates later
    // ratings). Let statement_timeout bound active/waiting work instead.
    await tx`SET LOCAL lock_timeout = 0`;
    // If the client connection drops mid-transaction, this bounds how long the
    // orphaned session sits idle holding locks before Postgres kills it itself
    // — previously it could sit for 10+ minutes, queueing up every other write.
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    await tx`SELECT pg_advisory_xact_lock(72591003)`;
    const [snapshotClock] = await tx<{ now: Date; due: boolean }[]>`SELECT now() AS now,
      NOT EXISTS (SELECT 1 FROM app_state_snapshots WHERE saved_at > now() - interval '1 hour') AS due`;
    if (snapshotClock.due) {
      const [latest] = await tx<{ id: number; state: State | null }[]>`SELECT id, state FROM app_state_snapshots ORDER BY saved_at DESC, id DESC LIMIT 1`;
      const previousItems = latest && !latest.state
        ? await tx<SnapshotItem[]>`SELECT entity_type AS "entityType", entity_id AS "entityId", content_hash AS "contentHash", position FROM app_state_snapshot_items WHERE snapshot_id = ${latest.id}`
        : [];
      // Canonicalise once, and compare the complete manifest before inserting.
      const hashed = snapshotEntities(state).map(entity => ({ ...entity,
        contentHash: snapshotHash(entity.entityType, entity.entityId, entity.payload) }));
      if (!latest || latest.state || !sameSnapshotItems(previousItems, hashed)) {
        const [snapshot] = await tx<{ id: number }[]>`INSERT INTO app_state_snapshots (state) VALUES (NULL) RETURNING id`;
        const snapshotId = snapshot.id;
        const entities = hashed.map(entity => ({
          content_hash: entity.contentHash,
          entity_type: entity.entityType,
          entity_id: entity.entityId,
          payload: tx.json(entity.payload as JSONValue),
        }));
        for (const chunk of insertChunks(entities)) await tx`INSERT INTO app_state_snapshot_entities ${tx(chunk)} ON CONFLICT (content_hash) DO NOTHING`;
        const items = hashed.map(entity => ({
          snapshot_id: snapshotId,
          entity_type: entity.entityType,
          entity_id: entity.entityId,
          content_hash: entity.contentHash,
          position: entity.position,
        }));
        for (const chunk of insertChunks(items)) await tx`INSERT INTO app_state_snapshot_items ${tx(chunk)}`;
      }
      // Also runs for an identical eligible save, so old deployments converge
      // to the smaller policy without needing a new snapshot first.
      const snapshots = await tx<{ id: number; savedAt: Date }[]>`SELECT id, saved_at AS "savedAt" FROM app_state_snapshots`;
      const keepIds = retainedSnapshotIds(snapshots, +new Date(snapshotClock.now));
      if (snapshots.length > keepIds.length) {
        await tx`DELETE FROM app_state_snapshots WHERE NOT (id = ANY(${keepIds}::bigint[]))`;
        await tx`DELETE FROM app_state_snapshot_entities e WHERE NOT EXISTS (SELECT 1 FROM app_state_snapshot_items i WHERE i.content_hash = e.content_hash)`;
      }
    }
    let changed = false;
    const track = (result: { count: number }) => { if (result.count > 0) changed = true; };
    track(await tx`INSERT INTO state_settings (id, data, updated_at) VALUES (true, ${tx.json(state.settings as JSONValue)}, now()) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE state_settings.data IS DISTINCT FROM excluded.data`);

    // Each table below does at most one bulk upsert plus one bulk stale-row
    // delete, instead of a round trip per row — a save with dozens of players
    // and matches previously meant dozens of sequential statements, each one
    // more exposure for a dropped connection to leave the transaction stuck
    // open mid-save, holding locks for everyone else.
    const playerIds = state.players.map(p => p.id);
    const matchIds = state.matches.map(m => m.id);
    const tournamentIds = state.tournaments.map(t => t.id);
    const auditIds = state.audits.map(a => a.id);

    // Matches are deleted before players are touched: state_matches has an
    // ON DELETE RESTRICT FK to state_players, so a stale match referencing a
    // stale player would block that player's delete if it were still around.
    track(await tx`DELETE FROM state_matches WHERE NOT (id = ANY(${matchIds}::text[]))`);

    if (state.players.length) {
      const rows = state.players.map(p => ({
        id: p.id, name: p.name, short: p.short, handicap: p.handicap, rating: p.rating,
        colour: p.colour ?? null, avatar: p.avatar ?? null, initial_rating: p.initialRating, preliminary_rating: p.preliminaryRating ?? null,
        active: p.active, wins: p.wins, losses: p.losses, draws: p.draws,
        frames_won: p.framesWon, frames_lost: p.framesLost, last_change: p.lastChange,
        form: tx.json(p.form),
      })).map(stamped);
      for (const chunk of insertChunks(rows)) track(await changedStateUpsert(tx, "state_players", chunk));
    }
    track(await tx`DELETE FROM state_players WHERE NOT (id = ANY(${playerIds}::text[]))`);

    if (state.matches.length) {
      const rows = state.matches.map(m => ({
        id: m.id, player_a: m.a, player_b: m.b, player_a2: m.a2 ?? null, player_b2: m.b2 ?? null,
        mode: m.mode ?? null, team_a_name: m.teamAName ?? null, team_b_name: m.teamBName ?? null, score_a: m.scoreA, score_b: m.scoreB,
        played_on: m.playedOn, entry_mode: m.entryMode ?? null, frame_evidence: m.frameEvidence ?? null,
        performance_score: m.performanceScore ?? null, evidence_weight: m.evidenceWeight ?? null,
        handicap_adjustment: m.handicapAdjustment ?? null, over_handicap_elo: m.overHandicapElo ?? null,
        over_handicap_multiplier: m.overHandicapMultiplier ?? null, high_breaks: tx.json(m.highBreaks ?? []),
        actual: m.actual, giver: m.giver, official: m.official, extra: m.extra, expected_a: m.expectedA,
        before_a: m.beforeA, before_b: m.beforeB, before_a2: m.beforeA2 ?? null, before_b2: m.beforeB2 ?? null,
        after_a: m.afterA, after_b: m.afterB, after_a2: m.afterA2 ?? null, after_b2: m.afterB2 ?? null,
        delta_a: m.deltaA, delta_b: m.deltaB ?? -m.deltaA, delta_a2: m.deltaA2 ?? null, delta_b2: m.deltaB2 ?? null,
        margin_multiplier: m.marginMultiplier ?? null, tournament_id: m.tournamentId ?? null, tournament_round: m.tournamentRound ?? null, tournament_match_index: m.tournamentMatchIndex ?? null,
        status: m.status, created_at: m.createdAt,
      })).map(stamped);
      for (const chunk of insertChunks(rows)) track(await changedStateUpsert(tx, "state_matches", chunk));
    }

    if (state.tournaments.length) {
      const rows = state.tournaments.map(t => ({
        id: t.id, name: t.name, handicap_mode: t.handicapMode,
        start_at: t.startAt ? (t.startAt.length === 16 ? `${t.startAt}:00+08:00` : t.startAt) : null,
        signup_deadline: t.signupDeadline.length === 16 ? `${t.signupDeadline}:00+08:00` : t.signupDeadline,
        created_at: t.createdAt, created_by: t.createdBy ?? null,
        ...(hasCoHosts ? { co_hosts: tx.json(t.coHosts ?? []) } : {}),
        ...(hasRosterOrder ? { roster_order: t.rosterOrder?.length ? tx.json(t.rosterOrder) : null } : {}),
        signups: tx.json(t.signups), draw: t.draw?.length ? tx.json(t.draw) : null,
        drawn_at: t.drawnAt ?? null, walkovers: t.walkovers?.length ? tx.json(t.walkovers) : null,
        ...(hasArrivalTimes ? { arrival_times: tx.json(t.arrivalTimes ?? {}) } : {}),
      })).map(stamped);
      for (const chunk of insertChunks(rows)) track(await changedStateUpsert(tx, "state_tournaments", chunk));
    }
    track(await tx`DELETE FROM state_tournaments WHERE NOT (id = ANY(${tournamentIds}::text[]))`);
    if (state.audits.length) {
      const rows = state.audits.map(a => ({ id: a.id, text: a.text, occurred_at: a.at }));
      for (const chunk of insertChunks(rows)) track(await changedStateUpsert(tx, "state_audits", chunk));
    }
    track(await tx`DELETE FROM state_audits WHERE NOT (id = ANY(${auditIds}::text[]))`);
    if (changed) await tx`UPDATE state_settings SET updated_at = now() WHERE id = true`;
  });
}

export async function listSnapshots(limit = 50): Promise<{ id: number; savedAt: string }[]> {
  await ensureStateSchema();
  const sql = getSql();
  return sql<{ id: number; savedAt: string }[]>`SELECT id, saved_at AS "savedAt" FROM app_state_snapshots ORDER BY saved_at DESC LIMIT ${limit}`;
}

export async function restoreSnapshot(id: number) {
  await ensureStateSchema();
  const sql = getSql();
  const rows = await sql<{ state: State | null }[]>`SELECT state FROM app_state_snapshots WHERE id = ${id}`;
  if (!rows.length) throw new Error("snapshot not found");
  let state = rows[0].state;
  if (!state) {
    const items = await sql<{ entityType: SnapshotEntity["entityType"]; entityId: string; position: number; payload: unknown }[]>`SELECT i.entity_type AS "entityType", i.entity_id AS "entityId", i.position, e.payload FROM app_state_snapshot_items i JOIN app_state_snapshot_entities e ON e.content_hash = i.content_hash WHERE i.snapshot_id = ${id} ORDER BY i.entity_type, i.position`;
    state = {
      players: items.filter(item => item.entityType === "player").map(item => item.payload as Player),
      matches: items.filter(item => item.entityType === "match").map(item => item.payload as Match),
      tournaments: items.filter(item => item.entityType === "tournament").map(item => item.payload as Tournament),
      settings: (items.find(item => item.entityType === "settings")?.payload ?? {}) as Record<string, unknown>,
      audits: items.filter(item => item.entityType === "audit").map(item => item.payload as { id:string;text:string;at:string }),
    };
  }
  await putState(JSON.stringify(state));
}

export async function deleteState() {
  await ensureStateSchema(); const sql = getSql();
  await sql.begin(async tx => {
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    await tx`SELECT pg_advisory_xact_lock(72591003)`;
    await tx`DELETE FROM state_audits`;
    await tx`DELETE FROM state_matches`;
    await tx`DELETE FROM state_tournaments`;
    await tx`DELETE FROM state_players`;
    await tx`DELETE FROM state_settings`;
  });
}
