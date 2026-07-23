import test from "node:test";
import assert from "node:assert/strict";

function calculate({ra,rb,official,actual,c=8,cap=200,k=24,score=1}) {
  const extra=actual-(official??0);
  const adjustment=Math.max(-cap,Math.min(cap,c*extra));
  const expected=1/(1+10**(((rb+adjustment)-ra)/400));
  const delta=k*(score-expected);
  return {extra,adjustment,expected,delta,other:-delta};
}
test("normal handicap yields an even expectation",()=>assert.equal(calculate({ra:1500,rb:1500,official:8,actual:8}).expected,.5));
test("missing official handicap is neutral",()=>assert.equal(calculate({ra:1500,rb:1500,official:null,actual:4}).extra,4));
test("adjustment is capped after conversion",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:100}).adjustment,200));
test("draw at even odds changes neither rating",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,score:.5}).delta,0));
test("rating change is zero sum",()=>{const r=calculate({ra:1510,rb:1490,official:2,actual:5});assert.equal(r.delta+r.other,0)});
