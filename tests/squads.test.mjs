import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  INVITE_CODE_LENGTH, hostsWithout, isRole, isVisibility, leaveOutcome, newInviteCode, normaliseInviteCode, normaliseSquadName,
} from "../lib/squads.ts";

test("squad names are trimmed, collapsed and bounded", () => {
  assert.equal(normaliseSquadName("  星期二   波友  "), "星期二 波友");
  assert.equal(normaliseSquadName("   "), null);
  assert.equal(normaliseSquadName(42), null);
  assert.equal(normaliseSquadName("球".repeat(40)), "球".repeat(40));
  assert.equal(normaliseSquadName("球".repeat(41)), null);
});

test("visibility and role guards accept only known values", () => {
  assert.ok(isVisibility("public") && isVisibility("private"));
  assert.ok(!isVisibility("secret"));
  assert.ok(isRole("host") && isRole("member"));
  assert.ok(!isRole("admin"));
});

test("invite codes are fixed-length, unambiguous and round-trip through normalisation", () => {
  const code = newInviteCode();
  assert.equal(code.length, INVITE_CODE_LENGTH);
  assert.doesNotMatch(code, /[01ILO]/);
  assert.equal(normaliseInviteCode(` ${code.toLowerCase()} `), code);
  assert.equal(normaliseInviteCode("short"), null);
  assert.equal(normaliseInviteCode("O".repeat(INVITE_CODE_LENGTH)), null);
  assert.notEqual(newInviteCode(), newInviteCode());
});

test("a squad always keeps a host", () => {
  const members = [{ playerId: "a", role: "host" }, { playerId: "b", role: "host" }, { playerId: "c", role: "member" }];
  assert.equal(hostsWithout(members, "a"), 1);
  assert.equal(hostsWithout(members, "c"), 2);
  assert.equal(leaveOutcome(members, "a"), "leave", "another host remains");
  assert.equal(leaveOutcome(members, "c"), "leave");
  const soleHost = [{ playerId: "a", role: "host" }, { playerId: "c", role: "member" }];
  assert.equal(leaveOutcome(soleHost, "a"), "last-host", "the only host can't strand the others");
  assert.equal(leaveOutcome(soleHost, "c"), "leave");
  assert.equal(leaveOutcome([{ playerId: "a", role: "host" }], "a"), "dissolve", "the last member leaving closes the squad");
});

test("squads migration enforces its storage contract", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE state_players (id text PRIMARY KEY);
      INSERT INTO state_players VALUES ('a'),('b');`);
    await db.exec(readFileSync(new URL("../supabase/migrations/20260930000000_squads.sql", import.meta.url), "utf8"));
    await db.exec(`INSERT INTO squads (id,name,invite_code,created_by) VALUES ('s','Tuesday','ABCDEFGHJK','a');
      INSERT INTO squad_members (squad_id,player_id,role) VALUES ('s','a','host'),('s','b','member');`);
    const row = (await db.query("SELECT visibility FROM squads WHERE id='s'")).rows[0];
    assert.equal(row.visibility, "private", "squads default to private");
    await assert.rejects(db.exec("INSERT INTO squads (id,name,invite_code) VALUES ('x','','ZZZZZZZZZZ')"), "empty names are refused");
    await assert.rejects(db.exec("INSERT INTO squads (id,name,visibility,invite_code) VALUES ('x','n','hidden','ZZZZZZZZZZ')"));
    await assert.rejects(db.exec("INSERT INTO squads (id,name,invite_code) VALUES ('x','n','ABCDEFGHJK')"), "invite codes are unique");
    await assert.rejects(db.exec("INSERT INTO squad_members (squad_id,player_id,role) VALUES ('s','a','member')"), "one membership per player");
    await assert.rejects(db.exec("UPDATE squad_members SET role='owner' WHERE player_id='b'"));
    await db.exec("INSERT INTO squad_exits (squad_id,player_id) VALUES ('s','b')");
    await db.exec("DELETE FROM squads WHERE id='s'");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM squad_members")).rows[0].n, 0, "deleting a squad removes memberships");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM squad_exits")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM state_players")).rows[0].n, 2, "and never touches players");
    const policies = (await db.query("SELECT tablename FROM pg_policies WHERE policyname='deny_data_api_clients' ORDER BY 1")).rows.map(r => r.tablename);
    assert.deepEqual(policies, ["squad_exits", "squad_members", "squads"]);
  } finally { await db.close(); }
});

import { SQUAD_INACTIVE_DAYS, daysSinceLastMatch, headToHead, isInactive, ratingSwing } from "../lib/squad-rivalry.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const m = (a, b, scoreA, scoreB, deltaA, playedOn, extra = {}) => ({ a, b, scoreA, scoreB, deltaA, playedOn, createdAt: `${playedOn}T10:00:00Z`, status: "confirmed", ...extra });
const matches = [
  m("me", "ken", 3, 1, 12, "2026-09-25"),
  m("ken", "me", 2, 1, 8, "2026-09-10"),
  m("me", "ken", 2, 2, 0, "2026-08-01"),
  m("me", "ken", 3, 0, 20, "2026-09-20", { status: "pending" }),
  m("me", "ken", 1, 0, 5, "2026-09-21", { mode: "2v2", a2: "x", b2: "y" }),
  m("me", "amy", 0, 3, -15, "2026-06-01"),
];

test("head-to-head counts confirmed singles from both sides and ignores doubles and pending", () => {
  assert.deepEqual(headToHead(matches, "me", "ken"), { wins: 1, losses: 1, draws: 1 });
  assert.deepEqual(headToHead(matches, "ken", "me"), { wins: 1, losses: 1, draws: 1 });
  assert.deepEqual(headToHead(matches, "me", "nobody"), { wins: 0, losses: 0, draws: 0 });
});

test("30-day swing sums rating movement inside the window only", () => {
  assert.equal(ratingSwing(matches, "me", 30, NOW), 12 - 8);
  assert.equal(ratingSwing(matches, "ken", 30, NOW), -12 + 8);
  assert.equal(ratingSwing(matches, "amy", 30, NOW), 0);
});

test("idle days mark squad-mates who stopped playing", () => {
  assert.equal(daysSinceLastMatch(matches, "me", NOW), 5);
  assert.equal(daysSinceLastMatch(matches, "amy", NOW), 121);
  assert.equal(daysSinceLastMatch(matches, "nobody", NOW), null);
  assert.ok(!isInactive(5));
  assert.ok(isInactive(SQUAD_INACTIVE_DAYS));
  assert.ok(isInactive(null), "never played reads as inactive");
});
