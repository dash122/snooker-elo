import test from "node:test";
import assert from "node:assert/strict";
import { addDays, dayRange, zonedClock, zonedDate, zonedInstant, zoneOffsetMinutes } from "../lib/play/time.ts";
import { composeWindow, intersect, intersectAll, isNarrow, isUrgent, minutesBetween, presetWindow, proposeWindow, requiredMinutes } from "../lib/play/window.ts";

test("zonedInstant converts wall-clock time in Hong Kong and London, including daylight saving", () => {
  assert.equal(zonedInstant("2026-10-04", "19:30", "Asia/Hong_Kong"), "2026-10-04T11:30:00.000Z");
  // London is on BST (UTC+1) in early October, GMT after the clocks go back on 25 October.
  assert.equal(zonedInstant("2026-10-04", "19:30", "Europe/London"), "2026-10-04T18:30:00.000Z");
  assert.equal(zonedInstant("2026-10-26", "19:30", "Europe/London"), "2026-10-26T19:30:00.000Z");
  assert.equal(zoneOffsetMinutes(Date.parse("2026-10-04T12:00:00Z"), "Europe/London"), 60);
});

test("zonedDate and zonedClock read an instant in the venue's zone", () => {
  const at = "2026-10-04T23:30:00.000Z";
  assert.equal(zonedDate(at, "Asia/Hong_Kong"), "2026-10-05");
  assert.equal(zonedClock(at, "Asia/Hong_Kong"), "07:30");
  assert.equal(zonedDate(at, "Europe/London"), "2026-10-05");
  assert.equal(zonedClock(at, "Europe/London"), "00:30");
});

test("dayRange spans a full local day even when the clocks change", () => {
  const normal = dayRange("2026-10-04", "Europe/London");
  assert.equal(minutesBetween(normal), 24 * 60);
  const fallBack = dayRange("2026-10-25", "Europe/London");
  assert.equal(minutesBetween(fallBack), 25 * 60);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.throws(() => addDays("bad", 1));
});

test("composeWindow runs past midnight when the end is not after the start", () => {
  const w = composeWindow("2026-10-04", "22:00", "01:00", "Asia/Hong_Kong");
  assert.equal(minutesBetween(w), 180);
  assert.equal(zonedDate(w.endAt, "Asia/Hong_Kong"), "2026-10-05");
});

test("intersect and intersectAll return the common part or null", () => {
  const a = { startAt: "2026-10-04T10:00:00.000Z", endAt: "2026-10-04T14:00:00.000Z" };
  const b = { startAt: "2026-10-04T12:00:00.000Z", endAt: "2026-10-04T16:00:00.000Z" };
  const c = { startAt: "2026-10-04T13:00:00.000Z", endAt: "2026-10-04T13:30:00.000Z" };
  assert.deepEqual(intersect(a, b), { startAt: "2026-10-04T12:00:00.000Z", endAt: "2026-10-04T14:00:00.000Z" });
  assert.equal(intersect(a, { startAt: a.endAt, endAt: "2026-10-04T18:00:00.000Z" }), null);
  assert.equal(minutesBetween(intersectAll([a, b, c])), 30);
  assert.equal(intersectAll([]), null);
});

test("a tight 3-5pm window proposes a start inside the overlap and respects minimum length", () => {
  const mine = { startAt: "2026-10-04T07:00:00.000Z", endAt: "2026-10-04T09:00:00.000Z" }; // 15:00-17:00 HK
  const theirs = { startAt: "2026-10-04T08:00:00.000Z", endAt: "2026-10-04T11:00:00.000Z" }; // 16:00-19:00 HK
  const shared = intersect(mine, theirs);
  const now = Date.parse("2026-10-04T05:00:00.000Z");
  assert.deepEqual(proposeWindow(shared, 60, now), shared);
  assert.equal(proposeWindow(shared, 90, now), null, "a 60 minute overlap cannot hold a 90 minute game");
  assert.equal(requiredMinutes(45, 90), 90);
  assert.equal(requiredMinutes(30), 60, "never below the default hour");
});

test("proposeWindow never starts in the past and rounds up to the half hour", () => {
  const shared = { startAt: "2026-10-04T07:00:00.000Z", endAt: "2026-10-04T10:00:00.000Z" };
  const now = Date.parse("2026-10-04T07:40:00.000Z");
  assert.equal(proposeWindow(shared, 60, now).startAt, "2026-10-04T08:00:00.000Z");
});

test("presets are clipped to now, or null once over", () => {
  const tz = "Asia/Hong_Kong";
  const morning = Date.parse("2026-10-04T01:00:00.000Z"); // 09:00 HK
  assert.equal(zonedClock(presetWindow("afterwork", "2026-10-04", tz, morning).startAt, tz), "18:00");
  const evening = Date.parse("2026-10-04T12:00:00.000Z"); // 20:00 HK
  assert.equal(zonedClock(presetWindow("afterwork", "2026-10-04", tz, evening).startAt, tz), "20:00");
  assert.equal(presetWindow("afternoon", "2026-10-04", tz, evening), null);
  const now = presetWindow("now", "2026-10-04", tz, evening);
  assert.equal(minutesBetween(now), 180);
  assert.equal(presetWindow("now", "2026-10-05", tz, evening), null, "'now' only applies to today");
});

test("narrow and urgent windows are flagged, never blocked", () => {
  const short = { startAt: "2026-10-04T10:00:00.000Z", endAt: "2026-10-04T11:00:00.000Z" };
  const long = { startAt: "2026-10-04T10:00:00.000Z", endAt: "2026-10-04T13:00:00.000Z" };
  assert.equal(isNarrow(short), true);
  assert.equal(isNarrow(long), false);
  const now = Date.parse("2026-10-04T09:00:00.000Z");
  assert.equal(isUrgent(short, now), true);
  assert.equal(isUrgent({ startAt: "2026-10-04T13:00:00.000Z", endAt: "2026-10-04T15:00:00.000Z" }, now), false);
});
