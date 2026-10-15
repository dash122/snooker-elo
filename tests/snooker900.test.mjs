import test from "node:test";
import assert from "node:assert/strict";
import {
  S900_FRAME_MS,
  S900_TAP_GUARD_MS,
  breakOff,
  canStart,
  createS900State,
  endFrameEarly,
  frameTally,
  getS900View,
  loadS900State,
  recordFrame,
  setPaused,
  takeTable,
  tapShot,
  undoTap,
} from "../lib/snooker900.ts";

const live = (shot = 20_000) => breakOff(createS900State("陳大文", "李志強", shot), 0);

test("needs two different named players", () => {
  assert.equal(canStart(createS900State("陳大文", "")), false);
  assert.equal(canStart(createS900State("陳大文", " 陳大文 ")), false);
  assert.equal(canStart(createS900State("陳大文", "李志強")), true);
});

test("break-off starts both clocks with the breaker at the table", () => {
  const state = live();
  assert.equal(state.status, "live");
  assert.equal(state.active, "a");
  const view = getS900View(state, 5_000);
  assert.equal(view.frameRemainingMs, S900_FRAME_MS - 5_000);
  assert.equal(view.shotRemainingMs, 15_000);
});

test("a shot tap restarts the shot clock but not the frame clock", () => {
  const state = tapShot(live(), 12_000);
  const view = getS900View(state, 13_000);
  assert.equal(view.shotRemainingMs, 19_000);
  assert.equal(view.frameRemainingMs, S900_FRAME_MS - 13_000);
  assert.equal(state.shots, 1);
});

test("an expired shot clock is flagged but nothing stops", () => {
  const view = getS900View(live(), 21_000);
  assert.equal(view.shotExpired, true);
  assert.equal(view.status, "live");
  assert.equal(view.active, "a");
});

test("taps inside the guard window are ignored", () => {
  const once = tapShot(live(), 5_000);
  const twice = tapShot(once, 5_000 + S900_TAP_GUARD_MS - 1);
  assert.equal(twice.shots, 1);
  assert.equal(getS900View(twice, 6_000).shotRemainingMs, 19_000);
});

test("the incoming player takes the table; tapping the player already there counts as a shot", () => {
  const switched = takeTable(live(), "b", 8_000);
  assert.equal(switched.active, "b");
  assert.equal(getS900View(switched, 9_000).shotRemainingMs, 19_000);
  const same = takeTable(switched, "b", 12_000);
  assert.equal(same.active, "b");
  assert.equal(same.shots, 1);
});

test("undo restores the previous player with the time their clock would have run", () => {
  const atTable = tapShot(live(), 2_000); // a's clock reset at 2s
  const wrong = takeTable(atTable, "b", 10_000); // a had 12s left
  const fixed = undoTap(wrong, 13_000);
  assert.equal(fixed.active, "a");
  assert.equal(getS900View(fixed, 13_000).shotRemainingMs, 9_000);
});

test("pause freezes both clocks", () => {
  const paused = setPaused(live(), true, 4_000);
  assert.equal(getS900View(paused, 60_000).frameRemainingMs, S900_FRAME_MS - 4_000);
  const resumed = setPaused(paused, false, 60_000);
  assert.equal(getS900View(resumed, 61_000).frameRemainingMs, S900_FRAME_MS - 5_000);
  assert.equal(tapShot(paused, 70_000).shots, 0, "taps do nothing while paused");
});

test("the frame ends at the buzzer and the next frame alternates the breaker", () => {
  const state = live();
  assert.equal(getS900View(state, S900_FRAME_MS).status, "frame-over");
  const over = tapShot(state, S900_FRAME_MS + 1);
  assert.equal(over.status, "frame-over");
  const next = recordFrame(over, "b", true, S900_FRAME_MS + 5_000);
  assert.equal(next.status, "ready");
  assert.equal(next.breaker, "b");
  assert.deepEqual(next.frames, [{winner: "b", blueBall: true}]);
  assert.deepEqual(frameTally(next), {a: 0, b: 1});
});

test("a frame can be ended early", () => {
  const over = endFrameEarly(live(), 300_000);
  assert.equal(over.status, "frame-over");
  assert.equal(recordFrame(over, "a", false, 301_000).frames.length, 1);
});

test("saved state round-trips and junk is rejected", () => {
  const state = tapShot(live(), 3_000);
  assert.deepEqual(loadS900State(JSON.stringify(state)), state);
  assert.equal(loadS900State("{"), null);
  assert.equal(loadS900State(JSON.stringify({version: 2})), null);
});
