import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestAim} from '../lib/snooker-aim.ts';
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
test('the opening aim prefers a ball the cue ball can actually reach',()=>{
  // The nearest red sits directly behind the pink; the next one is in the open.
  const balls=[ball(0,0,0),ball(6,0,-.3),{...ball(1,0,-.4),id:2},{...ball(1,.5,-.5),id:3}];
  assert.equal(nearestAim(balls,1),45);
  // Fully snookered: fall back to the nearest legal ball.
  assert.equal(nearestAim(balls.slice(0,3),1),0);
});
