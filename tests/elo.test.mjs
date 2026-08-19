import test from "node:test";
import assert from "node:assert/strict";
import { calculateSnookerElo } from "../lib/snooker-elo.ts";
import { replay } from "../lib/elo-replay.ts";
import { resolveOnboardingRating } from "../lib/onboarding.ts";
import { checkDisplayName, checkEmail, checkUsername, checkDisallowedText } from "../app/api/account/validate.ts";

test("matches the new PDF worked example",()=>{
  const result=calculateSnookerElo({ratingA:1600,ratingB:1450,handicapA:-5,framesA:5,framesB:1,repetitionCount:3});
  assert.equal(Math.round(result.expectedFramesA*100)/100,3.43);
  assert.equal(Math.round(result.scale*100)/100,111.29);
  assert.equal(Math.round(result.compressionWidth*1000)/1000,2.887);
  assert.equal(Math.round(result.repetitionFactor*1000)/1000,.743);
  assert.equal(Math.round(result.deltaA*100)/100,41.03);
});

test("handicap increases Player A's expected frames",()=>{
  const level=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:4,framesB:4});
  const receiving=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:2,framesA:4,framesB:4});
  assert.ok(receiving.expectedFramesA>level.expectedFramesA);
});

test("an explicit rating-sensitive handicap conversion takes precedence over 25H",()=>{
  const dynamic=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:2,handicapEloPerPoint:14,handicapPointsToElo:25,framesA:4,framesB:4});
  const legacy=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:2,handicapPointsToElo:25,framesA:4,framesB:4});
  assert.ok(dynamic.expectedFramesA<legacy.expectedFramesA);
});

test("uses match length scaling without a separate result bonus",()=>{
  const short=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:3,framesB:0});
  const long=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:6,framesB:0});
  assert.equal(short.bonus,0);
  assert.equal(long.bonus,0);
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
    probabilityA:.5,expectedFramesA:0,scale:0,compressionWidth:3,repetitionFactor:1,performance:0,bonus:0,deltaA:0,
  });
});

test("the logarithmic scaling numerator and denominator are configurable",()=>{
  const custom=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:5,framesB:3,frameScaleCoefficient:100,frameScaleNumeratorOffset:15,frameScaleDenominator:10});
  assert.equal(Math.round(custom.scale*10)/10,83.3);
});

test("adaptive compression width constants are configurable",()=>{
  const result=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:5,framesB:3,compressionWidthBase:6,compressionWidthExponent:.2});
  assert.equal(Math.round(result.compressionWidth*1000)/1000,5.664);
});

test("handicapEloScale is configurable",()=>{
  const wide=calculateSnookerElo({ratingA:1600,ratingB:1500,handicapA:0,framesA:4,framesB:4,handicapEloScale:1000});
  const narrow=calculateSnookerElo({ratingA:1600,ratingB:1500,handicapA:0,framesA:4,framesB:4,handicapEloScale:500});
  assert.ok(wide.probabilityA<narrow.probabilityA);
});

test("a fully-effective fair handicap makes probability exactly even",()=>{
  const result=calculateSnookerElo({ratingA:1800,ratingB:1500,handicapA:-12,framesA:4,framesB:4,handicapEffectiveness:1});
  assert.ok(Math.abs(result.probabilityA-.5)<1e-9);
});

test("reduced handicap effectiveness leaves the stronger player a residual edge",()=>{
  const result=calculateSnookerElo({ratingA:1800,ratingB:1500,handicapA:-12,framesA:4,framesB:4,handicapEffectiveness:.7});
  assert.ok(result.probabilityA>.5);
});

test("a larger ELO gap leaves a larger residual edge at the same effectiveness",()=>{
  const smallGap=calculateSnookerElo({ratingA:1600,ratingB:1500,handicapA:-4,framesA:4,framesB:4,handicapEffectiveness:.7});
  const bigGap=calculateSnookerElo({ratingA:1900,ratingB:1500,handicapA:-16,framesA:4,framesB:4,handicapEffectiveness:.7});
  assert.ok((bigGap.probabilityA-.5)>(smallGap.probabilityA-.5));
});

test("repetition decay reduces repeated-match rating changes",()=>{
  const first=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:5,framesB:3,repetitionCount:0});
  const repeated=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:5,framesB:3,repetitionCount:7});
  assert.equal(Math.round(repeated.deltaA*100)/100,Math.round(first.deltaA*.5*100)/100);
});

test("changing a starting ELO recalculates historical match deltas",()=>{
  const player=(id,rating)=>({id,name:id,short:id,handicap:null,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]});
  const match={id:"m1",a:"new",b:"opponent",scoreA:1,scoreB:0,playedOn:"2026-01-01",actual:0,giver:null,official:null,extra:0,expectedA:0,beforeA:0,beforeB:0,afterA:0,afterB:0,deltaA:0,status:"confirmed",createdAt:"2026-01-01T12:00:00.000Z"};
  const settings={start:1500};
  const original=replay([player("new",1500),player("opponent",1580)],[match],settings);
  const rebased=replay([player("new",1100),player("opponent",1580)],[match],settings);
  assert.equal(rebased.matches[0].beforeA,1100);
  assert.ok(rebased.matches[0].deltaA>original.matches[0].deltaA);
  assert.equal(rebased.players.find(item=>item.id==="new").rating,1100+rebased.matches[0].deltaA);
});

test("onboarding re-bases the live rating when past matches already exist",()=>{
  const existing = resolveOnboardingRating({ currentRating: 1534, initialRating: 1500, hasHistoricMatches: true, finalRating: 1100 });
  assert.equal(existing.shouldOverrideCurrentRating, true);
  assert.equal(existing.rating, 1100);
  assert.equal(existing.initialRating, 1100);
  assert.equal(existing.preliminaryRating, 1100);

  const newMember = resolveOnboardingRating({ currentRating: 1500, initialRating: 1500, hasHistoricMatches: false, finalRating: 1800 });
  assert.equal(newMember.shouldOverrideCurrentRating, true);
  assert.equal(newMember.rating, 1800);
  assert.equal(newMember.initialRating, 1800);
  assert.equal(newMember.preliminaryRating, 1800);
});

test("signup validation follows the current club rules",()=>{
  assert.equal(checkUsername("alice"),null);
  assert.equal(checkUsername("alice_123"),"username-format");
  assert.equal(checkUsername("alic123"),null);
  assert.equal(checkUsername("alice.."),null);
  assert.equal(checkDisplayName("Tom! 1"),null);
  assert.equal(checkDisplayName("bad!!!"),null);
  assert.equal(checkDisplayName(""),"display-name-format");
  assert.equal(checkEmail("player@example.com"),null);
  assert.equal(checkEmail("player@example.org"),null);
  assert.equal(checkEmail("plain-text"),"email-format");
  assert.equal(checkDisallowedText("idiot"),"disallowed-text");
  assert.equal(checkDisallowedText("Tom! 1"),null);
});
