import postgres from "postgres";

type Player = { id:string; name:string; short:string; handicap:number|null; rating:number; colour?:string; avatar?:string|null; initialRating:number; active:boolean; wins:number; losses:number; draws:number; framesWon:number; framesLost:number; lastChange:number; form:string[] };
type Match = { id:string; a:string; b:string; scoreA:number; scoreB:number; playedOn:string; entryMode?:"match"|"aggregate"; frameEvidence?:number; performanceScore?:number; evidenceWeight?:number; handicapAdjustment?:number; overHandicapElo?:number; overHandicapMultiplier?:number; highBreaks?:{playerId:string;value:number}[]; actual:number; giver:string|null; official:number|null; extra:number; expectedA:number; beforeA:number; beforeB:number; afterA:number; afterB:number; deltaA:number; marginMultiplier?:number; status:"confirmed"|"void"; createdAt:string };
type State = { players:Player[]; matches:Match[]; settings:Record<string, unknown>; audits:{id:string;text:string;at:string}[] };

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (!sqlClient) {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!url) throw new Error("No Postgres connection string found. Set POSTGRES_URL.");
    sqlClient = postgres(url, { ssl: "require", prepare: false });
  }
  return sqlClient;
}

let schemaReady: Promise<unknown> | null = null;
function ensureStateSchema() {
  schemaReady ??= (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS app_state_snapshots (id bigserial PRIMARY KEY, state jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS state_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS state_audits (id text PRIMARY KEY, text text NOT NULL, occurred_at timestamptz NOT NULL)`;
    // Added after the first release — existing deployments get it here rather
    // than depending on a migration having been run by hand.
    await sql`ALTER TABLE state_players ADD COLUMN IF NOT EXISTS avatar text`;
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
    await tx`INSERT INTO app_state_snapshots (state) VALUES (${JSON.stringify(state)})`;
    await tx`INSERT INTO state_settings (id, data, updated_at) VALUES (true, ${JSON.stringify(state.settings)}, now()) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;
    const playerIds = new Set(state.players.map(p => p.id));
    const matchIds = new Set(state.matches.map(m => m.id));
    for (const { id } of await tx<{id:string}[]>`SELECT id FROM state_matches`) if (!matchIds.has(id)) await tx`DELETE FROM state_matches WHERE id = ${id}`;

    for (const p of state.players) await tx`INSERT INTO state_players (id,name,short,handicap,rating,colour,avatar,initial_rating,active,wins,losses,draws,frames_won,frames_lost,last_change,form,updated_at) VALUES (${p.id},${p.name},${p.short},${p.handicap},${p.rating},${p.colour ?? null},${p.avatar ?? null},${p.initialRating},${p.active},${p.wins},${p.losses},${p.draws},${p.framesWon},${p.framesLost},${p.lastChange},${JSON.stringify(p.form)},now()) ON CONFLICT (id) DO UPDATE SET name=excluded.name,short=excluded.short,handicap=excluded.handicap,rating=excluded.rating,colour=excluded.colour,avatar=excluded.avatar,initial_rating=excluded.initial_rating,active=excluded.active,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,frames_won=excluded.frames_won,frames_lost=excluded.frames_lost,last_change=excluded.last_change,form=excluded.form,updated_at=excluded.updated_at`;
    for (const { id } of await tx<{id:string}[]>`SELECT id FROM state_players`) if (!playerIds.has(id)) await tx`DELETE FROM state_players WHERE id = ${id}`;

    for (const m of state.matches) await tx`INSERT INTO state_matches (id,player_a,player_b,score_a,score_b,played_on,entry_mode,frame_evidence,performance_score,evidence_weight,handicap_adjustment,over_handicap_elo,over_handicap_multiplier,high_breaks,actual,giver,official,extra,expected_a,before_a,before_b,after_a,after_b,delta_a,margin_multiplier,status,created_at,updated_at) VALUES (${m.id},${m.a},${m.b},${m.scoreA},${m.scoreB},${m.playedOn},${m.entryMode ?? null},${m.frameEvidence ?? null},${m.performanceScore ?? null},${m.evidenceWeight ?? null},${m.handicapAdjustment ?? null},${m.overHandicapElo ?? null},${m.overHandicapMultiplier ?? null},${JSON.stringify(m.highBreaks ?? [])},${m.actual},${m.giver},${m.official},${m.extra},${m.expectedA},${m.beforeA},${m.beforeB},${m.afterA},${m.afterB},${m.deltaA},${m.marginMultiplier ?? null},${m.status},${m.createdAt},now()) ON CONFLICT (id) DO UPDATE SET player_a=excluded.player_a,player_b=excluded.player_b,score_a=excluded.score_a,score_b=excluded.score_b,played_on=excluded.played_on,entry_mode=excluded.entry_mode,frame_evidence=excluded.frame_evidence,performance_score=excluded.performance_score,evidence_weight=excluded.evidence_weight,handicap_adjustment=excluded.handicap_adjustment,over_handicap_elo=excluded.over_handicap_elo,over_handicap_multiplier=excluded.over_handicap_multiplier,high_breaks=excluded.high_breaks,actual=excluded.actual,giver=excluded.giver,official=excluded.official,extra=excluded.extra,expected_a=excluded.expected_a,before_a=excluded.before_a,before_b=excluded.before_b,after_a=excluded.after_a,after_b=excluded.after_b,delta_a=excluded.delta_a,margin_multiplier=excluded.margin_multiplier,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at`;
    const auditIds = new Set(state.audits.map(a => a.id));
    for (const { id } of await tx<{id:string}[]>`SELECT id FROM state_audits`) if (!auditIds.has(id)) await tx`DELETE FROM state_audits WHERE id = ${id}`;
    for (const a of state.audits) await tx`INSERT INTO state_audits (id,text,occurred_at) VALUES (${a.id},${a.text},${a.at}) ON CONFLICT (id) DO UPDATE SET text=excluded.text,occurred_at=excluded.occurred_at`;
  });
}

export async function deleteState() {
  await ensureStateSchema(); const sql = getSql();
  await sql.begin(async tx => { await tx`DELETE FROM state_audits`; await tx`DELETE FROM state_matches`; await tx`DELETE FROM state_players`; await tx`DELETE FROM state_settings`; });
}
