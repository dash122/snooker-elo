import { TABLE_POCKETS, pocketCut } from './snooker-table.ts';
// Metres and seconds. Fixed 240 Hz stepping keeps fast balls from tunnelling.
export const WIDTH = 1.778, LENGTH = 3.569, RADIUS = .02625;
export const POCKETS = [[-WIDTH/2,-LENGTH/2],[WIDTH/2,-LENGTH/2],[-WIDTH/2,0],[WIDTH/2,0],[-WIDTH/2,LENGTH/2],[WIDTH/2,LENGTH/2]];
export type Ball = { id:number; value:number; x:number; z:number; vx:number; vz:number; potted:boolean; wx?:number; wz?:number; wy?:number };
export const COLOURS = ['#f8f6e9','#c51e32','#edcd25','#318750','#714127','#2864c2','#e997b9','#17191c'];
export const NAMES = ['白球','紅球','黃球','綠球','啡球','藍球','粉紅球','黑球'];
// Snooker tracking found sliding friction 0.178–0.245 and rolling deceleration
// 0.124–0.126 m/s² (Mathavan et al., 2009). Use the measured midpoints.
export const CLOTH_SLIDING_FRICTION = .21, CLOTH_ROLLING_DECELERATION = .125, SIDE_SPIN_DECAY = 10;
// Phenolic balls: restitution .94 and ball-ball friction ≈.06 (Alciatore).
export const BALL_RESTITUTION = .94, BALL_FRICTION = .06;
// Maximum cue speed matches the measured long backspin shot of an elite player.
// Lower controls must allow very soft touch shots, so use a nonlinear response.
// Model the impact as a 0.5 kg effective cue mass against a 0.141 kg ball,
// with leather-tip restitution .73; these are calibration assumptions.
export const CUE_SPEED_MIN = .4, CUE_SPEED_MAX = 4.02, POWER_RESPONSE_EXPONENT = 1.3;
const CUE_EFFECTIVE_MASS = .5, BALL_MASS = .141, TIP_RESTITUTION = .73;
export function rack():Ball[] {
  const specs = [[0,-.12,1.22],[2,.29,1.047],[3,-.29,1.047],[4,0,1.047],[5,0,0],[6,0,-.89],[7,0,-1.46]];
  for(let row=0;row<5;row++) for(let col=0;col<=row;col++) specs.push([1,(col-row/2)*RADIUS*2.04,-.98-row*RADIUS*1.77]);
  return specs.map(([value,x,z],id)=>({id,value,x,z,vx:0,vz:0,potted:false}));
}
export type Spin={top:number;side:number};
// Tip offset at full spin is half the ball radius (the miscue limit). An
// off-centre impulse puts more of the energy into rotation, so the ball leaves
// slower: the ball's effective mass at offset b is m/(1+5b²/2R²). Side also
// "squirts" the cue ball slightly away from the side used.
export const TIP_OFFSET_MAX = .5, SQUIRT_MAX_DEGREES = 1.6;
export function strike(b:Ball,angle:number,power:number,spin:Spin={top:0,side:0}) {
 const k=Math.max(1,Math.hypot(spin.top,spin.side)),top=spin.top/k,side=spin.side/k,offset2=TIP_OFFSET_MAX**2*(top*top+side*side);
 const a=(angle-SQUIRT_MAX_DEGREES*side)*Math.PI/180,p=Math.max(0,Math.min(100,power))/100,cue=CUE_SPEED_MIN+(CUE_SPEED_MAX-CUE_SPEED_MIN)*Math.pow(p,POWER_RESPONSE_EXPONENT);
 const v=cue*(1+TIP_RESTITUTION)*CUE_EFFECTIVE_MASS/(CUE_EFFECTIVE_MASS+BALL_MASS*(1+2.5*offset2));
 // Solid sphere: ω = 5vb/(2R²) for tip offset b along each axis.
 const w=2.5*v*TIP_OFFSET_MAX/RADIUS;
 b.vx=Math.sin(a)*v;b.vz=-Math.cos(a)*v;b.wx=b.vz/v*w*top;b.wz=-b.vx/v*w*top;b.wy=w*side;
}
function cushion(b:Ball,nx:number,nz:number){
 const n=b.vx*nx+b.vz*nz;if(n>=0)return;
 // Reduced planar cushion model: the nose contacts at 7R/5 above the cloth
 // (Mathavan et al., 2010), hence .4R above the centre. Evaluate v + w × r
 // at that point using the SAME right-handed axes as strike and cloth drag.
 // This couples horizontal-axis spin to side at oblique cushions. Backspin
 // never arbitrarily flips wy when the ball draws back or changes direction.
 const j=-1.9*n,tx=-nz,tz=nx,h=.4*RADIUS,arm=Math.sqrt(.84)*RADIUS;
 const slip=b.vx*tx+b.vz*tz+arm*(b.wy??0)+h*((b.wx??0)*nx+(b.wz??0)*nz);
 // Solid-sphere tangential effective inverse mass is 1 + R²/(.4R²).
 // Stop slip without an artificial tangential bounce; cap grazing impacts.
 const f=Math.max(-.28*j,Math.min(.28*j,-slip/3.5)),torque=2.5*f/(RADIUS*RADIUS);
 b.vx+=j*nx+f*tx;b.vz+=j*nz+f*tz;
 b.wy=(b.wy??0)+arm*torque;b.wx=(b.wx??0)+h*nx*torque;b.wz=(b.wz??0)+h*nz*torque;
}
export function moving(balls:Ball[]) { return balls.some(b=>!b.potted && (Math.hypot(b.vx,b.vz)>.001||RADIUS*Math.hypot(b.wx??0,b.wz??0)>.001)); }
// Real mouths: ~86 mm corners and ~90 mm middles for a 52.5 mm ball. A ball
// drops once its centre crosses the mouth while it still fits between the jaws.
// The cushions stop at the jaws, so a ball lined up with a mouth may run into
// it instead of being held off by the rail.
const CORNER_LANE=(TABLE_POCKETS.cornerCut*Math.SQRT2-RADIUS*2)/Math.SQRT2;
function inPocket(b:Ball,px:number,pz:number) {
  const along=Math.abs(b.x-px),across=Math.abs(b.z-pz);
  if(pz===0)return along<RADIUS*1.05&&across<TABLE_POCKETS.middleCut-RADIUS*.85;
  return along+across<pocketCut(pz)+RADIUS&&Math.abs(along-across)<CORNER_LANE;
}
function inMouth(b:Ball) {
  return POCKETS.some(([px,pz])=>{
    const along=Math.abs(b.x-px),across=Math.abs(b.z-pz);
    return pz===0?across<TABLE_POCKETS.middleCut-RADIUS*.85&&along<RADIUS*2:along+across<pocketCut(pz)+RADIUS*4&&Math.abs(along-across)<CORNER_LANE;
  });
}
export function step(balls:Ball[],dt:number,onContact:(value:number)=>void,onPot:(ball:Ball)=>void) {
  for(const b of balls) {
    if(b.potted) continue;
    b.wx??=b.vz/RADIUS;b.wz??=-b.vx/RADIUS;b.wy??=0;
    const sx=b.vx+RADIUS*b.wz,sz=b.vz-RADIUS*b.wx,slip=Math.hypot(sx,sz);
    // Solid sphere I=2/5 mr². Clamp friction at the slide-to-roll transition.
    if(slip>.00001){const j=Math.min(CLOTH_SLIDING_FRICTION*9.81*dt,slip/3.5),fx=-sx/slip*j,fz=-sz/slip*j;b.vx+=fx;b.vz+=fz;b.wx-=2.5*fz/RADIUS;b.wz+=2.5*fx/RADIUS;}
    else{const v=Math.hypot(b.vx,b.vz),k=v?Math.max(0,v-CLOTH_ROLLING_DECELERATION*dt)/v:0;b.vx*=k;b.vz*=k;b.wx=b.vz/RADIUS;b.wz=-b.vx/RADIUS;}
    // Spin about the vertical axis is bled off by the contact patch: about
    // 5μR g/2R with μR≈.011 for a napped cloth, roughly 10 rad/s².
    b.wy=Math.sign(b.wy)*Math.max(0,Math.abs(b.wy)-SIDE_SPIN_DECAY*dt);
    b.x+=b.vx*dt; b.z+=b.vz*dt;
    if(POCKETS.some(([x,z])=>inPocket(b,x,z))) { b.potted=true;b.vx=b.vz=b.wx=b.wz=b.wy=0;onPot(b);continue; }
    if(inMouth(b))continue;
    const bx=WIDTH/2-RADIUS,bz=LENGTH/2-RADIUS;
    if(Math.abs(b.x)>bx){const sign=Math.sign(b.x);b.x=sign*bx;cushion(b,-sign,0);}
    if(Math.abs(b.z)>bz){const sign=Math.sign(b.z);b.z=sign*bz;cushion(b,0,-sign);}

  }
  for(let i=0;i<balls.length;i++) for(let j=i+1;j<balls.length;j++) {
    const a=balls[i],b=balls[j]; if(a.potted||b.potted) continue;
    const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    if(d>=RADIUS*2||d<1e-9) continue;
    const nx=dx/d,nz=dz/d,overlap=(RADIUS*2-d)/2;
    a.x-=nx*overlap;a.z-=nz*overlap;b.x+=nx*overlap;b.z+=nz*overlap;
    const relative=(a.vx-b.vx)*nx+(a.vz-b.vz)*nz;
    if(relative<=0) continue;
    const impulse=relative*(1+BALL_RESTITUTION)/2;
    a.vx-=impulse*nx;a.vz-=impulse*nz;b.vx+=impulse*nx;b.vz+=impulse*nz;
    // Contact friction "throws" the object ball off the line of centres on cut
    // shots and with side, and passes a little of the side spin across. Slip
    // is the tangential surface velocity of a relative to b at the contact.
    const tx=-nz,tz=nx,slip=(a.vx-b.vx)*tx+(a.vz-b.vz)*tz-RADIUS*((a.wy??0)+(b.wy??0));
    if(Math.abs(slip)>1e-9){
      // Both balls: 1/m + R²/I = 3.5/m each, so the pair stops slipping at slip/7.
      const f=-Math.sign(slip)*Math.min(BALL_FRICTION*impulse,Math.abs(slip)/7);
      a.vx+=f*tx;a.vz+=f*tz;b.vx-=f*tx;b.vz-=f*tz;
      a.wy=(a.wy??0)-2.5*f/RADIUS;b.wy=(b.wy??0)-2.5*f/RADIUS;
    }
    if(a.value===0) onContact(b.value); if(b.value===0) onContact(a.value);
  }
}
export function respot(ball:Ball,balls:Ball[]) {
  const home=rack().find(b=>b.value===ball.value)!;
  // Search along the centre line, then the full cloth if the spot is occupied.
  const candidates=[{x:home.x,z:home.z}];
  for(let z=-LENGTH/2+.1;z<LENGTH/2-.1;z+=RADIUS*2.1) for(let x=-WIDTH/2+.1;x<WIDTH/2-.1;x+=RADIUS*2.1) candidates.push({x,z});
  const spot=candidates.find(p=>balls.every(b=>b===ball||b.potted||Math.hypot(b.x-p.x,b.z-p.z)>RADIUS*2.01));
  if(spot) Object.assign(ball,spot,{potted:false,vx:0,vz:0,wx:0,wz:0,wy:0});
}
export type ComputerShot={angle:number;power:number;spin:Spin};
export type PotOption={angle:number;quality:number;value:number;pocket:number;cut:number};
export function potOptions(balls:Ball[],target:number):PotOption[]{
 const cue=balls[0],options:PotOption[]=[];
 for(const ball of balls.filter(b=>!b.potted&&(target===-1?b.value>1:b.value===target)))for(const [pocket,[px,pz]] of POCKETS.entries()){
  const distance=Math.hypot(px-ball.x,pz-ball.z);if(distance<1e-6)continue;
  const nx=(px-ball.x)/distance,nz=(pz-ball.z)/distance;
  const gx=ball.x-nx*RADIUS*2,gz=ball.z-nz*RADIUS*2,dx=gx-cue.x,dz=gz-cue.z,length=Math.hypot(dx,dz),cut=(dx*nx+dz*nz)/length;
  if(!Number.isFinite(cut)||cut<.18||Math.abs(gx)>WIDTH/2-RADIUS||Math.abs(gz)>LENGTH/2-RADIUS)continue;
  const blocked=(x:number,z:number,ex:number,ez:number)=>{
   const vx=ex-x,vz=ez-z,d2=vx*vx+vz*vz;
   return balls.some(b=>{if(b===cue||b===ball||b.potted)return false;
    const t=Math.max(0,Math.min(1,((b.x-x)*vx+(b.z-z)*vz)/d2));
    return Math.hypot(b.x-x-t*vx,b.z-z-t*vz)<RADIUS*2.03;
   });
  };
  if(blocked(cue.x,cue.z,gx,gz)||blocked(ball.x,ball.z,px,pz))continue;
  options.push({angle:Math.atan2(dx,-dz)*180/Math.PI,quality:cut*3-(length+distance)*.35+ball.value*.12,value:ball.value,pocket,cut});
 }
 return options.sort((a,b)=>b.quality-a.quality);
}
function legalValue(target:number,value:number,first:number|null){return target===-1?value>1&&value===first:value===target;}
function nextTargetAfter(trial:Ball[],target:number){
 const reds=trial.some(b=>b.value===1&&!b.potted);
 return target===1?-1:reds?1:Math.min(...trial.filter(b=>b.value>1&&!b.potted).map(b=>b.value));
}
// Bounded search uses the same fixed-step physics as live play.
function simulate(balls:Ball[],target:number,angle:number,power:number,spin:Spin){
 const trial=balls.map(b=>({...b}));let first:number|null=null;const pots:Ball[]=[];
 strike(trial[0],angle,power,spin);
 for(let frame=0;frame<240*30&&moving(trial);frame++)step(trial,1/240,v=>{if(first===null)first=v;},b=>pots.push(b));
 const fair=!moving(trial)&&first!==null&&legalValue(target,first,first)&&pots.every(b=>legalValue(target,b.value,first));
 return {ok:fair&&pots.length>0,fair,trial,pots};
}
export type ShotPlan={shot:ComputerShot;kind:'pot'|'safety';option?:PotOption;chance:number;next?:PotOption;cueEnd:{x:number;z:number}};
/** Plans like a player of the given cue error: weighs every pot by how it
 * survives that error, plays for the next ball, and turns to safety when the
 * percentage is poor. `errorScale` 1 is a club player; lower is stronger. */
type Candidate={plan:ShotPlan;score:number;trial:Ball[];nextTarget:number;points:number};
// One level of the search: every pot × pace × screw/follow, each weighed by
// its chance under the player's cue error and by the position it leaves.
function candidates(balls:Ball[],target:number,errorScale:number,wide:boolean):Candidate[] {
 const found:Candidate[]=[];
 const powers=wide?[24,40,60,82]:[30,52,76],tops=wide?[-1,-.5,0,.5,1]:[-1,0,1];
 for(const option of potOptions(balls,target).slice(0,wide?4:3))for(const power of powers)for(const top of tops){
  const shot={angle:option.angle,power,spin:{top,side:0}},{ok,trial,pots}=simulate(balls,target,shot.angle,power,shot.spin);
  if(!ok)continue;
  // Long pots and thin cuts are percentage shots, as for a real player.
  const error=cueError(power,shot.spin)*errorScale,chance=(1+[-1,1].filter(k=>simulate(balls,target,shot.angle+k*error,power,shot.spin).ok).length)/3;
  const points=pots.reduce((sum,b)=>sum+b.value,0),cueEnd={x:trial[0].x,z:trial[0].z};
  const reds=trial.some(b=>b.value===1&&!b.potted);
  for(const ball of pots)if(ball.value>1&&(reds||target===-1))respot(ball,trial);
  const nextTarget=nextTargetAfter(trial,target),nextOptions=potOptions(trial,nextTarget),next=nextOptions[0];
  // Break-building: an easy next pot, spare options, the cue ball off the
  // cushions, and on a colour the black or pink rather than a low colour.
  const cushion=Math.min(WIDTH/2-Math.abs(cueEnd.x),LENGTH/2-Math.abs(cueEnd.z));
  const position=next?10+next.quality*3+Math.min(nextOptions.length,4)*.6+(nextTarget===-1?Math.max(...nextOptions.slice(0,3).map(o=>o.value))*.5:0):0;
  const score=chance*(points+position-(cushion<RADIUS*3?1.5:0))-(1-chance)*8-power*.004;
  found.push({plan:{shot,kind:'pot',option,chance,next,cueEnd},score,trial,nextTarget,points});
 }
 return found.sort((a,b)=>b.score-a.score);
}
/** Plans like a player of the given cue error: weighs every pot by how it
 * survives that error, looks one shot further ahead for the strongest
 * candidates (as a professional plans the next ball, not just this one), and
 * turns to safety when the percentage is poor. `errorScale` 1 is a club
 * player; lower is stronger. `lookAhead` costs roughly twice the time. */
export function planShot(balls:Ball[],target:number,errorScale=1,lookAhead=false):ShotPlan|null {
 const first=candidates(balls,target,errorScale,true);
 let best=first[0]?.plan??null;
 if(lookAhead&&first.length){
  let bestScore=-Infinity;
  for(const c of first.slice(0,3)){
   const follow=Number.isFinite(c.nextTarget)?candidates(c.trial,c.nextTarget,errorScale,false)[0]:undefined;
   const score=c.plan.chance*(c.points+(follow?Math.max(0,follow.score)+4:0))-(1-c.plan.chance)*8;
   if(score>bestScore){bestScore=score;best=c.plan;}
  }
 }
 if(best&&best.chance>.5)return best;
 const safety=planSafety(balls,target);
 return safety??best;
}
// Safety: touch a legal ball and leave the opponent nothing to pot, with the
// cue ball as far from their target as the table allows.
function planSafety(balls:Ball[],target:number):ShotPlan|null {
 const cue=balls[0];let best:ShotPlan|null=null,bestScore=-Infinity;
 const legal=balls.filter(b=>!b.potted&&(target===-1?b.value>1:b.value===target)).sort((a,b)=>Math.hypot(a.x-cue.x,a.z-cue.z)-Math.hypot(b.x-cue.x,b.z-cue.z)).slice(0,4);
 for(const ball of legal){
  const centre=Math.atan2(ball.x-cue.x,cue.z-ball.z)*180/Math.PI,half=Math.asin(Math.min(1,RADIUS*2/Math.hypot(ball.x-cue.x,ball.z-cue.z)))*180/Math.PI;
  for(const offset of [-.8,-.4,0,.4,.8])for(const power of [14,22,32]){
   const shot={angle:centre+offset*half,power,spin:{top:0,side:0}},{fair,trial,pots}=simulate(balls,target,shot.angle,power,shot.spin);
   if(!fair||pots.length)continue;
   const reply=target===-1&&trial.some(b=>b.value===1&&!b.potted)?1:target,threat=potOptions(trial,reply)[0];
   const far=Math.min(...trial.filter(b=>!b.potted&&(reply===-1?b.value>1:b.value===reply)).map(b=>Math.hypot(b.x-trial[0].x,b.z-trial[0].z)));
   const score=(threat?-threat.quality*3:6)+Math.min(far,2.5);
   if(score>bestScore){bestScore=score;best={shot,kind:'safety',chance:1,cueEnd:{x:trial[0].x,z:trial[0].z}};}
  }
 }
 return best;
}
/** The professional's cue error relative to a club player. */
export const PRO_ERROR_SCALE = .25;
export function computerShot(balls:Ball[],target:number,errorScale=PRO_ERROR_SCALE,lookAhead=true):ComputerShot {
 const plan=planShot(balls,target,errorScale,lookAhead);
 if(plan)return plan.shot;
 const cue=balls[0],legal=balls.filter(b=>!b.potted&&(target===-1?b.value>1:b.value===target));
 const ball=legal.sort((a,b)=>Math.hypot(a.x-cue.x,a.z-cue.z)-Math.hypot(b.x-cue.x,b.z-cue.z))[0];
 return {angle:ball?Math.atan2(ball.x-cue.x,cue.z-ball.z)*180/Math.PI:0,power:26,spin:{top:0,side:0}};
}

// Cue delivery is never perfect, so long pots and thin cuts (where the error
// is magnified) go in only sometimes. Hitting harder and using side spin widen
// it, as on a real table. `errorScale` sets the player's standard.
export const CUE_ERROR_BASE = .06, CUE_ERROR_POWER = .1, CUE_ERROR_SIDE = .08;
export function cueError(power:number,spin:Spin){
 return CUE_ERROR_BASE+CUE_ERROR_POWER*(power/100)**2+CUE_ERROR_SIDE*Math.abs(spin.side);
}
export function deliverShot(shot:ComputerShot,random:()=>number=Math.random,errorScale=1):ComputerShot {
 const gauss=Math.sqrt(-2*Math.log(1-random()))*Math.cos(2*Math.PI*random());
 return {...shot,angle:shot.angle+gauss*cueError(shot.power,shot.spin)*errorScale};
}

export function predictShot(balls:Ball[],angle:number,power:number,spin:Spin){
 const a=angle*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a),c=balls[0];
 let distance=Math.min(dx?(Math.sign(dx)*(WIDTH/2-RADIUS)-c.x)/dx:Infinity,dz?(Math.sign(dz)*(LENGTH/2-RADIUS)-c.z)/dz:Infinity),object:Ball|undefined;
 for(const b of balls){if(b===c||b.potted)continue;const x=b.x-c.x,z=b.z-c.z,t=x*dx+z*dz,h=x*x+z*z-t*t;if(t<=0||h>4*RADIUS*RADIUS)continue;const d=t-Math.sqrt(Math.max(0,4*RADIUS*RADIUS-h));if(d>=0&&d<distance){distance=d;object=b;}}
 const contact={x:c.x+dx*distance,z:c.z+dz*distance},copies=balls.map(b=>({...b})),cuePath:{x:number;z:number}[]=[],objectPath:{x:number;z:number}[]=[];
 strike(copies[0],angle,power,spin);
 cuePath.push({x:c.x,z:c.z});
 // Follow the complete shot using the same fixed step as live play. Sampling
 // limits line geometry without truncating the predicted stopping position.
 for(let i=0;i<240*120;i++){
   step(copies,1/240,()=>{},()=>{});
   const settled=!moving(copies);
   if(i%12===0||settled){
     cuePath.push({x:copies[0].x,z:copies[0].z});
     const b=copies.find(b=>b.id===object?.id);
     if(b&&!b.potted)objectPath.push({x:b.x,z:b.z});
   }
   if(settled)break;
 }
 const cueEnd={x:copies[0].x,z:copies[0].z,potted:copies[0].potted};
 return {contact,object,cuePath,objectPath,cueEnd};
}
