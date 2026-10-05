import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDICAP_ELO_PER_POINT, handicapCurveActive, matchHandicapRate, proposeHandicap, suggestedHandicap,
  taperEloForPoints, taperEloPerPoint, taperPoints,
} from "../lib/handicap.ts";
import { replay } from "../lib/elo-replay.ts";
import { createTranslator } from "../lib/i18n/translate.ts";

const t = createTranslator("zh-Hant");
const base = { handicapPointsToElo: 25, handicapMinimumElo: 7, handicapSensitivityRange: 16, handicapSensitivityWidth: 250, start: 1500 };
const taper = { ...base, handicapCurveFrom: "2000-01-01" };
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test("the taper curve is off unless a start date is set, and not before it", () => {
  assert.equal(handicapCurveActive(base), false);
  assert.equal(handicapCurveActive({ handicapCurveFrom: null }), false);
  assert.equal(handicapCurveActive({ handicapCurveFrom: "2026-10-06" }, "2026-10-05"), false);
  assert.equal(handicapCurveActive({ handicapCurveFrom: "2026-10-06" }, "2026-10-06"), true);
  assert.equal(handicapCurveActive({ handicapCurveFrom: "2026-10-06" }, "2026-11-01"), true);
});

test("with the curve off every suggestion and engine rate is exactly the flat 25 ELO per point", () => {
  assert.equal(suggestedHandicap({ rating: 1700 }, [], base), 52);
  assert.equal(suggestedHandicap({ rating: 1300 }, [], base), 68);
  assert.equal(proposeHandicap(t, 1200, 1000, base).points, 8);
  assert.equal(matchHandicapRate(1900, 900, 30, base, "2026-10-10"), HANDICAP_ELO_PER_POINT);
  assert.equal(matchHandicapRate(1900, 900, 30, { ...base, handicapCurveFrom: "2026-11-01" }, "2026-10-10"), HANDICAP_ELO_PER_POINT);
});

test("the rate starts at 50 ELO per point at the bottom and narrows to 25 by 2100", () => {
  assert.equal(taperEloPerPoint(500), 50);
  assert.equal(taperEloPerPoint(800), 50);
  close(taperEloPerPoint(1300), 40.38, 0.01);
  close(taperEloPerPoint(1450), 37.5, 0.01);
  assert.equal(taperEloPerPoint(2100), 25);
  assert.equal(taperEloPerPoint(2600), 25);
});

test("starts between real club ratings match the simulated curve", () => {
  close(taperPoints(731, 2118), 38.1, 0.3); // top player to the lowest-rated regular
  close(taperPoints(1347, 2118), 24.5, 0.3);
  close(taperPoints(731, 1347), 13.7, 0.3);
  close(taperPoints(1125, 1878), 20.9, 0.3);
});

test("starts are the difference of two fixed indexes, so they always add up", () => {
  for (const [a, b, c] of [[600, 1200, 2200], [731, 1347, 2118], [1000, 1500, 1500], [900, 2300, 2400]]) {
    close(taperPoints(a, b) + taperPoints(b, c), taperPoints(a, c), 1e-9);
  }
  close(taperPoints(1800, 900), -taperPoints(900, 1800), 1e-9);
  assert.equal(taperPoints(1500, 1500), 0);
});

test("ELO spanned by a start is the exact inverse of the points spanned by a rating gap", () => {
  for (const [low, high] of [[731, 2118], [900, 1100], [1500, 2400], [300, 700]]) {
    close(taperEloForPoints(low, taperPoints(low, high)), high - low, 0.01);
  }
  assert.equal(taperEloForPoints(1000, 0), 0);
});

test("the displayed handicap keeps the 60-at-start anchor and compresses the spread", () => {
  assert.equal(suggestedHandicap({ rating: 1500 }, [], taper), 60);
  assert.ok(suggestedHandicap({ rating: 1700 }, [], taper) < 60);
  assert.ok(suggestedHandicap({ rating: 1300 }, [], taper) > 60);
  const flat = proposeHandicap(t, 1878, 731, base).points;
  const tapered = proposeHandicap(t, 1878, 731, taper).points;
  assert.ok(flat >= 45 && flat <= 47, `flat start ${flat}`);
  assert.ok(tapered >= 27 && tapered <= 31, `tapered start ${tapered}`);
  assert.equal(proposeHandicap(t, 731, 1878, taper).points, -tapered);
});

test("engine rate is the ELO the start spans, so a fair start still lands at 50/50", () => {
  const fair = taperPoints(731, 2118);
  const rate = matchHandicapRate(2118, 731, fair, taper, "2026-10-10");
  assert.ok(rate > 25 && rate < 50);
  // The fair start's ELO value cancels the rating gap exactly, which is what makes it 50/50.
  close(rate * fair, 2118 - 731, 1e-6);
  // Giver is either side: the receiver's rating is the base of the span.
  assert.equal(matchHandicapRate(731, 2118, -fair, taper, "2026-10-10"), rate);
  // No points handed over: the local rate at the pair's average rating.
  close(matchHandicapRate(900, 1100, 0, taper, "2026-10-10"), taperEloPerPoint(1000), 1e-9);
});

const player = (id, rating) => ({
  id, name: id, short: id, handicap: null, rating, initialRating: rating, active: true,
  wins: 0, losses: 0, draws: 0, framesWon: 0, framesLost: 0, lastChange: 0, form: [],
});
const match = (id, playedOn, scoreA, scoreB) => ({
  id, a: "strong", b: "weak", scoreA, scoreB, playedOn, createdAt: `${playedOn}T00:00:00Z`,
  actual: 30, giver: "strong", official: null, extra: 0, expectedA: 0, beforeA: 0, beforeB: 0, afterA: 0, afterB: 0, deltaA: 0,
  status: "confirmed",
});
const engine = { start: 1500, handicapEloScale: 1250, frameScaleCoefficient: 250, repetitionDecayBase: 1.5, repetitionDecayPeriod: 10 };
const run = (settings) => replay(
  [player("strong", 1900), player("weak", 900)],
  [match("m1", "2026-09-20", 2, 1), match("m2", "2026-10-20", 2, 1)],
  { ...engine, ...settings },
);

test("switching the curve on never rewrites a match played before its start date", () => {
  const flat = run({});
  const switched = run({ handicapCurveFrom: "2026-10-01" });
  const [flat1, flat2] = flat.matches, [sw1, sw2] = switched.matches;
  assert.equal(sw1.afterA, flat1.afterA);
  assert.equal(sw1.expectedA, flat1.expectedA);
  // The second match is on the curve and, starting from the same rating, is valued differently.
  assert.notEqual(sw2.expectedA, flat2.expectedA);
});

test("an unset curve replays history exactly as before", () => {
  const unset = run({});
  const explicit = run({ handicapCurveFrom: null });
  assert.deepEqual(unset.players.map((p) => p.rating), explicit.players.map((p) => p.rating));
});
