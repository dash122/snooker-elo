import test from "node:test";
import assert from "node:assert/strict";
import { breakNudge } from "../lib/break-nudge.ts";

const today="2026-09-24";
const board=(values)=>values.map((value,i)=>({playerId:`p${i+1}`,value,date:"2026-09-20"}));

test("leader is pushed to beat their own record",()=>{
  assert.deepEqual(breakNudge(board([51,44,38]),"p1",today),{kind:"top",target:52,current:51,runnerUp:44});
});
test("mid-board player is told the score to pass the next player and to reach the top",()=>{
  assert.deepEqual(breakNudge(board([51,44,38,32,29]),"p4",today),{kind:"climb",target:38,current:32,position:4,nextPosition:3,topTarget:51});
});
test("player off a full board needs to match tenth place",()=>{
  const nudge=breakNudge(board([60,55,50,45,40,35,30,25,20,17]),"me",today);
  assert.deepEqual(nudge,{kind:"enter",target:17,lastValue:17});
});
test("player off a board with open slots can get on with any break",()=>{
  assert.deepEqual(breakNudge(board([30,20]),"me",today),{kind:"open",openSlots:8});
});
test("a break about to leave the 30-day window is flagged",()=>{
  const entries=[{playerId:"a",value:40,date:"2026-09-20"},{playerId:"me",value:17,date:"2026-08-27"}];
  assert.deepEqual(breakNudge(entries,"me",today),{kind:"expiring",target:17,current:17,position:2,daysLeft:2});
});
