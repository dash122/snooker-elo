import test from "node:test";
import assert from "node:assert/strict";
import { HALF_HOUR_TIMES, initialTimes, timeLabel } from "../lib/play/time-options.ts";

test("half-hour choices cover a whole day with clear 12-hour labels", () => {
  assert.equal(HALF_HOUR_TIMES.length, 48);
  assert.equal(HALF_HOUR_TIMES[0], "00:00");
  assert.equal(HALF_HOUR_TIMES.at(-1), "23:30");
  assert.equal(timeLabel("16:00"), "4pm");
  assert.equal(timeLabel("16:30"), "4:30pm");
  assert.equal(timeLabel("00:00"), "12am");
  assert.equal(timeLabel("12:00"), "12pm");
});

test("defaults move to the next future half hour and support overnight endings", () => {
  assert.deepEqual(initialTimes("2026-10-04", "Asia/Hong_Kong", Date.parse("2026-10-04T11:07:00Z")), { start: "19:30", end: "22:30" });
  assert.deepEqual(initialTimes("2026-10-04", "Asia/Hong_Kong", Date.parse("2026-10-04T15:01:00Z")), { start: "23:30", end: "02:30" });
  assert.deepEqual(initialTimes("2026-10-04", "Asia/Hong_Kong", Date.parse("2026-10-04T15:31:00Z")), { start: "", end: "" });
});

test("default selection uses the venue's date and time zone", () => {
  const now = Date.parse("2026-10-04T11:07:00Z");
  assert.deepEqual(initialTimes("2026-10-04", "Europe/London", now), { start: "19:00", end: "22:00" });
  assert.deepEqual(initialTimes("2026-10-05", "Asia/Hong_Kong", now), { start: "19:00", end: "22:00" });
});
