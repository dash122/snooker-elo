import test from "node:test";
import assert from "node:assert/strict";
import { bestNight, hongKongWeekday, inviteOwedBy, invitedSlot, isInviteExpired, isOfferLive, nowInterval, partitionInvites, partitionOffers, proposeMatchOffers, recurrenceDates, rankPlayables, reliabilityFactor, screenState, validateAvailabilityInterval } from "../lib/availability.ts";

const hk=(time)=>`2026-08-01T${time}:00+08:00`;
const slot=(from,to)=>({startAt:hk(from),endAt:hk(to)});
const before=Date.parse("2026-08-01T10:00:00.000Z"); // 18:00 HK
const during=Date.parse("2026-08-01T12:00:00.000Z"); // 20:00 HK

/* --- Counter-proposals ---------------------------------------------------- */

const negotiation=(over={})=>({id:"i1",status:"pending",startAt:"2026-08-01T11:00:00.000Z",endAt:"2026-08-01T13:00:00.000Z",createdAt:"2026-07-31T00:00:00.000Z",fromPlayer:{id:"a"},toPlayer:{id:"b"},...over});
const counterTo=(startAt,endAt,byPlayerId)=>({startAt,endAt,byPlayerId});

test("a counter-proposal supersedes the original times everywhere",()=>{
  const countered=negotiation({counter:counterTo("2026-08-01T13:00:00.000Z","2026-08-01T15:00:00.000Z","b")});
  assert.deepEqual(invitedSlot(countered),{startAt:"2026-08-01T13:00:00.000Z",endAt:"2026-08-01T15:00:00.000Z"});
  assert.deepEqual(invitedSlot(negotiation()),{startAt:"2026-08-01T11:00:00.000Z",endAt:"2026-08-01T13:00:00.000Z"});
});

test("expiry watches the countered time, not the original",()=>{
  // Countering a 19:00 invite to 21:00 must not expire it the moment 19:00 passes: the two are now
  // negotiating over 21:00, and expiring there would kill the conversation halfway through.
  const later=counterTo("2026-08-01T13:00:00.000Z","2026-08-01T15:00:00.000Z","b");
  assert.equal(isInviteExpired(negotiation(),during),true,"the original slot has begun");
  assert.equal(isInviteExpired(negotiation({counter:later}),during),false,"the counter has not");
});

test("a counter-proposal flips whose turn it is",()=>{
  assert.equal(inviteOwedBy(negotiation()),"b","normally the recipient answers");
  assert.equal(inviteOwedBy(negotiation({counter:counterTo("x","y","b")})),"a","b countered, so a owes the reply");
  assert.equal(inviteOwedBy(negotiation({counter:counterTo("x","y","a")})),"b","a countered back, so it is b's turn again");
});

test("an invite I sent but must now answer is filed as needing my response",()=>{
  // The bug this guards: a countered invite stayed in 等對方回覆 because it was in the sent list, so
  // the member never discovered the ball was back in their court.
  const countered=negotiation({counter:counterTo("2026-08-01T13:00:00.000Z","2026-08-01T15:00:00.000Z","b")});
  const mine=partitionInvites({sent:[countered],received:[],playerId:"a",now:before});
  assert.deepEqual(mine.needsResponse.map(x=>x.id),["i1"]);
  assert.deepEqual(mine.awaitingReply,[]);
  const theirs=partitionInvites({sent:[],received:[countered],playerId:"b",now:before});
  assert.deepEqual(theirs.awaitingReply.map(x=>x.id),["i1"]);
  assert.deepEqual(theirs.needsResponse,[]);
});

test("an ordinary invite still sorts the usual way",()=>{
  const plain=negotiation();
  assert.deepEqual(partitionInvites({sent:[],received:[plain],playerId:"b",now:before}).needsResponse.map(x=>x.id),["i1"]);
  assert.deepEqual(partitionInvites({sent:[plain],received:[],playerId:"a",now:before}).awaitingReply.map(x=>x.id),["i1"]);
});

/* --- Reliability ---------------------------------------------------------- */

test("an unmeasured member scores exactly neutral",()=>{
  // The trap a naive reliability score falls into: a newcomer with no invite history must not rank
  // below a known flake simply for being unknown.
  assert.equal(reliabilityFactor(undefined),0.5);
  assert.equal(reliabilityFactor({}),0.5);
});
test("each reliability signal only moves its own share",()=>{
  assert.equal(reliabilityFactor({acceptRate:1,showRate:1,responseHours:1}),1);
  assert.equal(reliabilityFactor({acceptRate:0,showRate:0,responseHours:24}),0);
  // Answering within the hour is full marks; a day later is worth nothing.
  assert.equal(reliabilityFactor({responseHours:1}),0.5*0.5+0.5*0.3+1*0.2);
  assert.equal(reliabilityFactor({responseHours:24}),0.5*0.5+0.5*0.3);
});

/* --- "Free now" ----------------------------------------------------------- */

test("free-now rounds down so the current minutes are not thrown away",()=>{
  // 19:42 HK. A member is free *now*, not at 20:00 — and the 30-minute grace window in
  // validateAvailabilityInterval is exactly wide enough to accept a start that has just passed.
  const at1942=Date.parse("2026-08-01T11:42:00Z");
  assert.deepEqual(nowInterval(120,at1942),{startAt:"2026-08-01T11:30:00.000Z",endAt:"2026-08-01T13:30:00.000Z"});
  assert.doesNotThrow(()=>validateAvailabilityInterval(nowInterval(120,at1942),at1942));
});
test("free-now never produces a slot under the 30-minute floor",()=>{
  assert.equal(nowInterval(0,Date.parse("2026-08-01T11:00:00Z")).endAt,"2026-08-01T11:30:00.000Z");
});
test("free-now outside the playing window is rejected, not silently shifted",()=>{
  // 04:00 HK. "I'm free now" is a real answer at 4am and the club is shut; the caller needs the
  // error so it can say which hours it means.
  const at0400=Date.parse("2026-07-31T20:00:00Z");
  assert.throws(()=>validateAvailabilityInterval(nowInterval(120,at0400),at0400),/between 10:00 and 02:00/);
});

/* --- Mutual offers -------------------------------------------------------- */

const opponent=(id,rating,slots)=>({id,rating,slots});

test("only proposes offers with a real overlap, closest ELO first",()=>{
  const proposals=proposeMatchOffers({mine:[slot("19:00","23:00")],rating:1500,opponents:[
    opponent("close",1505,[slot("19:00","22:00")]),
    opponent("far",1900,[slot("19:00","22:00")]),
    opponent("brief",1502,[slot("19:00","19:30")]),   // half an hour is not an evening
    opponent("elsewhere",1500,[slot("10:00","11:00")]),
  ]});
  assert.deepEqual(proposals.map(x=>x.opponentId),["close","far"],"the brief and the non-overlapping are dropped");
});

test("caps how many people one publish disturbs",()=>{
  const many=Array.from({length:10},(_,index)=>opponent(`p${index}`,1500+index,[slot("19:00","22:00")]));
  assert.equal(proposeMatchOffers({mine:[slot("19:00","23:00")],rating:1500,opponents:many}).length,3,
    "a broadcast would train members to ignore the whole feature within a week");
  assert.equal(proposeMatchOffers({mine:[slot("19:00","23:00")],rating:1500,opponents:many,limit:5}).length,5);
});

test("never offers somebody already mid-conversation",()=>{
  const opponents=[opponent("a",1500,[slot("19:00","22:00")]),opponent("b",1501,[slot("19:00","22:00")])];
  const proposals=proposeMatchOffers({mine:[slot("19:00","23:00")],rating:1500,opponents,excluded:["a"]});
  assert.deepEqual(proposals.map(x=>x.opponentId),["b"]);
});

test("trims an offer to a plausible session rather than the whole shared evening",()=>{
  const [proposal]=proposeMatchOffers({mine:[slot("18:00","23:00")],rating:1500,opponents:[opponent("a",1500,[slot("18:00","23:00")])]});
  assert.equal(proposal.startAt,"2026-08-01T10:00:00.000Z","starts when the overlap starts");
  assert.equal(proposal.endAt,"2026-08-01T12:00:00.000Z","two hours, not five");
  assert.equal(proposal.minutes,300,"but the full overlap is still reported");
});

test("an offer stops being answerable once its slot is under way",()=>{
  const live={id:"o1",status:"live",startAt:"2026-08-01T11:00:00.000Z"};
  assert.equal(isOfferLive(live,before),true);
  assert.equal(isOfferLive(live,during),false);
  assert.equal(isOfferLive({...live,status:"dead"},before),false);
});

test("splits offers into the ones waiting on me and the ones I have answered",()=>{
  const make=(id,myResponse,startAt)=>({id,myResponse,status:"live",startAt,endAt:"2026-08-01T15:00:00.000Z",venue:"",createdAt:"",opponent:{id:"x",name:"x",short:"x",rating:1500}});
  const {awaitingMe,answered}=partitionOffers([
    make("later","pending","2026-08-01T12:00:00.000Z"),
    make("sooner","pending","2026-08-01T11:00:00.000Z"),
    make("done","yes","2026-08-01T11:30:00.000Z"),
  ],before);
  assert.deepEqual(awaitingMe.map(x=>x.id),["sooner","later"],"soonest first — an offer is about tonight");
  assert.deepEqual(answered.map(x=>x.id),["done"]);
});

/* --- Recurring availability ----------------------------------------------- */

test("expands a weekly rule onto the right Hong Kong days",()=>{
  assert.equal(hongKongWeekday("2026-08-01"),6,"2026-08-01 is a Saturday");
  assert.deepEqual(recurrenceDates(3,"2026-08-01",14),["2026-08-05","2026-08-12"],"every Wednesday in the fortnight");
  assert.deepEqual(recurrenceDates(6,"2026-08-01",8),["2026-08-01","2026-08-08"],"including the day it starts on");
});

test("weekday is read at midday so the UTC+8 offset cannot shift it",()=>{
  // Reading `new Date(date+"T00:00+08:00").getUTCDay()` lands at 16:00 the previous day in UTC and
  // reports the wrong weekday for every single date.
  for(const [date,weekday] of [["2026-08-02",0],["2026-08-03",1],["2026-08-04",2],["2026-08-05",3],["2026-08-06",4],["2026-08-07",5],["2026-08-08",6]])
    assert.equal(hongKongWeekday(date),weekday,date);
});

/* --- Screen state ---------------------------------------------------------- */

test("the screen follows what the member owes, not what they might want",()=>{
  // Obligation outranks everything: leaving an invite unanswered costs somebody else a game.
  assert.equal(screenState({owed:2,upcoming:1,intent:{kind:"tonight"},pendingAsks:3}),"owed");
  assert.equal(screenState({owed:0,upcoming:1,intent:{kind:"tonight"},pendingAsks:3}),"booked");
  // Saying "I want a game" and having an unanswered invite out are the same situation to a member:
  // they have done their part and are waiting.
  assert.equal(screenState({owed:0,upcoming:0,intent:{kind:"window"},pendingAsks:0}),"searching");
  assert.equal(screenState({owed:0,upcoming:0,intent:null,pendingAsks:1}),"searching");
  assert.equal(screenState({owed:0,upcoming:0,intent:null,pendingAsks:0}),"idle");
});

/* --- One stream of games --------------------------------------------------- */

const rival=(id,score,intent)=>({id,score,qualifies:true,intent,minutes:120,recent:0,difference:0,
  overlaps:[{startAt:"2026-08-01T12:00:00.000Z",endAt:"2026-08-01T14:00:00.000Z"}]});
const table=(id,playerId,rating)=>({id,startAt:"2026-08-01T11:00:00.000Z",endAt:"2026-08-01T13:00:00.000Z",
  player:{id:playerId,rating}});

test("a claimable table outranks an opponent who still has to say yes",()=>{
  // A well-matched call (82) leads a strong keen opponent (70): the table is booked and nobody has
  // to say yes, which is what actually decides whether a frame gets played.
  const ranked=rankPlayables({rating:1500,opponents:[rival("keen",70,{kind:"tonight"})],calls:[table("c1","kelvin",1500)]});
  assert.deepEqual(ranked.map(x=>x.kind),["claim","keen"]);
  assert.equal(ranked[0].callId,"c1");
});

test("the claim bonus is generous but not infinite",()=>{
  // A badly mismatched call (400 ELO apart) scores 60, so a strong ranked opponent above that still
  // wins — the shortlist never degrades into "every open call first, then the rest".
  const ranked=rankPlayables({rating:1500,opponents:[rival("great",75)],calls:[table("c1","far",1900)]});
  assert.deepEqual(ranked.map(x=>x.opponentId),["great","far"]);
});

test("intent decides the label, not the ordering",()=>{
  const ranked=rankPlayables({rating:1500,calls:[],
    opponents:[rival("quiet",80),rival("keen",60,{kind:"tonight"})]});
  assert.deepEqual(ranked.map(x=>x.kind),["overlap","keen"],"score still sorts; the kind is only how the row reads");
});

test("one member never appears as both a table and a suggestion",()=>{
  const ranked=rankPlayables({rating:1500,opponents:[rival("kelvin",90,{kind:"tonight"})],calls:[table("c1","kelvin",1500)]});
  assert.equal(ranked.length,1,"the call wins — same game, less work");
  assert.equal(ranked[0].kind,"claim");
});

test("never re-offers somebody already mid-conversation",()=>{
  const ranked=rankPlayables({rating:1500,opponents:[rival("marco",90)],calls:[table("c1","kelvin",1500)],
    excluded:["marco","kelvin"]});
  assert.deepEqual(ranked,[]);
});

/* --- Best night ------------------------------------------------------------ */

test("suggests the fullest upcoming night, never today",()=>{
  const counts={"2026-08-01":9,"2026-08-02":4,"2026-08-03":8,"2026-08-04":1};
  // Today is excluded even though it is the fullest: a member seeing this has already established
  // that tonight is not working for them.
  assert.deepEqual(bestNight(counts,"2026-08-01"),{date:"2026-08-03",count:8});
  assert.equal(bestNight({"2026-08-02":2},"2026-08-01"),null,"below the floor is not worth suggesting");
  assert.equal(bestNight({},"2026-08-01"),null);
});
