import assert from "node:assert/strict";
import test from "node:test";
import { entertainmentOnlyWritePreservesOfficialState } from "../lib/entertainment-state.ts";
import { isEntertainmentMode, neutralRatingSnapshot, roundedTeamAverage, roundedTeamEloDifference } from "../lib/entertainment-match.ts";

test("2v2 is entertainment and 1v1 remains rated", () => {
  assert.equal(isEntertainmentMode("2v2"), true);
  assert.equal(isEntertainmentMode("1v1"), false);
  assert.equal(isEntertainmentMode(undefined), false);
});

test("team handicap basis uses rounded team-average ELO difference", () => {
  const teamA = [{ id: "a", rating: 1500.4 }, { id: "b", rating: 1600.4 }];
  const teamB = [{ id: "c", rating: 1450.2 }, { id: "d", rating: 1499.2 }];
  assert.equal(roundedTeamAverage(teamA), 1550);
  assert.equal(roundedTeamAverage(teamB), 1475);
  assert.equal(roundedTeamEloDifference(teamA, teamB), 75);
});

test("entertainment rating snapshots are always neutral", () => {
  assert.deepEqual(neutralRatingSnapshot({ id: "a", rating: 1537.25 }), { before: 1537.25, after: 1537.25, delta: 0 });
});
test("an entertainment-only write cannot alter official player fields", () => {
  const current = { settings: { k: 24 }, players: [{ id: "a", rating: 1500, wins: 2, losses: 1, draws: 0, framesWon: 8, framesLost: 4, lastChange: 5, form: ["W"] }], matches: [] };
  const entertainmentMatch = { id: "doubles", mode: "2v2", a: "a", b: "b", a2: "c", b2: "d" };
  assert.equal(entertainmentOnlyWritePreservesOfficialState(current, { ...current, matches: [entertainmentMatch] }), true);
  assert.equal(entertainmentOnlyWritePreservesOfficialState(current, { ...current, players: [{ ...current.players[0], rating: 1510 }], matches: [entertainmentMatch] }), false);
  assert.equal(entertainmentOnlyWritePreservesOfficialState(current, { ...current, settings: { k: 40 }, matches: [entertainmentMatch] }), false);
});