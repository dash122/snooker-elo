import test from "node:test";
import assert from "node:assert/strict";
import { PlayError, playWrite } from "../db/play-store.ts";
import { linkMatch, recordResult } from "../db/play-results.ts";
import { applyResult, buildFriendlyMatch, findSimilar, validateScores } from "../lib/play/match-record.ts";
import { at, fixture } from "./play-fixture.mjs";

const player = (id, name, rating) => ({
  id, name, short: name, handicap: null, rating, initialRating: rating, active: true,
  wins: 0, losses: 0, draws: 0, framesWon: 0, framesLost: 0, lastChange: 0, form: [],
});
const freshState = () => ({
  players: ["p1", "p2", "p3", "p4"].map((id, i) => player(id, `球員${i + 1}`, 1500 + i * 10)),
  matches: [],
  settings: { start: 1500, modelVersion: 15 },
  tournaments: [],
  audits: [],
});

/** An in-memory stand-in for the club state document, with the same optimistic version check. */
function gateway(pg, initial = freshState()) {
  const store = { doc: initial, version: 1, failWrites: 0, writes: 0 };
  /* putState writes state_matches; the link table references it, so mirror that here. */
  const mirror = async (doc) => {
    for (const m of doc.matches) await pg.query(`INSERT INTO state_matches(id,player_a,player_b,status) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [m.id, m.a, m.b, m.status]);
  };
  return {
    store, mirror,
    read: async () => ({ json: JSON.stringify(store.doc), version: String(store.version) }),
    write: async (json, version) => {
      if (store.failWrites > 0) { store.failWrites -= 1; store.version += 1; return false; }
      if (version !== String(store.version)) return false;
      store.doc = JSON.parse(json); await mirror(store.doc); store.version += 1; store.writes += 1; return true;
    },
  };
}

async function started(db, players = ["p2", "p3"]) {
  const { id } = await playWrite(db, "p1", "session.create", { venueId: "venue-scaa", startAt: at(-1), endAt: at(1) });
  for (const p of players) await playWrite(db, p, "session.respond", { id, response: "in" });
  return id;
}
const rating = (g, id) => g.store.doc.players.find((p) => p.id === id).rating;

test("a result updates both ratings immediately and links to the session without any confirmation", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db);
  const out = await recordResult(db, g, "p2", { sessionId, a: "p1", b: "p2", scoreA: 1, scoreB: 3 });
  assert.equal(out.status, "recorded");
  assert.equal(out.linked, true);
  assert.ok(out.after.p2 > out.before.p2, "the winner gains");
  assert.ok(out.after.p1 < out.before.p1, "the loser drops");
  assert.equal(rating(g, "p2"), out.after.p2);

  const match = g.store.doc.matches[0];
  assert.deepEqual([match.a, match.b, match.scoreA, match.scoreB, match.status, match.mode], ["p1", "p2", 1, 3, "confirmed", "1v1"]);
  assert.match(g.store.doc.audits[0].text, /1–3/);

  const link = (await pg.query(`SELECT session_id,recorded_by FROM play_session_results WHERE match_id=$1`, [out.matchId])).rows[0];
  assert.deepEqual([link.session_id, link.recorded_by], [sessionId, "p2"]);
  const members = (await pg.query(`SELECT player_id,played FROM play_session_members WHERE session_id=$1 ORDER BY player_id`, [sessionId])).rows;
  assert.deepEqual(members.map((m) => [m.player_id, m.played]), [["p1", true], ["p2", true], ["p3", null]], "both players count as having played; p3 has not answered");
  assert.equal((await pg.query(`SELECT status FROM play_sessions WHERE id=$1`, [sessionId])).rows[0].status, "played");
});

test("any accepted member may record a game between two accepted players (rotation)", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db, ["p2", "p3"]);
  const out = await recordResult(db, g, "p3", { sessionId, a: "p1", b: "p2", scoreA: 2, scoreB: 1 });
  assert.equal(out.status, "recorded");
  const second = await recordResult(db, g, "p3", { sessionId, a: "p2", b: "p3", scoreA: 0, scoreB: 2 });
  assert.equal(second.status, "recorded");
  assert.equal(g.store.doc.matches.length, 2);
});

test("only people in the session can record, between people in the session, once it has started", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db);
  const reject = (actor, input, status) => assert.rejects(recordResult(db, g, actor, { sessionId, scoreA: 1, scoreB: 0, ...input }), (e) => e instanceof PlayError && (status == null || e.status === status));
  await reject("p4", { a: "p1", b: "p2" }, 403);
  await reject("p1", { a: "p1", b: "p4" }, 400);
  await reject("p1", { a: "p1", b: "p1" }, 400);
  await reject("p1", { a: "p1", b: "p2", scoreA: 0, scoreB: 0 }, 400);
  await reject("p1", { a: "p1", b: "p2", scoreA: -1, scoreB: 2 }, 400);
  const future = (await playWrite(db, "p1", "session.create", { venueId: "venue-scaa", startAt: at(4), endAt: at(6) })).id;
  await playWrite(db, "p2", "session.respond", { id: future, response: "in" });
  await assert.rejects(recordResult(db, g, "p1", { sessionId: future, a: "p1", b: "p2", scoreA: 1, scoreB: 0 }), /尚未開始/);
  assert.equal(g.store.writes, 0, "nothing was written by any rejected attempt");
});

test("a similar recent result is never merged: the person is asked, and 'another game' records both", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db);
  const first = await recordResult(db, g, "p1", { sessionId, a: "p1", b: "p2", scoreA: 3, scoreB: 1 });
  assert.equal(first.status, "recorded");

  const asked = await recordResult(db, g, "p2", { sessionId, a: "p2", b: "p1", scoreA: 1, scoreB: 3 });
  assert.equal(asked.status, "similar");
  assert.equal(asked.similar.id, first.matchId);
  assert.equal(g.store.doc.matches.length, 1, "asking wrote nothing");

  const another = await recordResult(db, g, "p2", { sessionId, a: "p2", b: "p1", scoreA: 1, scoreB: 3, another: true });
  assert.equal(another.status, "recorded");
  assert.equal(g.store.doc.matches.length, 2, "they really did play twice");

  const different = await recordResult(db, g, "p2", { sessionId, a: "p1", b: "p2", scoreA: 3, scoreB: 2 });
  assert.equal(different.status, "recorded", "a different score is not similar");
});

test("a concurrent write to the club state is retried, and gives up cleanly after three tries", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db);
  g.store.failWrites = 2;
  const out = await recordResult(db, g, "p1", { sessionId, a: "p1", b: "p2", scoreA: 2, scoreB: 0 });
  assert.equal(out.status, "recorded");
  assert.equal(g.store.doc.matches.length, 1, "retried writes never duplicate the match");

  g.store.failWrites = 3;
  await assert.rejects(recordResult(db, g, "p1", { sessionId, a: "p1", b: "p3", scoreA: 2, scoreB: 0 }), (e) => e instanceof PlayError && e.status === 409);
  assert.equal(g.store.doc.matches.length, 1);
});

test("a handicap is stored as a signed number of points from the giver's side", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db);
  await recordResult(db, g, "p1", { sessionId, a: "p1", b: "p2", scoreA: 3, scoreB: 2, giver: "p1", points: 21 });
  assert.equal(g.store.doc.matches[0].actual, 21);
  assert.equal(g.store.doc.matches[0].giver, "p1");
  await recordResult(db, g, "p1", { sessionId, a: "p1", b: "p2", scoreA: 0, scoreB: 3, giver: "p2", points: 14 });
  assert.equal(g.store.doc.matches[0].actual, -14);
  await recordResult(db, g, "p1", { sessionId, a: "p1", b: "p3", scoreA: 1, scoreB: 3, giver: "someone-else", points: 9 });
  assert.equal(g.store.doc.matches[0].actual, 0, "an unknown giver means a level game");
});

test("the result stands even if linking it to the session fails, and can be linked later", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db);
  const original = console.error; console.error = () => {};
  await pg.exec(`ALTER TABLE play_session_results RENAME TO play_session_results_off`);
  const out = await recordResult(db, g, "p1", { sessionId, a: "p1", b: "p2", scoreA: 2, scoreB: 1 });
  console.error = original;
  assert.equal(out.status, "recorded");
  assert.equal(out.linked, false);
  assert.equal(g.store.doc.matches.length, 1);
  await pg.exec(`ALTER TABLE play_session_results_off RENAME TO play_session_results`);
  await linkMatch(db, g, "p1", { sessionId, matchId: out.matchId });
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM play_session_results WHERE match_id=$1`, [out.matchId])).rows[0].n, 1);
});

test("a match entered through the ordinary form can be attached to its session", async () => {
  const { db, pg } = await fixture();
  const g = gateway(pg);
  const sessionId = await started(db);
  const manual = { id: "manual-1", a: "p1", b: "p2", scoreA: 2, scoreB: 1, status: "confirmed", mode: "1v1", playedOn: "2026-10-04", createdAt: new Date().toISOString() };
  g.store.doc.matches.push(manual);
  await g.mirror(g.store.doc);
  const link = { sessionId, matchId: "manual-1" };
  await linkMatch(db, g, "p1", link);
  await linkMatch(db, g, "p1", link);
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM play_session_results`)).rows[0].n, 1, "linking twice is harmless");
  g.store.doc.matches.push({ ...manual, id: "outsider", a: "p1", b: "p4" });
  await g.mirror(g.store.doc);
  await assert.rejects(linkMatch(db, g, "p1", { sessionId, matchId: "outsider" }), PlayError);
  await assert.rejects(linkMatch(db, g, "p1", { sessionId, matchId: "missing" }), (e) => e.status === 404);
});

test("match building: signed handicap, scores validated, and the replay moves ratings opposite ways", () => {
  const state = freshState();
  assert.throws(() => validateScores(0, 0));
  assert.throws(() => validateScores(1.5, 2));
  assert.throws(() => validateScores(100, 1));
  const match = buildFriendlyMatch(state, { matchId: "m", a: "p1", b: "p2", scoreA: 3, scoreB: 0, playedOn: "2026-10-04", now: "2026-10-04T10:00:00.000Z" });
  assert.equal(match.status, "confirmed");
  const { next, before, after } = applyResult(state, match, "x", "2026-10-04T10:00:00.000Z");
  assert.ok(after.p1 > before.p1 && after.p2 < before.p2);
  assert.equal(next.matches.length, 1);
  assert.equal(next.audits.length, 1);
  assert.equal(findSimilar(next, { a: "p2", b: "p1", scoreA: 0, scoreB: 3, playedOn: "2026-10-04", now: "2026-10-04T12:00:00.000Z" })?.id, "m");
  assert.equal(findSimilar(next, { a: "p2", b: "p1", scoreA: 0, scoreB: 3, playedOn: "2026-10-04", now: "2026-10-05T12:00:00.000Z" }), null, "older than twelve hours is not similar");
});
