import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestAim,swipeAim} from '../lib/snooker-aim.ts';
const ball=(value,x,z,potted=false)=>({id:value,value,x,z,potted,vx:0,vz:0});
test('nearest aim selects a legal red and ignores closer colours and potted reds',()=>{
  const balls=[ball(0,0,0),ball(1,1,0),ball(1,0,-2),ball(2,0,-.1),ball(1,0,-.05,true)];
  const before=structuredClone(balls);
  assert.equal(nearestAim(balls,1),90);assert.deepEqual(balls,before);
});
test('any-colour and clearance target respect the current legal ball',()=>{
  const balls=[ball(0,0,0),ball(1,0,-.1),ball(2,-1,0),ball(7,0,-2)];
  assert.equal(nearestAim(balls,-1),-90);assert.equal(nearestAim(balls,7),0);
  assert.equal(nearestAim(balls,6,42),42);assert.equal(nearestAim([],1,12),12);
});
test('touch turning scales with viewport and precision is forty times finer',()=>{
  assert.equal(swipeAim(0,180,360,false),60);
  assert.equal(swipeAim(0,360,720,false),60);
  assert.equal(swipeAim(0,180,360,true),1.5);
  assert.equal(swipeAim(0,-180,360,false),-60);
});
test('swipes can be repeated without jumping and wrap across the angle boundary',()=>{
  assert.equal(swipeAim(swipeAim(0,180,360,false),180,360,false),120);
  assert.equal(swipeAim(179,6,360,false),-179);
  assert.equal(swipeAim(42,0,360,false),42);
});
