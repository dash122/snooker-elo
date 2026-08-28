import assert from "node:assert/strict";
import test from "node:test";
import { applyCupHandicap } from "../lib/cup-handicap-draft.ts";

const draft = (giver = "", points = 0) => ({ mode: "cup", giver, points, scoreA: 0, scoreB: 0 });

test("suggested cups apply the club's handicap to the draft", () => {
  const next = applyCupHandicap(draft(), { handicapMode: "suggested", fairActual: 12, aId: "p1", bId: "p2" });
  assert.equal(next.giver, "p1");
  assert.equal(next.points, 12);
  const other = applyCupHandicap(draft(), { handicapMode: "suggested", fairActual: -9, aId: "p1", bId: "p2" });
  assert.equal(other.giver, "p2");
  assert.equal(other.points, 9);
});

test("level cups clear any handicap", () => {
  const next = applyCupHandicap(draft("p1", 12), { handicapMode: "none", fairActual: 12, aId: "p1", bId: "p2" });
  assert.equal(next.giver, "");
  assert.equal(next.points, 0);
});

test("an even pairing is no handicap rather than a giver of zero", () => {
  const next = applyCupHandicap(draft("p1", 5), { handicapMode: "suggested", fairActual: 0, aId: "p1", bId: "p2" });
  assert.equal(next.giver, "");
  assert.equal(next.points, 0);
});

/* The regression that took the page down: reconciling a draft that already carries the cup's terms
   must hand back the identical object, so React bails out instead of re-rendering the form into
   another pass of the same effect. */
test("reconciling settled terms returns the same draft object", () => {
  const settled = draft("p1", 12);
  const terms = { handicapMode: "suggested", fairActual: 12, aId: "p1", bId: "p2" };
  assert.equal(applyCupHandicap(settled, terms), settled);
  assert.equal(applyCupHandicap(applyCupHandicap(draft(), terms), terms) === applyCupHandicap(draft(), terms), false);
  const once = applyCupHandicap(draft(), terms);
  assert.equal(applyCupHandicap(once, terms), once);

  const level = draft();
  assert.equal(applyCupHandicap(level, { handicapMode: "none", fairActual: null, aId: "p1", bId: "p2" }), level);
});

test("a draft with no cup selected is left untouched", () => {
  const blank = draft("p1", 3);
  assert.equal(applyCupHandicap(blank, { handicapMode: undefined, fairActual: 7, aId: "p1", bId: "p2" }), blank);
  assert.equal(applyCupHandicap(blank, { handicapMode: "suggested", fairActual: null, aId: "p1", bId: "p2" }), blank);
});

test("string points from a hand-edited draft still settle", () => {
  const typed = { ...draft("p1", 12), points: "12" };
  assert.equal(applyCupHandicap(typed, { handicapMode: "suggested", fairActual: 12, aId: "p1", bId: "p2" }), typed);
});
