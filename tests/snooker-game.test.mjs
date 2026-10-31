import test from 'node:test';
import assert from 'node:assert/strict';
import {rack,step,moving,respot,respotAll,RADIUS,computerShot,strike,CUE_SPEED_MIN,CUE_SPEED_MAX,POWER_RESPONSE_EXPONENT,CLOTH_ROLLING_DECELERATION} from '../lib/snooker-game.ts';
import {newMatch,beginShot,finishShot} from '../lib/snooker-match.ts';

test('rack contains 15 reds, six colours and a cue ball without overlaps',()=>{
  const balls=rack();assert.equal(balls.length,22);assert.equal(balls.filter(b=>b.value===1).length,15);
  for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++)assert.ok(Math.hypot(balls[i].x-balls[j].x,balls[i].z-balls[j].z)>=RADIUS*2);
});
test('head-on equal-mass impact transfers velocity and reports first contact',()=>{
  const balls=rack().slice(0,2);Object.assign(balls[0],{x:0,z:0,vx:1,vz:0});Object.assign(balls[1],{x:RADIUS*2+.001,z:0,vx:0,vz:0});
  let contact;step(balls,1/240,v=>contact=v,()=>{});assert.equal(contact,2);assert.ok(balls[1].vx>.9);assert.ok(balls[0].vx<.05);
});
test('cloth drag settles a shot and pocket captures cue ball',()=>{
  const balls=rack();Object.assign(balls[0],{x:0,z:.5,vx:.2,vz:0});
  for(let i=0;i<1000;i++)step(balls,1/240,()=>{},()=>{});assert.equal(moving(balls),false);
  Object.assign(balls[0],{x:.88,z:0});let pot=false;step(balls,1/240,()=>{},()=>pot=true);assert.ok(pot);assert.ok(balls[0].potted);
});
test('legal red scores and retains turn; colour returns and target becomes red',()=>{
  const m=newMatch();beginShot(m,0,50);const red=m.balls.find(b=>b.value===1);red.potted=true;m.first=1;m.potted=[red];finishShot(m);
  assert.equal(m.scores[0],1);assert.equal(m.target,-1);assert.equal(m.turn,0);
  beginShot(m,0,50);const black=m.balls.find(b=>b.value===7);black.potted=true;m.first=7;m.potted=[black];finishShot(m);
  assert.equal(m.scores[0],8);assert.equal(m.target,1);assert.equal(black.potted,false);
  assert.deepEqual(m.breakBalls,[1,7]);
  beginShot(m,0,50);m.first=1;finishShot(m);
  assert.deepEqual(m.breakBalls,[]);assert.equal(m.break,0);
});
test('wrong first contact awards penalty and passes turn',()=>{
  const m=newMatch();m.break=8;m.breakBalls=[1,7];m.first=7;finishShot(m);assert.deepEqual(m.scores,[0,7]);assert.equal(m.turn,1);assert.deepEqual(m.breakBalls,[]);
});
test('final black ends frame, tied frame respots black',()=>{
  for(const tied of [false,true]){
    const m=newMatch();m.balls.forEach(b=>{if(b.value)b.potted=true;});m.target=7;m.shotTarget=7;m.first=7;m.potted=[m.balls.find(b=>b.value===7)];m.scores=[0,tied?7:0];finishShot(m);
    assert.equal(m.finished,!tied);if(tied)assert.equal(m.target,7);
  }
});
test('computer generates a finite legal-target shot',()=>{
  const shot=computerShot(rack(),1);assert.ok(Number.isFinite(shot.angle));assert.ok(shot.power>=5&&shot.power<=100);
});
test('shot power follows a soft-touch curve and reaches measured professional cue speed',()=>{
  const weak=rack()[0],half=rack()[0],strong=rack()[0];strike(weak,0,5);strike(half,0,50);strike(strong,0,100);
  const impactRatio=(1+.73)*.5/(.5+.141);
  const expectedSoftTipSpeed=CUE_SPEED_MIN+(CUE_SPEED_MAX-CUE_SPEED_MIN)*Math.pow(.05,POWER_RESPONSE_EXPONENT);
  assert.ok(Math.abs(Math.hypot(weak.vx,weak.vz)-expectedSoftTipSpeed*impactRatio)<1e-12);
  assert.ok(Math.hypot(weak.vx,weak.vz)<.7);
  assert.ok(Math.hypot(half.vx,half.vz)<CUE_SPEED_MAX*.5*impactRatio);
 assert.ok(Math.abs(Math.hypot(strong.vx,strong.vz)-CUE_SPEED_MAX*impactRatio)<1e-12);
});
import {predictShot,WIDTH,LENGTH} from '../lib/snooker-game.ts';
const ball=(value,x,z)=>({id:value,value,x,z,vx:0,vz:0,potted:false});
const advance=(balls,n)=>{for(let i=0;i<n;i++)step(balls,1/240,()=>{},()=>{});};
test('rolling drag gives the expected stopping distance without reversing',()=>{
 const b=ball(0,0,.4);b.vx=.3;b.wx=0;b.wz=-.3/RADIUS;advance([b],900);
 assert.equal(moving([b]),false);assert.ok(Math.abs(b.x-.3*.3/(2*CLOTH_ROLLING_DECELERATION))<.002);
});
test('draw and follow separate after a close straight contact',()=>{
 const velocities=[];
 for(const top of [-1,1]){const balls=[ball(0,0,.15),ball(1,0,0)];strike(balls[0],0,40,{top,side:0});advance(balls,65);velocities.push(balls[0].vz);}
 assert.ok(velocities[0]>.1);assert.ok(velocities[1]<-.1);
});
test('cushion dissipates total energy and side spin changes its exit angle',()=>{
 const result=[];
 for(const side of [-1,1]){const b=ball(0,WIDTH/2-RADIUS-.001,.5);b.vx=1;b.vz=.2;b.wx=b.vz/RADIUS;b.wz=-b.vx/RADIUS;b.wy=side*30;
 const energy=b=>b.vx*b.vx+b.vz*b.vz+.4*RADIUS*RADIUS*(b.wx*b.wx+b.wz*b.wz+b.wy*b.wy);
 const before=energy(b);advance([b],1);assert.ok(b.vx<0);assert.ok(energy(b)<=before);result.push(b.vz);}
 assert.ok(Math.abs(result[0]-result[1])>.1);
});

test('side spin produces mirrored, visible rebounds on all four cushions',()=>{
 for(const [nx,nz,limit] of [[-1,0,WIDTH/2-RADIUS],[1,0,WIDTH/2-RADIUS],[0,-1,LENGTH/2-RADIUS],[0,1,LENGTH/2-RADIUS]]){
  const exits=[];
  for(const side of [-1,0,1]){
   const b=ball(0,nx? -nx*(limit-.001):.3,nz? -nz*(limit-.001):.5);
   b.vx=-nx;b.vz=-nz;b.wx=b.vz/RADIUS;b.wz=-b.vx/RADIUS;b.wy=side*1.25/RADIUS;
   advance([b],1);
   const normal=b.vx*nx+b.vz*nz,tangent=-b.vx*nz+b.vz*nx;
   assert.ok(normal>0);exits.push(Math.atan2(tangent,normal));
  }
  // Positive world-y rotation drives the contact surface along +t, so the
  // cushion's friction kicks the centre along -t (right side of the cue).
  assert.ok(exits[0]>.3);assert.ok(exits[2]<-.3);
  assert.ok(Math.abs(exits[1])<1e-9);assert.ok(Math.abs(exits[0]+exits[2])<1e-9);
 }
});

test('cushion stays passive for running, check and grazing spin impacts',()=>{
 const energy=b=>b.vx*b.vx+b.vz*b.vz+.4*RADIUS*RADIUS*(b.wx*b.wx+b.wz*b.wz+b.wy*b.wy);
 for(const normal of [.05,.5,2])for(const tangent of [-2,0,2])for(const spin of [-150,-30,0,30,150])for(const roll of [-1,1]){
  const b=ball(0,WIDTH/2-RADIUS-.00001,.5);
  Object.assign(b,{vx:normal,vz:tangent,wx:roll*tangent/RADIUS,wz:-roll*normal/RADIUS,wy:spin});
  const before=energy(b);advance([b],1);
  assert.ok(b.vx<0);assert.ok(energy(b)<=before+1e-9);
 }
});

test('a side-spin kick remains visible after cloth friction acts on the rebound',()=>{
 const positions=[];
 for(const side of [-1,0,1]){
  const b=ball(0,0,.5);strike(b,90,30,{top:0,side});
  let rebounded=false;
  for(let i=0;i<480;i++){
   advance([b],1);if(b.vx<0)rebounded=true;
   if(rebounded&&b.x<.65)break;
  }
  assert.ok(rebounded);assert.equal(b.potted,false);positions.push(b.z);
 }
 assert.ok(positions[1]-positions[0]>.14);
 assert.ok(positions[2]-positions[1]>.14);
});

test('draw with side retains world spin while reversing travel and its next-cushion effect',()=>{
 for(const side of [-.5,.5]){
  const balls=[ball(0,.3,LENGTH/2-.15),ball(1,.3,LENGTH/2-.30)];
  strike(balls[0],0,60,{top:-.8,side});
  let drew=false,rebounded=false;
  for(let i=0;i<1200;i++){
   advance(balls,1);
   const cue=balls[0];
   if(cue.vz>0){drew=true;assert.equal(Math.sign(cue.wy),Math.sign(side));}
   if(drew&&cue.vz<0){
    // Right side at launch now kicks left at the cushion behind the player.
    assert.ok(cue.vx*side<0);rebounded=true;break;
   }
  }
  assert.ok(drew);assert.ok(rebounded);
 }
});

test('draw drag increases the side-spin rebound angle without flipping the spin',()=>{
 const exits=[];
 for(const top of [-.7,0,.7]){
  const b=ball(0,0,.5);strike(b,90,30,{top,side:.5});
  for(let i=0;i<1000&&b.vx>0;i++)advance([b],1);
  assert.ok(b.vx<0);assert.ok(b.vz>0);assert.ok(b.wy>0);
  exits.push(Math.atan2(b.vz,-b.vx));
 }
 // Margins reflect realistic side-spin decay (~10 rad/s²) before the cushion.
 assert.ok(exits[0]>exits[1]+.06);assert.ok(exits[1]>exits[2]+.03);
});

test('raised cushion contact couples horizontal-axis spin into side response',()=>{
 const exits=[];
 for(const wx of [-30,30]){
  const b=ball(0,WIDTH/2-RADIUS-.001,.5);
  Object.assign(b,{vx:1,vz:.3,wx,wz:-1/RADIUS,wy:10});
  advance([b],1);exits.push(b.vz);
 }
 assert.ok(exits[0]>exits[1]+.15);
});
test('prediction selects nearest ball, is finite, and never mutates the match',()=>{
 const balls=[ball(0,0,.5),ball(1,0,0),ball(2,0,-.5)],before=structuredClone(balls);
 const p=predictShot(balls,0,50,{top:0,side:0});assert.equal(p.object.id,1);assert.ok(Math.abs(p.contact.z-2*RADIUS)<1e-8);assert.ok(p.objectPath.length>0);assert.deepEqual(balls,before);
 const miss=predictShot([balls[0]],90,50,{top:0,side:0});assert.equal(miss.object,undefined);assert.ok(Number.isFinite(miss.contact.x));
});

test('landing prediction matches a complete live shot across power, spin and collisions',()=>{
 for(const [power,top,side] of [[8,0,0],[45,-1,0],[60,-.8,.5],[60,-.8,-.5],[100,1,1]]){
  const balls=[ball(0,0,.5),ball(1,.02,0)];
  const prediction=predictShot(balls,0,power,{top,side});
  const live=structuredClone(balls);strike(live[0],0,power,{top,side});
  for(let i=0;i<240*120&&moving(live);i++)step(live,1/240,()=>{},()=>{});
  assert.equal(moving(live),false);
  assert.deepEqual(prediction.cueEnd,{x:live[0].x,z:live[0].z,potted:live[0].potted});
  assert.deepEqual(prediction.cuePath.at(-1),{x:live[0].x,z:live[0].z});
 }
 const weak=predictShot([ball(0,0,.5)],0,5,{top:0,side:0});
 const strong=predictShot([ball(0,0,.5)],0,15,{top:0,side:0});
 assert.ok(Number.isFinite(strong.cueEnd.z));
 const weakShot=ball(0,0,.5),strongShot=ball(0,0,.5);strike(weakShot,0,5);strike(strongShot,0,15);
 assert.ok(Math.hypot(strongShot.vx,strongShot.vz)>Math.hypot(weakShot.vx,weakShot.vz));
 assert.ok(weak.cueEnd.z>weak.contact.z);
 const scratch=predictShot([ball(0,0,0)],90,40,{top:0,side:0});
 assert.equal(scratch.cueEnd.potted,true);
});


test('middle pocket rejects a ball outside its narrower throat rather than capturing across the jaw',()=>{
 const b=ball(0,WIDTH/2-.009,.04);b.vx=.3;
 let potted=false;step([b],1/240,()=>{},()=>{potted=true;});
 assert.equal(potted,false);assert.ok(b.vx<0);
});
test('centred middle and diagonal corner entries still fall through the resized openings',()=>{
 for(const [x,z] of [[WIDTH/2-.009,0],[WIDTH/2-.02,3.569/2-.02]]){
  const b=ball(0,x,z);let potted=false;step([b],1/240,()=>{},()=>{potted=true;});assert.equal(potted,true);
 }
});

test('computer pots an available black without scratching or changing the live table',()=>{
 const balls=[ball(0,.25,-.9),ball(7,.5,-1.25)],before=structuredClone(balls);
 const shot=computerShot(balls,7);assert.deepEqual(balls,before);
 let first=null;const pots=[];strike(balls[0],shot.angle,shot.power,shot.spin);
 for(let i=0;i<240*30&&moving(balls);i++)step(balls,1/240,v=>{first??=v;},b=>pots.push(b.value));
 assert.equal(first,7);assert.deepEqual(pots,[7]);assert.equal(moving(balls),false);
});

test('computer builds a red-colour break with the live match rules',()=>{
 const m=newMatch();m.balls=[ball(0,.25,-.9),ball(1,.5,-1.25),ball(7,-.3,-1.3)];m.turn=1;
 for(let shotNumber=0;shotNumber<2;shotNumber++){
  const shot=computerShot(m.balls,m.target);beginShot(m,shot.angle,shot.power,shot.spin);
  for(let i=0;i<240*30&&moving(m.balls);i++)step(m.balls,1/240,v=>{m.first??=v;},b=>m.potted.push(b));
  finishShot(m);assert.equal(m.turn,1);
 }
 assert.equal(m.break,8);assert.deepEqual(m.breakBalls,[1,7]);
});

test('corner pockets forgive a small aim error on a medium pot but not on a long one',async()=>{
 const g=await import('../lib/snooker-game.ts'),[px,pz]=g.POCKETS[0],u=Math.SQRT1_2;
 const pots=(object,cue,error)=>{
  const ox=px+u*object,oz=pz+u*object,b=[{id:0,value:0,x:ox+u*cue,z:oz+u*cue,vx:0,vz:0,potted:false},{id:1,value:1,x:ox,z:oz,vx:0,vz:0,potted:false}];
  g.strike(b[0],-45+error,40);for(let f=0;f<240*20&&g.moving(b);f++)g.step(b,1/240,()=>{},()=>{});return b[1].potted;
 };
 for(const error of [-.3,0,.3])assert.ok(pots(.3,.5,error),'medium straight pot drops within 0.3°');
 assert.ok(pots(.6,1,0));assert.ok(!pots(.6,1,.3)&&!pots(.6,1,-.3),'long pot punishes 0.3°');
});
test('occupied own spot respots a colour on the highest free spot',()=>{
  const balls=rack(),pink=balls.find(b=>b.value===6),black=balls.find(b=>b.value===7),green=balls.find(b=>b.value===3);
  const blackSpot={x:black.x,z:black.z},pinkSpot={x:pink.x,z:pink.z};
  // Black is potted; the pink has been moved and a red sits on the black spot.
  const red=balls.find(b=>b.value===1);Object.assign(red,{x:blackSpot.x,z:blackSpot.z});black.potted=true;Object.assign(pink,{x:.5,z:.5});
  respot(black,balls);assert.deepEqual({x:black.x,z:black.z},pinkSpot);assert.equal(black.potted,false);
  green.potted=true;respot(green,balls);
  const blue=balls.find(b=>b.value===5);assert.notDeepEqual({x:green.x,z:green.z},{x:blue.x,z:blue.z});
});
test('with every spot occupied a colour goes towards the top cushion, then below for pink and black',()=>{
  const balls=rack(),spots=balls.filter(b=>b.value>1).map(b=>({value:b.value,x:b.x,z:b.z}));
  const reds=balls.filter(b=>b.value===1);
  spots.forEach((s,i)=>Object.assign(reds[i],{x:s.x,z:s.z}));
  const green=balls.find(b=>b.value===3),greenSpot=spots.find(s=>s.value===3);
  for(const b of balls)if(b.value>1){b.potted=true;Object.assign(b,{x:9,z:9});}
  respot(green,balls);
  assert.equal(green.x,greenSpot.x);assert.ok(green.z<greenSpot.z);assert.ok(Math.abs(green.z-(greenSpot.z-RADIUS*2))<.001);
  // Fill the space between the black spot and the top cushion.
  const black=balls.find(b=>b.value===7),blackSpot=spots.find(s=>s.value===7),extra=reds.slice(6);
  for(let i=0;i<extra.length&&i<6;i++)Object.assign(extra[i],{x:0,z:blackSpot.z-RADIUS*2.02*(i+1)});
  assert.ok(extra[5].z<-LENGTH/2+RADIUS);
  respot(black,balls);
  assert.equal(black.x,0);assert.ok(black.z>blackSpot.z);
  for(const b of balls)if(b!==black&&!b.potted)assert.ok(Math.hypot(b.x-black.x,b.z-black.z)>=RADIUS*2);
});
test('colours potted together respot in value order',()=>{
  const balls=rack(),pink=balls.find(b=>b.value===6),black=balls.find(b=>b.value===7),blackSpot={x:black.x,z:black.z},pinkSpot={x:pink.x,z:pink.z};
  const red=balls.find(b=>b.value===1);Object.assign(red,{x:pinkSpot.x,z:pinkSpot.z});
  pink.potted=black.potted=true;respotAll([pink,black],balls);
  assert.deepEqual({x:black.x,z:black.z},blackSpot);
  assert.ok(Math.hypot(pink.x-blackSpot.x,pink.z-blackSpot.z)>=RADIUS*2);
});
