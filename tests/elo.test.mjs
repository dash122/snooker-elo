import test from "node:test";
import assert from "node:assert/strict";

function calculate({ra,rb,official,actual,c=8,cap=200,k=24,score=1,scoreA=4,scoreB=0}) {
  const extra=actual-(official??0);
  const adjustment=Math.max(-cap,Math.min(cap,c*extra));
  const expected=1/(1+10**(((rb+adjustment)-ra)/400));
  const total=scoreA+scoreB;
  const multiplier=scoreA===scoreB||total===0?1:1+Math.abs(scoreA-scoreB)/total;
  const delta=k*(score-expected)*multiplier;
  return {extra,adjustment,expected,delta,other:-delta,multiplier};
}
test("normal handicap yields an even expectation",()=>assert.equal(calculate({ra:1500,rb:1500,official:8,actual:8}).expected,.5));
test("missing official handicap is neutral",()=>assert.equal(calculate({ra:1500,rb:1500,official:null,actual:4}).extra,4));
test("adjustment is capped after conversion",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:100}).adjustment,200));
test("draw at even odds changes neither rating",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,score:.5,scoreA:3,scoreB:3}).delta,0));
test("rating change is zero sum",()=>{const r=calculate({ra:1510,rb:1490,official:2,actual:5});assert.equal(r.delta+r.other,0)});
test("frame margin scales a 4-0 win to 2x",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0}).multiplier,2));
test("frame margin scales a 4-2 win to 1.33x",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:4,scoreB:2}).multiplier,4/3));
test("fair handicap inversion targets an even expectation",()=>{
  const ratingA=1580,ratingB=1500,official=6,conversion=8;
  const suggested=official+(ratingA-ratingB)/conversion;
  assert.equal(suggested,16);
  assert.equal(calculate({ra:ratingA,rb:ratingB,official,actual:suggested}).expected,.5);
});
