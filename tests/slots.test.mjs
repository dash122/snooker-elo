import test from "node:test";
import assert from "node:assert/strict";
import { conditionChips, handoffMessage, hasConditions, shareMessage, slotStatus, sortPostedSlots,
  visiblePostedSlots, whatsappShareUrl } from "../lib/slots.ts";

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
