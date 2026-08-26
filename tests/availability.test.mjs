import test from "node:test";
import assert from "node:assert/strict";
import { addDaysHongKong, availabilityDensity, availabilityEndTimes, availabilityPeak, availabilityStartTimes, composeAvailabilityInterval, dayRangeHongKong, gamesPlayed, intervalFromHours, intersectIntervals, matchesBetween, mergeAvailabilitySlots, mergeIntervals, inviteAwaitsOutcome, isInviteExpired, isOpenCallLive, nextAvailabilityStart, overlapMinutes, partitionInvites, partitionOpenCalls, rankOpponents, recommendationScore, validateAvailabilityInterval } from "../lib/availability.ts";


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
test("filters end times by duration and keeps overnight choices chronological",()=>{
  assert.deepEqual(availabilityStartTimes().slice(0,2),["10:00","10:30"]);
  assert.equal(availabilityStartTimes().at(-1),"23:30");
  assert.deepEqual(availabilityEndTimes("10:00").slice(-1)[0],{value:"22:00",label:"22:00",minutes:1320});
  assert.deepEqual(availabilityEndTimes("23:30").map(option=>option.value),["00:00","00:30","01:00","01:30","02:00"]);
  assert.equal(availabilityEndTimes("23:30").at(-1).minutes,1560);
});
test("does not merge availability windows with different preferences",()=>{
  const merged=mergeAvailabilitySlots([
    {startAt:"2026-08-01T10:00:00Z",endAt:"2026-08-01T12:00:00Z",conditions:{handicap:true}},
    {startAt:"2026-08-01T11:00:00Z",endAt:"2026-08-01T13:00:00Z",conditions:{noSmoking:true}},
  ]);
  assert.equal(merged.length,2);
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
test("requires 30 minutes and caps score components",()=>{
  assert.equal(recommendationScore({minutes:29,eloDifference:0,recentMatches:0}),null);
  // Full overlap, worst possible ELO gap, played out — plus a neutral reliability score and a neutral
  // intent score, because an opponent with no invite history and no declared intent must not be
  // penalised for being unmeasured.
  assert.deepEqual(recommendationScore({minutes:120,eloDifference:400,recentMatches:5}),{score:55,overlap:40,elo:0,variety:0,reliability:7.5,intent:7.5});
});
test("reliability moves the ranking without letting it dominate",()=>{
  const base={minutes:120,eloDifference:400,recentMatches:5};
  const unknown=recommendationScore(base).score;
  const great=recommendationScore({...base,signals:{acceptRate:1,showRate:1,responseHours:0.5}}).score;
  const poor=recommendationScore({...base,signals:{acceptRate:0,showRate:0,responseHours:48}}).score;
  assert.equal(great-poor,15,"reliability is worth about a seventh of the score, no more");
  assert.ok(great>unknown&&unknown>poor,"an unmeasured opponent sits between the proven and the flaky");
  // A newcomer with two answered invites has no rate at all yet, so they score exactly neutral —
  // this is what stops the shortlist from freezing into whoever happened to reply first.
  assert.equal(recommendationScore({...base,signals:{}}).score,unknown);
});
test("a partial reliability picture only moves the part it knows about",()=>{
  const base={minutes:120,eloDifference:400,recentMatches:5};
  // Answers fast, nothing known about turning up: better than neutral, worse than a proven regular.
  const responsive=recommendationScore({...base,signals:{responseHours:1}}).score;
  assert.ok(responsive>recommendationScore(base).score);
  assert.ok(responsive<recommendationScore({...base,signals:{acceptRate:1,showRate:1,responseHours:1}}).score);
});
test("intent moves the ranking without letting it dominate",()=>{
  const base={minutes:120,eloDifference:400,recentMatches:5};
  const unknown=recommendationScore(base).score;
  const tonight=recommendationScore({...base,intent:{kind:"tonight"}}).score;
  const standby=recommendationScore({...base,intent:{kind:"standby"}}).score;
  assert.ok(tonight>standby&&standby>unknown,"a member who wants a game tonight outranks standby, which outranks no signal at all");
  assert.equal(tonight-unknown,7.5,"the strongest intent signal is worth about a seventh of the score, no more");
});

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

/* --- Invite lifecycle ---------------------------------------------------- */

const invite=(over={})=>({id:"i1",startAt:"2026-08-01T11:00:00.000Z",endAt:"2026-08-01T13:00:00.000Z",status:"pending",createdAt:"2026-07-30T00:00:00.000Z",fromPlayer:{id:"a"},toPlayer:{id:"b"},...over});
const before=Date.parse("2026-08-01T09:00:00.000Z"),during=Date.parse("2026-08-01T12:00:00.000Z"),after=Date.parse("2026-08-01T15:00:00.000Z");

test("a pending invite expires once the slot it proposes has begun",()=>{
  // The unique (from,to) index on pending invites meant an unanswered invite blocked its sender from
  // ever inviting that opponent again. Expiry at the slot start is what releases the pair.
  assert.equal(isInviteExpired(invite(),before),false);
  assert.equal(isInviteExpired(invite(),during),true,"a slot already under way can no longer be accepted");
  assert.equal(isInviteExpired(invite({status:"accepted"}),after),false,"only pending invites expire");
});

test("an accepted invite awaits an outcome only after its slot ends",()=>{
  assert.equal(inviteAwaitsOutcome(invite({status:"accepted"}),during),false,"still being played");
  assert.equal(inviteAwaitsOutcome(invite({status:"accepted"}),after),true);
  assert.equal(inviteAwaitsOutcome(invite({status:"pending"}),after),false,"nobody agreed to play, so there is nothing to follow up");
});

test("partitions the whole inbox rather than surfacing one invite",()=>{
  // Three people asking to play used to read as two of them being ignored, because the status card
  // took only the first pending invite.
  const received=[invite({id:"r1"}),invite({id:"r2",startAt:"2026-08-01T10:00:00.000Z",endAt:"2026-08-01T12:00:00.000Z"}),invite({id:"stale",startAt:"2026-07-31T11:00:00.000Z",endAt:"2026-07-31T13:00:00.000Z"})];
  const sent=[invite({id:"s1",fromPlayer:{id:"b"},toPlayer:{id:"c"}})];
  const buckets=partitionInvites({sent,received,playerId:"b",now:before});
  assert.deepEqual(buckets.needsResponse.map(x=>x.id),["r2","r1"],"soonest slot first, and the stale one is gone");
  assert.deepEqual(buckets.awaitingReply.map(x=>x.id),["s1"]);
});

test("a confirmed game moves from upcoming to follow-up when its slot ends",()=>{
  const accepted=[invite({id:"a1",status:"accepted"})];
  const upcoming=partitionInvites({sent:accepted,received:[],playerId:"a",now:before});
  assert.deepEqual(upcoming.upcoming.map(x=>x.id),["a1"]);
  assert.deepEqual(upcoming.followUps,[]);
  const done=partitionInvites({sent:accepted,received:[],playerId:"a",now:after});
  assert.deepEqual(done.upcoming,[],"a finished game is no longer 'next up'");
  assert.deepEqual(done.followUps.map(x=>x.id),["a1"]);
});

test("recording the score retires the follow-up prompt",()=>{
  // Members who already did the right thing must never be nagged for it.
  const accepted=[invite({id:"a1",status:"accepted"})];
  const played=[{a:"a",b:"b",playedOn:"2026-08-01",status:"confirmed"}];
  const buckets=partitionInvites({sent:accepted,received:[],playerId:"a",matches:played,now:after});
  assert.deepEqual(buckets.followUps,[],"a confirmed match on the slot's day closes the loop");
  const earlier=[{a:"a",b:"b",playedOn:"2026-07-20",status:"confirmed"}];
  assert.equal(partitionInvites({sent:accepted,received:[],playerId:"a",matches:earlier,now:after}).followUps.length,1,
    "an older match between the same pair is not this game's result");
});

test("past confirmed games never occupy the status card",()=>{
  // `confirmedMatches[0]` was sorted ascending with no lower bound, so a game from three weeks ago
  // could present itself as the member's next fixture.
  const old=invite({id:"old",status:"accepted",startAt:"2026-07-10T11:00:00.000Z",endAt:"2026-07-10T13:00:00.000Z"});
  const next=invite({id:"next",status:"accepted",startAt:"2026-08-02T11:00:00.000Z",endAt:"2026-08-02T13:00:00.000Z"});
  const buckets=partitionInvites({sent:[old,next],received:[],playerId:"a",now:before});
  assert.deepEqual(buckets.upcoming.map(x=>x.id),["next"]);
});

/* --- Open calls ---------------------------------------------------------- */

const call=(over={})=>({id:"c1",status:"open",startAt:"2026-08-01T11:00:00.000Z",player:{id:"a"},...over});

test("an open call stays claimable until its slot starts",()=>{
  assert.equal(isOpenCallLive(call(),before),true);
  assert.equal(isOpenCallLive(call(),during),false);
  assert.equal(isOpenCallLive(call({status:"claimed"}),before),false,"somebody already took it");
});

test("separates a member's own calls from the ones they can claim",()=>{
  const calls=[call({id:"mine"}),call({id:"theirs",player:{id:"b"},startAt:"2026-08-01T10:00:00.000Z"}),call({id:"gone",status:"cancelled",player:{id:"c"}})];
  const {mine,others}=partitionOpenCalls(calls,"a",before);
  assert.deepEqual(mine.map(x=>x.id),["mine"]);
  assert.deepEqual(others.map(x=>x.id),["theirs"],"you cannot claim your own table, and a cancelled call is not on offer");
});
