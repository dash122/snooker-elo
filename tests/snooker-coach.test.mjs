import test from 'node:test';
import assert from 'node:assert/strict';
import {rack,planShot,PRO_ERROR_SCALE} from '../lib/snooker-game.ts';
import {describePlan,reviewShot,focus,record,EMPTY_STATS} from '../lib/snooker-coach.ts';

const base={power:45,spin:{top:0,side:0},target:1,pottedValues:[],ballsAfter:rack(),targetAfter:1,stillTurn:false};
test('review names the reason for a miss',()=>{
 assert.match(reviewShot({...base,potted:false,foul:false,power:90}).tip,/大力/);
 assert.match(reviewShot({...base,potted:false,foul:false,spin:{top:0,side:.8}}).tip,/側旋/);
 assert.equal(reviewShot({...base,potted:false,foul:true}).headline,'犯規');
});
test('a pot that leaves nothing is a position failure',()=>{
 const balls=rack().map(b=>({...b,potted:b.value===1}));
 const v=reviewShot({...base,potted:true,foul:false,pottedValues:[1],ballsAfter:balls,targetAfter:1,stillTurn:true});
 assert.equal(v.positionOk,false);assert.match(v.headline,/走位失敗/);
});
test('practice focus moves from potting to pace to route planning',()=>{
 assert.match(focus({shots:20,pots:8,positions:8,positionsOk:6,best:9}).title,/入球/);
 assert.match(focus({shots:20,pots:16,positions:16,positionsOk:4,best:9}).title,/走位/);
 assert.match(focus({shots:20,pots:16,positions:16,positionsOk:12,best:20}).title,/線路/);
 const s=record(EMPTY_STATS,{...base,potted:true,foul:false},{headline:'',tip:'',positionOk:true},12);
 assert.deepEqual(s,{shots:1,pots:1,positions:1,positionsOk:1,best:12});
});
test('the coach describes a concrete plan for the opening position',()=>{
 const balls=rack(),plan=planShot(balls,1,PRO_ERROR_SCALE);
 assert.ok(plan);assert.ok(describePlan(plan).length>10);
});
