import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

/* db/*.ts import each other without file extensions, which Vite resolves for the app but Node
   does not. Registering the same resolution here lets the test load the real module rather than
   a copy of the query that could drift from it. */
register("data:text/javascript," + encodeURIComponent(`
  import { existsSync } from "node:fs";
  import { fileURLToPath, pathToFileURL } from "node:url";
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith(".") && ctx.parentURL?.startsWith("file:")) {
      const path = fileURLToPath(new URL(spec, ctx.parentURL));
      if (!existsSync(path) && existsSync(path + ".ts")) return { url: pathToFileURL(path + ".ts").href, shortCircuit: true };
    }
    return next(spec, ctx);
  }
`), import.meta.url);

/* getState() assembles the whole club document in one Postgres statement instead of five
   JavaScript-side queries (db/state.pg.ts). Every caller parses that string, so the rewrite had
   to preserve it exactly — key order included, which is why the query uses `to_json` rather than
   `to_jsonb`. This test pins that equivalence by running both shapes against a real database.

   Needs a throwaway Postgres; skipped without one:
     TEST_DATABASE_URL=postgres://... npm test */
const url = process.env.TEST_DATABASE_URL;

test("the single-statement document matches the five-query document exactly", { skip: url ? false : "set TEST_DATABASE_URL" }, async () => {
  const { default: postgres } = await import("postgres");
  process.env.POSTGRES_URL = url;
  const sql = postgres(url, { ssl: false, prepare: false, max: 4 });

  await sql.unsafe(`
    DROP TABLE IF EXISTS state_players, state_matches, state_tournaments, state_settings, state_audits CASCADE;
    CREATE TABLE state_players (id text PRIMARY KEY, name text NOT NULL, rating numeric NOT NULL, active boolean DEFAULT true NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL, short text NOT NULL, handicap numeric, colour text, initial_rating numeric NOT NULL, wins int DEFAULT 0 NOT NULL, losses int DEFAULT 0 NOT NULL, draws int DEFAULT 0 NOT NULL, frames_won int DEFAULT 0 NOT NULL, frames_lost int DEFAULT 0 NOT NULL, last_change numeric DEFAULT 0 NOT NULL, form jsonb DEFAULT '[]'::jsonb NOT NULL, avatar text, preliminary_rating numeric);
    CREATE TABLE state_matches (id text PRIMARY KEY, player_a text NOT NULL, player_b text NOT NULL, player_a2 text, player_b2 text, mode text, team_a_name text, team_b_name text, played_on date, status text NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL, score_a int NOT NULL, score_b int NOT NULL, entry_mode text, frame_evidence numeric, performance_score numeric, evidence_weight numeric, handicap_adjustment numeric, over_handicap_elo numeric, over_handicap_multiplier numeric, high_breaks jsonb DEFAULT '[]'::jsonb NOT NULL, actual numeric NOT NULL, giver text, official numeric, extra numeric NOT NULL, expected_a numeric NOT NULL, before_a numeric NOT NULL, before_b numeric NOT NULL, before_a2 numeric, before_b2 numeric, after_a numeric NOT NULL, after_b numeric NOT NULL, after_a2 numeric, after_b2 numeric, delta_a numeric NOT NULL, delta_b numeric, delta_a2 numeric, delta_b2 numeric, margin_multiplier numeric, tournament_id text, tournament_round int, tournament_match_index int, created_at timestamptz NOT NULL);
    CREATE TABLE state_tournaments (id text PRIMARY KEY, name text NOT NULL, handicap_mode text NOT NULL, signup_deadline timestamptz NOT NULL, created_at timestamptz NOT NULL, created_by text, signups jsonb DEFAULT '[]'::jsonb NOT NULL, draw jsonb, drawn_at timestamptz, walkovers jsonb);
    CREATE TABLE state_settings (id boolean PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL);
    CREATE TABLE state_audits (id text PRIMARY KEY, text text NOT NULL, occurred_at timestamptz NOT NULL);
  `);

  // Nullable columns, sub-second and whole-second timestamps, a null play date, non-ASCII names
  // and a tie on the audit sort key — every place the two encodings could have drifted apart.
  await sql.unsafe(`
    INSERT INTO state_players (id,name,short,rating,handicap,colour,avatar,initial_rating,preliminary_rating,wins,losses,draws,frames_won,frames_lost,last_change,form,active) VALUES
     ('p2','Bob','B',1512.3333333,NULL,NULL,NULL,1500,NULL,3,1,0,10,7,12.3333333,'["W","L"]',true),
     ('p1','Alice','A',1487.6666667,-2.5,'#ff0000','a.png',1500,1490.25,1,3,0,7,10,-0.1,'[]',false),
     ('p3','Céline','C',1500,0,NULL,NULL,1500,NULL,0,0,0,0,0,0,'[]',true);
    INSERT INTO state_matches (id,player_a,player_b,player_a2,player_b2,mode,team_a_name,team_b_name,played_on,status,score_a,score_b,entry_mode,frame_evidence,performance_score,evidence_weight,handicap_adjustment,over_handicap_elo,over_handicap_multiplier,high_breaks,actual,giver,official,extra,expected_a,before_a,before_b,before_a2,before_b2,after_a,after_b,after_a2,after_b2,delta_a,delta_b,delta_a2,delta_b2,margin_multiplier,tournament_id,tournament_round,tournament_match_index,created_at) VALUES
     ('m2','p1','p2',NULL,NULL,NULL,NULL,NULL,'2026-02-01','confirmed',2,3,'match',5,0.4,0.5,0,0,1,'[{"playerId":"p1","value":42}]',10,'p1',8,2,0.5123,1500,1500,NULL,NULL,1487.6666667,1512.3333333,NULL,NULL,-12.3333333,12.3333333,NULL,NULL,NULL,NULL,NULL,NULL,'2026-02-01T10:00:00.250Z'),
     ('m1','p1','p2','p3','p2','entertainment','紅隊','藍隊',NULL,'void',0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'[]',0,NULL,NULL,0,0.5,1500,1500,1500,1500,1500,1500,1500,1500,0,0,0,0,1,'t1',1,0,'2026-01-15T08:30:00Z');
    INSERT INTO state_tournaments VALUES ('t1','冬季盃','suggested','2026-01-20T15:00:00Z','2026-01-10T00:00:00Z','p1','["p1","p2"]','["p1","p2"]','2026-01-21T02:00:00.123Z','[{"round":1,"index":0,"winner":"p1"}]');
    INSERT INTO state_tournaments VALUES ('t2','夏季盃','none','2026-06-20T15:00:00Z','2026-06-01T00:00:00Z',NULL,'[]',NULL,NULL,NULL);
    INSERT INTO state_settings VALUES (true,'{"start":1500,"modelVersion":14,"compressionWidthExponent":0.1}');
    INSERT INTO state_audits VALUES ('a1','建立球會','2026-01-01T00:00:00Z'),('a2','調整設定','2026-01-01T00:00:00Z'),('a3','記錄比賽','2026-03-01T12:00:00.5Z');
  `);

  const [players, matches, tournaments, settings, audits] = await Promise.all([
    sql`SELECT id, name, short, handicap::float8 AS handicap, rating::float8 AS rating, colour, avatar, initial_rating::float8 AS "initialRating", preliminary_rating::float8 AS "preliminaryRating", active, wins, losses, draws, frames_won AS "framesWon", frames_lost AS "framesLost", last_change::float8 AS "lastChange", form FROM state_players ORDER BY name`,
    sql`SELECT id, player_a AS a, player_b AS b, player_a2 AS a2, player_b2 AS b2, mode, team_a_name AS "teamAName", team_b_name AS "teamBName", score_a AS "scoreA", score_b AS "scoreB", to_char(played_on, 'YYYY-MM-DD') AS "playedOn", entry_mode AS "entryMode", frame_evidence::float8 AS "frameEvidence", performance_score::float8 AS "performanceScore", evidence_weight::float8 AS "evidenceWeight", handicap_adjustment::float8 AS "handicapAdjustment", over_handicap_elo::float8 AS "overHandicapElo", over_handicap_multiplier::float8 AS "overHandicapMultiplier", high_breaks AS "highBreaks", actual::float8 AS actual, giver, official::float8 AS official, extra::float8 AS extra, expected_a::float8 AS "expectedA", before_a::float8 AS "beforeA", before_b::float8 AS "beforeB", before_a2::float8 AS "beforeA2", before_b2::float8 AS "beforeB2", after_a::float8 AS "afterA", after_b::float8 AS "afterB", after_a2::float8 AS "afterA2", after_b2::float8 AS "afterB2", delta_a::float8 AS "deltaA", delta_b::float8 AS "deltaB", delta_a2::float8 AS "deltaA2", delta_b2::float8 AS "deltaB2", margin_multiplier::float8 AS "marginMultiplier", tournament_id AS "tournamentId", tournament_round AS "tournamentRound", tournament_match_index AS "tournamentMatchIndex", status, created_at AS "createdAt" FROM state_matches ORDER BY played_on, created_at, id`,
    sql`SELECT id, name, handicap_mode AS "handicapMode", to_char(signup_deadline AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-DD"T"HH24:MI') AS "signupDeadline", created_at AS "createdAt", created_by AS "createdBy", signups, draw, drawn_at AS "drawnAt", walkovers FROM state_tournaments ORDER BY created_at DESC`,
    sql`SELECT data FROM state_settings WHERE id = true`,
    sql`SELECT id, text, occurred_at AS at FROM state_audits ORDER BY occurred_at DESC, id DESC`,
  ]);
  const expected = JSON.stringify({ players, matches, tournaments, settings: settings[0]?.data ?? {}, audits });

  const { getStateDocument, getStateVersion } = await import("../db/state.pg.ts");
  const document = await getStateDocument();

  // Key order and value encoding both matter: callers JSON.parse this and compare the result.
  assert.equal(JSON.stringify(JSON.parse(document.data)), expected);

  // The version travels as an ETag, so it must be stable for unchanged data, agree with the
  // standalone probe that answers conditional requests, and move when the club changes.
  assert.equal(document.version, await getStateVersion());
  assert.equal((await getStateDocument()).version, document.version);
  await sql`UPDATE state_settings SET updated_at = now() + interval '1 second' WHERE id = true`;
  assert.notEqual((await getStateDocument()).version, document.version);

  await sql.end();
});

test("an entirely empty database still reads as no state at all", { skip: url ? false : "set TEST_DATABASE_URL" }, async () => {
  const { default: postgres } = await import("postgres");
  process.env.POSTGRES_URL = url;
  const sql = postgres(url, { ssl: false, prepare: false, max: 4 });
  await sql.unsafe(`TRUNCATE state_players, state_matches, state_tournaments, state_settings, state_audits`);
  const { getStateDocument } = await import("../db/state.pg.ts");
  assert.equal((await getStateDocument()).data, null);
  await sql.end();
});
