import test from "node:test";
import assert from "node:assert/strict";
import { blockedByUnfinishedOnboarding } from "../lib/state-write-rules.ts";

const player = (id, name, preliminaryRating) => ({ id, name, preliminaryRating });

test("blocks a new match involving a player who hasn't finished onboarding", () => {
  const current = { players: [player("p1", "Alice", null), player("p2", "Bob", 1500)], matches: [] };
  const next = {
    players: current.players,
    matches: [{ id: "m1", a: "p1", b: "p2", scoreA: 2, scoreB: 1 }],
  };
  assert.equal(blockedByUnfinishedOnboarding(current, next), "Alice");
});

test("allows a new match once both participants have a preliminary rating", () => {
  const current = { players: [player("p1", "Alice", 1300), player("p2", "Bob", 1500)], matches: [] };
  const next = {
    players: current.players,
    matches: [{ id: "m1", a: "p1", b: "p2", scoreA: 2, scoreB: 1 }],
  };
  assert.equal(blockedByUnfinishedOnboarding(current, next), null);
});

test("still blocks a brand-new placeholder-rated player", () => {
  const current = {
    settings: { start: 1500 },
    players: [
      { id: "p1", name: "New member", rating: 1500, initialRating: 1500, preliminaryRating: null },
      { id: "p2", name: "Bob", rating: 1500, initialRating: 1500, preliminaryRating: 1500 },
    ],
    matches: [],
  };
  const next = { ...current, matches: [{ id: "new", a: "p1", b: "p2", scoreA: 2, scoreB: 1 }] };
  assert.equal(blockedByUnfinishedOnboarding(current, next), "New member");
});

test("allows a legacy rated player without a questionnaire marker", () => {
  const current = {
    settings: { start: 1500 },
    players: [
      { id: "p1", name: "Ryan", rating: 1612, initialRating: 1500, preliminaryRating: null },
      { id: "p2", name: "Bob", rating: 1500, initialRating: 1500, preliminaryRating: 1500 },
    ],
    matches: [{ id: "old", a: "p1", b: "p2", scoreA: 2, scoreB: 1 }],
  };
  const next = { ...current, matches: [...current.matches, { id: "new", a: "p1", b: "p2", scoreA: 1, scoreB: 2 }] };
  assert.equal(blockedByUnfinishedOnboarding(current, next), null);
});

test("allows a manually rated legacy player whose rating moved without history", () => {
  const current = {
    settings: { start: 1500 },
    players: [
      { id: "p1", name: "Ryan", rating: 1600, initialRating: 1500, preliminaryRating: null },
      { id: "p2", name: "Bob", rating: 1500, initialRating: 1500, preliminaryRating: 1500 },
    ],
    matches: [],
  };
  const next = { ...current, matches: [{ id: "new", a: "p1", b: "p2", scoreA: 1, scoreB: 2 }] };
  assert.equal(blockedByUnfinishedOnboarding(current, next), null);
});

test("does not block an unrelated, unchanged match just because some other player is unfinished", () => {
  const match = { id: "m1", a: "p2", b: "p3", scoreA: 2, scoreB: 1 };
  const current = { players: [player("p1", "Alice", null), player("p2", "Bob", 1500), player("p3", "Cara", 1500)], matches: [match] };
  const next = { players: current.players, matches: [match] };
  assert.equal(blockedByUnfinishedOnboarding(current, next), null);
});

test("blocks editing an existing match's score for an unfinished participant", () => {
  const current = { players: [player("p1", "Alice", null), player("p2", "Bob", 1500)], matches: [{ id: "m1", a: "p1", b: "p2", scoreA: 2, scoreB: 1 }] };
  const next = { players: current.players, matches: [{ id: "m1", a: "p1", b: "p2", scoreA: 2, scoreB: 0 }] };
  assert.equal(blockedByUnfinishedOnboarding(current, next), "Alice");
});
