import test from "node:test";
import assert from "node:assert/strict";
import {bestCommonWindow,formationStatus,opportunityScore,venuesCompatible,viableOverlap} from "../lib/matchmaking-formation.ts";

const at=time=>`2026-09-01T${time}:00.000Z`;

test("formation status separates merely forming, playable, and full",()=>{
  assert.equal(formationStatus(1,4),"forming");
  assert.equal(formationStatus(2,4),"playable");
  assert.equal(formationStatus(4,4),"full");
});

test("an unspecified venue stays compatible",()=>{
  assert.equal(venuesCompatible(null,"scaa"),true);
  assert.equal(venuesCompatible("scaa",null),true);
  assert.equal(venuesCompatible("scaa","scaa"),true);
  assert.equal(venuesCompatible("scaa","other"),false);
});

test("viable overlap enforces the one-hour product rule",()=>{
  assert.equal(viableOverlap([{startAt:at("19:00"),endAt:at("20:00")}],[{startAt:at("19:30"),endAt:at("20:30")}]).length,0);
  assert.deepEqual(viableOverlap([{startAt:at("19:00"),endAt:at("21:30")}],[{startAt:at("20:00"),endAt:at("22:00")}]),[{startAt:at("20:00"),endAt:at("21:30")}]);
});

test("best common window counts only players who cover the same full hour",()=>{
  const anchor={id:"a",playerId:"host",startAt:at("19:00"),endAt:at("23:00"),venueId:null};
  const slots=[
    anchor,
    {id:"v",playerId:"viewer",startAt:at("19:30"),endAt:at("22:30"),venueId:null},
    {id:"b",playerId:"b",startAt:at("20:00"),endAt:at("21:00"),venueId:"scaa"},
    {id:"c",playerId:"c",startAt:at("20:00"),endAt:at("21:00"),venueId:null},
    {id:"d",playerId:"d",startAt:at("21:00"),endAt:at("22:00"),venueId:null},
  ];
  assert.deepEqual(bestCommonWindow(anchor,"viewer",slots),{startAt:at("20:00"),endAt:at("21:00"),playerIds:["b","c","host","viewer"]});
});

test("opportunity ranking rewards real group formation and longer overlap",()=>{
  const pair=opportunityScore({compatiblePlayers:2,overlapMinutes:60,eloDifference:40,recentMatches:0});
  const group=opportunityScore({compatiblePlayers:4,overlapMinutes:180,eloDifference:40,recentMatches:0});
  assert.ok(group>pair);
});
