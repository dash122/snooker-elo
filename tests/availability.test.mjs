import test from "node:test";
import assert from "node:assert/strict";
import { addDaysHongKong, availabilityDensity, availabilityPeak, composeAvailabilityInterval, dayRangeHongKong, intervalFromHours, intersectIntervals, mergeIntervals, nextAvailabilityStart, overlapMinutes, recommendationScore, validateAvailabilityInterval } from "../lib/availability.ts";

test("keeps a same-day slot on the day the member picked",()=>{
  // Deriving the end date from `new Date(date+"T00:00+08:00").toISOString()` rolled it back a day,
  // so every slot ended before it started and nothing could be created.
  const interval=composeAvailabilityInterval("2026-08-01","19:00","21:00");
  assert.deepEqual(interval,{startAt:"2026-08-01T11:00:00.000Z",endAt:"2026-08-01T13:00:00.000Z"});
  assert.deepEqual(validateAvailabilityInterval(interval,Date.parse("2026-07-31T00:00:00Z")),interval);
});
test("rolls a slot ending at or before its start into the next day",()=>{
  assert.deepEqual(composeAvailabilityInterval("2026-08-01","22:00","01:00"),{startAt:"2026-08-01T14:00:00.000Z",endAt:"2026-08-01T17:00:00.000Z"});
  assert.equal(composeAvailabilityInterval("2026-08-01","22:00","22:00").endAt,"2026-08-02T14:00:00.000Z");
});
test("places a slot painted past midnight on the following morning",()=>{
  assert.deepEqual(intervalFromHours("2026-08-01",21,24.5),{startAt:"2026-08-01T13:00:00.000Z",endAt:"2026-08-01T16:30:00.000Z"});
  assert.deepEqual(intervalFromHours("2026-08-31",22.5,26),{startAt:"2026-08-31T14:30:00.000Z",endAt:"2026-08-31T18:00:00.000Z"});
  assert.equal(intervalFromHours("2026-08-31",22.5,26).endAt,new Date("2026-09-01T02:00:00+08:00").toISOString());
  assert.throws(()=>intervalFromHours("2026-08-01",21,21));
});
test("advances Hong Kong dates across month and year ends",()=>{
  assert.equal(addDaysHongKong("2026-08-31",1),"2026-09-01");
  assert.equal(addDaysHongKong("2026-12-31",1),"2027-01-01");
  assert.equal(addDaysHongKong("2026-03-01",-1),"2026-02-28");
});
test("offers the next half-hour boundary in Hong Kong terms",()=>{
  assert.deepEqual(nextAvailabilityStart(Date.parse("2026-08-01T11:01:00Z")),{date:"2026-08-01",time:"19:30",at:Date.parse("2026-08-01T11:30:00Z")});
  // 23:45 in Hong Kong rolls the offered start onto the next calendar day.
  assert.deepEqual(nextAvailabilityStart(Date.parse("2026-08-01T15:45:00Z")),{date:"2026-08-02",time:"00:00",at:Date.parse("2026-08-01T16:00:00Z")});
});

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

const hk=(time)=>`2026-08-01T${time}:00+08:00`;
const slot=(from,to)=>({startAt:hk(from),endAt:hk(to)});

test("finds the window where the most members are free",()=>{
  const best=availabilityPeak([[slot("14:00","18:00")],[slot("16:00","19:00")],[slot("16:30","21:00")]]);
  assert.deepEqual(best,{startAt:"2026-08-01T08:30:00.000Z",endAt:"2026-08-01T10:00:00.000Z",count:3});
});
test("counts each member once when their own slots overlap",()=>{
  const best=availabilityPeak([[slot("14:00","16:00"),slot("15:00","17:00")]]);
  assert.equal(best.count,1);
  assert.equal(best.endAt,"2026-08-01T09:00:00.000Z");
});
test("prefers the wider window when counts tie",()=>{
  const best=availabilityPeak([[slot("14:00","15:00"),slot("18:00","21:00")]]);
  assert.deepEqual(best,{startAt:"2026-08-01T10:00:00.000Z",endAt:"2026-08-01T13:00:00.000Z",count:1});
});
test("returns no peak when nobody is free",()=>assert.equal(availabilityPeak([]),null));
test("buckets member counts across the day",()=>{
  const buckets=availabilityDensity([[slot("14:00","18:00")],[slot("16:00","19:00")]],"2026-08-01",12,24);
  assert.equal(buckets.length,48);
  assert.equal(buckets[0].at,"2026-08-01T04:00:00.000Z");
  assert.equal(buckets[0].count,0,"12:00 is before anyone starts");
  assert.equal(buckets[8].count,1,"14:00 has one member");
  assert.equal(buckets[16].count,2,"16:00 has both members");
  assert.equal(buckets[27].count,1,"18:45 still has the later member");
  assert.equal(buckets[28].count,0,"19:00 is when the last slot ends");
});
test("density counts each member once regardless of slot count",()=>{
  const buckets=availabilityDensity([[slot("14:00","16:00"),slot("15:00","17:00")]],"2026-08-01",12,24);
  assert.equal(Math.max(...buckets.map(b=>b.count)),1);
});
