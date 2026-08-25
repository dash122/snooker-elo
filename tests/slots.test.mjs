import test from "node:test";
import assert from "node:assert/strict";
import { conditionChips, freshnessLabel, handoffMessage, handsLine, handsView, hasConditions,
  shareMessage, slotStatus, slotTakingHands, sortBoard, sortPostedSlots, takeActionLabel,
  visibleHands, visiblePostedSlots, weekendDates, whatsappShareUrl } from "../lib/slots.ts";

const now=Date.parse("2026-08-01T13:00:00.000Z"); // 21:00 HK
const s=(id,startAt,endAt,over={})=>({id,startAt,endAt,filledBy:null,result:"pending",...over});
const tonight=s("t","2026-08-01T12:00:00.000Z","2026-08-01T15:00:00.000Z");
const finished=s("f","2026-08-01T08:00:00.000Z","2026-08-01T11:00:00.000Z");

/* --- Status ------------------------------------------------------------ */

test("a slot's status follows from time and who filled it, not a stored flag",()=>{
  assert.equal(slotStatus(tonight,now),"open");
  assert.equal(slotStatus({...tonight,filledBy:"kelvin"},now),"filled");
  assert.equal(slotStatus(finished,now),"expired","time passed, nobody raised a winning hand");
  assert.equal(slotStatus({...finished,filledBy:"kelvin"},now),"toRecord","filled, no result yet");
  assert.equal(slotStatus({...finished,filledBy:"kelvin",result:"played"},now),"done");
  assert.equal(slotStatus({...finished,filledBy:"kelvin",result:"missed"},now),"done",
    "missed is still a closed loop, not an open obligation");
});

/* --- Ordering ------------------------------------------------------------- */

test("what needs a score comes first, then what is live, then what expired quietly",()=>{
  const ordered=sortPostedSlots([
    finished,
    s("later","2026-08-02T12:00:00.000Z","2026-08-02T15:00:00.000Z"),
    tonight,
    {...s("owed","2026-08-01T06:00:00.000Z","2026-08-01T09:00:00.000Z"),filledBy:"kelvin"},
  ],now);
  assert.deepEqual(ordered.map(item=>item.id),["owed","t","later","f"]);
});

test("an unfilled slot fades out after a while; a filled one waiting on a score never does",()=>{
  const old=s("old","2026-07-30T06:00:00.000Z","2026-07-30T09:00:00.000Z");
  assert.equal(visiblePostedSlots([old],now).length,0,"two days later, gone");
  assert.equal(visiblePostedSlots([finished],now).length,1,"this morning's is still worth seeing once");
  assert.equal(visiblePostedSlots([{...old,filledBy:"kelvin"}],now).length,1,
    "still owes a score — that never expires quietly");
  assert.equal(visiblePostedSlots([{...tonight,cancelledAt:"2026-08-01T12:30:00.000Z"}],now).length,0,
    "a cancelled slot is gone regardless of its time");
});

/* --- Conditions ------------------------------------------------------------ */

test("condition chips only ever show what the poster actually set",()=>{
  assert.deepEqual(conditionChips({}),[]);
  assert.equal(hasConditions({}),false);
  assert.deepEqual(conditionChips({handicap:true,noSmoking:true,frames:15,levelOnly:true,tableBooked:true}),
    ["要讓分","無煙","15 局","水平接近","已訂枱"]);
  assert.deepEqual(conditionChips({handicap:false,frames:0}),[],
    "an explicit false or a zero frame count is not a stated condition");
});

/* --- Hand-off ------------------------------------------------------------- */

test("the hand-off message carries the time and, when there is one, the table",()=>{
  assert.equal(handoffMessage({venue:"4 號枱",whenLabel:"今晚 21:30–23:30"}),
    "今晚 21:30–23:30 4 號枱，SCAA App 夾到嘅，見！");
  assert.equal(handoffMessage({venue:"",whenLabel:"今晚 21:30–23:30"}),
    "今晚 21:30–23:30，SCAA App 夾到嘅，見！");
});

test("the WhatsApp compose link carries the message and nobody's phone number",()=>{
  const url=whatsappShareUrl("hello world");
  assert.equal(url,"https://wa.me/?text=hello%20world");
  assert.ok(!url.includes("phone"));
});

test("the share message carries the club's own link, not just plain text",()=>{
  const text=shareMessage({whenLabel:"今晚 21:30–23:30",venue:"會所",url:"https://scaa.example/s/abc123"});
  assert.ok(text.includes("https://scaa.example/s/abc123"));
  assert.ok(text.includes("今晚 21:30–23:30"));
  assert.ok(text.includes("會所"));
});

/* --- Hands: counts public, identities private ------------------------------- */

const hand=(playerId,state="raised")=>({playerId,state});

test("hands are counted whole, and split into taken and still waiting",()=>{
  assert.deepEqual(handsView([hand("a","accepted"),hand("b"),hand("c")]),{total:3,accepted:1,waiting:2});
});

test("the poster sees who is waiting; nobody else ever does",()=>{
  const hands=[hand("kelvin","accepted"),hand("amy"),hand("jason")];
  assert.deepEqual(visibleHands(hands,"poster","poster").map(h=>h.playerId),["kelvin","amy","jason"],
    "the poster has to act on the list, so the poster gets the list");
  assert.deepEqual(visibleHands(hands,"amy","poster").map(h=>h.playerId),["kelvin","amy"],
    "Amy sees who was taken and her own hand — never that Jason is also waiting");
  assert.deepEqual(visibleHands(hands,null,"poster").map(h=>h.playerId),["kelvin"],
    "a signed-out reader sees only accepted names, which are the reason to join");
});

test("nobody who was passed over is nameable, so nobody can work out they were",()=>{
  const hands=[hand("kelvin","accepted"),hand("jason")];
  for(const viewer of ["kelvin",null,"stranger"])
    assert.equal(visibleHands(hands,viewer,"poster").some(h=>h.playerId==="jason"),false);
});

/* --- Zero is never printed as zero ------------------------------------------ */

test("an empty slot reads as elapsed time to its poster, never as a score",()=>{
  const line=at=>handsLine({hands:handsView([]),mine:true,iRaised:false,fillRule:"first",createdAt:at},now);
  assert.equal(line("2026-08-01T12:58:00.000Z"),"啱啱開 · 2 分鐘");
  assert.equal(line("2026-08-01T11:00:00.000Z"),"開咗 2 個鐘");
  for(const at of ["2026-08-01T12:58:00.000Z","2026-08-01T09:00:00.000Z","2026-07-30T09:00:00.000Z"])
    assert.equal(line(at).includes("0"),false,"'0 人舉手' is a verdict, not a status");
  assert.equal(freshnessLabel("2026-08-01T13:00:30.000Z",now),"啱啱開","clock skew must not print a negative");
});

test("the same empty slot reads as an opportunity to everyone else",()=>{
  const line=rule=>handsLine({hands:handsView([]),mine:false,iRaised:false,fillRule:rule,
    createdAt:"2026-08-01T12:58:00.000Z"},now);
  assert.equal(line("first"),"仲未有人舉手 · 你舉就即刻成事");
  assert.equal(line("review"),"仲未有人舉手 · 你會係第一個");
});

test("once hands are up the count is stated plainly, to everybody",()=>{
  const hands=handsView([hand("a","accepted"),hand("b"),hand("c")]);
  assert.equal(handsLine({hands,mine:false,iRaised:false,fillRule:"review",createdAt:"2026-08-01T12:00:00.000Z"},now),
    "3 人舉咗手 · 已經收咗 1 個",
    "the number is the liveliness signal — hiding it re-creates the silence it exists to break");
  assert.equal(handsLine({hands:handsView([hand("b"),hand("c")]),mine:true,iRaised:false,
    fillRule:"review",createdAt:"2026-08-01T12:00:00.000Z"},now),"2 人舉咗手 · 等你收人");
});

/* --- Taking people ---------------------------------------------------------- */

test("the poster's action is always 'take', never 'pick'",()=>{
  assert.equal(takeActionLabel(handsView([])),null,"nothing to do yet, so no button");
  assert.equal(takeActionLabel(handsView([hand("a")])),"收佢");
  assert.equal(takeActionLabel(handsView([hand("a"),hand("b"),hand("c")])),"全部收 · 3 個都要",
    "with three hands up, taking all three is the offer — being made to choose one is what stops people posting");
  assert.equal(takeActionLabel(handsView([hand("a","accepted"),hand("b")])),"收佢",
    "already took somebody; the remaining hand is still takeable, not a competitor");
});

test("a filled slot keeps taking hands — only 夠喇, cancelling or the clock stops it",()=>{
  const base={startAt:"2026-08-01T12:00:00.000Z",endAt:"2026-08-01T15:00:00.000Z",result:"pending"};
  assert.equal(slotTakingHands({...base,filledBy:"kelvin"},now),true,
    "taking one person must not close the table — that is the capacity rule this change deletes");
  assert.equal(slotTakingHands({...base,filledBy:null,closedAt:"2026-08-01T12:30:00.000Z"},now),false);
  assert.equal(slotTakingHands({...base,filledBy:null,cancelledAt:"2026-08-01T12:30:00.000Z"},now),false);
  assert.equal(slotTakingHands({...base,endAt:"2026-08-01T12:30:00.000Z",filledBy:null},now),false);
});

/* --- One board -------------------------------------------------------------- */

test("my own slot is pinned first but stays inside the same list",()=>{
  const slot=(id,startAt,mine)=>({id,startAt,mine});
  assert.deepEqual(sortBoard([
    slot("early","2026-08-01T10:00:00.000Z",false),
    slot("mine","2026-08-01T20:00:00.000Z",true),
    slot("late","2026-08-01T14:00:00.000Z",false),
  ]).map(s=>s.id),["mine","early","late"],"pinned by pinning, not by moving it to a section of its own");
});

test("somebody else being taken is not my acceptance, and not my loss either",()=>{
  /* The tray splits on my own acceptance, never on the slot's status: a slot that took somebody else
     is still one I am waiting on. Showing a hand-off card for it would tell me I have a game I do
     not have; marking it lost would tell me about a competition I am not supposed to know ran. */
  const slot={startAt:"2026-08-01T14:00:00.000Z",endAt:"2026-08-01T17:00:00.000Z",
    filledBy:"kelvin",result:"pending"};
  assert.equal(slotStatus(slot,now),"filled","the slot has somebody in it");
  assert.equal(slotTakingHands(slot,now),true,"and is still open to me");
});

/* --- The coming weekend -------------------------------------------------- */

/* 2026-08-01 is a Saturday; 2026-08-05 a Wednesday. Only used by the composer's own day presets
   now — the timeline itself picks dates with the same exact-date scroller the roster grid uses. */

test("the coming weekend is this Saturday, and a Sunday's weekend is the day itself",()=>{
  assert.deepEqual(weekendDates("2026-08-05"),["2026-08-08","2026-08-09"]);
  assert.deepEqual(weekendDates("2026-08-02"),["2026-08-02"]);
});
