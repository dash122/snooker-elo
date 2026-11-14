import test from 'node:test';
import assert from 'node:assert/strict';
import {aimAtBall,bestAim,paceLengths,respot,canSee,clampToD,computerPlan,cueSpotInD,deliverComputerShot,moving,planShot,pocketAt,predictShot,rack,step,strike,BAULK_Z,D_RADIUS,LENGTH,LEVELS,POCKETS,RADIUS,WIDTH} from '../lib/snooker-game.ts';
import {beginShot,concedeFrame,finishShot,framesToWin,lineUpRack,newMatch,newPractice,nextFrame,placeCueBall,pointsRemaining,snookersRequired,wouldConcede} from '../lib/snooker-match.ts';

const ball=(id,value,x,z)=>({id,value,x,z,vx:0,vz:0,potted:false});
const settle=balls=>{for(let i=0;i<240*30&&moving(balls);i++)step(balls,1/240,()=>{},()=>{});return balls;};
const play=(balls,angle,power,spin)=>{const trial=structuredClone(balls);strike(trial[0],angle,power,spin);return settle(trial);};
const W=WIDTH/2,L=LENGTH/2;

test('the cut angle off an object ball does not depend on how hard it is struck',()=>{
 // A half-ball cut. Resolving the contact late used to turn this by a degree
 // or more at pace, so the same aim potted at one power and missed at the next.
 const directions=[];
 for(const power of [20,35,50,65,80,95]){
  const balls=[ball(0,0,RADIUS,.6),ball(1,1,0,0)];strike(balls[0],0,power);
  for(let i=0;i<240*5&&balls[1].vx===0&&balls[1].vz===0;i++)step(balls,1/240,()=>{},()=>{});
  directions.push(Math.atan2(balls[1].vx,-balls[1].vz)*180/Math.PI);
 }
 assert.ok(Math.max(...directions)-Math.min(...directions)<.15,`object ball direction varied: ${directions.map(d=>d.toFixed(2))}`);
 // Contact friction throws it a few degrees inside the 30° line of centres.
 assert.ok(directions[0]>-29&&directions[0]<-25,`half-ball cut left at ${directions[0].toFixed(2)}°`);
});

test('rounded jaws: a slow ball clipping the jaw drops, a clean miss stays out, and the jaw rejects a hard one',()=>{
 const roll=(offset,speed)=>{
  // Towards the top-right corner along the diagonal, shifted sideways by `offset`.
  const u=Math.SQRT1_2,b=ball(1,1,W-u*.5+u*offset,-L+u*.5+u*offset);
  Object.assign(b,{vx:u*speed,vz:-u*speed,wx:-u*speed/RADIUS,wz:-u*speed/RADIUS,wy:0});
  for(let i=0;i<240*6&&moving([b]);i++)step([b],1/240,()=>{},()=>{});return b;
 };
 assert.equal(roll(0,1).pocket,1);
 assert.ok(roll(.018,.8).potted,'a ball 18 mm off centre still drops');
 assert.ok(!roll(.035,.8).potted,'35 mm off centre hits the cushion and stays out');
 const rattled=roll(.03,3);assert.ok(!rattled.potted&&Math.hypot(rattled.x-W,rattled.z+L)>.2,'a hard ball on the jaw comes back out');
});

test('a ball running along the side cushion passes the middle pocket and drops in the corner',()=>{
 const b=ball(1,1,W-RADIUS,.5);Object.assign(b,{vz:-1.5,wx:-1.5/RADIUS,wz:0,wy:0});
 for(let i=0;i<240*6&&moving([b]);i++)step([b],1/240,()=>{},()=>{});
 assert.equal(b.potted,true);assert.equal(b.pocket,1);
 assert.equal(pocketAt(W-.01,0),3);assert.equal(pocketAt(-W+.01,0),2);assert.equal(pocketAt(0,0),-1);
});

test('aim assist lines up a cut that pots at every pace, where the ghost-ball aim misses',()=>{
 // Black off its spot from a half-ball angle: throw takes the textbook aim wide.
 const balls=[ball(0,0,-.314,-1.478),ball(1,7,0,-1.46)],aim=aimAtBall(balls,1);
 assert.equal(aim.pocket,1);
 for(const power of [40,50,60,75]){
  const after=play(balls,aim.angle,power);
  assert.ok(after[1].potted&&after[1].pocket===1,`black potted at ${power}%`);
 }
 // Pace is real: a soft roll on the right line dies short of the pocket.
 const soft=play(balls,aim.angle,25);assert.ok(!soft[1].potted&&soft[1].x>.3,'25% runs most of the way and stops short');
 const [px,pz]=POCKETS[1],d=Math.hypot(px,pz+1.46),gx=-(px/d)*RADIUS*2,gz=-1.46-((pz+1.46)/d)*RADIUS*2;
 const ghost=Math.atan2(gx+.314,-1.478-gz)*180/Math.PI;
 assert.ok(Math.abs(aim.angle-ghost)>.2&&Math.abs(aim.angle-ghost)<1.2,'the assist allows for throw');
 // Tapping again steps to the next pocket; a ball with no pot gets a full-ball aim.
 assert.notEqual(aimAtBall(balls,1,1).pocket,aim.pocket);
 const hidden=[ball(0,0,0,.5),ball(1,1,0,0),ball(2,2,0,.25)];
 assert.deepEqual(aimAtBall(hidden,1),{angle:0,pocket:-1});
 assert.equal(bestAim(hidden,1),null);
 assert.equal(bestAim(balls,7).ball,1);
});

test('prediction reports the pot, the pocket and the thickness of contact',()=>{
 const balls=[ball(0,0,-.314,-1.478),ball(1,7,0,-1.46)],aim=aimAtBall(balls,1),before=structuredClone(balls);
 const p=predictShot(balls,aim.angle,45,{top:0,side:0});
 assert.equal(p.first,7);assert.equal(p.objectPocket,1);assert.deepEqual(p.pots.map(x=>x.value),[7]);
 assert.ok(p.fraction>.3&&p.fraction<.7);assert.equal(p.cueEnd.potted,false);assert.deepEqual(balls,before);
 const full=predictShot([ball(0,0,0,.5),ball(1,1,0,0)],0,30,{top:0,side:0});
 assert.ok(full.fraction>.99);
 // The cue ball passing the object ball's right-hand side reads as +1.
 const right=predictShot([ball(0,0,RADIUS,.5),ball(1,1,0,0)],0,30,{top:0,side:0});
 assert.equal(right.side,1);assert.ok(Math.abs(right.fraction-.5)<.02);
});

test('snookers are recognised and a safety never leaves a free pot behind it',()=>{
 const snookered=[ball(0,0,0,.5),ball(1,1,0,-.5),ball(2,5,0,0)];
 assert.equal(canSee(snookered,1),false);assert.equal(canSee(snookered,5),true);
 // No pot is on from here, so the plan is a legal safety.
 const balls=[ball(0,0,0,1.3),ball(1,1,.3,-L+RADIUS),ball(2,1,-.4,-L+RADIUS),ball(3,7,0,-1.46)];
 const plan=planShot(balls,1,.5,false,.99);
 assert.equal(plan.kind,'safety');
 const after=structuredClone(balls);let first=null;const pots=[];strike(after[0],plan.shot.angle,plan.shot.power,plan.shot.spin);
 for(let i=0;i<240*30&&moving(after);i++)step(after,1/240,v=>{first??=v;},b=>pots.push(b.value));
 assert.equal(first,1);assert.deepEqual(pots,[]);
});

test('opponent levels differ in accuracy and shot selection, and always produce a stroke',()=>{
 assert.ok(LEVELS.casual.error>LEVELS.club.error&&LEVELS.club.error>LEVELS.pro.error);
 assert.ok(LEVELS.casual.attack<LEVELS.club.attack&&LEVELS.club.attack<LEVELS.pro.attack);
 const balls=[ball(0,0,.25,-.9),ball(1,1,.5,-1.25),ball(2,7,-.3,-1.3)];
 for(const level of Object.keys(LEVELS)){
  const plan=computerPlan(balls,1,level);assert.equal(plan.kind,'pot');
  let seed=3;const random=()=>((seed=seed*16807%2147483647)/2147483647);
  const shot=deliverComputerShot(plan.shot,balls,random,level);
  assert.ok(Number.isFinite(shot.angle)&&shot.power>=5&&shot.power<=100);
 }
 const errors=level=>{let seed=5,total=0;const random=()=>((seed=seed*16807%2147483647)/2147483647),shot={angle:0,power:50,spin:{top:0,side:0}};
  for(let i=0;i<200;i++)total+=Math.abs(deliverComputerShot(shot,balls,random,level).angle);return total;};
 assert.ok(errors('casual')>errors('club')*1.5&&errors('club')>errors('pro')*1.5);
 // Nothing legal to hit cleanly still yields a stroke rather than a stall.
 assert.ok(Number.isFinite(computerPlan([ball(0,0,0,0)],1).shot.angle));
});

test('ball in hand: the frame starts in the D and an in-off returns the cue ball there',()=>{
 const m=newMatch();assert.equal(m.inHand,true);
 assert.ok(placeCueBall(m,.1,BAULK_Z+.1));assert.deepEqual([m.balls[0].x,m.balls[0].z],[.1,BAULK_Z+.1]);
 // Outside the D is pulled back onto its edge, never past the baulk line.
 assert.ok(placeCueBall(m,.5,1.4));assert.ok(m.balls[0].z>=BAULK_Z&&Math.hypot(m.balls[0].x,m.balls[0].z-BAULK_Z)<=D_RADIUS);
 const edge=clampToD(0,3);assert.ok(Math.abs(edge.z-BAULK_Z-D_RADIUS)<.002);
 // Not on top of the brown, which sits on the baulk line.
 assert.equal(placeCueBall(m,0,BAULK_Z+.01),false);
 beginShot(m,0,30);assert.equal(m.inHand,false);assert.equal(placeCueBall(m,0,1.2),false);
 const cue=m.balls[0];cue.potted=true;cue.vx=cue.vz=0;m.first=1;m.potted=[cue];finishShot(m);
 assert.deepEqual(m.scores,[0,4]);assert.equal(m.turn,1);assert.equal(m.inHand,true);assert.equal(cue.potted,false);
 assert.ok(cue.z>=BAULK_Z&&Math.hypot(cue.x,cue.z-BAULK_Z)<=D_RADIUS);
 const spot=cueSpotInD(m.balls,m.target);assert.ok(placeCueBall(m,spot.x,spot.z));
});

test('points remaining follows the reds, the colour in hand and the final colours',()=>{
 const m=newMatch();assert.equal(pointsRemaining(m),147);
 m.balls.find(b=>b.value===1).potted=true;m.target=-1;assert.equal(pointsRemaining(m),14*8+27+7);
 m.balls.forEach(b=>{if(b.value===1)b.potted=true;});m.target=2;assert.equal(pointsRemaining(m),27);
 m.balls.find(b=>b.value===2).potted=true;m.target=3;assert.equal(pointsRemaining(m),25);
});

test('line-up practice: no opponent, a miss resets the break, and the cue ball goes anywhere',()=>{
 const drill=lineUpRack();assert.equal(drill.length,22);assert.equal(drill.filter(b=>b.value===1).length,15);
 assert.deepEqual(drill.map(b=>b.id),drill.map((_,i)=>i));assert.equal(drill[0].value,0);
 for(let i=0;i<drill.length;i++)for(let j=i+1;j<drill.length;j++)assert.ok(Math.hypot(drill[i].x-drill[j].x,drill[i].z-drill[j].z)>RADIUS*2.05);
 const m=newPractice();assert.ok(m.practice&&m.inHand);
 assert.ok(placeCueBall(m,.5,-.5));assert.deepEqual([m.balls[0].x,m.balls[0].z],[.5,-.5]);
 const aim=bestAim(m.balls,m.target);assert.ok(aim);
 beginShot(m,aim.angle,45);for(let i=0;i<240*30&&moving(m.balls);i++)step(m.balls,1/240,v=>{m.first??=v;},b=>m.potted.push(b));finishShot(m);
 assert.equal(m.scores[0],1);assert.equal(m.break,1);assert.equal(m.target,-1);
 // A miss and a foul both keep you at the table and concede nothing.
 beginShot(m,0,10);m.first=7;finishShot(m);
 assert.equal(m.turn,0);assert.equal(m.break,0);assert.deepEqual(m.scores,[1,0]);assert.equal(m.best,1);
 beginShot(m,0,10);m.first=null;finishShot(m);
 assert.equal(m.turn,0);assert.deepEqual(m.scores,[1,0]);
});

test('pace follows real table lengths and contact speeds match ball physics',()=>{
 // Most positional shots are under two lengths, so that is where the bar's middle sits.
 assert.ok(paceLengths(25)>.3&&paceLengths(25)<.7);
 assert.ok(paceLengths(50)>1.5&&paceLengths(50)<2.5);
 assert.ok(paceLengths(75)>5&&paceLengths(75)<8);
 assert.ok(paceLengths(100)>15);
 // Equal masses, restitution .94: a full ball passes on (1+e)/2 of the speed, a
 // half ball cos 30° of that; the cue ball keeps almost nothing along the line.
 for(const [offset,expected] of [[0,.97],[RADIUS,.97*Math.cos(Math.PI/6)]]){
  const c=ball(0,0,offset,Math.sqrt(4*RADIUS*RADIUS-offset*offset)+.0005),o=ball(1,1,0,0);
  Object.assign(c,{vz:-1.5,wx:-1.5/RADIUS,wz:0,wy:0});
  for(let i=0;i<4&&!o.vz;i++)step([c,o],1/240,()=>{},()=>{});
  assert.ok(Math.abs(Math.hypot(o.vx,o.vz)/1.5-expected)<.02,`object ball at ${(Math.hypot(o.vx,o.vz)/1.5).toFixed(3)} of incoming`);
 }
});

test('rack balls carry their pocket when potted, for the drop animation',()=>{
 const balls=rack();Object.assign(balls[0],{x:-W+.02,z:L-.02});step(balls,1/240,()=>{},()=>{});
 assert.equal(balls[0].potted,true);assert.equal(balls[0].pocket,4);
});

test('a best-of-three match counts frames, alternates the break and ends at two',()=>{
 const m=newMatch(3);assert.equal(framesToWin(m),2);assert.deepEqual(m.frames,[0,0]);
 // Finish a frame by potting the last black with the score in someone's favour.
 const endFrame=(scores)=>{
  m.balls.forEach(b=>{if(b.value)b.potted=true;});m.target=7;m.shotTarget=7;m.first=7;
  m.potted=[m.balls.find(b=>b.value===7)];m.scores=scores;finishShot(m);
 };
 endFrame([60,20]);assert.equal(m.finished,true);assert.equal(m.matchOver,false);assert.deepEqual(m.frames,[1,0]);
 nextFrame(m);
 assert.equal(m.finished,false);assert.equal(m.frame,1);assert.equal(m.turn,1,'the computer breaks the second frame');
 assert.equal(m.inHand,true);assert.deepEqual(m.scores,[0,0]);assert.equal(m.balls.filter(b=>!b.potted).length,22);
 endFrame([10,70]);assert.deepEqual(m.frames,[1,1]);assert.equal(m.matchOver,false);
 nextFrame(m);assert.equal(m.turn,0,'and you break the third');
 endFrame([55,40]);assert.deepEqual(m.frames,[2,1]);assert.equal(m.matchOver,true);
 // The final black's 7 goes to whoever was at the table.
 assert.deepEqual(m.frameScores,[[67,20],[10,77],[62,40]]);
 // No more frames once the match is over.
 const before=m.frame;nextFrame(m);assert.equal(m.frame,before);
});

test('a single-frame match ends with the frame, and practice never counts frames',()=>{
 const one=newMatch();assert.equal(one.bestOf,1);
 one.balls.forEach(b=>{if(b.value)b.potted=true;});Object.assign(one,{target:7,shotTarget:7,first:7,scores:[30,10]});one.potted=[one.balls.find(b=>b.value===7)];finishShot(one);
 assert.equal(one.matchOver,true);
 const drill=newPractice();drill.balls.forEach(b=>{if(b.value)b.potted=true;});Object.assign(drill,{target:7,shotTarget:7,first:7});drill.potted=[drill.balls.find(b=>b.value===7)];finishShot(drill);
 assert.equal(drill.finished,true);assert.deepEqual(drill.frames,[0,0]);assert.equal(drill.matchOver,false);
});

test('cushion rebounds follow the measured two-contact model',async()=>{
 const {CUSHION_RESTITUTION,CUSHION_FRICTION}=await import('../lib/snooker-game.ts');
 assert.equal(CUSHION_RESTITUTION,.98);assert.equal(CUSHION_FRICTION,.14);
 const rebound=(speed,degrees)=>{
  const a=degrees*Math.PI/180,b=ball(0,0,W-RADIUS-.002,.6);
  Object.assign(b,{vx:Math.cos(a)*speed,vz:-Math.sin(a)*speed});b.wx=b.vz/RADIUS;b.wz=-b.vx/RADIUS;b.wy=0;
  for(let i=0;i<40&&b.vx>0;i++)step([b],1/240,()=>{},()=>{});
  return {normal:-b.vx/(Math.cos(a)*speed),angle:Math.atan2(-b.vz,-b.vx)*180/Math.PI,kept:Math.hypot(b.vx,b.vz)/speed,spin:b};
 };
 for(const speed of [.5,2,4]){
  const straight=rebound(speed,0);
  // Rolling straight in: most of the normal speed comes back, never more.
  assert.ok(straight.normal>.85&&straight.normal<.95,`straight-in rebound ${straight.normal.toFixed(2)} at ${speed} m/s`);
  // At an angle the friction shortens the angle off the cushion, and a rolling
  // ball's forward spin then bends the path wider again as it grips the cloth.
  const angled=rebound(speed,45);
  assert.ok(angled.angle<45&&angled.angle>30,`45° in leaves at ${angled.angle.toFixed(1)}°`);
  assert.ok(angled.kept>.75&&angled.kept<.92);
 }
 // The impact is scale-free: double the speed, same angles.
 assert.ok(Math.abs(rebound(1,45).angle-rebound(2,45).angle)<.2);
});

test('a colour whose spot is taken goes to the highest free spot, else above its own spot',()=>{
 const spots=Object.fromEntries(rack().filter(b=>b.value>1).map(b=>[b.value,{x:b.x,z:b.z}]));
 // Pink spot covered by a red: the pink goes on the black spot.
 const pink=ball(1,6,0,0);pink.potted=true;
 let balls=[ball(0,0,0,1.2),pink,ball(2,1,spots[6].x,spots[6].z+.01),ball(3,7,.4,.4)];
 respot(pink,balls);assert.deepEqual([pink.x,pink.z],[spots[7].x,spots[7].z]);
 // Black spot taken too: the pink takes the blue spot, the next highest.
 const blocker=ball(4,1,spots[7].x+.02,spots[7].z);pink.potted=true;balls=[...balls,blocker];
 respot(pink,balls);assert.deepEqual([pink.x,pink.z],[spots[5].x,spots[5].z]);
 // A yellow never takes a lower spot than its own rules allow: with only the green spot free, it goes there.
 const yellow=ball(5,2,0,0);yellow.potted=true;
 const others=[7,6,5,4,2].map((v,i)=>ball(10+i,1,spots[v].x,spots[v].z));
 respot(yellow,[ball(0,0,0,1.6),yellow,...others]);assert.deepEqual([yellow.x,yellow.z],[spots[3].x,spots[3].z]);
 // Every spot occupied: the black goes as near its spot as possible towards the top cushion.
 const black=ball(6,7,0,0);black.potted=true;
 const all=[7,6,5,4,3,2].map((v,i)=>ball(20+i,1,spots[v].x,spots[v].z));
 respot(black,[ball(0,0,0,1.6),black,...all]);
 assert.equal(black.x,spots[7].x);assert.ok(black.z<spots[7].z&&spots[7].z-black.z<RADIUS*2+.002,`black at z ${black.z.toFixed(4)}`);
 // ...and below its spot if the line to the top cushion is blocked as well.
 const black2=ball(7,7,0,0);black2.potted=true;
 const wall=[];for(let z=spots[7].z;z>-L+RADIUS;z-=RADIUS*1.8)wall.push(ball(40+wall.length,1,0,z));
 respot(black2,[ball(0,0,0,1.6),black2,...all,...wall]);
 assert.equal(black2.x,0);assert.ok(black2.z>spots[7].z);
});

test('colours potted together are respotted highest value first',()=>{
 const m=newMatch(),spots=Object.fromEntries(rack().filter(b=>b.value>1).map(b=>[b.value,{x:b.x,z:b.z}]));
 // A foul pots the pink and the black while a red sits on the black spot.
 const pink=m.balls.find(b=>b.value===6),black=m.balls.find(b=>b.value===7),red=m.balls.find(b=>b.value===1);
 Object.assign(red,{x:spots[7].x,z:spots[7].z+.005});pink.potted=black.potted=true;
 beginShot(m,0,10);m.first=6;m.potted=[pink,black];m.shotTarget=1;finishShot(m);
 // Black (higher) is placed first and takes the free pink spot; pink then
 // finds its own spot taken and goes to the next highest free one, the blue's... unless free.
 assert.deepEqual([black.x,black.z],[spots[6].x,spots[6].z]);
 assert.ok(!pink.potted&&!(pink.x===spots[6].x&&pink.z===spots[6].z));
});

test('snookers required and when a player concedes the frame',()=>{
 const m=newMatch(3);
 // Colours only, yellow on: 27 left. Behind by 40: 13 beyond the table, 4 a snooker on yellow.
 m.balls.forEach(b=>{if(b.value===1)b.potted=true;});m.target=2;m.scores=[60,20];m.turn=1;
 assert.equal(pointsRemaining(m),27);assert.equal(snookersRequired(m,1),Math.ceil(13/4));assert.equal(snookersRequired(m,0),0);
 // Level with the points left is not "needing snookers": a tie respots the black.
 m.scores=[47,20];assert.equal(snookersRequired(m,1),0);
 m.scores=[48,20];assert.equal(snookersRequired(m,1),1);
 // On the pink, a snooker is worth 6.
 m.balls.forEach(b=>{if(b.value>1&&b.value<6)b.potted=true;});m.target=6;m.scores=[40,10];
 assert.equal(pointsRemaining(m),13);assert.equal(snookersRequired(m,1),Math.ceil(17/6));
 // Club standard: one snooker on the colours is enough to shake hands; a beginner plays on.
 m.scores=[25,10];assert.equal(snookersRequired(m,1),1);
 assert.equal(wouldConcede(m,1,{snookers:2,onColours:1}),true);
 assert.equal(wouldConcede(m,1,{snookers:3,onColours:2}),false);
 concedeFrame(m,1);
 assert.equal(m.finished,true);assert.deepEqual(m.frames,[1,0]);assert.equal(m.frameWinner,0);assert.deepEqual(m.frameScores,[[25,10]]);
 assert.match(m.message,/認輸/);
 // With reds still on, it takes two snookers before the club player concedes.
 const r=newMatch(3);r.turn=1;r.scores=[150,0];
 assert.equal(pointsRemaining(r),147);assert.equal(snookersRequired(r,1),1);assert.equal(wouldConcede(r,1,{snookers:2,onColours:1}),false);
 r.scores=[160,0];assert.equal(snookersRequired(r,1),4);assert.equal(wouldConcede(r,1,{snookers:2,onColours:1}),true);
 // Practice frames are never conceded; a finished frame cannot be conceded twice.
 const drill=newPractice();drill.scores=[0,200];assert.equal(wouldConcede(drill,0,{snookers:1,onColours:1}),false);
 concedeFrame(m,0);assert.deepEqual(m.frames,[1,0]);
 // Conceding while ahead still gives the frame to the opponent.
 const ahead=newMatch(3);ahead.scores=[50,0];concedeFrame(ahead,0);assert.equal(ahead.frameWinner,1);assert.deepEqual(ahead.frames,[0,1]);
});
