import test from "node:test";
import assert from "node:assert/strict";
import { BASE_RATE, DEFAULT_QUORUM, MAX_QUORUM, MIN_QUORUM, forecastHeadline, forecastNight,
  isConfidence, nightWindow, normaliseQuorum, promotionsFor, rateFor, recencyWeight,
  stillNeeded } from "../lib/nights.ts";

const NIGHT = "2026-09-01T11:00:00.000Z";        // 19:00 HK on 1 Sep
const at = (hoursBefore) => new Date(Date.parse(NIGHT) - hoursBefore * 3_600_000).toISOString();
const now = Date.parse(NIGHT) - 3_600_000;        // one hour before the band opens
const signal = (playerId, confidence, over = {}) => ({ playerId, confidence, setAt: at(2), ...over });
const forecast = (signals, over = {}) => forecastNight({ signals, nightStart: NIGHT, now, ...over });

/* --- Thresholds are the member's own -------------------------------------- */

test("a threshold is clamped into range, and anything malformed becomes no condition at all",()=>{
  assert.equal(normaliseQuorum(3),3);
  assert.equal(normaliseQuorum("4"),4,"form fields arrive as strings");
  assert.equal(normaliseQuorum(1),MIN_QUORUM,"below two there is no game to be had");
  assert.equal(normaliseQuorum(99),MAX_QUORUM);
  assert.equal(normaliseQuorum(2.4),2,"a fractional person is not a threshold");
  for(const bad of [null,undefined,"","abc",NaN,{}]){
    assert.equal(normaliseQuorum(bad),null,`${String(bad)} must never become a silent promise to attend`);
  }
  assert.ok(DEFAULT_QUORUM>=MIN_QUORUM);
});

test("only the four confidence levels are accepted",()=>{
  for(const level of ["high","mid","low","out"])assert.ok(isConfidence(level));
  for(const bad of ["going","maybe","","HIGH",null,2])assert.equal(isConfidence(bad),false);
});

/* --- What a level is worth ------------------------------------------------ */

test("a member's own history replaces the club prior only once there is enough of it",()=>{
  assert.equal(rateFor("mid",null),BASE_RATE.mid,"no history at all");
  assert.equal(rateFor("mid",{mid:0.9,sampleN:2}),BASE_RATE.mid,"two evenings is not a pattern");
  assert.equal(rateFor("mid",{mid:0.9,sampleN:12}),0.9,"a reliable hedger is counted as one");
  assert.equal(rateFor("mid",{mid:0.1,sampleN:12}),0.1,"and an optimist is quietly counted as fewer");
  assert.equal(rateFor("mid",{mid:null,sampleN:40}),BASE_RATE.mid,"sample from another level does not transfer");
  assert.equal(rateFor("out",{high:1,sampleN:99}),0,"唔得 is always zero");
});

test("a stale signal loses weight instead of becoming a lie",()=>{
  assert.equal(recencyWeight(at(1),NIGHT,now),1,"set an hour before kick-off");
  assert.equal(recencyWeight(at(4),NIGHT,now),1,"still inside the full-weight window");
  const twoDays=recencyWeight(at(48),NIGHT,now);
  const week=recencyWeight(at(24*7),NIGHT,now);
  assert.ok(twoDays<1&&twoDays>week,"older signals weigh less");
  assert.ok(week>0.5,"but never decay to nothing — nobody has to come back and refresh");
});

/* --- 夠人就去 ------------------------------------------------------------- */

test("a threshold promotes once the floor reaches it",()=>{
  const signals=[signal("a","high"),signal("b","high"),signal("c","low",{upgradeAt:2})];
  assert.deepEqual(promotionsFor(signals),["c"]);
});

test("nobody is promoted while their own threshold is unmet",()=>{
  assert.deepEqual(promotionsFor([signal("a","high"),signal("c","low",{upgradeAt:4})]),[]);
});

test("promotion cascades: three who would each not have gone alone all go",()=>{
  const signals=[
    signal("anchor","high"),
    signal("x","low",{upgradeAt:2}),   // promoted by the anchor, floor -> 2
    signal("y","mid",{upgradeAt:2}),   // promoted by x,           floor -> 3
    signal("z","low",{upgradeAt:3}),   // promoted by y
  ];
  assert.deepEqual(promotionsFor(signals).sort(),["x","y","z"]);
});

test("the cascade is deterministic regardless of row order",()=>{
  const rows=[signal("z","low",{upgradeAt:3}),signal("y","mid",{upgradeAt:2}),signal("anchor","high"),signal("x","low",{upgradeAt:2})];
  assert.deepEqual(promotionsFor(rows).sort(),["x","y","z"]);
});

test("唔得 never promotes and never counts toward anybody else's threshold",()=>{
  const signals=[signal("a","high"),signal("b","high"),signal("x","out",{upgradeAt:2}),signal("c","low",{upgradeAt:2})];
  const promoted=promotionsFor(signals);
  assert.ok(!promoted.includes("x"),"a member who declined is not dragged back in");
  assert.deepEqual(promoted,["c"]);
});

test("with no anchor at all, thresholds alone cannot bootstrap a night",()=>{
  assert.deepEqual(promotionsFor([signal("a","low",{upgradeAt:2}),signal("b","low",{upgradeAt:2})]),[],
    "two people each waiting for two others is correctly a stalemate, not a phantom quorum");
});

/* --- The forecast --------------------------------------------------------- */

test("the floor counts only commitments, and promotions join it",()=>{
  const f=forecast([signal("a","high"),signal("b","high"),signal("c","low",{upgradeAt:2}),signal("d","mid")]);
  assert.equal(f.floor,3,"two declared plus one promoted");
  assert.deepEqual(f.promoted,["c"]);
  assert.equal(f.counts.mid,1);
});

test("the range is floored at the number already committed",()=>{
  const f=forecast([signal("a","high"),signal("b","high"),signal("c","high")]);
  assert.equal(f.floor,3);
  assert.ok(f.lo>=3,"arithmetic must never un-attend somebody who has committed");
});

test("hedges widen the range without inflating the floor",()=>{
  const f=forecast([signal("a","high"),signal("b","mid"),signal("c","mid"),signal("d","low")]);
  assert.equal(f.floor,1,"a hedge is not a commitment");
  assert.ok(f.hi>f.lo,"but it is real upside");
  assert.ok(f.expected>1&&f.expected<4);
});

test("an empty night is reported as empty rather than as a small number",()=>{
  const f=forecast([]);
  assert.equal(f.floor,0);
  assert.equal(f.expected,0);
  assert.equal(f.chanceOfGame,0);
  assert.equal(f.band,"low");
  assert.equal(forecastHeadline(f),"暫時未有人回覆");
});

test("members who said 唔得 are removed from the forecast entirely",()=>{
  const f=forecast([signal("a","high"),signal("b","out"),signal("c","out")]);
  assert.equal(f.counts.out,2);
  assert.equal(f.counts.high,1);
  assert.ok(f.expected<1.1,"declining actually removes you, rather than counting you at a discount");
});

test("two committed members make a game near-certain; two hedges do not",()=>{
  const sure=forecast([signal("a","high"),signal("b","high")]);
  const hedged=forecast([signal("a","low"),signal("b","low")]);
  assert.ok(sure.chanceOfGame>0.75&&sure.band==="high");
  assert.ok(hedged.chanceOfGame<0.2&&hedged.band==="low","and the product says so instead of promising a room");
});

test("the same declared levels forecast lower for a member who historically does not turn up",()=>{
  const signals=[signal("a","high"),signal("flake","mid")];
  const neutral=forecast(signals);
  const known=forecast(signals,{calibrations:{flake:{mid:0.05,sampleN:20}}});
  assert.ok(known.expected<neutral.expected,"self-calibrating, and nobody had to be honest");
  assert.equal(known.floor,neutral.floor,"and it never touches what they declared");
});

test("the headline always leads with the reliable half",()=>{
  const f=forecast([signal("a","high"),signal("b","high"),signal("c","mid"),signal("d","mid")]);
  const headline=forecastHeadline(f);
  assert.match(headline,/^2 人確定/,"the number a member can act on comes first");
  assert.match(headline,/估/,"and the optimistic half is explicitly an estimate");
});

test("the conditional pool is surfaced so a reader can see their tap might tip it",()=>{
  const f=forecast([signal("a","high"),signal("b","low",{upgradeAt:4}),signal("c","low",{upgradeAt:4})]);
  assert.equal(f.conditional,2);
  assert.equal(stillNeeded(4,f.floor),3);
  assert.equal(stillNeeded(2,5),null,"already met");
  assert.equal(stillNeeded(null,0),null,"no condition set");
});

/* --- Nights exist without anybody opening them ---------------------------- */

test("a night is derived from a date, in Hong Kong time",()=>{
  const { startAt, endAt } = nightWindow("2026-09-01");
  assert.equal(startAt,"2026-09-01T19:00:00+08:00");
  assert.ok(Date.parse(endAt)>Date.parse(startAt));
});
