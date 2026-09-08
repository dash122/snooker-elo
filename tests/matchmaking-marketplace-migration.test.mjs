import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";

const migration = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),"utf8");

test("marketplace migration preserves legacy rows and enforces the new storage contract", async t => {
  const db = new PGlite();
  try {
    // Minimal upstream dependencies; formation tables and constraints come from real migrations.
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE state_players (id text PRIMARY KEY);
      CREATE TABLE venues (id text PRIMARY KEY);
      CREATE TABLE availability_slots (
        id text PRIMARY KEY, player_id text NOT NULL REFERENCES state_players(id),
        start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
        venue_id text REFERENCES venues(id) ON DELETE RESTRICT,
        commitment text NOT NULL DEFAULT 'going', conditions jsonb NOT NULL DEFAULT '{}'
      );
      INSERT INTO state_players VALUES ('a'),('b'),('c'),('d');
      INSERT INTO venues VALUES ('scaa');
    `);
    await db.exec(migration("20260830052006_matchmaking_formation_mvp"));
    await db.exec(migration("20260831000000_matchmaking_option_a_two_player"));
    await db.exec(`
      INSERT INTO availability_slots (id,player_id,start_at,end_at,venue_id,conditions) VALUES
        ('exact','a','2026-09-09 12:00Z','2026-09-09 15:00Z','scaa','{"levelOnly":true}'),
        ('flexible','b','2026-09-09 12:00Z','2026-09-09 15:00Z',NULL,'{}');
      INSERT INTO matchmaking_sessions (id,host_player_id,anchor_slot_id,start_at,end_at,target_size)
        VALUES ('old','a','exact','2026-09-09 12:00Z','2026-09-09 15:00Z',2);
      INSERT INTO matchmaking_session_members (session_id,player_id,role,status)
        VALUES ('old','a','host','accepted'),('old','b','member','pending');
    `);
    const oldSession = (await db.query("SELECT * FROM matchmaking_sessions WHERE id='old'")).rows[0];
    const oldMembers = (await db.query("SELECT * FROM matchmaking_session_members ORDER BY player_id")).rows;
    await db.exec(migration("20260908021904_matchmaking_marketplace_mvp"));

    await t.test("legacy data and omitted-column writes retain their meaning", async () => {
      const migrated = (await db.query("SELECT * FROM matchmaking_sessions WHERE id='old'")).rows[0];
      for (const [key,value] of Object.entries(oldSession)) assert.deepEqual(migrated[key],value,key);
      assert.equal(migrated.source,"legacy");
      assert.equal(migrated.created_by_player_id,"a");
      assert.deepEqual((await db.query("SELECT * FROM matchmaking_session_members ORDER BY player_id")).rows,oldMembers);
      assert.deepEqual((await db.query("SELECT id,venue_scope,conditions FROM availability_slots ORDER BY id")).rows,[
        {id:"exact",venue_scope:"exact",conditions:{levelOnly:true}},
        {id:"flexible",venue_scope:"any_hk",conditions:{}},
      ]);
      await db.exec(`INSERT INTO availability_slots (id,player_id,start_at,end_at,venue_id) VALUES
        ('legacy-null','c','2026-09-09 12:00Z','2026-09-09 15:00Z',NULL),
        ('legacy-venue','d','2026-09-09 12:00Z','2026-09-09 15:00Z','scaa');`);
      assert.deepEqual((await db.query("SELECT venue_scope FROM availability_slots WHERE id LIKE 'legacy-%' ORDER BY id")).rows,[{venue_scope:"any_hk"},{venue_scope:"exact"}]);
    });

    await t.test("both tables enforce all ordered group ranges from two through six", async () => {
      for (const table of ["availability_slots","matchmaking_sessions"]) {
        const id = table === "availability_slots" ? "flexible" : "old";
        for (const [min,ideal,max] of [[2,2,2],[2,3,3],[4,5,6],[2,4,6],[6,6,6]]) {
          await db.query(`UPDATE ${table} SET min_players=$1,target_size=$2,max_players=$3 WHERE id=$4`,[min,ideal,max,id]);
        }
        for (const [min,ideal,max] of [[1,2,2],[3,2,4],[2,4,3],[2,4,7]]) {
          await assert.rejects(db.query(`UPDATE ${table} SET min_players=$1,target_size=$2,max_players=$3 WHERE id=$4`,[min,ideal,max,id]),{code:"23514"});
        }
        await db.query(`UPDATE ${table} SET min_players=2,target_size=2,max_players=2 WHERE id=$1`,[id]);
      }
      await assert.rejects(db.exec("UPDATE availability_slots SET venue_scope='exact' WHERE id='flexible'"),{code:"23514"});
      await assert.rejects(db.exec("UPDATE availability_slots SET venue_scope='district' WHERE id='flexible'"),{code:"23514"});
      await assert.rejects(db.exec("UPDATE availability_slots SET venue_scope='nearby' WHERE id='exact'"),{code:"23514"});
      await db.exec("UPDATE availability_slots SET venue_scope='district' WHERE id='exact'");
    });

    await t.test("hostless sessions allow multiple invitations and shared optional anchors", async () => {
      await db.exec(`INSERT INTO matchmaking_sessions (id,start_at,end_at,target_size,min_players,max_players,source,created_by_player_id,anchor_slot_id)
        VALUES ('new','2026-09-09 12:00Z','2026-09-09 15:00Z',5,4,6,'marketplace','a',NULL),
        ('direct','2026-09-09 12:00Z','2026-09-09 15:00Z',2,2,2,'direct','a','exact');
        INSERT INTO matchmaking_session_members (session_id,player_id,status) VALUES
          ('new','a','accepted'),('new','b','pending'),('new','c','pending');`);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM matchmaking_session_members WHERE session_id='new' AND status='pending'")).rows[0].n,2);
      assert.equal((await db.query("SELECT host_player_id FROM matchmaking_sessions WHERE id='new'")).rows[0].host_player_id,null);
      await assert.rejects(db.exec("UPDATE matchmaking_sessions SET host_player_id='a' WHERE id='new'"),{code:"23514"});
      await assert.rejects(db.exec("UPDATE matchmaking_sessions SET source='other' WHERE id='new'"),{code:"23514"});
      await db.exec("UPDATE matchmaking_session_members SET status='withdrawn' WHERE session_id='new' AND player_id='a'");
      assert.equal((await db.query("SELECT count(*)::int AS n FROM matchmaking_session_members WHERE session_id='new'")).rows[0].n,3);
    });

    await t.test("avoid pairs are private, unique, directional records with valid foreign keys", async () => {
      await db.exec("INSERT INTO matchmaking_pair_preferences (player_id,other_player_id,preference) VALUES ('a','b','avoid')");
      await assert.rejects(db.exec("INSERT INTO matchmaking_pair_preferences (player_id,other_player_id,preference) VALUES ('a','a','avoid')"),{code:"23514"});
      await assert.rejects(db.exec("INSERT INTO matchmaking_pair_preferences (player_id,other_player_id,preference) VALUES ('a','c','like')"),{code:"23514"});
      await assert.rejects(db.exec("INSERT INTO matchmaking_pair_preferences (player_id,other_player_id,preference) VALUES ('a','b','avoid')"),{code:"23505"});
      await assert.rejects(db.exec("INSERT INTO matchmaking_pair_preferences (player_id,other_player_id,preference) VALUES ('a','missing','avoid')"),{code:"23503"});
      assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='matchmaking_pair_preferences'::regclass")).rows[0].relrowsecurity,true);
      for (const role of ["anon","authenticated"]) {
        for (const permission of ["SELECT","INSERT","UPDATE","DELETE"]) {
          assert.equal((await db.query("SELECT has_table_privilege($1,'matchmaking_pair_preferences',$2) AS allowed",[role,permission])).rows[0].allowed,false);
        }
        await db.exec(`SET ROLE ${role}`);
        try { await assert.rejects(db.query("SELECT * FROM matchmaking_pair_preferences"),{code:"42501"}); }
        finally { await db.exec("RESET ROLE"); }
      }
      // RLS still denies both roles if someone accidentally grants table access in the future.
      await db.exec("GRANT ALL ON matchmaking_pair_preferences TO anon, authenticated");
      for (const role of ["anon","authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        try {
          assert.deepEqual((await db.query("SELECT * FROM matchmaking_pair_preferences")).rows,[]);
          await assert.rejects(db.exec("INSERT INTO matchmaking_pair_preferences (player_id,other_player_id,preference) VALUES ('b','a','avoid')"),{code:"42501"});
          assert.equal((await db.query("UPDATE matchmaking_pair_preferences SET preference='avoid' RETURNING player_id")).rows.length,0);
          assert.equal((await db.query("DELETE FROM matchmaking_pair_preferences RETURNING player_id")).rows.length,0);
        } finally { await db.exec("RESET ROLE"); }
      }
    });
  } finally {
    await db.close();
  }
});
