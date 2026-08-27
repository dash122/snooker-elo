import test from "node:test";
import assert from "node:assert/strict";
import { calculateSnookerElo } from "../lib/snooker-elo.ts";
import { replay } from "../lib/elo-replay.ts";
import { resolveOnboardingRating } from "../lib/onboarding.ts";
import { checkDisplayName, checkEmail, checkUsername, checkDisallowedText } from "../app/api/account/validate.ts";

test("matches the worked example with a fully effective handicap",()=>{
  const result=calculateSnookerElo({ratingA:1600,ratingB:1450,handicapA:-5,framesA:5,framesB:1,repetitionCount:3});
  assert.equal(Math.round(result.expectedFramesA*100)/100,3.17);
  assert.equal(result.scale,300);
  assert.equal(Math.round(result.confidence*1000)/1000,.545);
  assert.equal(Math.round(result.repetitionFactor*1000)/1000,.743);
  assert.equal(Math.round(result.deltaA*100)/100,37.03);
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

test("uses diminishing confidence for match length without a separate result bonus",()=>{
  const short=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:3,framesB:0});
  const long=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:6,framesB:0});
  assert.equal(short.bonus,0);
  assert.equal(long.bonus,0);
  assert.ok(long.confidence>short.confidence);
  assert.ok(long.deltaA>short.deltaA);
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
    probabilityA:.5,expectedFramesA:0,scale:300,compressionWidth:3,repetitionFactor:1,actualFrameShare:.5,confidence:0,performance:0,bonus:0,deltaA:0,
  });
});

test("zero-score match previews update their frame-share forecast for handicap changes",()=>{
  const level=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:0,framesB:0});
  const receiving=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:5,framesA:0,framesB:0});
  const giving=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:-5,framesA:0,framesB:0});
  assert.ok(receiving.probabilityA>level.probabilityA);
  assert.ok(giving.probabilityA<level.probabilityA);
  assert.equal(receiving.deltaA,0);
  assert.equal(giving.deltaA,0);
});

test("performance sensitivity is configurable",()=>{
  const standard=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:5,framesB:3});
  const half=calculateSnookerElo({ratingA:1500,ratingB:1500,handicapA:0,framesA:5,framesB:3,frameScaleCoefficient:150});
  assert.equal(half.deltaA,standard.deltaA/2);
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

test("excess handicap becomes progressively more decisive beyond the fair recommendation",()=>{
  // Handicap indexes 32 and 49 imply a 17-point fair start and a 425-ELO rating gap.
  const fair=calculateSnookerElo({ratingA:1925,ratingB:1500,handicapA:-17,framesA:0,framesB:0,handicapEloScale:1250});
  const excessive=calculateSnookerElo({ratingA:1925,ratingB:1500,handicapA:-35,framesA:0,framesB:0,handicapEloScale:1250});
  assert.ok(Math.abs(fair.probabilityA-.5)<1e-9);
  assert.ok(excessive.probabilityA>.19&&excessive.probabilityA<.21);
});

test("the excess-handicap curve is symmetric",()=>{
  const giving=calculateSnookerElo({ratingA:1925,ratingB:1500,handicapA:-35,framesA:0,framesB:0,handicapEloScale:1250});
  const receiving=calculateSnookerElo({ratingA:1500,ratingB:1925,handicapA:35,framesA:0,framesB:0,handicapEloScale:1250});
  assert.ok(Math.abs(giving.probabilityA-(1-receiving.probabilityA))<1e-12);
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

/* The repetition window is what the replay's meeting index has to reproduce exactly: a rematch
   inside 30 days is damped, one outside it is not, and the pairing is order-independent. */
const replayPlayer=(id,rating)=>({id,name:id,short:id,handicap:null,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]});
const replayMatch=(id,a,b,playedOn)=>({id,a,b,scoreA:3,scoreB:1,playedOn,actual:0,giver:null,official:null,extra:0,expectedA:0,beforeA:0,beforeB:0,afterA:0,afterB:0,deltaA:0,status:"confirmed",createdAt:`${playedOn}T12:00:00.000Z`});

test("a rematch inside the repetition window is damped, and one beyond it is not",()=>{
  const roster=()=>[replayPlayer("a",1500),replayPlayer("b",1500)];
  const near=replay(roster(),[replayMatch("m1","a","b","2026-01-01"),replayMatch("m2","a","b","2026-01-20")],{start:1500});
  const far=replay(roster(),[replayMatch("m1","a","b","2026-01-01"),replayMatch("m2","a","b","2026-03-20")],{start:1500});
  assert.ok(near.matches[1].deltaA<far.matches[1].deltaA);
});

test("repetition counts the same pairing with the sides reversed",()=>{
  const roster=()=>[replayPlayer("a",1500),replayPlayer("b",1500)];
  const repeated=replay(roster(),[replayMatch("m1","a","b","2026-01-01"),replayMatch("m2","b","a","2026-01-10")],{start:1500});
  const fresh=replay(roster(),[replayMatch("m1","a","b","2026-01-01"),replayMatch("m2","b","a","2026-06-10")],{start:1500});
  assert.ok(Math.abs(repeated.matches[1].deltaA)<Math.abs(fresh.matches[1].deltaA));
});

/* Replay runs on the client for every load and every save, so quadratic growth here shows up as a
   club that can no longer open the app once it has a few thousand results behind it. */
test("replay stays linear enough for a full club history",()=>{
  const size=24;
  const players=Array.from({length:size},(_,index)=>replayPlayer(`p${index}`,1500));
  const matches=Array.from({length:4000},(_,index)=>{
    const a=index%size;
    const b=(index*7+1)%size;
    const playedOn=new Date(Date.UTC(2024,0,1)+(index%600)*864e5).toISOString().slice(0,10);
    return replayMatch(`m${index}`,`p${a}`,`p${b===a?(b+1)%size:b}`,playedOn);
  });
  const started=performance.now();
  const rebuilt=replay(players,matches,{start:1500});
  assert.equal(rebuilt.matches.length,4000);
  assert.ok(performance.now()-started<2000,"4000 matches should replay in well under two seconds");
});
