import test from "node:test";
import assert from "node:assert/strict";

function calculate({ra,rb,official,actual,c=8,curve=1.25,softCap=800,k=24,bonus=.5,boost=.75,boostScale=200,scoreA=4,scoreB=0}) {
  const extra=actual-(official??0);
  const raw=actual===0?0:Math.sign(actual)*c*10*(Math.abs(actual)/10)**curve;
  const adjustment=softCap*Math.tanh(raw/softCap);
  const expected=1/(1+10**(((rb+adjustment)-ra)/400));
  const total=scoreA+scoreB;
  const frameEvidence=Math.min(total,20);
  const performance=scoreA===scoreB?.5:scoreA>scoreB?(scoreA+bonus)/(total+bonus):scoreA/(total+bonus);
  const weight=frameEvidence<4?frameEvidence/4:Math.sqrt(frameEvidence/4);
  const baseDelta=k*weight*(performance-expected);
  const ratingDifference=ra-rb;
  const performerIsA=performance>.5||(performance===.5&&expected<.5);
  const overHandicapElo=performerIsA?Math.max(0,adjustment-ratingDifference):Math.max(0,ratingDifference-adjustment);
  const performanceMargin=performance===.5?.6:.6+.4*Math.min(1,Math.abs(performance-.5)/.5);
  const multiplier=1+boost*Math.min(1,weight)*(1-Math.exp(-overHandicapElo/boostScale))*performanceMargin;
  const delta=baseDelta*multiplier;
  return {extra,adjustment,expected,performance,weight,delta,other:-delta,frameEvidence,overHandicapElo,multiplier};
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
test("winning while giving beyond the fair handicap earns an explicit multiplier",()=>{
  const fair=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:3,scoreB:2});
  const over=calculate({ra:1500,rb:1500,official:0,actual:20,scoreA:3,scoreB:2});
  assert.equal(fair.multiplier,1);
  assert.ok(over.overHandicapElo>0&&over.multiplier>1&&over.delta>fair.delta);
});
test("a favourite winning without excess handicap gets no multiplier",()=>{
  const result=calculate({ra:1700,rb:1500,official:0,actual:0,scoreA:3,scoreB:2});
  assert.equal(result.overHandicapElo,0);
  assert.equal(result.multiplier,1);
});
test("drawing under excess handicap receives a positive boosted reward",()=>{
  const result=calculate({ra:1500,rb:1500,official:0,actual:20,scoreA:3,scoreB:3});
  assert.ok(result.delta>0&&result.multiplier>1);
});
test("evidence weight scales linearly below 4 frames and matches the old sqrt curve at and above it",()=>{
  assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:1,scoreB:0}).weight,.25);
  assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:2,scoreB:0}).weight,.5);
  assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:4,scoreB:0}).weight,1);
  assert.equal(calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:16,scoreB:0}).weight,2);
});
test("a single frame moves rating half as much as the old formula would have",()=>{
  const oldWeight=Math.sqrt(1/4);
  const result=calculate({ra:1500,rb:1500,official:0,actual:0,scoreA:1,scoreB:0});
  assert.ok(result.weight<=oldWeight/2);
});
test("a generous handicap can't earn its full over-handicap multiplier off a single frame",()=>{
  const oneFrame=calculate({ra:1500,rb:1500,official:0,actual:20,scoreA:1,scoreB:0});
  const fullMatch=calculate({ra:1500,rb:1500,official:0,actual:20,scoreA:4,scoreB:0});
  assert.ok(oneFrame.overHandicapElo>0);
  assert.ok(oneFrame.multiplier<fullMatch.multiplier);
});
test("a receiving player who loses a single big-handicap frame loses much less than the pre-fix formula would",()=>{
  // Mirrors Joe Tang's 07-20 match: his opponent (ra) gave him (rb) 40 points
  // — about +410 ELO of adjustment — then still won the only frame played.
  // Under the old sqrt(frameEvidence/4) weight with no multiplier scaling
  // this cost Joe about -23 ELO for one frame; the fix brings it under -10.
  const result=calculate({ra:1194,rb:1000,official:0,actual:40,k:40,scoreA:1,scoreB:0});
  assert.ok(-result.delta<10,`expected receiving player's loss under ~10 ELO, got ${-result.delta}`);
});
