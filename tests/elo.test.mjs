import test from "node:test";
import assert from "node:assert/strict";
import { calculateSnookerElo } from "../lib/snooker-elo.ts";

test("matches the PDF example",()=>{
  const result=calculateSnookerElo({ratingA:1500,ratingB:1550,handicapA:2,framesA:5,framesB:3});
  assert.equal(result.expectedFramesA,4);
  assert.equal(Math.round(result.scale*10)/10,88.2);
  assert.equal(Math.round(result.deltaA*10)/10,44.3);
});

test("handicap increases Player A's expected frames",()=>{
  const level=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:4,framesB:4});
  const receiving=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:2,framesA:4,framesB:4});
  assert.ok(receiving.expectedFramesA>level.expectedFramesA);
});

test("uses match length scaling and a result bonus",()=>{
  const short=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:3,framesB:0});
  const long=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:6,framesB:0});
  assert.equal(short.bonus,6);
  assert.equal(long.bonus,12);
  assert.ok(long.scale>short.scale);
});

test("draws have no match-result bonus",()=>{
  const result=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:4,framesB:4});
  assert.equal(result.bonus,0);
  assert.equal(result.deltaA,0);
});

test("reversing the result reverses the rating change",()=>{
  const win=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:5,framesB:3});
  const loss=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:3,framesB:5});
  assert.equal(win.deltaA,-loss.deltaA);
});

test("zero-frame input is neutral",()=>{
  assert.deepEqual(calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:0,framesB:0}),{
    probabilityA:.5,expectedFramesA:0,scale:0,performance:0,bonus:0,deltaA:0,
  });
});
