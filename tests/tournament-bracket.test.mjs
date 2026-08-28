import test from "node:test";
import assert from "node:assert/strict";
import { bracketShape, buildBracket, computeDraw, firstRoundPairings, matchRoundLabel, playerEliminated, playerHonours, opponentIn, playerSlot, roundLabel, shuffleDraw, signupsClosed, swapPlayer } from "../lib/tournament.ts";

const PAST = "2020-01-01T00:00";
const FUTURE = "2999-01-01T00:00";

const cup = (overrides = {}) => ({
  id: "t1",
  name: "會友盃",
  signupDeadline: PAST,
  signups: ["p1", "p2", "p3", "p4"],
  ...overrides,
});

const result = (round, index, a, b, scoreA, scoreB) => ({
  id: `m${round}-${index}`, a, b, scoreA, scoreB, mode: "cup", status: "confirmed",
  tournamentId: "t1", tournamentRound: round, tournamentMatchIndex: index,
});

test("sign-ups close on the Hong Kong deadline, not the viewer's midnight", () => {
  assert.equal(signupsClosed({ signupDeadline: "2026-08-01" }, Date.parse("2026-08-01T15:58:00Z")), false);
  assert.equal(signupsClosed({ signupDeadline: "2026-08-01" }, Date.parse("2026-08-01T16:00:00Z")), true);
  assert.equal(signupsClosed({ signupDeadline: "" }), false);
});

test("bracket shape rounds up to a power of two", () => {
  assert.deepEqual(bracketShape(1), { size: 0, rounds: 0 });
  assert.deepEqual(bracketShape(2), { size: 2, rounds: 1 });
  assert.deepEqual(bracketShape(5), { size: 8, rounds: 3 });
  assert.deepEqual(bracketShape(8), { size: 8, rounds: 3 });
});

test("round labels count backwards from the final", () => {
  assert.equal(roundLabel(3, 3), "決賽");
  assert.equal(roundLabel(2, 3), "四強");
  assert.equal(roundLabel(1, 3), "八強");
});

test("the draw is deterministic and drops duplicate sign-ups", () => {
  const first = computeDraw(cup());
  assert.deepEqual(first, computeDraw(cup({ signups: [...cup().signups].reverse() })));
  assert.deepEqual(computeDraw(cup({ signups: ["p1", "p1", "p2"] })).length, 2);
});

test("a stored draw pins the pairings even when the roster is edited afterwards", () => {
  const frozen = cup({ draw: ["p1", "p2", "p3", "p4"], drawnAt: "2026-08-01T00:00:00.000Z" });
  const before = buildBracket(frozen, []);
  const after = buildBracket({ ...frozen, signups: [...frozen.signups, "p9"] }, []);
  assert.deepEqual(after.slots.map(slot => [slot.a, slot.b]), before.slots.map(slot => [slot.a, slot.b]));
  assert.deepEqual(before.slots[0], { ...before.slots[0], a: "p1", b: "p2", state: "ready" });
});

test("no bracket before the deadline", () => {
  assert.equal(buildBracket(cup({ signupDeadline: FUTURE }), []).size, 0);
});

test("an odd field gives the last entrant a bye into round two", () => {
  const bracket = buildBracket(cup({ signups: ["p1", "p2", "p3"], draw: ["p1", "p2", "p3"] }), []);
  assert.equal(bracket.size, 4);
  const bye = bracket.slots.find(slot => slot.round === 1 && slot.index === 2);
  assert.equal(bye.state, "bye");
  assert.equal(bye.winner, "p3");
  // The empty half of the bracket must not read as "we don't know yet" — the
  // semi-final below it is a real, playable tie the moment p1/p2 is settled.
  const final = bracket.slots.find(slot => slot.round === 2);
  assert.equal(final.b, "p3");
  assert.equal(final.state, "waiting");
});

test("winners propagate and the champion falls out of the final", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"] });
  const matches = [result(1, 1, "p1", "p2", 3, 1), result(1, 2, "p3", "p4", 0, 3)];
  const semisOnly = buildBracket(drawn, matches);
  const final = semisOnly.slots.find(slot => slot.round === 2);
  assert.deepEqual([final.a, final.b, final.state], ["p1", "p4", "ready"]);
  assert.equal(semisOnly.champion, "");
  const finished = buildBracket(drawn, [...matches, result(2, 1, "p4", "p1", 4, 2)]);
  assert.equal(finished.champion, "p4");
});

test("a drawn frame advances nobody", () => {
  const bracket = buildBracket(cup({ draw: ["p1", "p2", "p3", "p4"] }), [result(1, 1, "p1", "p2", 2, 2)]);
  assert.equal(bracket.slots.find(slot => slot.round === 2).a, "");
});

test("a voided result leaves the tie playable again", () => {
  const voided = { ...result(1, 1, "p1", "p2", 3, 1), status: "void" };
  const bracket = buildBracket(cup({ draw: ["p1", "p2", "p3", "p4"] }), [voided]);
  assert.equal(bracket.slots[0].state, "ready");
});

test("a walkover advances a player without inventing a result", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"], walkovers: [{ round: 1, index: 1, winner: "p2" }] });
  const bracket = buildBracket(drawn, []);
  assert.equal(bracket.slots[0].state, "walkover");
  assert.equal(bracket.slots[0].match, undefined);
  assert.equal(bracket.slots.find(slot => slot.round === 2).a, "p2");
});

test("a walkover naming someone outside the tie is ignored", () => {
  const bracket = buildBracket(cup({ draw: ["p1", "p2", "p3", "p4"], walkovers: [{ round: 1, index: 1, winner: "p9" }] }), []);
  assert.equal(bracket.slots[0].state, "ready");
  assert.equal(bracket.slots[0].winner, "");
});

test("playerSlot finds the tie a member is actually due to play", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"] });
  const open = buildBracket(drawn, []);
  assert.deepEqual([playerSlot(open, "p1").round, playerSlot(open, "p1").index], [1, 1]);
  const advanced = buildBracket(drawn, [result(1, 1, "p1", "p2", 3, 0)]);
  const next = playerSlot(advanced, "p1");
  assert.deepEqual([next.round, next.state], [2, "waiting"]);
  assert.equal(playerSlot(advanced, "p2"), undefined);
  assert.equal(playerSlot(open, undefined), undefined);
});

test("elimination is losing, not merely being idle", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"] });
  const played = buildBracket(drawn, [result(1, 1, "p1", "p2", 3, 0)]);
  assert.equal(playerEliminated(played, "p2"), true);
  assert.equal(playerEliminated(played, "p1"), false);
  assert.equal(playerEliminated(played, "p3"), false);
  assert.equal(playerEliminated(played, "p9"), false);
});

test("first-round pairings name each entrant's own opponent, byes included", () => {
  const pairings = firstRoundPairings(cup({ signups: ["p1", "p2", "p3"], draw: ["p1", "p2", "p3"] }));
  assert.equal(pairings.length, 3);
  assert.equal(pairings.find(entry => entry.playerId === "p1").opponentId, "p2");
  assert.equal(pairings.find(entry => entry.playerId === "p3").opponentId, "");
});

test("swapping two entrants trades their boxes and leaves the rest of the draw alone", () => {
  const drawn = cup({ signups: ["p1", "p2", "p3", "p4"], draw: ["p1", "p2", "p3", "p4"] });
  const swapped = swapPlayer(drawn, "p1", "p4");
  assert.equal(swapped.ok, true);
  assert.equal(swapped.kind, "swap");
  assert.deepEqual(swapped.tournament.draw, ["p4", "p2", "p3", "p1"]);
  assert.deepEqual(swapped.tournament.signups, ["p1", "p2", "p3", "p4"]);
  const bracket = buildBracket(swapped.tournament, []);
  assert.equal(opponentIn(playerSlot(bracket, "p4"), "p4"), "p2");
});

test("substituting a reserve keeps the box and adds them to the roster", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"], walkovers: [{ round: 1, index: 1, winner: "p1" }] });
  const swapped = swapPlayer(drawn, "p1", "p9");
  assert.equal(swapped.ok, true);
  assert.equal(swapped.kind, "substitute");
  assert.deepEqual(swapped.tournament.draw, ["p9", "p2", "p3", "p4"]);
  assert.deepEqual(swapped.tournament.signups, ["p9", "p2", "p3", "p4"]);
  assert.deepEqual(swapped.tournament.walkovers, []);
});

test("a swap on an undrawn but closed cup freezes the order it would have drawn", () => {
  const closed = cup({ signups: ["p1", "p2", "p3", "p4"] });
  const order = computeDraw(closed);
  const swapped = swapPlayer(closed, order[0], order[3]);
  assert.equal(swapped.ok, true);
  assert.deepEqual(swapped.tournament.draw, [order[3], order[1], order[2], order[0]]);
});

test("swaps are refused for unknown, self-paired or already-played entrants", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"] });
  assert.equal(swapPlayer(drawn, "p9", "p1").ok, false);
  assert.equal(swapPlayer(drawn, "p1", "p1").ok, false);
  assert.equal(swapPlayer(drawn, "p1", "").ok, false);
  const withResult = swapPlayer(drawn, "p1", "p9", [result(1, 1, "p1", "p2", 3, 0)]);
  assert.equal(withResult.ok, false);
  assert.equal(withResult.error, "該球員已有賽果，不能更換");
  assert.equal(swapPlayer(drawn, "p3", "p1", [result(1, 1, "p1", "p2", 3, 0)]).ok, false);
  assert.equal(swapPlayer(drawn, "p3", "p9", [result(1, 1, "p1", "p2", 3, 0)]).ok, true);
});

test("shuffling re-rolls the draw order and clears stale walkovers", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"], walkovers: [{ round: 1, index: 1, winner: "p1" }] });
  const shuffled = shuffleDraw(drawn, []);
  assert.equal(shuffled.ok, true);
  assert.equal(shuffled.tournament.draw.length, 4);
  assert.deepEqual([...shuffled.tournament.draw].sort(), ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(shuffled.tournament.signups, drawn.signups);
  assert.deepEqual(shuffled.tournament.walkovers, []);
});

test("shuffling an undrawn but closed cup freezes a fresh order", () => {
  const closed = cup({ signups: ["p1", "p2", "p3", "p4"] });
  const shuffled = shuffleDraw(closed, []);
  assert.equal(shuffled.ok, true);
  assert.deepEqual([...shuffled.tournament.draw].sort(), ["p1", "p2", "p3", "p4"]);
});

test("shuffling is refused once any tie has a recorded result", () => {
  const drawn = cup({ draw: ["p1", "p2", "p3", "p4"] });
  const withResult = shuffleDraw(drawn, [result(1, 1, "p1", "p2", 3, 0)]);
  assert.equal(withResult.ok, false);
  assert.equal(withResult.error, "已有賽果，不能重新抽籤");
});

test("shuffling is refused for fewer than two entrants", () => {
  assert.equal(shuffleDraw(cup({ signups: ["p1"], draw: ["p1"] }), []).ok, false);
});

/* Honours — who a cup finish belongs to, and who it does not. */

const finished = () => ({
  cup: cup({ draw: ["p1", "p2", "p3", "p4"] }),
  matches: [result(1, 1, "p1", "p2", 3, 1), result(1, 2, "p3", "p4", 0, 3), result(2, 1, "p4", "p1", 4, 2)],
});

test("the champion gets the title and the beaten finalist gets the final", () => {
  const { cup: t, matches } = finished();
  assert.deepEqual(playerHonours([t], matches, "p4"), [{ tournamentId: "t1", name: "會友盃", place: "champion" }]);
  assert.deepEqual(playerHonours([t], matches, "p1"), [{ tournamentId: "t1", name: "會友盃", place: "runnerUp" }]);
});

test("a beaten semi-finalist gets nothing, because third is not a place in a knockout", () => {
  // The two losing semi-finalists are indistinguishable without a play-off the club has never held,
  // so awarding either one would be inventing a result.
  const { cup: t, matches } = finished();
  assert.deepEqual(playerHonours([t], matches, "p2"), []);
  assert.deepEqual(playerHonours([t], matches, "p3"), []);
});

test("an unfinished cup awards nothing to anybody", () => {
  const t = cup({ draw: ["p1", "p2", "p3", "p4"] });
  const semisOnly = [result(1, 1, "p1", "p2", 3, 1), result(1, 2, "p3", "p4", 0, 3)];
  for (const player of ["p1", "p2", "p3", "p4"]) {
    assert.deepEqual(playerHonours([t], semisOnly, player), []);
  }
});

test("honours only count cups the player actually entered", () => {
  const { cup: t, matches } = finished();
  assert.deepEqual(playerHonours([t], matches, "p9"), []);
  assert.deepEqual(playerHonours([t], matches, ""), []);
});

test("titles accumulate across cups", () => {
  const first = cup({ draw: ["p1", "p2", "p3", "p4"] });
  const second = { ...cup({ id: "t2", name: "春季賽", draw: ["p1", "p2", "p3", "p4"] }) };
  const played = id => [result(1, 1, "p1", "p2", 3, 1), result(1, 2, "p3", "p4", 0, 3), result(2, 1, "p4", "p1", 4, 2)]
    .map(match => ({ ...match, tournamentId: id }));
  const honours = playerHonours([first, second], [...played("t1"), ...played("t2")], "p4");
  assert.equal(honours.length, 2);
  assert.ok(honours.every(item => item.place === "champion"));
  assert.deepEqual(honours.map(item => item.name), ["會友盃", "春季賽"]);
});

test("a match's round is named without building a bracket, and an impossible round names nothing", () => {
  assert.equal(matchRoundLabel(4, 1), "四強");
  assert.equal(matchRoundLabel(4, 2), "決賽");
  assert.equal(matchRoundLabel(8, 1), "八強");
  assert.equal(matchRoundLabel(5, 1), "八強");
  for (const bad of [0, 4, null, undefined]) assert.equal(matchRoundLabel(4, bad), "");
  assert.equal(matchRoundLabel(1, 1), "");
});
