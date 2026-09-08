import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_PRESETS, marketplaceFormationStatus, parseMatchConditions, parseVenueScope, validateGroupRange,
  marketplaceOpportunities, resolveGroup, pairCompatible, marketplaceDeliveryTimingValid, parseStoredMatchConditions,
} from "../lib/matchmaking-marketplace.ts";

test("queued notifications expire with their intended delivery window",()=>{
  const now=Date.parse("2030-09-09T12:00:00Z");
  assert.equal(marketplaceDeliveryTimingValid("reminder",{startAt:"2030-09-09T12:30:00Z",endAt:"2030-09-09T14:00:00Z"},now),true);
  assert.equal(marketplaceDeliveryTimingValid("reminder",{startAt:"2030-09-09T11:30:00Z",endAt:"2030-09-09T14:00:00Z"},now),false);
  assert.equal(marketplaceDeliveryTimingValid("playable",{startAt:"2030-09-09T09:00:00Z",endAt:"2030-09-09T11:00:00Z"},now),false);
  assert.equal(marketplaceDeliveryTimingValid("result",{startAt:"2030-09-09T09:00:00Z",endAt:"2030-09-09T11:00:00Z"},now),true);
  assert.equal(marketplaceDeliveryTimingValid("result",{startAt:"2030-09-07T09:00:00Z",endAt:"2030-09-07T11:00:00Z"},now),false);
});

test("stored jsonb conditions decode when the production pooler returns text",()=>{
  const value={handicap:false,levelStrict:false,levelPreference:"similar",feePreference:"aa",tempo:"any"};
  assert.deepEqual(parseStoredMatchConditions(JSON.stringify(value)),value);
  assert.throws(()=>parseStoredMatchConditions("not json"),/儲存的約戰條件/);
});

test("all group presets satisfy the numeric range contract", () => {
  for (const preset of Object.values(GROUP_PRESETS)) assert.deepEqual(validateGroupRange(preset), preset);
  for (const values of [[1,2,2], [3,2,4], [2,4,3], [2,4,7], [2,2.5,3], [2,NaN,4], [2,3,Infinity]]) {
    assert.throws(() => validateGroupRange({minPlayers:values[0],targetSize:values[1],maxPlayers:values[2]}));
  }
});

const supply=(id,extra={})=>({id,playerId:id,player:{id,name:id,rating:1500},startAt:"2030-09-09T11:00:00Z",endAt:"2030-09-09T14:00:00Z",...GROUP_PRESETS.flexible,venueId:"scaa",venueScope:"exact",commitment:"going",conditions:{handicap:true},...extra});
const pool=slots=>({slots,venues:[{id:"scaa",name:"SCAA",district:"灣仔"},{id:"wan",name:"Wan",district:"灣仔"},{id:"other",name:"Other",district:"旺角"}],sessions:[],conflicts:[],avoids:[]});
test("venue constraints resolve the strongest preference and reject empty common windows",()=>{
  const a=supply("a"),b=supply("b",{venueId:"other",venueScope:"any_hk"});
  assert.equal(resolveGroup([a,b],pool([a,b])).venueId,"scaa");
  assert.equal(resolveGroup([a,{...b,venueScope:"exact"}],pool([a,b])),null);
  assert.equal(resolveGroup([a,{...b,venueId:"wan",venueScope:"district"}],pool([a,b])).venueId,"scaa");
  assert.equal(resolveGroup([a,{...b,venueId:"other",venueScope:"district"}],pool([a,b])),null);
  assert.equal(resolveGroup([a,{...b,startAt:"2030-09-09T13:30:00Z"}],pool([a,b])),null);
});
test("private exclusions apply in both directions and ELO hints reflect widening",()=>{
  const a=supply("a"),b=supply("b",{player:{id:"b",name:"B",rating:1680}}),p=pool([a,b]);
  assert.ok(marketplaceOpportunities("a",p)[0].hints.includes("擴闊水平範圍"));
  assert.equal(pairCompatible({...a,conditions:{levelStrict:true}},b,p),false);
  p.avoids=[{playerId:"b",otherPlayerId:"a",preference:"avoid"}];
  assert.equal(marketplaceOpportunities("a",p).length,0);
  assert.equal(marketplaceOpportunities("b",p).length,0);
});
test("active intent wins equivalent candidates without repeating identical cards",()=>{
  const a=supply("a",GROUP_PRESETS.singles),b=supply("b",{...GROUP_PRESETS.singles,commitment:"interested"}),c=supply("c",GROUP_PRESETS.singles);
  const opportunities=marketplaceOpportunities("a",pool([a,b,c]));
  assert.equal(opportunities.length,1);assert.match(opportunities[0].key,/:c:/);
  const p=pool([a,b,c]);p.conflicts=[{playerId:"a",sessionId:"confirmed",startAt:a.startAt,endAt:a.endAt}];
  assert.equal(marketplaceOpportunities("a",p).length,0);
});

test("minimum forms a session; ideal is a preference and maximum makes it full", () => {
  const rotation = GROUP_PRESETS.rotation;
  assert.equal(marketplaceFormationStatus(0,rotation),"cancelled");
  assert.equal(marketplaceFormationStatus(1,rotation),"forming");
  assert.equal(marketplaceFormationStatus(3,rotation),"forming");
  assert.equal(marketplaceFormationStatus(4,rotation),"playable");
  assert.equal(marketplaceFormationStatus(5,rotation),"playable");
  assert.equal(marketplaceFormationStatus(6,rotation),"full");
  for (const count of [-1,1.5,NaN,7]) assert.throws(() => marketplaceFormationStatus(count,rotation));
  assert.equal(marketplaceFormationStatus(2,GROUP_PRESETS.singles),"full");
});

test("creator leaving has the same status effect as any other accepted member leaving", () => {
  const members = ["creator","b","c","d"];
  for (const leaving of members) {
    const remaining = members.filter(id => id !== leaving);
    assert.equal(marketplaceFormationStatus(remaining.length,GROUP_PRESETS.rotation),"forming");
    assert.equal(marketplaceFormationStatus(remaining.length + 1,GROUP_PRESETS.rotation),"playable");
    assert.equal(marketplaceFormationStatus(remaining.length,GROUP_PRESETS.flexible),"playable");
  }
});

test("venue defaults preserve legacy selected and unspecified venue meanings", () => {
  assert.equal(parseVenueScope(undefined,"scaa"),"exact");
  assert.equal(parseVenueScope(undefined,null),"any_hk");
  assert.equal(parseVenueScope("any_hk",null),"any_hk");
  assert.equal(parseVenueScope("district","scaa"),"district");
  for (const scope of ["exact","district"]) assert.throws(() => parseVenueScope(scope,null));
  for (const scope of ["nearby",null,true]) assert.throws(() => parseVenueScope(scope,"scaa"));
});

test("marketplace conditions preserve explicit false and do not reinterpret legacy host preferences", () => {
  const conditions = {handicap:false,noSmoking:true,levelPreference:"similar",levelStrict:false,feePreference:"aa",tempo:"casual"};
  assert.deepEqual(parseMatchConditions(conditions),conditions);
  assert.deepEqual(parseMatchConditions({costSplit:"host",levelOnly:true,frames:3}),{});
  assert.deepEqual(parseMatchConditions(undefined),{});
  assert.deepEqual(parseMatchConditions({levelPreference:"any",feePreference:"any",tempo:"any"}),{levelPreference:"any",feePreference:"any",tempo:"any"});
  assert.deepEqual(parseMatchConditions({levelPreference:"similar",levelStrict:true,tempo:"sport"}),{levelPreference:"similar",levelStrict:true,tempo:"sport"});
  for (const invalid of [null,[],"{}",{handicap:"false"},{noSmoking:1},{levelStrict:"true"},{feePreference:"host"},{tempo:"fast"},{levelPreference:"close"},{levelPreference:"any",levelStrict:true}]) {
    assert.throws(() => parseMatchConditions(invalid));
  }
});
