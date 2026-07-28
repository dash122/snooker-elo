import test from "node:test";
import assert from "node:assert/strict";
import { addDaysHongKong, availabilityDensity, availabilityPeak, composeAvailabilityInterval, dayRangeHongKong, gamesPlayed, intervalFromHours, intersectIntervals, matchesBetween, mergeIntervals, nextAvailabilityStart, overlapMinutes, rankOpponents, recommendationScore, validateAvailabilityInterval } from "../lib/availability.ts";

test("keeps a same-day slot on the day the member picked",()=>{
  // Deriving the end date from `new Date(date+"T00:00+08:00").toISOString()` rolled it back a day,
  // so every slot ended before it started and nothing could be created.
  const interval=composeAvailabilityInterval("2026-08-01","19:00","21:00");
  assert.deepEqual(interval,{startAt:"2026-08-01T11:00:00.000Z",endAt:"2026-08-01T13:00:00.000Z"});
  assert.deepEqual(validateAvailabilityInterval(interval,Date.parse("2026-07-31T00:00:00Z")),interval);
});
test("allows a slot starting up to 30 minutes ago, not further back",()=>{
  // At 13:01 HK, 13:00 has technically already begun, but the member is still standing at the table
  // — a slot should not vanish from the menu the instant its start time ticks past.
  const soonAfter=Date.parse("2026-08-01T05:01:00Z"); // 13:01 HK, one minute after 13:00
  assert.doesNotThrow(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","13:00","14:00"),soonAfter));
  const onTheEdge=Date.parse("2026-08-01T05:30:00Z"); // 13:30 HK: 13:00 is exactly 30 minutes ago
  assert.doesNotThrow(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","13:00","14:00"),onTheEdge),"exactly 30 minutes ago is still within the grace window");
  assert.throws(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","12:30","14:00"),onTheEdge),/must start in the future/,"an hour ago is well outside the grace window");
});
test("limits slots to the 10:00–02:00 Hong Kong playing window",()=>{
  const now=Date.parse("2026-07-31T00:00:00Z");
  assert.doesNotThrow(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","10:00","22:00"),now));
  assert.doesNotThrow(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","14:00","02:00"),now));
  assert.doesNotThrow(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-02","00:30","02:00"),now));
  assert.throws(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","09:30","12:00"),now),/between 10:00 and 02:00/);
  assert.throws(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","23:00","02:30"),now),/between 10:00 and 02:00/);
  assert.throws(()=>validateAvailabilityInterval(composeAvailabilityInterval("2026-08-01","23:00","10:00"),now),/between 10:00 and 02:00/);
});test("rolls a slot ending at or before its start into the next day",()=>{
  assert.deepEqual(composeAvailabilityInterval("2026-08-01","22:00","01:00"),{startAt:"2026-08-01T14:00:00.000Z",endAt:"2026-08-01T17:00:00.000Z"});
  assert.equal(composeAvailabilityInterval("2026-08-01","22:00","22:00").endAt,"2026-08-02T14:00:00.000Z");
});
test("places a slot painted past midnight on the following morning",()=>{
  assert.deepEqual(intervalFromHours("2026-08-01",21,24.5),{startAt:"2026-08-01T13:00:00.000Z",endAt:"2026-08-01T16:30:00.000Z"});
  assert.deepEqual(intervalFromHours("2026-08-31",22.5,26),{startAt:"2026-08-31T14:30:00.000Z",endAt:"2026-08-31T18:00:00.000Z"});
  assert.equal(intervalFromHours("2026-08-31",22.5,26).endAt,new Date("2026-09-01T02:00:00+08:00").toISOString());
  assert.throws(()=>intervalFromHours("2026-08-01",21,21));
  assert.throws(()=>intervalFromHours("2026-08-01",23,26.5),/between 10:00 and 02:00/);
  assert.deepEqual(intervalFromHours("2026-08-01",24.5,26),{startAt:"2026-08-01T16:30:00.000Z",endAt:"2026-08-01T18:00:00.000Z"});
  assert.throws(()=>intervalFromHours("2026-08-01",26,26.5),/between 10:00 and 02:00/);
});
test("advances Hong Kong dates across month and year ends",()=>{
  assert.equal(addDaysHongKong("2026-08-31",1),"2026-09-01");
  assert.equal(addDaysHongKong("2026-12-31",1),"2027-01-01");
  assert.equal(addDaysHongKong("2026-03-01",-1),"2026-02-28");
});
test("offers the next half-hour boundary in Hong Kong terms",()=>{
  // A 30-minute grace lets a slot that only just started stay offered, so at 19:01 HK (11:01Z) the
  // 19:00 boundary is still on the table rather than jumping straight to 19:30.
  assert.deepEqual(nextAvailabilityStart(Date.parse("2026-08-01T11:01:00Z")),{date:"2026-08-01",time:"19:00",at:Date.parse("2026-08-01T11:00:00Z")});
  // 23:45 in Hong Kong rolls the offered start onto the next calendar day.
  assert.deepEqual(nextAvailabilityStart(Date.parse("2026-08-01T16:10:00Z")),{date:"2026-08-02",time:"00:00",at:Date.parse("2026-08-01T16:00:00Z")});
  // 13:01 HK (05:01Z): the exact scenario this grace exists for — 1pm is still offered at 1:01pm.
  assert.deepEqual(nextAvailabilityStart(Date.parse("2026-08-01T05:01:00Z")),{date:"2026-08-01",time:"13:00",at:Date.parse("2026-08-01T05:00:00Z")});
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

test("recommends every opponent who overlaps, not just the best one",()=>{
  // The page used to surface a single name, so two of these three were invisible.
  const ranked=rankOpponents({
    mine:[slot("19:00","23:00")],rating:1500,
    opponents:[
      {id:"a",rating:1490,slots:[slot("21:30","22:00")]},
      {id:"b",rating:1800,slots:[slot("21:30","22:00")]},
      {id:"c",rating:1505,slots:[slot("19:00","23:00")]},
      {id:"d",rating:1500,slots:[slot("10:00","11:00")]},   // free, but never at the same time
    ],
  });
  assert.deepEqual(ranked.map(x=>x.id),["c","a","b"],"all three overlappers, longest/closest first");
  assert.equal(ranked.every(x=>x.minutes>0),true);
});
test("ranks a focused band on the overlap inside that band",()=>{
  // Whole-day overlap put the wrong player first when the member had focused one hour.
  const opponents=[
    {id:"early",rating:1500,slots:[slot("14:00","20:00")]},
    {id:"late",rating:1500,slots:[slot("21:00","23:00")]},
  ];
  const mine=[slot("14:00","23:00")];
  assert.equal(rankOpponents({mine,rating:1500,opponents})[0].id,"early","unfocused, the longer day wins");
  const focused=rankOpponents({mine,rating:1500,opponents,window:slot("21:30","22:00")});
  assert.deepEqual(focused.map(x=>x.id),["late"],"only the player free in the band, measured on the band");
  assert.equal(focused[0].minutes,30);
});
test("counts a split overlap once across several slots",()=>{
  const ranked=rankOpponents({
    mine:[slot("14:00","16:00"),slot("18:00","20:00")],rating:1500,
    opponents:[{id:"a",rating:1500,slots:[slot("15:00","19:00")]}],
  });
  assert.equal(ranked[0].minutes,120,"one hour from each half");
  assert.equal(ranked[0].overlaps.length,2);
});
test("keeps a sub-30-minute overlap in the list but unqualified",()=>{
  const ranked=rankOpponents({
    mine:[slot("19:00","20:00")],rating:1500,
    opponents:[{id:"a",rating:1500,slots:[slot("19:50","20:00")]}],
  });
  assert.equal(ranked.length,1,"still worth showing");
  assert.equal(ranked[0].qualifies,false);
});

const played=(a,b,status="confirmed")=>({a,b,status});

test("finds confirmed matches between two players regardless of side",()=>{
  const matches=[played("x","y"),played("y","x"),played("x","z"),played("x","y","void")];
  assert.equal(matchesBetween(matches,"x","y").length,2,"both sides, only confirmed");
  assert.equal(matchesBetween(matches,"y","x").length,2,"order of the two ids doesn't matter");
  assert.equal(matchesBetween(matches,"x","z").length,1);
  assert.equal(matchesBetween(matches,"z","y").length,0,"never played each other");
});
test("counts lifetime games for one player from either side, confirmed only",()=>{
  const matches=[played("x","y"),played("z","x"),played("y","z"),played("x","y","void")];
  assert.equal(gamesPlayed(matches,"x"),2);
  assert.equal(gamesPlayed(matches,"y"),2);
  assert.equal(gamesPlayed(matches,"nobody"),0);
});
