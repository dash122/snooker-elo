import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOOTOUT_LONG_SHOT_MS,
  SHOOTOUT_MATCH_MS,
  SHOOTOUT_PHASE_CHANGE_MS,
  SHOOTOUT_SHORT_SHOT_MS,
  canEnterReady,
  createShootoutState,
  getShootoutView,
  resetShotClock,
  restorePreviousTurn,
  setPause,
  startShootout,
  switchShootoutTurn,
} from "../lib/shootout.ts";

const readyState = () => ({...createShootoutState("陳大文", "李志強"), openingPlayer: "a"});

test("requires two distinct players and an opening player", () => {
  assert.equal(canEnterReady(createShootoutState("陳大文", "李志強")), false);
  assert.equal(canEnterReady({...readyState(), playerB: "陳大文"}), false);
  assert.equal(canEnterReady(readyState()), true);
});

test("starting begins both clocks together without starting during setup", () => {
  const setup = readyState();
  assert.equal(getShootoutView(setup, 5_000).matchRemainingMs, SHOOTOUT_MATCH_MS);
  const started = startShootout(setup, 5_000);
  assert.equal(started.status, "live");
  assert.equal(started.activePlayer, "a");
  assert.equal(started.matchRemainingMs, SHOOTOUT_MATCH_MS);
  assert.equal(started.shotRemainingMs, SHOOTOUT_LONG_SHOT_MS);
});

test("the five-minute boundary changes immediately to ten seconds and caps an active shot", () => {
  const started = startShootout(readyState(), 1_000);
  const boundary = {...started, matchRemainingMs: SHOOTOUT_PHASE_CHANGE_MS + 500, shotRemainingMs: SHOOTOUT_LONG_SHOT_MS, lastUpdatedAt: 2_000};
  const view = getShootoutView(boundary, 2_500);
  assert.equal(view.matchRemainingMs, SHOOTOUT_PHASE_CHANGE_MS);
  assert.equal(view.phase, "short");
  assert.equal(view.shotRemainingMs, SHOOTOUT_SHORT_SHOT_MS);
  assert.equal(view.status, "live");
});

test("shot expiry leaves the player unchanged while the match clock continues", () => {
  const started = startShootout(readyState(), 1_000);
  const expiredView = getShootoutView(started, 17_000);
  assert.equal(expiredView.status, "expired");
  assert.equal(expiredView.activePlayer, "a");
  assert.equal(expiredView.shotRemainingMs, 0);
  assert.ok(expiredView.matchRemainingMs < SHOOTOUT_MATCH_MS);
  assert.ok(expiredView.matchRemainingMs > 0);
});

test("only a manual switch after expiry changes player and starts a fresh shot clock", () => {
  const started = startShootout(readyState(), 1_000);
  const switched = switchShootoutTurn(started, 17_000);
  assert.equal(switched.status, "live");
  assert.equal(switched.activePlayer, "b");
  assert.equal(switched.shotRemainingMs, SHOOTOUT_LONG_SHOT_MS);
  assert.equal(switched.events.at(-1).kind, "switch");
});

test("pausing only the shot clock does not stop the match clock", () => {
  const started = startShootout(readyState(), 1_000);
  const paused = setPause(started, "shot", 6_000);
  const view = getShootoutView(paused, 9_000);
  assert.equal(view.shotClockPaused, true);
  assert.equal(view.shotRemainingMs, 10_000);
  assert.equal(view.matchRemainingMs, SHOOTOUT_MATCH_MS - 8_000);
});

test("undo restores the previous player without adding match time back", () => {
  const started = startShootout(readyState(), 0);
  const switched = switchShootoutTurn(started, 4_000);
  const undone = restorePreviousTurn(switched, 6_000);
  assert.equal(undone.activePlayer, "a");
  assert.equal(undone.matchRemainingMs, SHOOTOUT_MATCH_MS - 6_000);
  assert.equal(undone.shotRemainingMs, 9_000);
  assert.equal(undone.events.at(-1).kind, "correction");
});

test("a referee correction can recover an expired shot clock without changing player", () => {
  const started = startShootout(readyState(), 0);
  const corrected = resetShotClock(started, 16_000, true);
  assert.equal(corrected.activePlayer, "a");
  assert.equal(corrected.status, "live");
  assert.equal(corrected.shotRemainingMs, SHOOTOUT_LONG_SHOT_MS);
  assert.equal(corrected.events.at(-1).kind, "correction");
});
