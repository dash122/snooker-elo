import test from "node:test";
import assert from "node:assert/strict";

function calculate({ra,rb,official,actual,c=8,curve=1.25,softCap=800,k=24,bonus=.5,scoreA=4,scoreB=0}) {
  const extra=actual-(official??0);
  const raw=actual===0?0:Math.sign(actual)*c*10*(Math.abs(actual)/10)**curve;
  const adjustment=softCap*Math.tanh(raw/softCap);
  const expected=1/(1+10**(((rb+adjustment)-ra)/400));
  const total=scoreA+scoreB;
  const frameEvidence=Math.min(total,20);
  const performance=scoreA===scoreB?.5:scoreA>scoreB?(scoreA+bonus)/(total+bonus):scoreA/(total+bonus);
  const weight=Math.sqrt(frameEvidence/4);
  const delta=k*weight*(performance-expected);
  return {extra,adjustment,expected,performance,weight,delta,other:-delta,frameEvidence};
}
test("official handicap is reference-only",()=>assert.equal(calculate({ra:1500,rb:1500,official:8,actual:0}).expected,.5));
test("missing official handicap is neutral",()=>assert.equal(calculate({ra:1500,rb:1500,official:null,actual:4}).extra,4));
test("soft ceiling keeps extreme handicap finite",()=>assert.ok(calculate({ra:1500,rb:1500,official:0,actual:10000}).adjustment<=800));
test("draw at even odds changes neither rating",()=>assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:3,scoreB:3}).delta,0));
test("rating change is zero sum",()=>{const r=calculate({ra:1510,rb:1490,official:2,actual:5});assert.equal(r.delta+r.other,0)});
test("3-2 is only a modest step above a 3-3 draw",()=>{
  const draw=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:3,scoreB:3}).delta;
  const narrow=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:3,scoreB:2}).delta;
  assert.equal(draw,0);assert.ok(narrow>0&&narrow<5);
});
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
test("handicap difficulty grows disproportionately",()=>{
  const ten=calculate({ra:1500,rb:1500,official:0,actual:10}).adjustment;
  const twenty=calculate({ra:1500,rb:1500,official:0,actual:20}).adjustment;
  assert.ok(twenty>ten*2);
});
test("larger handicap lowers expectation and increases reward for the same win",()=>{
  const ten=calculate({ra:1500,rb:1500,official:0,actual:10,scoreA:3,scoreB:2});
  const twenty=calculate({ra:1500,rb:1500,official:0,actual:20,scoreA:3,scoreB:2});
  assert.ok(twenty.expected<ten.expected);
  assert.ok(twenty.delta>ten.delta);
});
