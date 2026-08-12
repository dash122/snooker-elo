import test from "node:test";
import assert from "node:assert/strict";
import { memberCanWrite } from "../lib/state-write-rules.ts";

const basePlayer=(id,name)=>({
  id,
  name,
  short:name.slice(0,3).toUpperCase(),
  handicap:null,
  rating:1500,
  initialRating:1500,
  colour:"#123456",
  avatar:null,
  active:true,
  wins:0,
  losses:0,
  draws:0,
  framesWon:0,
  framesLost:0,
  lastChange:0,
  form:[],
});

const baseState=()=>({
  players:[basePlayer("p1","Alice"),basePlayer("p2","Bob")],
  matches:[{
    id:"m1",a:"p1",b:"p2",mode:"1v1",scoreA:2,scoreB:1,playedOn:"2026-08-01",
    actual:0,giver:null,official:0,extra:0,expectedA:.5,beforeA:1500,beforeB:1500,afterA:1510,afterB:1490,deltaA:10,
    status:"confirmed",entryMode:"match",createdAt:"2026-08-01T10:00:00.000Z",
  }],
  tournaments:[{
    id:"t1",
    name:"南華會週期會友盃",
    handicapMode:"suggested",
    signupDeadline:"2026-08-20",
    createdAt:"2026-08-01T00:00:00.000Z",
    createdBy:"p1",
    signups:["p1"],
  }],
  settings:{ start:1500, provisionalGames:10, frameScaleCoefficient:100, frameScaleBase:10, handicapEloScale:500, handicapPointsToElo:25, performanceTanhDivisor:3, winBonusMultiplier:2, handicapEffectiveness:.7, modelVersion:6 },
  audits:[],
});

test("member can toggle only own tournament signup",()=>{
  const current=baseState();
  const next=baseState();
  next.tournaments[0].signups=["p1","p2"];
  assert.equal(memberCanWrite(current,next,"p2"),true);
});

test("member cannot toggle other member signup",()=>{
  const current=baseState();
  const next=baseState();
  next.tournaments[0].signups=[];
  assert.equal(memberCanWrite(current,next,"p2"),false);
});

test("member cannot edit tournament metadata",()=>{
  const current=baseState();
  const next=baseState();
  next.tournaments[0].name="其他盃賽";
  assert.equal(memberCanWrite(current,next,"p1"),false);
});

test("member can save cup match if they are participant",()=>{
  const current=baseState();
  const next=baseState();
  next.matches.push({
    id:"m2",a:"p1",b:"p2",mode:"cup",scoreA:3,scoreB:2,playedOn:"2026-08-02",
    actual:4,giver:"p1",official:0,extra:0,expectedA:.55,beforeA:1510,beforeB:1490,afterA:1518,afterB:1482,deltaA:8,
    status:"confirmed",entryMode:"match",createdAt:"2026-08-02T10:00:00.000Z",
    tournamentId:"t1",tournamentRound:1,tournamentMatchIndex:1,
  });
  assert.equal(memberCanWrite(current,next,"p1"),true);
});

test("member cannot save unrelated cup match",()=>{
  const current=baseState();
  const next=baseState();
  next.players.push(basePlayer("p3","Carol"),basePlayer("p4","Dylan"));
  next.matches.push({
    id:"m2",a:"p3",b:"p4",mode:"cup",scoreA:3,scoreB:2,playedOn:"2026-08-02",
    actual:0,giver:null,official:0,extra:0,expectedA:.5,beforeA:1500,beforeB:1500,afterA:1505,afterB:1495,deltaA:5,
    status:"confirmed",entryMode:"match",createdAt:"2026-08-02T10:00:00.000Z",
    tournamentId:"t1",tournamentRound:1,tournamentMatchIndex:1,
  });
  assert.equal(memberCanWrite(current,next,"p1"),false);
});

test("member cannot write the frozen draw",()=>{
  const current=baseState();
  const next=baseState();
  next.tournaments[0].draw=["p1","p2"];
  next.tournaments[0].drawnAt="2026-08-20T16:00:00.000Z";
  assert.equal(memberCanWrite(current,next,"p1"),false);
});

test("member cannot reshuffle an existing draw",()=>{
  const current=baseState();
  current.tournaments[0].draw=["p1","p2"];
  const next=baseState();
  next.tournaments[0].draw=["p2","p1"];
  assert.equal(memberCanWrite(current,next,"p1"),false);
});

test("member cannot declare a walkover",()=>{
  const current=baseState();
  current.tournaments[0].draw=["p1","p2"];
  const next=baseState();
  next.tournaments[0].draw=["p1","p2"];
  next.tournaments[0].walkovers=[{round:1,index:1,winner:"p1"}];
  assert.equal(memberCanWrite(current,next,"p1"),false);
});

test("member cannot enter or leave a cup once it is drawn",()=>{
  const current=baseState();
  current.tournaments[0].draw=["p1","p2"];
  const joining=baseState();
  joining.tournaments[0].draw=["p1","p2"];
  joining.tournaments[0].signups=["p1","p2"];
  assert.equal(memberCanWrite(current,joining,"p2"),false);
  const leaving=baseState();
  leaving.tournaments[0].draw=["p1","p2"];
  leaving.tournaments[0].signups=[];
  assert.equal(memberCanWrite(current,leaving,"p1"),false);
});

test("an undrawn cup still accepts a member's own signup",()=>{
  const current=baseState();
  const next=baseState();
  next.tournaments[0].signups=["p1","p2"];
  assert.equal(memberCanWrite(current,next,"p2"),true);
});
