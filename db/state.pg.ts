import { getSql } from "./sql";

type Player = { id:string; name:string; short:string; handicap:number|null; rating:number; colour?:string; avatar?:string|null; initialRating:number; active:boolean; wins:number; losses:number; draws:number; framesWon:number; framesLost:number; lastChange:number; form:string[] };
type Match = { id:string; a:string; b:string; scoreA:number; scoreB:number; playedOn:string; entryMode?:"match"|"aggregate"; frameEvidence?:number; performanceScore?:number; evidenceWeight?:number; handicapAdjustment?:number; overHandicapElo?:number; overHandicapMultiplier?:number; highBreaks?:{playerId:string;value:number}[]; actual:number; giver:string|null; official:number|null; extra:number; expectedA:number; beforeA:number; beforeB:number; afterA:number; afterB:number; deltaA:number; marginMultiplier?:number; status:"confirmed"|"void"; createdAt:string };
type State = { players:Player[]; matches:Match[]; settings:Record<string, unknown>; audits:{id:string;text:string;at:string}[] };

let schemaReady: Promise<unknown> | null = null;
export function ensureStateSchema() {
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
      await tx`CREATE TABLE IF NOT EXISTS state_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
      await tx`CREATE TABLE IF NOT EXISTS state_audits (id text PRIMARY KEY, text text NOT NULL, occurred_at timestamptz NOT NULL)`;
      // Added after the first release — existing deployments get it here rather
      // than depending on a migration having been run by hand.
      await tx`ALTER TABLE state_players ADD COLUMN IF NOT EXISTS avatar text`;
    });
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

export async function getState(): Promise<string | null> {
  await ensureStateSchema();
  const sql = getSql();
  const [players, matches, settings, audits] = await Promise.all([
    sql<Player[]>`SELECT id, name, short, handicap::float8 AS handicap, rating::float8 AS rating, colour, avatar, initial_rating::float8 AS "initialRating", active, wins, losses, draws, frames_won AS "framesWon", frames_lost AS "framesLost", last_change::float8 AS "lastChange", form FROM state_players ORDER BY name`,
    sql<Match[]>`SELECT id, player_a AS a, player_b AS b, score_a AS "scoreA", score_b AS "scoreB", to_char(played_on, 'YYYY-MM-DD') AS "playedOn", entry_mode AS "entryMode", frame_evidence::float8 AS "frameEvidence", performance_score::float8 AS "performanceScore", evidence_weight::float8 AS "evidenceWeight", handicap_adjustment::float8 AS "handicapAdjustment", over_handicap_elo::float8 AS "overHandicapElo", over_handicap_multiplier::float8 AS "overHandicapMultiplier", high_breaks AS "highBreaks", actual::float8 AS actual, giver, official::float8 AS official, extra::float8 AS extra, expected_a::float8 AS "expectedA", before_a::float8 AS "beforeA", before_b::float8 AS "beforeB", after_a::float8 AS "afterA", after_b::float8 AS "afterB", delta_a::float8 AS "deltaA", margin_multiplier::float8 AS "marginMultiplier", status, created_at AS "createdAt" FROM state_matches ORDER BY played_on, created_at, id`,
    sql<{data:Record<string, unknown>}[]>`SELECT data FROM state_settings WHERE id = true`,
    sql<{id:string;text:string;at:string}[]>`SELECT id, text, occurred_at AS at FROM state_audits ORDER BY occurred_at DESC, id DESC`,
  ]);
  if (!players.length && !matches.length && !settings.length && !audits.length) return null;
  return JSON.stringify({ players, matches, settings: settings[0]?.data ?? {}, audits });
}

export async function putState(data: string) {
  await ensureStateSchema();
  const state = JSON.parse(data) as State;
  const sql = getSql();
  await sql.begin(async tx => {
    // If the client connection drops mid-transaction, this bounds how long the
    // orphaned session sits idle holding locks before Postgres kills it itself
    // — previously it could sit for 10+ minutes, queueing up every other write.
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    await tx`INSERT INTO app_state_snapshots (state) VALUES (${tx.json(state as any)})`;
    await tx`INSERT INTO state_settings (id, data, updated_at) VALUES (true, ${tx.json(state.settings as any)}, now()) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;

    // Each table below does at most one bulk upsert plus one bulk stale-row
    // delete, instead of a round trip per row — a save with dozens of players
    // and matches previously meant dozens of sequential statements, each one
    // more exposure for a dropped connection to leave the transaction stuck
    // open mid-save, holding locks for everyone else.
    const playerIds = state.players.map(p => p.id);
    const matchIds = state.matches.map(m => m.id);
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
        id: m.id, player_a: m.a, player_b: m.b, score_a: m.scoreA, score_b: m.scoreB,
        played_on: m.playedOn, entry_mode: m.entryMode ?? null, frame_evidence: m.frameEvidence ?? null,
        performance_score: m.performanceScore ?? null, evidence_weight: m.evidenceWeight ?? null,
        handicap_adjustment: m.handicapAdjustment ?? null, over_handicap_elo: m.overHandicapElo ?? null,
        over_handicap_multiplier: m.overHandicapMultiplier ?? null, high_breaks: tx.json(m.highBreaks ?? []),
        actual: m.actual, giver: m.giver, official: m.official, extra: m.extra, expected_a: m.expectedA,
        before_a: m.beforeA, before_b: m.beforeB, after_a: m.afterA, after_b: m.afterB, delta_a: m.deltaA,
        margin_multiplier: m.marginMultiplier ?? null, status: m.status, created_at: m.createdAt, updated_at: new Date(),
      }));
      await tx`INSERT INTO state_matches ${tx(rows)}
        ON CONFLICT (id) DO UPDATE SET player_a=excluded.player_a,player_b=excluded.player_b,score_a=excluded.score_a,score_b=excluded.score_b,played_on=excluded.played_on,entry_mode=excluded.entry_mode,frame_evidence=excluded.frame_evidence,performance_score=excluded.performance_score,evidence_weight=excluded.evidence_weight,handicap_adjustment=excluded.handicap_adjustment,over_handicap_elo=excluded.over_handicap_elo,over_handicap_multiplier=excluded.over_handicap_multiplier,high_breaks=excluded.high_breaks,actual=excluded.actual,giver=excluded.giver,official=excluded.official,extra=excluded.extra,expected_a=excluded.expected_a,before_a=excluded.before_a,before_b=excluded.before_b,after_a=excluded.after_a,after_b=excluded.after_b,delta_a=excluded.delta_a,margin_multiplier=excluded.margin_multiplier,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at`;
    }

    if (state.audits.length) {
      const rows = state.audits.map(a => ({ id: a.id, text: a.text, occurred_at: a.at }));
      await tx`INSERT INTO state_audits ${tx(rows)}
        ON CONFLICT (id) DO UPDATE SET text=excluded.text,occurred_at=excluded.occurred_at`;
    }
    await tx`DELETE FROM state_audits WHERE NOT (id = ANY(${auditIds}::text[]))`;
  });
}

export async function deleteState() {
  await ensureStateSchema(); const sql = getSql();
  await sql.begin(async tx => {
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    await tx`DELETE FROM state_audits`; await tx`DELETE FROM state_matches`; await tx`DELETE FROM state_players`; await tx`DELETE FROM state_settings`;
  });
}
