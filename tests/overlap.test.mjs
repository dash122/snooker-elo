import test from "node:test";
import assert from "node:assert/strict";
import { STRIP_START_MINUTES, clockLabel, isCommitment, overlapHeadline, overlapView,
  overlapWithMine, visibleBuckets } from "../lib/overlap.ts";

/* 2026-09-01 00:00 Hong Kong = 2026-08-31T16:00Z */
const DAY = Date.parse("2026-08-31T16:00:00.000Z");
const at = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(DAY + (h * 60 + m) * 60000).toISOString();
};
const slot = (playerId, from, to, commitment = "going") =>
  ({ playerId, startAt: at(from), endAt: at(to), commitment });
const view = (slots) => overlapView(slots, DAY);

test("only the two commitments are accepted",()=>{
  for(const ok of ["going","interested"])assert.ok(isCommitment(ok));
  for(const bad of ["high","mid","out","","GOING",null,2])assert.equal(isCommitment(bad),false);
});

/* --- A day is many sessions ----------------------------------------------- */

test("people who never share an hour do not count as an overlap",()=>{
  const v=view([slot("a","14:00","17:00"),slot("b","21:00","23:00")]);
  assert.equal(v.goingTotal,2,"both are going, and the all-day figure says so");
  assert.equal(v.peak,1,"but they are never in the room together");
  assert.match(overlapHeadline(v),/^1 人/,"and the headline reports the truth, not the day count");
});

test("the peak is the busiest moment, and its window is the longest run at that level",()=>{
  const v=view([slot("a","18:00","22:00"),slot("b","19:00","22:00"),slot("c","19:00","21:00")]);
  assert.equal(v.peak,3);
  assert.equal(v.peakStart,"19:00");
  assert.equal(v.peakEnd,"21:00");
});

test("an afternoon session and an evening session coexist without merging",()=>{
  const v=view([slot("a","14:00","17:00"),slot("b","14:30","17:00"),
                slot("c","19:00","23:00"),slot("d","19:00","23:00"),slot("e","20:00","23:00")]);
  assert.equal(v.peak,3,"the evening is the busier of the two sessions");
  assert.equal(v.peakStart,"20:00");
  const afternoon=v.buckets.find(b=>b.label==="15:00");
  assert.equal(afternoon.going,2,"and the afternoon is still there, at its own strength");
});

/* --- Half-hour resolution -------------------------------------------------- */

test("windows land on half hours, not whole ones",()=>{
  const v=view([slot("a","18:30","20:30"),slot("b","19:30","21:00")]);
  assert.equal(v.peak,2);
  assert.equal(v.peakStart,"19:30");
  assert.equal(v.peakEnd,"20:30");
});

test("a bucket only counts when it is fully covered",()=>{
  // b arrives exactly as a leaves: they are never in the room together.
  const v=view([slot("a","19:00","20:00"),slot("b","20:00","21:00")]);
  assert.equal(v.peak,1,"touching windows are not an overlap");
});

test("a 30-minute window occupies exactly one bucket",()=>{
  const v=view([slot("a","19:00","19:30"),slot("b","19:00","19:30")]);
  assert.equal(v.peak,2);
  assert.equal(v.peakStart,"19:00");
  assert.equal(v.peakEnd,"19:30");
});

/* --- 有興趣 is a subscription, not attendance ------------------------------ */

test("interested never inflates the number a member is about to act on",()=>{
  const v=view([slot("a","19:00","22:00"),slot("b","19:00","22:00","interested"),
                slot("c","19:00","22:00","interested")]);
  assert.equal(v.peak,1,"one person is actually going");
  assert.equal(v.interestedTotal,2,"the other two are waiting on the room to fill");
  assert.equal(v.buckets.find(b=>b.label==="19:00").interested,2);
});

test("an empty day says so rather than reporting a small number",()=>{
  const v=view([]);
  assert.equal(v.peak,0);
  assert.equal(v.goingTotal,0);
  assert.equal(overlapHeadline(v),"今日未有人");
});

test("a day where everybody misses everybody is distinguished from an empty one",()=>{
  const v=view([slot("a","14:00","15:00")]);
  assert.equal(v.peak,1);
  assert.notEqual(overlapHeadline(v),"今日未有人");
});

/* --- Malformed input ------------------------------------------------------- */

test("a window that ends before it starts is ignored, not counted backwards",()=>{
  const v=view([slot("a","21:00","19:00"),slot("b","19:00","22:00")]);
  assert.equal(v.peak,1);
  assert.equal(v.goingTotal,1,"and the broken row does not reach the all-day figure either");
});

test("one member with two windows is one person, not two",()=>{
  const v=view([slot("a","14:00","16:00"),slot("a","19:00","21:00")]);
  assert.equal(v.goingTotal,1);
  assert.equal(v.peak,1);
});

/* --- Reading the strip ----------------------------------------------------- */

test("play past midnight stays one continuous run",()=>{
  const v=view([slot("a","22:00","25:00"),slot("b","23:00","25:00")]);
  assert.equal(v.peak,2);
  assert.equal(v.peakStart,"23:00");
  assert.equal(v.peakEnd,"01:00","after midnight reads as 01:00, and follows 23:00 on the strip");
});

test("the strip is trimmed to the part anybody occupies",()=>{
  const full=view([slot("a","19:00","21:00")]);
  const shown=visibleBuckets(full);
  assert.ok(shown.length<full.buckets.length,"a strip from 10:00 to 02:00 is mostly empty columns");
  assert.ok(shown.some(b=>b.label==="19:00")&&shown.some(b=>b.label==="20:30"));
});

test("an empty day still renders an evening-shaped strip rather than nothing",()=>{
  assert.ok(visibleBuckets(view([])).length>0);
});

test("a member is told how many people their own window actually touches",()=>{
  const v=view([slot("a","14:00","17:00"),slot("b","19:00","22:00"),slot("c","19:00","22:00")]);
  assert.equal(overlapWithMine(v,{startAt:at("19:30"),endAt:at("21:00")},DAY),2,"the evening");
  assert.equal(overlapWithMine(v,{startAt:at("14:00"),endAt:at("15:00")},DAY),1,"the afternoon");
  assert.equal(overlapWithMine(v,{startAt:at("17:00"),endAt:at("18:00")},DAY),0,"the gap between them");
  assert.equal(overlapWithMine(v,null,DAY),0);
});

test("clock labels are Hong Kong wall time",()=>{
  assert.equal(clockLabel(STRIP_START_MINUTES),"10:00");
  assert.equal(clockLabel(19*60+30),"19:30");
  assert.equal(clockLabel(25*60),"01:00");
});
