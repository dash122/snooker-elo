import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard, buildPools } from "../lib/play/board.ts";
import { avoidSet } from "../lib/play/fit.ts";

const tz = "Asia/Hong_Kong";
const now = Date.parse("2026-10-04T08:00:00Z"); // 16:00 HK
const date = "2026-10-04";
const player = (id, rating, name = id) => [id, { id, name, rating }];
const players = new Map([player("me", 1500), player("amy", 1520), player("bob", 1550), player("cat", 1980), player("dee", 1510), player("eve", 1490)]);
const range = { minPlayers: 2, targetSize: 4, maxPlayers: 6 };
const intent = (id, playerId, over = {}) => ({
  id, playerId, kind: "wants", strength: "likely", startAt: "2026-10-04T10:00:00Z", endAt: "2026-10-04T14:00:00Z",
  minMinutes: 60, venueScope: "city", venueIds: [], city: "hong-kong", conditions: {}, note: null, quiet: false, status: "active", ...range, ...over,
});
const member = (playerId, status, over = {}) => ({ playerId, status, source: "joined", came: null, played: null, ...over });
const session = (id, members, over = {}) => ({
  id, createdBy: members[0]?.playerId ?? null, venueId: null, city: "hong-kong", startAt: "2026-10-04T11:00:00Z", endAt: "2026-10-04T13:00:00Z",
  tableStatus: "walkin", status: "forming", note: null, terms: {}, revision: 0, members, ...range, ...over,
});
const board = (extra = {}) => buildBoard({ viewerId: "me", city: "hong-kong", tz, date, now, players, venues: [], intents: [], sessions: [], avoids: avoidSet([]), ...extra });

test("people looking are listed by fit, only from the viewer's city, and only compatible ones", () => {
  const intents = [
    intent("1", "amy"), intent("2", "bob"),
    intent("3", "cat", { conditions: { level: { want: "similar", strictness: "must" } } }),
    intent("4", "dee", { city: "london" }),
    intent("5", "me", { kind: "open" }),
  ];
  const b = board({ intents });
  assert.deepEqual(b.looking.map((l) => l.player.id), ["amy", "bob"]);
  assert.ok(b.looking[0].score >= b.looking[1].score);
  assert.equal(b.mine.length, 1);
});

test("private avoids hide people and sessions in both directions without a trace", () => {
  const avoids = avoidSet([{ playerId: "amy", otherId: "me" }]);
  const intents = [intent("1", "amy"), intent("2", "bob")];
  const sessions = [session("s1", [member("amy", "in")]), session("s2", [member("bob", "in")])];
  const b = board({ intents, sessions, avoids });
  assert.deepEqual(b.looking.map((l) => l.player.id), ["bob"]);
  assert.deepEqual(b.sessions.map((s) => s.session.id), ["s2"]);
});

test("a quiet intent is never named but still counts in a pool", () => {
  const intents = [intent("1", "amy", { kind: "open" }), intent("2", "bob", { kind: "open", quiet: true }), intent("3", "dee", { kind: "open" })];
  const b = board({ intents });
  assert.ok(!b.looking.some((l) => l.player.id === "bob"));
  assert.equal(b.pools.length, 1);
  assert.equal(b.pools[0].count, 3);
  assert.equal(b.pools[0].hiddenCount, 1);
  assert.deepEqual(b.pools[0].named.map((p) => p.id).sort(), ["amy", "dee"]);
});

test("pools need three people with enough common time and mutual acceptability", () => {
  const a = intent("1", "amy"), b = intent("2", "bob"), d = intent("3", "dee", { startAt: "2026-10-04T13:30:00Z", endAt: "2026-10-04T15:00:00Z" });
  assert.equal(buildPools([a, b, d], players, avoidSet([]), "me").length, 0, "dee overlaps for only 30 minutes");
  const e = intent("4", "eve");
  assert.equal(buildPools([a, b, e], players, avoidSet([]), "me").length, 1);
  assert.equal(buildPools([a, b, e], players, avoidSet([{ playerId: "amy", otherId: "bob" }]), "me").length, 0);
});

test("open sessions are offered with a block reason when the viewer cannot take a seat", () => {
  const sessions = [
    session("free", [member("amy", "in")]),
    session("clash", [member("bob", "in")], { startAt: "2026-10-04T12:00:00Z", endAt: "2026-10-04T14:00:00Z" }),
    session("mine", [member("dee", "in"), member("me", "in")], { startAt: "2026-10-04T13:30:00Z", endAt: "2026-10-04T15:30:00Z", status: "playable" }),
  ];
  const b = board({ sessions });
  const byId = Object.fromEntries(b.sessions.map((s) => [s.session.id, s]));
  assert.equal(byId.free.block, null);
  assert.equal(byId.clash.block, "conflict");
  assert.equal(byId.mine.mine, "in");
});

test("a session whose terms the viewer cannot accept is not joinable", () => {
  const strict = { level: { want: "similar", strictness: "must" } };
  const sessions = [session("picky", [member("cat", "in")], { terms: strict })];
  const b = board({ sessions });
  assert.equal(b.sessions[0].block, "incompatible");
});

test("the queue is one pass in a fixed order: record, invite, upcoming, join, then 'I want to play'", () => {
  const sessions = [
    session("done", [member("me", "in"), member("amy", "in")], { startAt: "2026-10-04T05:00:00Z", endAt: "2026-10-04T07:00:00Z", status: "playable" }),
    session("asked", [member("bob", "in"), member("me", "invited")], { startAt: "2026-10-04T12:00:00Z", endAt: "2026-10-04T14:00:00Z" }),
    session("soon", [member("dee", "in"), member("me", "in")], { startAt: "2026-10-04T15:00:00Z", endAt: "2026-10-04T17:00:00Z", status: "playable" }),
    session("open", [member("eve", "in")], { startAt: "2026-10-04T10:00:00Z", endAt: "2026-10-04T12:00:00Z" }),
  ];
  const kinds = board({ sessions }).queue.map((q) => q.kind + (q.session ? `:${q.session.id}` : ""));
  assert.deepEqual(kinds, ["record:done", "invite:asked", "upcoming:soon", "join:open", "want"]);
  const withIntent = board({ sessions, intents: [intent("9", "me")] }).queue.map((q) => q.kind);
  assert.ok(!withIntent.includes("want"), "no prompt once the viewer has already said they want a game");
});

test("a played session that was already answered leaves the queue", () => {
  const answered = session("done", [member("me", "in", { played: true }), member("amy", "in")], { startAt: "2026-10-04T05:00:00Z", endAt: "2026-10-04T07:00:00Z", status: "playable" });
  assert.ok(!board({ sessions: [answered] }).queue.some((q) => q.kind === "record"));
});

test("wants carry why-chips and an overlap window; open intents respect shared venues", () => {
  const intents = [
    intent("1", "amy", { kind: "open", venueScope: "listed", venueIds: ["v1"] }),
    intent("2", "me", { kind: "open", venueScope: "listed", venueIds: ["v2"] }),
    intent("3", "bob", { kind: "wants" }),
  ];
  const b = board({ intents });
  assert.deepEqual(b.looking.map((l) => l.player.id), ["bob"], "amy is open at a venue the viewer does not use");
  assert.ok(b.looking[0].why.includes("similarLevel"));
  assert.ok(b.looking[0].overlap);
});
