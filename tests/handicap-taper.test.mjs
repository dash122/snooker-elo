import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDICAP_CURVE_MODEL_VERSION, HANDICAP_ELO_PER_POINT, HANDICAP_MODEL_VERSION, HANDICAP_TAPER_ANCHORS, HANDICAP_TAPER_ANCHORS_V16,
  handicapCurveActive, legacyStartToCurve, matchHandicapRate, proposeHandicap, restateMatchesBetweenCurves, restateMatchesInCurve,
  restateStartBetweenCurves, suggestedHandicap, taperEloForPoints, taperEloPerPoint, taperPoints,
} from "../lib/handicap.ts";
import { replay } from "../lib/elo-replay.ts";
import { createTranslator } from "../lib/i18n/translate.ts";

const t = createTranslator("zh-Hant");
const base = { handicapPointsToElo: 25, handicapMinimumElo: 7, handicapSensitivityRange: 16, handicapSensitivityWidth: 250, start: 1500 };
const flat = { ...base, modelVersion: 15 };
const v16 = { ...base, modelVersion: HANDICAP_CURVE_MODEL_VERSION };
const curve = { ...base, modelVersion: HANDICAP_MODEL_VERSION };
const V16 = HANDICAP_TAPER_ANCHORS_V16;
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

test("model 17 runs 75 ELO per point at the bottom, 50 at 1500, and narrows to 25 by 2600", () => {
  assert.equal(HANDICAP_MODEL_VERSION, 17);
  assert.equal(taperEloPerPoint(500), 75);
  assert.equal(taperEloPerPoint(800), 75);
  close(taperEloPerPoint(1100), 64.29, 0.01);
  assert.equal(taperEloPerPoint(1500), 50);
  close(taperEloPerPoint(1800), 43.18, 0.01);
  close(taperEloPerPoint(2200), 34.09, 0.01);
  assert.equal(taperEloPerPoint(2600), 25);
  assert.equal(taperEloPerPoint(3000), 25);
});

test("model 16 keeps its own curve: 75 at 800 straight down to 25 at 2200", () => {
  close(taperEloPerPoint(1800, V16), 39.29, 0.01);
  assert.equal(taperEloPerPoint(2200, V16), 25);
  assert.equal(taperEloPerPoint(2600, V16), 25);
});

test("the rate never jumps, so the taper has no cliff where it ends", () => {
  for (const [x] of HANDICAP_TAPER_ANCHORS) close(taperEloPerPoint(x - 1e-6), taperEloPerPoint(x + 1e-6), 1e-4);
  for (let rating = 500; rating < 3000; rating += 10) assert.ok(taperEloPerPoint(rating + 10) <= taperEloPerPoint(rating));
});

test("model 17 narrows 1500 to 2200 and leaves everything below 1500 alone", () => {
  close(taperPoints(1500, 2200), 16.9, 0.1); // model 16: 19.4
  close(taperPoints(1500, 2200, V16), 19.4, 0.1);
  close(taperPoints(1500, 1800), 6.5, 0.1); // model 16: 6.8
  close(taperPoints(1800, 2200), 10.4, 0.1); // model 16: 12.7
  close(taperPoints(2200, 2600), 13.7, 0.1); // model 16: 16.0
  for (const [low, high] of [[600, 1000], [731, 1347], [1000, 1500]]) close(taperPoints(low, high), taperPoints(low, high, V16), 1e-9);
  const index = (rating, settings) => suggestedHandicap({ rating }, [], settings);
  for (const rating of [800, 1100, 1300, 1500]) assert.equal(index(rating, curve), index(rating, v16));
  assert.deepEqual([1800, 2000, 2200, 2400, 2600].map((r) => index(r, curve)), [54, 49, 43, 37, 30]);
  assert.deepEqual([1800, 2000, 2200, 2400, 2600].map((r) => index(r, v16)), [53, 48, 41, 33, 25]);
});

test("starts between real club ratings are far narrower than flat 25", () => {
  close(taperPoints(731, 2118), 26.8, 0.2); // flat 25 would be 55.5
  close(taperPoints(731, 1878), 20.6, 0.2); // 45.9
  close(taperPoints(731, 1347), 9.4, 0.2); // 24.6
  close(taperPoints(731, 1125), 5.6, 0.2); // 15.8
  close(taperPoints(1347, 2118), 17.4, 0.2); // 30.8
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
    close(taperEloForPoints(low, taperPoints(low, high, V16), V16), high - low, 0.01);
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
  // A model-16 club still rates its matches on the model-16 curve until it upgrades.
  const fair16 = taperPoints(731, 2118, V16);
  close(matchHandicapRate(2118, 731, fair16, v16) * fair16, 2118 - 731, 1e-6);
});

test("a flat start is restated in curve points holding its ELO value", () => {
  // 20 flat points was 500 ELO; at a 1000-rated receiver that is 9 curve points.
  assert.equal(legacyStartToCurve(20, 1000, V16), 9);
  assert.equal(legacyStartToCurve(30, 731, V16), 12);
  assert.equal(legacyStartToCurve(60, 900, V16), 37);
  assert.equal(legacyStartToCurve(10, 1400, V16), 5);
  assert.equal(legacyStartToCurve(0, 1000, V16), 0);
  // The same ELO buys fewer points the lower the receiver sits, but never more than flat 25.
  for (const rating of [600, 1000, 1500, 2000, 2400]) {
    assert.ok(legacyStartToCurve(30, rating, V16) <= 30);
    assert.ok(legacyStartToCurve(30, rating) <= 30);
  }
});

test("a model-16 start is restated on the model-17 curve holding its ELO value", () => {
  const V17 = HANDICAP_TAPER_ANCHORS;
  // Spans that stay below 1500 are identical on both curves.
  assert.equal(restateStartBetweenCurves(5, 900, V16, V17), 5);
  // Spans reaching above 1500 need fewer points on the wider-rated curve.
  assert.equal(restateStartBetweenCurves(20, 1000, V16, V17), 19);
  assert.equal(restateStartBetweenCurves(19, 1500, V16, V17), 17);
  assert.equal(restateStartBetweenCurves(10, 1800, V16, V17), 8);
  assert.equal(restateStartBetweenCurves(0, 1800, V16, V17), 0);
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
  assert.equal(restated.actual, legacyStartToCurve(20, 1500, V16));
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

test("the version-17 upgrade restates model-16 starts and keeps every rating where it was", () => {
  const v15 = replay(club(), history(), { ...engine, modelVersion: 15 });
  const on16 = replay(club(), restateMatchesInCurve(v15.matches, 1500), { ...engine, modelVersion: 16 });
  const restated = restateMatchesBetweenCurves(on16.matches, 1500);
  const on17 = replay(club(), restated, { ...engine, modelVersion: 17 });
  for (const id of ["top", "mid", "low"]) {
    close(on17.players.find((p) => p.id === id).rating, on16.players.find((p) => p.id === id).rating, 15);
  }
  restated.forEach((m, i) => assert.ok(Math.abs(m.actual) <= Math.abs(on16.matches[i].actual)));
  const again = replay(club(), on17.matches, { ...engine, modelVersion: 17 });
  assert.deepEqual(again.players.map((p) => p.rating), on17.players.map((p) => p.rating));
});

test("before model 16 the same matches replay exactly as they always did", () => {
  const unset = replay(club(), history(), engine);
  const v15 = replay(club(), history(), { ...engine, modelVersion: 15 });
  assert.deepEqual(unset.players.map((p) => p.rating), v15.players.map((p) => p.rating));
});
