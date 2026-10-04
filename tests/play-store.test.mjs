import test from "node:test";
import assert from "node:assert/strict";
import { PlayError, playDashboard, playReady, playWrite, readSnapshot, venueAdmin } from "../db/play-store.ts";
import { GROUP_PRESETS } from "../lib/play/types.ts";
import { at, fixture } from "./play-fixture.mjs";

const hk = "venue-scaa";
const session = (extra = {}) => ({ venueId: hk, startAt: at(3), endAt: at(5), range: GROUP_PRESETS.open, ...extra });
const write = (db, actor, action, input) => playWrite(db, actor, action, input);
const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof PlayError && (status == null || e.status === status));
const board = (db, viewer, extra = {}) => playDashboard(db, viewer, viewer != null, { city: "hong-kong", ...extra });

test("board snapshot uses one database round trip and decodes empty collections", async () => {
  const { db } = await fixture();
  let reads = 0;
  const snapshot = await readSnapshot({ query: (...args) => { reads++; return db.query(...args); } }, Date.parse(at(0)));
  assert.equal(reads, 1);
  assert.ok(snapshot.players.size > 0);
  assert.ok(snapshot.venues.length > 0);
  assert.deepEqual(snapshot.intents, []);
  assert.deepEqual(snapshot.sessions, []);
  assert.deepEqual(snapshot.avoids, []);
});

test("readiness is false until the migration is applied", async () => {
  const before = await fixture({ play: false });
  assert.equal(await playReady(before.db), false);
  const after = await fixture();
  assert.equal(await playReady(after.db), true);
});

test("a session is created, invited players see it, and only explicit acceptance counts", async () => {
  const { db } = await fixture();
  const { id } = await write(db, "p1", "session.create", session({ invitees: ["p2", "p3"], note: "winner stays" }));
  let b = await board(db, "p2");
  assert.equal(b.queue[0].kind, "invite");
  assert.equal(b.queue[0].session.id, id);
  assert.equal(b.sessions[0].status, "forming");
  assert.equal(b.sessions[0].members.length, 1, "invited people are not members until they accept");

  await write(db, "p2", "session.respond", { id, response: "maybe" });
  b = await board(db, "p1");
  assert.equal(b.sessions[0].status, "forming", "a maybe does not make it playable");
  assert.deepEqual(b.sessions[0].members.map((m) => m.confidence).sort(), ["in", "maybe"]);

  await write(db, "p2", "session.respond", { id, response: "in" });
  b = await board(db, "p1");
  assert.equal(b.sessions[0].status, "playable");
  assert.equal(b.sessions[0].invitees.map((p) => p.id).join(), "p3", "the creator sees who is still pending");
  assert.equal((await board(db, "p4")).sessions[0].invitees.length, 0, "nobody else sees pending invitees");
});

test("a booked table marks the creator as locked", async () => {
  const { db } = await fixture();
  await write(db, "p1", "session.create", session({ tableStatus: "booked" }));
  const card = (await board(db, "p2")).sessions[0];
  assert.equal(card.tableStatus, "booked");
  assert.equal(card.members[0].confidence, "locked");
});

test("leaving below the minimum reopens recruitment, and an empty session closes", async () => {
  const { db } = await fixture();
  const { id } = await write(db, "p1", "session.create", session());
  await write(db, "p2", "session.respond", { id, response: "in" });
  assert.equal((await board(db, "p1")).sessions[0].status, "playable");
  await write(db, "p2", "session.leave", { id });
  assert.equal((await board(db, "p1")).sessions[0].status, "forming");
  await write(db, "p1", "session.leave", { id });
  assert.equal((await board(db, "p2")).sessions.length, 0, "no one left in it, so it is cancelled and hidden");
});

test("capacity: the last seat goes to one person; the other is told it is full", async () => {
  const { db } = await fixture();
  const { id } = await write(db, "p1", "session.create", session({ range: GROUP_PRESETS.singles }));
  const results = await Promise.allSettled([write(db, "p2", "session.respond", { id, response: "in" }), write(db, "p3", "session.respond", { id, response: "in" })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected");
  assert.ok(lost.reason instanceof PlayError);
  assert.equal(lost.reason.status, 409);
  assert.equal((await board(db, "p1")).sessions[0].status, "full");
});

test("a player cannot be 'in' two overlapping sessions, but may say maybe to the second", async () => {
  const { db } = await fixture();
  const first = await write(db, "p1", "session.create", session());
  const other = await write(db, "p2", "session.create", session({ startAt: at(4), endAt: at(6) }));
  await write(db, "p3", "session.respond", { id: first.id, response: "in" });
  await rejects(write(db, "p3", "session.respond", { id: other.id, response: "in" }), 409);
  await write(db, "p3", "session.respond", { id: other.id, response: "maybe" });
  await rejects(write(db, "p1", "session.create", session({ startAt: at(4), endAt: at(6) })), 409);
});

test("the database itself refuses a double booking even if the application check were bypassed", async () => {
  const { pg, db } = await fixture();
  const first = await write(db, "p1", "session.create", session());
  const other = await write(db, "p2", "session.create", session({ startAt: at(4), endAt: at(6) }));
  await write(db, "p3", "session.respond", { id: first.id, response: "in" });
  await assert.rejects(pg.exec(`INSERT INTO play_session_members(session_id,player_id,status) VALUES ('${other.id}','p3','in')`), /another session/);
  await assert.rejects(
    pg.exec(`INSERT INTO play_session_members(session_id,player_id,status) VALUES ('${first.id}','p4','in'),('${first.id}','p5','in'),('${first.id}','p6','in'),('${first.id}','p7','in'),('${first.id}','p8','in')`),
    /full/);
});

test("avoids are private: invites skip silently and the avoided person's board hides the session", async () => {
  const { db } = await fixture();
  await write(db, "p2", "avoid.add", { playerId: "p1" });
  const { id, events } = await write(db, "p1", "session.create", session({ invitees: ["p2", "p3"] }));
  assert.equal(events[0].props.invited, 1, "only p3 was actually invited, and p1 is not told why");
  assert.equal((await board(db, "p2")).queue.some((q) => q.kind === "invite"), false);
  assert.equal((await board(db, "p2")).sessions.length, 0);
  assert.equal((await board(db, "p3")).sessions[0].id, id);
  await rejects(write(db, "p2", "session.respond", { id, response: "in" }), 400);
  await write(db, "p2", "avoid.remove", { playerId: "p1" });
  assert.equal((await board(db, "p2")).sessions.length, 1);
});

test("requirements are enforced as mutual acceptability when joining", async () => {
  const { db } = await fixture();
  const strict = { level: { want: "similar", strictness: "must", maxGap: 25 } };
  const { id } = await write(db, "p1", "session.create", session({ terms: strict }));
  await write(db, "p2", "session.respond", { id, response: "in" });
  await rejects(write(db, "p8", "session.respond", { id, response: "in" }), 400);
});

test("a window is validated: past, backwards, too long, too far ahead", async () => {
  const { db } = await fixture();
  await rejects(write(db, "p1", "session.create", session({ startAt: at(-3), endAt: at(-1) })), 400);
  await rejects(write(db, "p1", "session.create", session({ startAt: at(5), endAt: at(3) })), 400);
  await rejects(write(db, "p1", "session.create", session({ startAt: at(1), endAt: at(30) })), 400);
  await rejects(write(db, "p1", "session.create", session({ startAt: at(24 * 40), endAt: at(24 * 40 + 2) })), 400);
  await rejects(write(db, "p1", "session.create", session({ range: { minPlayers: 5, targetSize: 3, maxPlayers: 6 } })), 400);
});

test("unlinked or inactive members cannot write", async () => {
  const { db, pg } = await fixture();
  await pg.exec(`INSERT INTO state_players(id,name,rating) VALUES ('ghost','無帳戶',1500)`);
  await rejects(write(db, "ghost", "session.create", session()), 403);
  await pg.exec(`UPDATE members SET active=false WHERE state_player_id='p5'`);
  await rejects(write(db, "p5", "session.create", session()), 403);
});

test("'Played' needs two accepted players, has started, and stores who came privately", async () => {
  const { db, pg } = await fixture();
  const { id } = await write(db, "p1", "session.create", session({ startAt: at(-1), endAt: at(1) }));
  await rejects(write(db, "p1", "session.played", { id, played: true }), 400);
  await write(db, "p2", "session.respond", { id, response: "in" });
  await write(db, "p3", "session.respond", { id, response: "in" });
  await write(db, "p1", "session.played", { id, played: true, came: ["p1", "p2"] });
  const rows = (await pg.query(`SELECT player_id,came,played FROM play_session_members WHERE session_id=$1 ORDER BY player_id`, [id])).rows;
  assert.deepEqual(rows.map((r) => [r.player_id, r.came, r.played]), [["p1", true, true], ["p2", true, null], ["p3", false, null]]);
  assert.equal((await pg.query(`SELECT status FROM play_sessions WHERE id=$1`, [id])).rows[0].status, "played");
  const text = JSON.stringify(await board(db, "p2"));
  assert.ok(!text.includes('"came"'), "the private attendance list never reaches the client");

  const future = await write(db, "p4", "session.create", session());
  await write(db, "p5", "session.respond", { id: future.id, response: "in" });
  await rejects(write(db, "p4", "session.played", { id: future.id, played: true }), 400);
});

test("a queued 'record' item appears after a session ends until the player answers", async () => {
  const { db } = await fixture();
  const { id } = await write(db, "p1", "session.create", session({ startAt: at(-0.5), endAt: at(0.5) }));
  await write(db, "p2", "session.respond", { id, response: "in" });
  const later = Date.now() + 2 * 3_600_000;
  const queue = (await playDashboard(db, "p2", true, { city: "hong-kong" }, later)).queue;
  assert.equal(queue[0].kind, "record");
  await playWrite(db, "p2", "session.played", { id, played: false }, later);
  assert.equal((await playDashboard(db, "p2", true, { city: "hong-kong" }, later)).queue.some((q) => q.kind === "record"), false);
});

test("intents: wants are visible to the city, quiet ones are not named, and guests see counts only", async () => {
  const { db } = await fixture();
  await write(db, "p2", "intent.post", { kind: "wants", startAt: at(2), endAt: at(5), city: "hong-kong", note: "after work" });
  await write(db, "p3", "intent.post", { kind: "open", strength: "could", startAt: at(2), endAt: at(5), city: "hong-kong", quiet: true });
  await write(db, "p1", "intent.post", { kind: "wants", startAt: at(2), endAt: at(5), city: "hong-kong" });
  const b = await board(db, "p1");
  assert.deepEqual(b.looking.map((l) => l.player.id), ["p2"], "p3 is quiet, p1 is the viewer");
  assert.equal(b.looking[0].note, "after work");
  assert.equal(b.dates[0].wants + b.dates[1].wants + b.dates[2].wants >= 2, true);

  const guest = await board(db, null);
  assert.equal(guest.signedIn, false);
  assert.deepEqual([guest.queue, guest.sessions, guest.looking, guest.pools, guest.mine], [[], [], [], [], []]);
  assert.ok(guest.dates.some((d) => d.wants > 0), "guests still see that people are looking");
  assert.ok(!JSON.stringify(guest).includes("球員"), "and never a name");
});

test("other people's requirements and private fields never reach the dashboard", async () => {
  const { db } = await fixture();
  await write(db, "p2", "intent.post", { kind: "wants", startAt: at(2), endAt: at(5), city: "hong-kong", conditions: { smoking: { want: "no", strictness: "must" }, level: { want: "similar", strictness: "prefer" } } });
  await write(db, "p3", "avoid.add", { playerId: "p2" });
  const text = JSON.stringify(await board(db, "p1"));
  assert.ok(!text.includes("strictness"), "someone else's requirements are not exposed");
  assert.ok(!text.includes("quiet"));
  assert.ok(!text.includes("avoid"));
  const mine = await write(db, "p1", "intent.post", { kind: "wants", startAt: at(2), endAt: at(5), city: "hong-kong", conditions: { vibe: { want: "relaxed", strictness: "prefer" } } });
  assert.equal((await board(db, "p1")).mine.find((i) => i.id === mine.id).conditions.vibe.want, "relaxed", "but your own requirements come back");
});

test("intents can be cancelled only by their owner, and a player is capped at five", async () => {
  const { db } = await fixture();
  const { id } = await write(db, "p1", "intent.post", { kind: "wants", startAt: at(2), endAt: at(5), city: "hong-kong" });
  await rejects(write(db, "p2", "intent.cancel", { id }), 404);
  await write(db, "p1", "intent.cancel", { id });
  for (let i = 0; i < 5; i += 1) await write(db, "p1", "intent.post", { kind: "open", startAt: at(2 + i), endAt: at(3 + i), city: "hong-kong" });
  await rejects(write(db, "p1", "intent.post", { kind: "open", startAt: at(2), endAt: at(3), city: "hong-kong" }), 400);
});

test("intents tied to a venue take the venue's city", async () => {
  const { db } = await fixture();
  const { id } = await write(db, "p1", "intent.post", { kind: "open", startAt: at(2), endAt: at(5), venueIds: [hk] });
  assert.equal((await board(db, "p1")).mine[0].city, "hong-kong");
  assert.equal((await board(db, "p1")).mine[0].venueScope, "listed");
  assert.ok(id);
});

test("venues: a pin sets the city, near-duplicates are suggested first, and admins can approve or merge", async () => {
  const { db, pg } = await fixture();
  await pg.exec(`UPDATE venues SET city='hong-kong',tz='Asia/Hong_Kong',lat=22.2785,lng=114.1735 WHERE id='venue-scaa'`);
  const first = await write(db, "p1", "venue.create", { name: "SCAA 灣仔", lat: 22.2786, lng: 114.1736 });
  assert.equal(first.id, undefined);
  assert.equal(first.duplicates[0].id, "venue-scaa");

  const created = await write(db, "p1", "venue.create", { name: "Kowloon Cue Club", lat: 22.32, lng: 114.17 });
  const row = (await pg.query(`SELECT city,tz,status,created_by FROM venues WHERE id=$1`, [created.id])).rows[0];
  assert.deepEqual([row.city, row.tz, row.status, row.created_by], ["hong-kong", "Asia/Hong_Kong", "unverified", "p1"]);

  const london = await write(db, "p1", "venue.create", { name: "Soho Snooker", lat: 51.5136, lng: -0.1365 });
  assert.equal((await pg.query(`SELECT city,tz FROM venues WHERE id=$1`, [london.id])).rows[0].city, "london");
  await rejects(write(db, "p1", "venue.create", { name: "Nowhere", lat: 200, lng: 0 }), 400);
  await rejects(write(db, "p1", "venue.create", { name: "", lat: 1, lng: 1 }), 400);

  const dupe = await write(db, "p2", "venue.create", { name: "Kowloon Cue Club (copy)", lat: 22.3201, lng: 114.1701, confirmNew: true });
  const intent = await write(db, "p2", "intent.post", { kind: "open", startAt: at(2), endAt: at(4), venueIds: [dupe.id] });
  const sess = await write(db, "p2", "session.create", session({ venueId: dupe.id }));
  await venueAdmin(db, "merge", { id: dupe.id, into: created.id });
  assert.equal((await pg.query(`SELECT venue_id FROM play_sessions WHERE id=$1`, [sess.id])).rows[0].venue_id, created.id);
  assert.deepEqual(JSON.parse((await pg.query(`SELECT venue_ids::text AS v FROM play_intents WHERE id=$1`, [intent.id])).rows[0].v), [created.id]);
  assert.equal((await pg.query(`SELECT active FROM venues WHERE id=$1`, [dupe.id])).rows[0].active, false);

  await venueAdmin(db, "approve", { id: created.id });
  assert.equal((await pg.query(`SELECT status FROM venues WHERE id=$1`, [created.id])).rows[0].status, "verified");
  await venueAdmin(db, "reject", { id: london.id });
  assert.equal((await board(db, "p1", { city: "london" })).venues.length, 0, "a rejected venue is not offered");
  await assert.rejects(venueAdmin(db, "approve", { id: "nope" }), PlayError);
});

test("London sessions carry their own zone and day", async () => {
  const { db, pg } = await fixture();
  await pg.exec(`INSERT INTO venues(id,name,city,tz,lat,lng) VALUES ('venue-ldn','Soho','london','Europe/London',51.51,-0.13)`);
  await write(db, "p1", "session.create", session({ venueId: "venue-ldn" }));
  const hkBoard = await board(db, "p2");
  const ldnBoard = await board(db, "p2", { city: "london" });
  assert.equal(hkBoard.sessions.length, 0, "a London session is not on the Hong Kong board");
  assert.equal(ldnBoard.sessions.length, 1);
  assert.equal(ldnBoard.tz, "Europe/London");
});
