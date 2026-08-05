import test from "node:test";
import assert from "node:assert/strict";
import { extendedEnd, levelLabel, licenceNote, preferenceLicence, rankRoom, remainingLabel, roomScore, shouldOfferUnconfirmed } from "../lib/room.ts";

const now=Date.parse("2026-08-01T11:00:00.000Z"); // 19:00 HK
const at=(iso)=>Date.parse(iso);
const window=(startAt,endAt)=>({startAt,endAt});
const live=(id,rating,over={})=>({id,rating,tier:"live",window:window("2026-08-01T11:00:00.000Z","2026-08-01T15:00:00.000Z"),preference:"any",atClub:false,...over});

/* --- Preference licences -------------------------------------------------- */

test("a preference welcomes the players it was written for, and nobody is ever excluded",()=>{
  // gap is their rating minus mine: positive means they are stronger.
  assert.equal(preferenceLicence("mentor",300),"welcome","a weaker member reading a mentor's row");
  assert.equal(preferenceLicence("mentor",-300),"neutral","a much stronger member is not who 樂意陪新手 is for");
  assert.equal(preferenceLicence("challenge",-300),"welcome","they want somebody stronger; I am stronger");
  assert.equal(preferenceLicence("even",40),"welcome");
  assert.equal(preferenceLicence("even",250),"neutral");
  assert.equal(preferenceLicence("any",900),"welcome","求其打下 means exactly that");
});

test("a licence is never a barrier — 'neutral' only means no tag to show",()=>{
  // The room must not hide anyone: the whole point of showing the market is that a member's own
  // judgement about who is worth asking beats the score's.
  const entries=rankRoom({myRating:1500,now,members:[
    live("mentor",1900,{preference:"mentor"}),
    live("picky",1900,{preference:"even"}),
  ]});
  assert.equal(entries.length,2,"both are listed");
  assert.equal(entries[0].id,"mentor","the one who welcomes me leads");
  assert.equal(entries[1].licence,"neutral");
  assert.equal(entries[1].licenceNote,null,"no tag, but still on the board");
});

test("licence notes are only produced when the licence is real",()=>{
  assert.equal(licenceNote("mentor",300),"佢歡迎水平低啲嘅球友");
  assert.equal(licenceNote("mentor",-300),null);
});

/* --- Level, said from my side --------------------------------------------- */

test("level reads as a distance from me, never as their standing",()=>{
  assert.equal(levelLabel(1500,1680),"高你 180 分");
  assert.equal(levelLabel(1500,1410),"低你 90 分");
  assert.equal(levelLabel(1500,1510),"水平差唔多","inside the noise floor it is not worth a number");
});

/* --- The clock ------------------------------------------------------------- */

test("the countdown never rounds in the member's favour",()=>{
  const end="2026-08-01T12:40:00.000Z";
  assert.equal(remainingLabel(end,now),"仲有 1 小時 40 分");
  assert.equal(remainingLabel(end,at("2026-08-01T12:10:00.000Z")),"仲有 30 分鐘");
  assert.equal(remainingLabel(end,at("2026-08-01T13:00:00.000Z")),"已經完咗");
  assert.equal(remainingLabel("2026-08-01T13:00:00.000Z",now),"仲有 2 小時","an exact hour drops the minutes");
});

test("extending adds an hour but cannot rebuild an all-night claim",()=>{
  const startAt="2026-08-01T11:00:00.000Z";
  assert.equal(extendedEnd("2026-08-01T13:00:00.000Z",startAt,now),"2026-08-01T14:00:00.000Z");
  // Eight hours from the start is the ceiling; a member at it gets no further extension rather than
  // a silently ignored tap.
  assert.equal(extendedEnd("2026-08-01T19:00:00.000Z",startAt,now),null);
  // An expired window extends from now, not from the stale end — otherwise "+1 小時" on a status
  // that ran out an hour ago would produce a window already in the past.
  assert.equal(extendedEnd("2026-08-01T10:00:00.000Z",startAt,now),"2026-08-01T12:00:00.000Z");
});

/* --- Ranking --------------------------------------------------------------- */

test("presence outranks every other signal",()=>{
  // Someone holding a cue right now converts at a rate no calendar entry ever will, so a perfectly
  // matched opponent who is merely free must not sit above them.
  const entries=rankRoom({myRating:1500,now,members:[
    live("perfect",1500,{preference:"even"}),
    live("here",1900,{preference:"even",atClub:true}),
  ]});
  assert.equal(entries[0].id,"here");
  assert.equal(entries[0].group,"at-club");
  assert.equal(entries[1].group,"free-now");
});

test("groups are ordered before fit, so tonight always beats a better game later",()=>{
  const entries=rankRoom({myRating:1500,now,members:[
    live("tuesday",1500,{window:window("2026-08-04T11:00:00.000Z","2026-08-04T15:00:00.000Z")}),
    live("tonight",1800,{}),
  ]});
  assert.deepEqual(entries.map(e=>e.id),["tonight","tuesday"]);
  assert.equal(entries[1].group,"later");
});

test("unconfirmed members sort last, and are marked as a question rather than an answer",()=>{
  // A three-week-old published slot is not evidence anybody is free. It earns them a poke, not a row
  // that claims they are available.
  const entries=rankRoom({myRating:1500,now,members:[
    {id:"stale",rating:1500,tier:"unconfirmed",window:window("2026-08-01T11:00:00.000Z","2026-08-01T15:00:00.000Z"),preference:"any",atClub:false},
    live("said-so",1900,{}),
  ]});
  assert.deepEqual(entries.map(e=>e.id),["said-so","stale"]);
  assert.equal(entries[1].group,"unconfirmed");
  assert.equal(entries[1].tier,"unconfirmed");
});

test("a declared welcome outweighs a marginally better ELO match",()=>{
  // The point of the preference field: a game that gets asked for beats a better one that doesn't.
  const entries=rankRoom({myRating:1500,now,members:[
    live("closer",1610,{preference:"even"}),   // 110 apart, so 勢均力敵 does not cover me
    live("welcoming",1700,{preference:"mentor"}),
  ]});
  assert.equal(entries[0].id,"welcoming");
});

test("a member with no window still ranks — 'ask me' is a real answer",()=>{
  const entries=rankRoom({myRating:1500,now,members:[live("standby",1500,{window:null})]});
  assert.equal(entries[0].group,"later");
  assert.equal(entries[0].window,null);
  assert.ok(entries[0].score>0);
});

test("scoring is bounded and every component pulls the way it claims to",()=>{
  const base={gap:0,licence:"neutral",startsInMinutes:0,atClub:false};
  const plain=roomScore(base);
  assert.ok(roomScore({...base,licence:"welcome"})>plain);
  assert.ok(roomScore({...base,atClub:true})>plain);
  assert.ok(roomScore({...base,startsInMinutes:300})<plain,"a game four hours out is worth less tonight");
  assert.ok(roomScore({...base,gap:400})<plain);
  assert.ok(roomScore({gap:0,licence:"welcome",startsInMinutes:0,atClub:true})<=100);
});

test("a thin room reaches for unconfirmed members, a full one does not",()=>{
  assert.equal(shouldOfferUnconfirmed(0),true);
  assert.equal(shouldOfferUnconfirmed(2),true);
  assert.equal(shouldOfferUnconfirmed(3),false);
});
