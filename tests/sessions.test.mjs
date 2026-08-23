import test from "node:test";
import assert from "node:assert/strict";
import { overlapsExisting, sessionLive, sessionStatus, sortSessions, visibleSessions } from "../lib/sessions.ts";
import { handicapSentence, headToHead, proposeHandicap, roundToNearestInteger } from "../lib/handicap.ts";

const now=Date.parse("2026-08-01T13:00:00.000Z"); // 21:00 HK
const s=(id,startAt,endAt,over={})=>({id,startAt,endAt,...over});
const tonight=s("t","2026-08-01T12:00:00.000Z","2026-08-01T15:00:00.000Z");
const finished=s("f","2026-08-01T08:00:00.000Z","2026-08-01T11:00:00.000Z");
const booking={inviteId:"i1",opponentId:"ken",startAt:"2026-08-01T12:00:00.000Z",endAt:"2026-08-01T14:00:00.000Z"};

/* --- Session status -------------------------------------------------------- */

test("a session's status follows from the time and the booking, not from a stored flag",()=>{
  assert.equal(sessionStatus(tonight,now),"looking");
  assert.equal(sessionStatus({...tonight,booking},now),"booked");
  assert.equal(sessionStatus(finished,now),"missed","time passed, nobody agreed");
  assert.equal(sessionStatus({...finished,booking},now),"toRecord","played, no score yet");
  assert.equal(sessionStatus({...finished,booking,recorded:true},now),"done",
    "the score is in — history, not an obligation, and never a second 記錄比分 button");
});

test("a session that has begun is live, and 21:05 has not missed a 21:00 start",()=>{
  assert.equal(sessionLive(tonight,now),true);
  assert.equal(sessionLive(finished,now),false);
  assert.equal(sessionLive(s("x","2026-08-01T14:00:00.000Z","2026-08-01T16:00:00.000Z"),now),false,
    "not started yet");
});

/* --- Ordering -------------------------------------------------------------- */

test("what needs the member comes first, then what is next, then what is over",()=>{
  const ordered=sortSessions([
    finished,
    s("later","2026-08-02T12:00:00.000Z","2026-08-02T15:00:00.000Z"),
    tonight,
    {...s("owed","2026-08-01T06:00:00.000Z","2026-08-01T09:00:00.000Z"),booking},
  ],now);
  assert.deepEqual(ordered.map(item=>item.id),["owed","t","later","f"]);
});

test("a missed session fades out rather than standing as a permanent reproach",()=>{
  const old=s("old","2026-07-30T06:00:00.000Z","2026-07-30T09:00:00.000Z");
  assert.equal(visibleSessions([old],now).length,0,"two days later it is gone");
  assert.equal(visibleSessions([finished],now).length,1,"this morning's is still worth seeing once");
  assert.equal(visibleSessions([{...old,booking}],now).length,1,
    "unless it still owes a score — that never expires quietly");
});

/* --- Overlap --------------------------------------------------------------- */

test("sessions cannot overlap — that is one evening entered twice",()=>{
  const existing=[{startAt:"2026-08-01T12:00:00.000Z",endAt:"2026-08-01T15:00:00.000Z"}];
  assert.equal(overlapsExisting({startAt:"2026-08-01T14:00:00.000Z",endAt:"2026-08-01T16:00:00.000Z"},existing),true);
  assert.equal(overlapsExisting({startAt:"2026-08-01T15:00:00.000Z",endAt:"2026-08-01T17:00:00.000Z"},existing),false,
    "back-to-back is fine — the boundary is not an overlap");
  assert.equal(overlapsExisting({startAt:"2026-08-02T12:00:00.000Z",endAt:"2026-08-02T15:00:00.000Z"},existing),false);
});

/* --- The handicap proposal ------------------------------------------------- */

const settings={handicapPointsToElo:25,handicapMinimumElo:7,handicapSensitivityRange:16,handicapSensitivityWidth:250};

test("the proposal uses the displayed handicap difference and reads from my side",()=>{
  const strongerThanMe=proposeHandicap(1400,1700,settings);
  assert.equal(strongerThanMe.direction,"receive");
  assert.ok(strongerThanMe.label.startsWith("建議佢讓"));
  assert.equal(strongerThanMe.points,-12);

  const weakerThanMe=proposeHandicap(1700,1400,settings);
  assert.equal(weakerThanMe.direction,"give");
  assert.equal(weakerThanMe.points,-strongerThanMe.points,"the same game, read from the other side");

  assert.deepEqual(proposeHandicap(1500,1500,settings),{points:0,direction:"level",label:"平手打就啱"});
});

test("a bigger displayed handicap gap proposes more points",()=>{
  const near=proposeHandicap(1500,1600,settings).points;
  const far=proposeHandicap(1500,1900,settings).points;
  const absurd=proposeHandicap(1500,3000,settings).points;
  assert.equal(near,-4);
  assert.equal(far,-16);
  assert.equal(absurd,-60);
});

test("suggestions round to the nearest integer",()=>{
  assert.equal(roundToNearestInteger(2.49),2);
  assert.equal(roundToNearestInteger(2.5),3);
  assert.ok(Object.is(roundToNearestInteger(-0.4),0),"would otherwise print as -0 分");
});

/* --- The evidence behind it ------------------------------------------------ */

const played=(a,b,scoreA,scoreB)=>({a,b,scoreA,scoreB,status:"confirmed"});

test("head-to-head counts both directions and ignores voided matches",()=>{
  const record=headToHead([
    played("me","ken",3,1), played("ken","me",2,3), played("me","ken",0,3),
    {...played("me","ken",3,0),status:"void"},
  ],"me","ken");
  assert.equal(record.played,3);
  assert.equal(record.myWins,2);
  assert.equal(record.theirWins,1);
  assert.equal(record.label,"你哋過往 3 局 2 : 1");
});

test("below three games the record says nothing rather than overclaiming",()=>{
  // "你哋打過 1 局，你贏咗" is not evidence, and dressing it up as a reason to trust the handicap
  // costs more trust than staying quiet.
  assert.equal(headToHead([played("me","ken",3,1)],"me","ken").label,null);
  assert.equal(headToHead([],"me","ken").label,null);
});

test("two members who never met still get the proposal — that is when it matters most",()=>{
  const sentence=handicapSentence({myRating:1400,theirRating:1800,settings,matches:[],me:"me",them:"new"});
  assert.equal(sentence.evidence,null);
  assert.equal(sentence.direction,"receive");
  assert.ok(sentence.label.length>0,"the handicap is the only thing making this game playable");
});
