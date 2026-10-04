import test from "node:test";
import assert from "node:assert/strict";
import { marketplace } from "../lib/play/marketplace.ts";

const now = Date.parse("2026-10-04T08:00:00Z");
const window = { startAt: "2026-10-04T10:00:00Z", endAt: "2026-10-04T14:00:00Z" };
const intent = (id, extra = {}) => ({ id, playerId: "me", city: "hong-kong", status: "active", kind: "open", quiet: false, venueScope: "city", venueIds: [], ...window, ...extra });
const session = (id, extra = {}) => ({ id, city: "hong-kong", status: "forming", ...window, ...extra });
const board = (extra = {}) => ({ city: "hong-kong", date: "2026-10-04", tz: "Asia/Hong_Kong", viewerRating: 1500, mine: [], sessions: [], looking: [], ...extra });

test("own availability appears beside other members without altering server-approved listings", () => {
  const other = { id: "other", player: { id: "amy" }, ...window };
  const data = board({ mine: [intent("mine"), intent("private", { quiet: true })], looking: [other] });
  const result = marketplace(data, "My name", now);
  assert.deepEqual(result.looking.map((i) => i.id), ["mine", "private", "other"]);
  assert.equal(result.looking[0].own, true);
  assert.equal(result.looking[0].player.name, "My name");
  assert.equal(result.looking[1].quiet, true);
  assert.equal(result.looking[2], other);
  assert.deepEqual(data.looking, [other], "private availability is never added to the server's public list");
});

test("own availability respects city, selected date, expiration and cancellation", () => {
  const data = board({ mine: [intent("today"), intent("wrong-city", { city: "london" }), intent("cancelled", { status: "cancelled" }), intent("expired", { endAt: "2026-10-04T07:00:00Z" }), intent("tomorrow", { startAt: "2026-10-05T10:00:00Z", endAt: "2026-10-05T14:00:00Z" })] });
  assert.deepEqual(marketplace(data, "Me", now).looking.map((i) => i.id), ["today"]);
});

test("sessions retain own and full listings but omit closed, expired and off-day arrangements", () => {
  const data = board({ sessions: [session("own", { createdBy: "me" }), session("full", { status: "full" }), session("cancelled", { status: "cancelled" }), session("played", { status: "played" }), session("expired", { endAt: "2026-10-04T07:00:00Z" }), session("tomorrow", { startAt: "2026-10-05T10:00:00Z", endAt: "2026-10-05T14:00:00Z" })] });
  assert.deepEqual(marketplace(data, "Me", now).sessions.map((s) => s.id), ["own", "full"]);
});

test("overnight listings appear on both overlapping local dates", () => {
  const data = board({ mine: [intent("overnight", { startAt: "2026-10-04T15:00:00Z", endAt: "2026-10-04T18:00:00Z" })] });
  assert.equal(marketplace(data, "Me", now).looking.length, 1);
  assert.equal(marketplace({ ...data, date: "2026-10-05" }, "Me", now).looking.length, 1);
});
