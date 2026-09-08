import test from 'node:test';
import assert from 'node:assert/strict';
import {marketplaceWrite,marketplaceDashboard,readPool} from '../db/matchmaking-marketplace-store.ts';
import {GROUP_PRESETS,marketplaceOpportunities} from '../lib/matchmaking-marketplace.ts';
import {fixture,date,startAt,endAt} from './marketplace-fixture.mjs';

test("marketplace transactions support asynchronous consent, hostless recovery and privacy",async()=>{
  const {pg,db,publish}=await fixture();
  try{
    const slots=[];for(let i=1;i<=6;i++)slots.push(await publish(`p${i}`,GROUP_PRESETS.rotation));
    const first=await marketplaceDashboard(db,"p1",true,date);
    const opportunity=first.opportunities.find(o=>o.targetSize===4);
    assert.ok(opportunity);assert.deepEqual(opportunity.acceptedPlayers,[]);
    assert.equal("members" in opportunity,false);
    const {id}=await marketplaceWrite(db,"p1","create",{slotId:slots[0].id,key:opportunity.key});
    let second=await marketplaceDashboard(db,"p2",true,date);
    assert.equal(second.opportunities[0].sessionId,id);
    await marketplaceWrite(db,"p1","invite",{id,playerId:"p2",slotId:slots[1].id});
    assert.equal((await marketplaceDashboard(db,"p2",true,date)).sessions[0].myStatus,"pending");
    await marketplaceWrite(db,"p2","accept",{id});
    for(const p of ["p3","p4"])await marketplaceWrite(db,p,"join",{id});
    assert.equal((await readPool(db)).sessions[0].status,"playable");
    await marketplaceWrite(db,"p1","withdraw",{id:slots[0].id});
    assert.equal((await readPool(db)).sessions[0].accepted.length,4);
    await marketplaceWrite(db,"p1","leave",{id});
    assert.equal((await readPool(db)).sessions[0].status,"forming");
    await marketplaceWrite(db,"p5","join",{id});
    assert.equal((await readPool(db)).sessions[0].status,"playable");
    await marketplaceWrite(db,"p5","join",{id});
    assert.equal((await readPool(db)).sessions[0].accepted.length,4);
    await assert.rejects(marketplaceWrite(db,"p3","edit",{...GROUP_PRESETS.singles,id:slots[2].id,startAt,endAt,venueId:"other",venueScope:"exact",conditions:{},commitment:"going"}));
    await marketplaceWrite(db,"p6","avoid",{playerId:"p3"});
    await assert.rejects(marketplaceWrite(db,"p6","join",{id}));
    const guest=await marketplaceDashboard(db,null,false,date);
    for(const key of ["mine","availability","sessions","opportunities"])assert.deepEqual(guest[key],[]);
    assert.ok(guest.dates.some(d=>d.publicPlayers>0));
    second=await marketplaceDashboard(db,"p2",true,date);
    assert.equal(JSON.stringify(second).includes('"avoids"'),false);
    assert.equal(second.sessions[0].acceptedPlayers.some(p=>p.id==="p1"),false);
    await assert.rejects(db.query(`UPDATE availability_slots SET cancelled_at=now() WHERE id=$1`,[slots[2].id]),{code:"23514"});
    assert.ok((await db.query(`SELECT * FROM matchmaking_delivery WHERE kind='reopened'`)).length);
  }finally{await pg.close();}
});

test("direct invitations are private consent and conflicting confirmations cannot coexist",async()=>{
  const {pg,db,publish}=await fixture();
  try{
    const a=await publish("p1",GROUP_PRESETS.singles),b=await publish("p2",GROUP_PRESETS.singles),c=await publish("p3",GROUP_PRESETS.singles);
    const {id}=await marketplaceWrite(db,"p1","invite",{ownSlotId:a.id,slotId:b.id,playerId:"p2"});
    await assert.rejects(marketplaceWrite(db,"p3","accept",{id}));
    await marketplaceWrite(db,"p2","accept",{id});
    await assert.rejects(marketplaceWrite(db,"p1","invite",{ownSlotId:a.id,slotId:c.id,playerId:"p3"}));
    // A legacy write cannot create a conflict through a different endpoint.
    await db.query(`INSERT INTO open_calls VALUES('old',$1,$2,'open')`,[startAt,endAt]);
    await db.query(`INSERT INTO open_call_players VALUES('old','p3')`);
    await assert.rejects(db.query(`INSERT INTO open_call_players VALUES('old','p1')`),{code:"23514"});
    assert.equal((await db.query(`SELECT * FROM open_call_players WHERE call_id='old'`)).length,1);
  }finally{await pg.close();}
});

test("ten mixed players create multiple viable shapes, with no forced ten-player allocation",async()=>{
  const {pg,db,publish}=await fixture();
  try{
    for(let i=1;i<=10;i++)await publish(`p${i}`,i<=4?GROUP_PRESETS.singles:i<=6?GROUP_PRESETS.small:GROUP_PRESETS.rotation);
    const pool=await readPool(db);
    const sizes=new Set();
    for(let i=1;i<=10;i++)for(const o of marketplaceOpportunities(`p${i}`,pool)){sizes.add(o.targetSize);assert.ok(o.targetSize<=6);assert.ok(o.minPlayers<=o.targetSize&&o.targetSize<=o.maxPlayers);}
    assert.ok(sizes.has(2));assert.ok(sizes.has(4));
    await publish("p11",GROUP_PRESETS.flexible);
    assert.ok(marketplaceOpportunities("p5",await readPool(db)).some(o=>o.targetSize===3));
  }finally{await pg.close();}
});

test("competing joins serialize at capacity and forged candidates never create consent",async()=>{
  const {pg,db,publish}=await fixture();
  try{
    const a=await publish("p1",GROUP_PRESETS.singles);
    await publish("p2",GROUP_PRESETS.singles);await publish("p3",GROUP_PRESETS.singles);
    await assert.rejects(marketplaceWrite(db,"p1","create",{slotId:a.id,key:"forged",playerIds:["p2","p3"]}));
    assert.equal((await readPool(db)).sessions.length,0);
    const candidate=(await marketplaceDashboard(db,"p1",true,date)).opportunities[0];
    const {id}=await marketplaceWrite(db,"p1","create",{slotId:a.id,key:candidate.key});
    const results=await Promise.allSettled([marketplaceWrite(db,"p2","join",{id}),marketplaceWrite(db,"p3","join",{id})]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await readPool(db)).sessions[0].accepted.length,2);
    await marketplaceWrite(db,"p1","leave",{id});
    await marketplaceWrite(db,"p1","leave",{id});
    assert.equal((await readPool(db)).sessions[0].accepted.length,1);
  }finally{await pg.close();}
});
