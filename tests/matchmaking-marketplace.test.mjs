import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_PRESETS, marketplaceFormationStatus, parseMatchConditions, parseVenueScope, validateGroupRange,
} from "../lib/matchmaking-marketplace.ts";

test("all group presets satisfy the numeric range contract", () => {
  for (const preset of Object.values(GROUP_PRESETS)) assert.deepEqual(validateGroupRange(preset), preset);
  for (const values of [[1,2,2], [3,2,4], [2,4,3], [2,4,7], [2,2.5,3], [2,NaN,4], [2,3,Infinity]]) {
    assert.throws(() => validateGroupRange({minPlayers:values[0],targetSize:values[1],maxPlayers:values[2]}));
  }
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
