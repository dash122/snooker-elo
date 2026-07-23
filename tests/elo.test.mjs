import test from "node:test";
import assert from "node:assert/strict";

function calculate({ra,rb,official,actual,c=8,cap=200,k=24,score,scoreA=4,scoreB=0}) {
  const extra=actual-(official??0);
  const adjustment=Math.max(-cap,Math.min(cap,c*actual));
  const expected=1/(1+10**(((rb+adjustment)-ra)/400));
  const total=scoreA+scoreB;
  const result=score??(scoreA===scoreB?.5:scoreA>scoreB?1:0);
  const frameShare=total?scoreA/total:.5;
  const frameEvidence=Math.min(total,20);
  const matchDelta=k*(result-expected);
  const frameDelta=(k/5)*frameEvidence*(frameShare-expected);
  const delta=matchDelta+frameDelta;
  return {extra,adjustment,expected,delta,other:-delta,frameEvidence,matchDelta,frameDelta};
}
test("official handicap is reference-only",()=>assert.equal(calculate({ra:1500,rb:1500,official:8,actual:0}).expected,.5));
test("missing official handicap is neutral",()=>assert.equal(calculate({ra:1500,rb:1500,official:null,actual:4}).extra,4));
test("adjustment is capped after conversion",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:100}).adjustment,200));
test("draw at even odds changes neither rating",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,score:.5,scoreA:3,scoreB:3}).delta,0));
test("rating change is zero sum",()=>{const r=calculate({ra:1510,rb:1490,official:2,actual:5});assert.equal(r.delta+r.other,0)});
test("additive frame evidence makes 7-0 worth more than 4-0 and 2-0",()=>{
  const d2=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:2,scoreB:0}).delta;
  const d4=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:4,scoreB:0}).delta;
  const d7=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:7,scoreB:0}).delta;
  assert.ok(d7>d4&&d4>d2);
});
test("70-70 historical aggregate is neutral at even expectation",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:70,scoreB:70}).delta,0));
test("opposite 70-0 batches from the same even baseline are equal and opposite",()=>{
  const win=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:70,scoreB:0}).delta;
  const loss=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:0,scoreB:70}).delta;
  assert.equal(win,-loss);
});
test("frame evidence is capped at 20",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:70,scoreB:0}).frameEvidence,20));
test("fair handicap inversion targets an even expectation without official handicap",()=>{
  const ratingA=1580,ratingB=1500,official=6,conversion=8;
  const suggested=(ratingA-ratingB)/conversion;
  assert.equal(suggested,10);
  assert.equal(calculate({ra:ratingA,rb:ratingB,official,actual:suggested}).expected,.5);
});
