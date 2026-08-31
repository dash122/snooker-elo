import test from "node:test";
import assert from "node:assert/strict";
import {bestCommonWindow,formationStatus,opportunityScore,venuesCompatible,viableOverlap} from "../lib/matchmaking-formation.ts";

const at=time=>`2026-09-01T${time}:00.000Z`;

test("formation status confirms a game as soon as two players accept",()=>{
  assert.equal(formationStatus(1,2),"forming");
  assert.equal(formationStatus(2,2),"full");
  /* Legacy target sizes cannot turn the MVP back into a group session. */
  assert.equal(formationStatus(2,8),"full");
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

test("best common window uses only the anchor and requester",()=>{
  const anchor={id:"a",playerId:"host",startAt:at("19:00"),endAt:at("23:00"),venueId:null};
  const slots=[
    anchor,
    {id:"v",playerId:"viewer",startAt:at("19:30"),endAt:at("22:30"),venueId:null},
    {id:"b",playerId:"b",startAt:at("20:00"),endAt:at("21:00"),venueId:"scaa"},
    {id:"c",playerId:"c",startAt:at("20:00"),endAt:at("21:00"),venueId:null},
    {id:"d",playerId:"d",startAt:at("21:00"),endAt:at("22:00"),venueId:null},
  ];
  assert.deepEqual(bestCommonWindow(anchor,"viewer",slots),{startAt:at("19:30"),endAt:at("22:30"),playerIds:["host","viewer"]});
});

test("opportunity ranking rewards longer overlap and a close, fresh matchup",()=>{
  const short=opportunityScore({compatiblePlayers:2,overlapMinutes:60,eloDifference:40,recentMatches:0});
  const long=opportunityScore({compatiblePlayers:8,overlapMinutes:180,eloDifference:40,recentMatches:0});
  const close=opportunityScore({overlapMinutes:180,eloDifference:20,recentMatches:0});
  const repeated=opportunityScore({overlapMinutes:180,eloDifference:20,recentMatches:5});
  assert.ok(long>short);
  assert.ok(close>repeated);
});
