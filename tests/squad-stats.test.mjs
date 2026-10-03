import test from "node:test";
import assert from "node:assert/strict";
import { squadStats } from "../lib/squad-stats.ts";

const now = Date.parse("2026-10-01T12:00:00Z");
const m = (a, b, scoreA, scoreB, playedOn, extra = {}) => ({ a, b, scoreA, scoreB, playedOn, status: "confirmed", createdAt: `${playedOn}T00:00:00Z`, ...extra });

test("only confirmed singles between two squad members count", () => {
  const stats = squadStats([
    m("x", "y", 3, 1, "2026-09-30"),
    m("x", "z", 3, 0, "2026-09-30"), // z is outside the squad
    m("x", "y", 3, 2, "2026-09-30", { status: "pending" }),
    m("x", "y", 3, 2, "2026-09-30", { mode: "2v2" }),
  ], ["x", "y"], "all", now);
  assert.equal(stats.matches, 1);
  assert.equal(stats.frames, 4);
  assert.equal(stats.pairsPossible, 1);
});

test("30-day window excludes older matches while 'all' keeps them", () => {
  const list = [m("x", "y", 3, 1, "2026-09-25"), m("x", "y", 2, 3, "2026-06-01")];
  assert.equal(squadStats(list, ["x", "y"], "30d", now).matches, 1);
  assert.equal(squadStats(list, ["x", "y"], "all", now).matches, 2);
});

test("per-member lines, top pair, draws, close matches and best break", () => {
  const stats = squadStats([
    m("x", "y", 3, 3, "2026-09-30"),
    m("y", "x", 4, 1, "2026-09-29", { highBreaks: [{ playerId: "y", value: 62 }, { playerId: "ghost", value: 140 }] }),
    m("x", "z", 3, 0, "2026-09-28"),
  ], ["x", "y", "z"], "all", now);
  assert.equal(stats.draws, 1);
  assert.equal(stats.closeMatches, 1);
  assert.deepEqual(stats.topBreak, { playerId: "y", value: 62, date: "2026-09-29" });
  assert.deepEqual(stats.topPair, { a: "x", b: "y", matches: 2, winsA: 0, winsB: 1, draws: 1 });
  assert.equal(stats.pairsMet, 2);
  assert.equal(stats.pairsPossible, 3);
  assert.equal(stats.members[0].id, "x");
  assert.equal(stats.members[0].matches, 3);
  assert.equal(stats.members[0].wins, 1);
});

test("weekly buckets run oldest to newest ending this week", () => {
  const stats = squadStats([m("x", "y", 1, 0, "2026-10-01"), m("x", "y", 1, 0, "2026-09-10")], ["x", "y"], "all", now, 4);
  assert.deepEqual(stats.weekly, [1, 0, 0, 1]);
});

test("squadRecords counts win / draw / loss only against other squad members", async () => {
  const { squadRecords } = await import("../lib/squad-rivalry.ts");
  const records = squadRecords([
    m("x", "y", 3, 1, "2026-09-30"),
    m("x", "y", 2, 2, "2026-09-30"),
    m("y", "x", 3, 0, "2026-09-30"),
    m("x", "z", 3, 0, "2026-09-30"), // z is outside the squad
    m("x", "y", 3, 0, "2026-09-30", { status: "pending" }),
    m("x", "y", 3, 0, "2026-09-30", { mode: "2v2" }),
  ], ["x", "y"]);
  assert.deepEqual(records.get("x"), { wins: 1, losses: 1, draws: 1 });
  assert.deepEqual(records.get("y"), { wins: 1, losses: 1, draws: 1 });
  assert.equal(records.has("z"), false);
});
