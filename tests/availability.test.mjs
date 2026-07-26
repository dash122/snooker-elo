import test from "node:test";
import assert from "node:assert/strict";
import { dayRangeHongKong, intersectIntervals, mergeIntervals, overlapMinutes, recommendationScore } from "../lib/availability.ts";

test("merges overlapping and adjacent availability slots",()=>{
  const merged=mergeIntervals([{startAt:"2026-08-01T10:00:00Z",endAt:"2026-08-01T11:00:00Z"},{startAt:"2026-08-01T11:00:00Z",endAt:"2026-08-01T12:30:00Z"}]);
  assert.deepEqual(merged,[{startAt:"2026-08-01T10:00:00.000Z",endAt:"2026-08-01T12:30:00.000Z"}]);
});
test("calculates multi-slot overlaps",()=>{
  const overlaps=intersectIntervals([{startAt:"2026-08-01T10:00:00Z",endAt:"2026-08-01T12:00:00Z"},{startAt:"2026-08-01T13:00:00Z",endAt:"2026-08-01T15:00:00Z"}],[{startAt:"2026-08-01T11:30:00Z",endAt:"2026-08-01T13:30:00Z"},{startAt:"2026-08-01T14:00:00Z",endAt:"2026-08-01T16:00:00Z"}]);
  assert.equal(overlapMinutes(overlaps),120);
});
test("uses Hong Kong dates as UTC+8",()=>assert.deepEqual(dayRangeHongKong("2026-08-01"),{startAt:"2026-07-31T16:00:00.000Z",endAt:"2026-08-01T16:00:00.000Z"}));
test("requires 30 minutes and caps score components",()=>{assert.equal(recommendationScore({minutes:29,eloDifference:0,recentMatches:0}),null);assert.deepEqual(recommendationScore({minutes:120,eloDifference:400,recentMatches:5}),{score:60,overlap:60,elo:0,variety:0});});
