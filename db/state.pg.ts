import { createHash } from "node:crypto";
import { getSql } from "./sql";

type Player = { id:string; name:string; short:string; handicap:number|null; rating:number; colour?:string; avatar?:string|null; initialRating:number; active:boolean; wins:number; losses:number; draws:number; framesWon:number; framesLost:number; lastChange:number; form:string[] };
type Match = { id:string; a:string; b:string; a2?:string; b2?:string; mode?:string; teamAName?:string; teamBName?:string; scoreA:number; scoreB:number; playedOn:string; entryMode?:("match"|"aggregate"); frameEvidence?:number; performanceScore?:number; evidenceWeight?:number; handicapAdjustment?:number; overHandicapElo?:number; overHandicapMultiplier?:number; highBreaks?:{playerId:string;value:number}[]; actual:number; giver:string|null; official:number|null; extra:number; expectedA:number; beforeA:number; beforeB:number; beforeA2?:number; beforeB2?:number; afterA:number; afterB:number; afterA2?:number; afterB2?:number; deltaA:number; marginMultiplier?:number; status:("confirmed"|"void"); createdAt:string; tournamentId?:string; tournamentRound?:number; tournamentMatchIndex?:number };
type Walkover = { round:number; index:number; winner:string; reason?:string };
type Tournament = { id:string; name:string; handicapMode:"suggested"|"none"; signupDeadline:string; createdAt:string; createdBy?:string; signups:string[]; draw?:string[]|null; drawnAt?:string|null; walkovers?:Walkover[]|null };
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
      await tx`CREATE TABLE IF NOT EXISTS state_tournaments (id text PRIMARY KEY, name text NOT NULL, handicap_mode text NOT NULL, signup_deadline timestamptz NOT NULL, created_at timestamptz NOT NULL, created_by text REFERENCES state_players(id) ON DELETE SET NULL, signups jsonb NOT NULL DEFAULT '[]'::jsonb)`;
      await tx`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'state_tournaments' AND column_name = 'signup_deadline' AND data_type = 'date') THEN ALTER TABLE state_tournaments ALTER COLUMN signup_deadline TYPE timestamptz USING signup_deadline::timestamp AT TIME ZONE 'Asia/Hong_Kong'; END IF; END $$`;
      // Added after the first release — existing deployments get it here rather
      // than depending on a migration having been run by hand.
      await tx`ALTER TABLE state_players ADD COLUMN IF NOT EXISTS avatar text`;
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
    });
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

export async function getState(): Promise<string | null> {
  await ensureStateSchema();
  const sql = getSql();
  const [players, matches, tournaments, settings, audits] = await Promise.all([
    sql<Player[]>`SELECT id, name, short, handicap::float8 AS handicap, rating::float8 AS rating, colour, avatar, initial_rating::float8 AS "initialRating", active, wins, losses, draws, frames_won AS "framesWon", frames_lost AS "framesLost", last_change::float8 AS "lastChange", form FROM state_players ORDER BY name`,
    sql<Match[]>`SELECT id, player_a AS a, player_b AS b, player_a2 AS a2, player_b2 AS b2, mode, team_a_name AS "teamAName", team_b_name AS "teamBName", score_a AS "scoreA", score_b AS "scoreB", to_char(played_on, 'YYYY-MM-DD') AS "playedOn", entry_mode AS "entryMode", frame_evidence::float8 AS "frameEvidence", performance_score::float8 AS "performanceScore", evidence_weight::float8 AS "evidenceWeight", handicap_adjustment::float8 AS "handicapAdjustment", over_handicap_elo::float8 AS "overHandicapElo", over_handicap_multiplier::float8 AS "overHandicapMultiplier", high_breaks AS "highBreaks", actual::float8 AS actual, giver, official::float8 AS official, extra::float8 AS extra, expected_a::float8 AS "expectedA", before_a::float8 AS "beforeA", before_b::float8 AS "beforeB", before_a2::float8 AS "beforeA2", before_b2::float8 AS "beforeB2", after_a::float8 AS "afterA", after_b::float8 AS "afterB", after_a2::float8 AS "afterA2", after_b2::float8 AS "afterB2", delta_a::float8 AS "deltaA", margin_multiplier::float8 AS "marginMultiplier", tournament_id AS "tournamentId", tournament_round AS "tournamentRound", tournament_match_index AS "tournamentMatchIndex", status, created_at AS "createdAt" FROM state_matches ORDER BY played_on, created_at, id`,
    sql<Tournament[]>`SELECT id, name, handicap_mode AS "handicapMode", to_char(signup_deadline AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-DD"T"HH24:MI') AS "signupDeadline", created_at AS "createdAt", created_by AS "createdBy", signups, draw, drawn_at AS "drawnAt", walkovers FROM state_tournaments ORDER BY created_at DESC`,
    sql<{data:Record<string, unknown>}[]>`SELECT data FROM state_settings WHERE id = true`,
    sql<{id:string;text:string;at:string}[]>`SELECT id, text, occurred_at AS at FROM state_audits ORDER BY occurred_at DESC, id DESC`,
  ]);
  if (!players.length && !matches.length && !tournaments.length && !settings.length && !audits.length) return null;
  return JSON.stringify({ players, matches, tournaments, settings: settings[0]?.data ?? {}, audits });
}

export async function putState(data: string) {
  await ensureStateSchema();
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
    // Snapshots exist for admin rollback, not per-save auditing — writing one
    // on every save (some of which are near-identical, seconds apart) grew the
    // table without bound. Throttle to at most one per hour and cap history to
    // the most recent 100, so storage stays flat regardless of save frequency.
    const snapshotRows = await tx<{ id: number }[]>`INSERT INTO app_state_snapshots (state)
      SELECT NULL::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM app_state_snapshots WHERE saved_at > now() - interval '1 hour')
      RETURNING id`;
    if (snapshotRows.length) {
      const snapshotId = snapshotRows[0].id;
      const entities = snapshotEntities(state).map(entity => ({
        content_hash: snapshotHash(entity.entityType, entity.entityId, entity.payload),
        entity_type: entity.entityType,
        entity_id: entity.entityId,
        payload: tx.json(entity.payload as any),
      }));
      await tx`INSERT INTO app_state_snapshot_entities ${tx(entities)} ON CONFLICT (content_hash) DO NOTHING`;
      const items = snapshotEntities(state).map(entity => ({
        snapshot_id: snapshotId,
        entity_type: entity.entityType,
        entity_id: entity.entityId,
        content_hash: snapshotHash(entity.entityType, entity.entityId, entity.payload),
        position: entity.position,
      }));
      await tx`INSERT INTO app_state_snapshot_items ${tx(items)}`;
    }
    await tx`DELETE FROM app_state_snapshots WHERE id NOT IN (SELECT id FROM app_state_snapshots ORDER BY saved_at DESC LIMIT 100)`;
    await tx`DELETE FROM app_state_snapshot_entities e WHERE NOT EXISTS (SELECT 1 FROM app_state_snapshot_items i WHERE i.content_hash = e.content_hash)`;
    await tx`INSERT INTO state_settings (id, data, updated_at) VALUES (true, ${tx.json(state.settings as any)}, now()) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;

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
    await tx`DELETE FROM state_matches WHERE NOT (id = ANY(${matchIds}::text[]))`;

    if (state.players.length) {
      const rows = state.players.map(p => ({
        id: p.id, name: p.name, short: p.short, handicap: p.handicap, rating: p.rating,
        colour: p.colour ?? null, avatar: p.avatar ?? null, initial_rating: p.initialRating,
        active: p.active, wins: p.wins, losses: p.losses, draws: p.draws,
        frames_won: p.framesWon, frames_lost: p.framesLost, last_change: p.lastChange,
        form: tx.json(p.form), updated_at: new Date(),
      }));
      await tx`INSERT INTO state_players ${tx(rows)}
        ON CONFLICT (id) DO UPDATE SET name=excluded.name,short=excluded.short,handicap=excluded.handicap,rating=excluded.rating,colour=excluded.colour,avatar=excluded.avatar,initial_rating=excluded.initial_rating,active=excluded.active,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,frames_won=excluded.frames_won,frames_lost=excluded.frames_lost,last_change=excluded.last_change,form=excluded.form,updated_at=excluded.updated_at`;
    }
    await tx`DELETE FROM state_players WHERE NOT (id = ANY(${playerIds}::text[]))`;

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
        delta_a: m.deltaA,
        margin_multiplier: m.marginMultiplier ?? null, tournament_id: m.tournamentId ?? null, tournament_round: m.tournamentRound ?? null, tournament_match_index: m.tournamentMatchIndex ?? null,
        status: m.status, created_at: m.createdAt, updated_at: new Date(),
      }));
      await tx`INSERT INTO state_matches ${tx(rows)}
        ON CONFLICT (id) DO UPDATE SET player_a=excluded.player_a,player_b=excluded.player_b,player_a2=excluded.player_a2,player_b2=excluded.player_b2,mode=excluded.mode,team_a_name=excluded.team_a_name,team_b_name=excluded.team_b_name,score_a=excluded.score_a,score_b=excluded.score_b,played_on=excluded.played_on,entry_mode=excluded.entry_mode,frame_evidence=excluded.frame_evidence,performance_score=excluded.performance_score,evidence_weight=excluded.evidence_weight,handicap_adjustment=excluded.handicap_adjustment,over_handicap_elo=excluded.over_handicap_elo,over_handicap_multiplier=excluded.over_handicap_multiplier,high_breaks=excluded.high_breaks,actual=excluded.actual,giver=excluded.giver,official=excluded.official,extra=excluded.extra,expected_a=excluded.expected_a,before_a=excluded.before_a,before_b=excluded.before_b,before_a2=excluded.before_a2,before_b2=excluded.before_b2,after_a=excluded.after_a,after_b=excluded.after_b,after_a2=excluded.after_a2,after_b2=excluded.after_b2,delta_a=excluded.delta_a,margin_multiplier=excluded.margin_multiplier,tournament_id=excluded.tournament_id,tournament_round=excluded.tournament_round,tournament_match_index=excluded.tournament_match_index,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at`;
    }

    if (state.tournaments.length) {
      const rows = state.tournaments.map(t => ({ id: t.id, name: t.name, handicap_mode: t.handicapMode, signup_deadline: t.signupDeadline.length === 16 ? `${t.signupDeadline}:00+08:00` : t.signupDeadline, created_at: t.createdAt, created_by: t.createdBy ?? null, signups: tx.json(t.signups), draw: t.draw?.length ? tx.json(t.draw) : null, drawn_at: t.drawnAt ?? null, walkovers: t.walkovers?.length ? tx.json(t.walkovers) : null }));
      await tx`INSERT INTO state_tournaments ${tx(rows)}
        ON CONFLICT (id) DO UPDATE SET name=excluded.name,handicap_mode=excluded.handicap_mode,signup_deadline=excluded.signup_deadline,created_at=excluded.created_at,created_by=excluded.created_by,signups=excluded.signups,draw=excluded.draw,drawn_at=excluded.drawn_at,walkovers=excluded.walkovers`;
    }
    await tx`DELETE FROM state_tournaments WHERE NOT (id = ANY(${tournamentIds}::text[]))`;
    if (state.audits.length) {
      const rows = state.audits.map(a => ({ id: a.id, text: a.text, occurred_at: a.at }));
      await tx`INSERT INTO state_audits ${tx(rows)}
        ON CONFLICT (id) DO UPDATE SET text=excluded.text,occurred_at=excluded.occurred_at`;
    }
    await tx`DELETE FROM state_audits WHERE NOT (id = ANY(${auditIds}::text[]))`;
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
