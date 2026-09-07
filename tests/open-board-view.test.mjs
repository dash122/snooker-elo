import test from "node:test";
import assert from "node:assert/strict";
import {closestOpponent,hasSimilarOpponent,opponentFit,rankRecommendedCalls} from "../lib/open-board-view.ts";
import {suggestedHandicap} from "../lib/handicap.ts";

test("similar ELO includes both ±200 boundaries and excludes players outside them",()=>{
  for(const rating of [1400,1600,1800])assert.equal(hasSimilarOpponent([{id:"other",rating}],"me",1600),true);
  for(const rating of [1399,1801])assert.equal(hasSimilarOpponent([{id:"other",rating}],"me",1600),false);
});
test("similar ELO compares other participants, never the viewer's own entry",()=>{
  assert.equal(hasSimilarOpponent([{id:"me",rating:1600},{id:"other",rating:2000}],"me",1600),false);
  assert.equal(hasSimilarOpponent([{id:"other",rating:1600}],null,1600),false);
  assert.equal(hasSimilarOpponent([{id:"other",rating:1600}],"me",null),false);
  assert.equal(hasSimilarOpponent([{id:"other",rating:1600}],"me",NaN),false);
});
test("a multi-player group qualifies if at least one other participant is similar",()=>{
  assert.equal(hasSimilarOpponent([{id:"high",rating:2100},{id:"near",rating:1500}],"me",1600),true);
});
test("the closest opponent is surfaced even when they are not the host",()=>{
  const players=[{id:"host",rating:2100},{id:"me",rating:1600},{id:"near",rating:1640}];
  assert.equal(closestOpponent(players,"me",1600)?.id,"near");
  assert.equal(closestOpponent([{id:"me",rating:1600}],"me",1600),null);
});
test("opponent fit uses explainable tiers instead of an opaque percentage",()=>{
  assert.deepEqual(opponentFit(1675,1600),{tier:"very-close",difference:75});
  assert.deepEqual(opponentFit(1800,1600),{tier:"similar",difference:200});
  assert.deepEqual(opponentFit(1801,1600),{tier:"handicap",difference:201});
  assert.deepEqual(opponentFit(undefined,1600),{tier:"unknown",difference:null});
});
test("recommendations prioritize joinable opponent fit before time fit",()=>{
  const calls=[
    {id:"time",players:[{id:"far",rating:1900}],joined:false,fits:true,startAt:"2026-09-08T10:00:00Z"},
    {id:"opponent",players:[{id:"near",rating:1620}],joined:false,fits:false,startAt:"2026-09-09T10:00:00Z"},
    {id:"mine",players:[{id:"nearer",rating:1601}],joined:true,fits:true,startAt:"2026-09-07T10:00:00Z"},
  ];
  assert.deepEqual(rankRecommendedCalls(calls,"me",1600).map(call=>call.id),["opponent","time","mine"]);
});
test("the displayed handicap score uses the leaderboard's configured baseline",()=>{
  const settings={start:1500,handicapPointsToElo:25,handicapMinimumElo:10,handicapSensitivityRange:20,handicapSensitivityWidth:150};
  assert.equal(suggestedHandicap({rating:1600},[],settings),56);
  assert.equal(suggestedHandicap({rating:1680},[],settings),53);
  assert.equal(suggestedHandicap({rating:1680},[],{...settings,start:1600}),57);
});
