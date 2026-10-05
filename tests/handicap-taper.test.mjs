import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDICAP_CURVE_MODEL_VERSION, HANDICAP_ELO_PER_POINT, handicapCurveActive, legacyStartToCurve, matchHandicapRate,
  proposeHandicap, restateMatchesInCurve, suggestedHandicap, taperEloForPoints, taperEloPerPoint, taperPoints,
} from "../lib/handicap.ts";
import { replay } from "../lib/elo-replay.ts";
import { createTranslator } from "../lib/i18n/translate.ts";

const t = createTranslator("zh-Hant");
const base = { handicapPointsToElo: 25, handicapMinimumElo: 7, handicapSensitivityRange: 16, handicapSensitivityWidth: 250, start: 1500 };
const flat = { ...base, modelVersion: 15 };
const curve = { ...base, modelVersion: HANDICAP_CURVE_MODEL_VERSION };
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test("the curve belongs to rating model 16: earlier models keep the flat 25 ELO per point", () => {
  assert.equal(HANDICAP_CURVE_MODEL_VERSION, 16);
  assert.equal(handicapCurveActive({}), false);
  assert.equal(handicapCurveActive({ modelVersion: 15 }), false);
  assert.equal(handicapCurveActive({ modelVersion: 16 }), true);
  assert.equal(suggestedHandicap({ rating: 1700 }, [], flat), 52);
  assert.equal(suggestedHandicap({ rating: 1300 }, [], flat), 68);
  assert.equal(proposeHandicap(t, 1200, 1000, flat).points, 8);
  assert.equal(matchHandicapRate(1900, 900, 30, flat), HANDICAP_ELO_PER_POINT);
});

test("the rate starts at 75 ELO per point at the bottom and narrows to 25 by 2200", () => {
  assert.equal(taperEloPerPoint(500), 75);
  assert.equal(taperEloPerPoint(800), 75);
  close(taperEloPerPoint(1100), 64.29, 0.01);
  assert.equal(taperEloPerPoint(1500), 50);
  close(taperEloPerPoint(1800), 39.29, 0.01);
  assert.equal(taperEloPerPoint(2200), 25);
  assert.equal(taperEloPerPoint(2600), 25);
});

test("starts between real club ratings are far narrower than flat 25", () => {
  close(taperPoints(731, 2118), 28.6, 0.2); // flat 25 would be 55.5
  close(taperPoints(731, 1878), 21.1, 0.2); // 45.9
  close(taperPoints(731, 1347), 9.4, 0.2); // 24.6
  close(taperPoints(731, 1125), 5.6, 0.2); // 15.8
  close(taperPoints(1347, 2118), 19.2, 0.2); // 30.8
});

test("starts are the difference of two fixed indexes, so they always add up", () => {
  for (const [a, b, c] of [[600, 1200, 2400], [731, 1347, 2118], [1000, 1500, 1500], [900, 2300, 2500]]) {
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
  assert.equal(suggestedHandicap({ rating: 1500 }, [], curve), 60);
  assert.ok(suggestedHandicap({ rating: 1700 }, [], curve) < 60);
  assert.ok(suggestedHandicap({ rating: 1300 }, [], curve) > 60);
  const before = proposeHandicap(t, 1878, 731, flat).points;
  const after = proposeHandicap(t, 1878, 731, curve).points;
  assert.ok(before >= 45 && before <= 47, `flat start ${before}`);
  assert.ok(after >= 20 && after <= 23, `curve start ${after}`);
  assert.equal(proposeHandicap(t, 731, 1878, curve).points, -after);
});

test("engine rate is the ELO the start spans, so a fair start still lands at 50/50", () => {
  const fair = taperPoints(731, 2118);
  const rate = matchHandicapRate(2118, 731, fair, curve);
  assert.ok(rate > 25 && rate < 75);
  // The fair start's ELO value cancels the rating gap exactly, which is what makes it 50/50.
  close(rate * fair, 2118 - 731, 1e-6);
  // Giver is either side: the receiver's rating is the base of the span.
  assert.equal(matchHandicapRate(731, 2118, -fair, curve), rate);
  // No points handed over: the local rate at the pair's average rating.
  close(matchHandicapRate(900, 1100, 0, curve), taperEloPerPoint(1000), 1e-9);
});

test("a flat start is restated in curve points holding its ELO value", () => {
  // 20 flat points was 500 ELO; at a 1000-rated receiver that is 9 curve points.
  assert.equal(legacyStartToCurve(20, 1000), 9);
  assert.equal(legacyStartToCurve(30, 731), 12);
  assert.equal(legacyStartToCurve(60, 900), 37);
  assert.equal(legacyStartToCurve(10, 1400), 5);
  assert.equal(legacyStartToCurve(0, 1000), 0);
  // The same ELO buys fewer points the lower the receiver sits, but never more than flat 25.
  for (const rating of [600, 1000, 1500, 2000, 2400]) assert.ok(legacyStartToCurve(30, rating) <= 30);
});

const match = (overrides) => ({
  a: "p1", b: "p2", giver: "p1", actual: 20, official: null, extra: 20, beforeA: 1800, beforeB: 1000, mode: "1v1", ...overrides,
});

test("the version-16 upgrade restates starts on the receiver's rating and keeps their direction", () => {
  const [aGives, bGives, level, team, official] = restateMatchesInCurve([
    match({}),
    match({ giver: "p2", actual: -20, extra: -20, beforeA: 1000, beforeB: 1800 }),
    match({ giver: null, actual: 0, extra: 0 }),
    match({ mode: "2v2", actual: 15, extra: 15 }),
    match({ actual: 20, official: 6, extra: 14 }),
  ], 1500);
  assert.equal(aGives.actual, 9); // receiver p2 at 1000
  assert.equal(aGives.extra, 9);
  assert.equal(bGives.actual, -9); // receiver is side A at 1000, sign kept
  assert.equal(level.actual, 0);
  assert.equal(team.actual, 15); // team matches carry no start
  assert.equal(official.actual, 9);
  assert.equal(official.official, 6); // the club's separate per-player gap is untouched
  assert.equal(official.extra, 3); // played beyond it, recomputed
});

test("a start with no rating on record falls back to the club's starting rating", () => {
  const [restated] = restateMatchesInCurve([match({ beforeB: Number.NaN })], 1500);
  assert.equal(restated.actual, legacyStartToCurve(20, 1500));
});

const player = (id, rating) => ({
  id, name: id, short: id, handicap: null, rating, initialRating: rating, active: true,
  wins: 0, losses: 0, draws: 0, framesWon: 0, framesLost: 0, lastChange: 0, form: [],
});
const played = (id, day, a, b, scoreA, scoreB, giver, actual) => ({
  id, a, b, scoreA, scoreB, playedOn: `2026-09-${String(day).padStart(2, "0")}`, createdAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`,
  actual, giver, official: null, extra: actual, expectedA: 0, beforeA: 0, beforeB: 0, afterA: 0, afterB: 0, deltaA: 0, status: "confirmed",
});
const engine = { start: 1500, handicapEloScale: 1250, frameScaleCoefficient: 250, repetitionDecayBase: 1.5, repetitionDecayPeriod: 10 };
const club = () => [player("top", 1900), player("mid", 1300), player("low", 800)];
const history = () => [
  played("m1", 1, "top", "low", 2, 0, "top", 40), played("m2", 2, "top", "mid", 3, 2, "top", 24),
  played("m3", 3, "mid", "low", 2, 1, "mid", 20), played("m4", 4, "top", "low", 1, 2, "top", 40),
  played("m5", 5, "mid", "low", 3, 3, "mid", 20), played("m6", 6, "top", "mid", 2, 1, "top", 24),
  played("m7", 7, "top", "low", 3, 1, "top", 40), played("m8", 8, "mid", "low", 1, 0, "mid", 20),
];

test("restating history keeps every rating where it was, so replay never rewrites who is who", () => {
  const old = replay(club(), history(), { ...engine, modelVersion: 15 });
  const restated = restateMatchesInCurve(old.matches, 1500);
  const next = replay(club(), restated, { ...engine, modelVersion: HANDICAP_CURVE_MODEL_VERSION });
  for (const id of ["top", "mid", "low"]) {
    const before = old.players.find((p) => p.id === id).rating;
    const after = next.players.find((p) => p.id === id).rating;
    close(after, before, 15);
  }
  // Starts are now in curve points: the same games, a much narrower range.
  assert.ok(Math.max(...restated.map((m) => Math.abs(m.actual))) < Math.max(...old.matches.map((m) => Math.abs(m.actual))) * 0.75);
});

test("replaying a restated history is stable: a second pass changes nothing", () => {
  const old = replay(club(), history(), { ...engine, modelVersion: 15 });
  const restated = restateMatchesInCurve(old.matches, 1500);
  const once = replay(club(), restated, { ...engine, modelVersion: 16 });
  const twice = replay(club(), once.matches, { ...engine, modelVersion: 16 });
  assert.deepEqual(twice.players.map((p) => p.rating), once.players.map((p) => p.rating));
});

test("before model 16 the same matches replay exactly as they always did", () => {
  const unset = replay(club(), history(), engine);
  const v15 = replay(club(), history(), { ...engine, modelVersion: 15 });
  assert.deepEqual(unset.players.map((p) => p.rating), v15.players.map((p) => p.rating));
});
