import { pocketCut } from './snooker-table.ts';
// Metres and seconds. Fixed 240 Hz stepping keeps fast balls from tunnelling.
export const WIDTH = 1.778, LENGTH = 3.569, RADIUS = .02625;
export const POCKETS = [[-WIDTH/2,-LENGTH/2],[WIDTH/2,-LENGTH/2],[-WIDTH/2,0],[WIDTH/2,0],[-WIDTH/2,LENGTH/2],[WIDTH/2,LENGTH/2]];
export type Ball = { id:number; value:number; x:number; z:number; vx:number; vz:number; potted:boolean; wx?:number; wz?:number; wy?:number };
export const COLOURS = ['#f8f6e9','#c51e32','#edcd25','#318750','#714127','#2864c2','#e997b9','#17191c'];
export const NAMES = ['白球','紅球','黃球','綠球','啡球','藍球','粉紅球','黑球'];
// Snooker tracking found sliding friction 0.178–0.245 and rolling deceleration
// 0.124–0.126 m/s² (Mathavan et al., 2009). Use the measured midpoints.
export const CLOTH_SLIDING_FRICTION = .21, CLOTH_ROLLING_DECELERATION = .125;
// Maximum cue speed matches the measured long backspin shot of an elite player.
// Lower controls must allow very soft touch shots, so use a nonlinear response.
// Model the impact as a 0.5 kg effective cue mass against a 0.141 kg ball,
// with leather-tip restitution .73; these are calibration assumptions.
export const CUE_SPEED_MIN = .4, CUE_SPEED_MAX = 4.02, POWER_RESPONSE_EXPONENT = 1.3;
const CUE_EFFECTIVE_MASS = .5, BALL_MASS = .141, TIP_RESTITUTION = .73;
const CUE_TO_BALL_SPEED = (1 + TIP_RESTITUTION) * CUE_EFFECTIVE_MASS / (CUE_EFFECTIVE_MASS + BALL_MASS);
export function rack():Ball[] {
  const specs = [[0,-.12,1.22],[2,.29,1.047],[3,-.29,1.047],[4,0,1.047],[5,0,0],[6,0,-.89],[7,0,-1.46]];
  for(let row=0;row<5;row++) for(let col=0;col<=row;col++) specs.push([1,(col-row/2)*RADIUS*2.04,-.98-row*RADIUS*1.77]);
  return specs.map(([value,x,z],id)=>({id,value,x,z,vx:0,vz:0,potted:false}));
}
export type Spin={top:number;side:number};
export function strike(b:Ball,angle:number,power:number,spin:Spin={top:0,side:0}) {
 const a=angle*Math.PI/180,p=Math.max(0,Math.min(100,power))/100,v=(CUE_SPEED_MIN+(CUE_SPEED_MAX-CUE_SPEED_MIN)*Math.pow(p,POWER_RESPONSE_EXPONENT))*CUE_TO_BALL_SPEED,k=Math.max(1,Math.hypot(spin.top,spin.side));
 b.vx=Math.sin(a)*v;b.vz=-Math.cos(a)*v;b.wx=b.vz/RADIUS*1.25*spin.top/k;b.wz=-b.vx/RADIUS*1.25*spin.top/k;b.wy=v/RADIUS*1.25*spin.side/k;
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
export function step(balls:Ball[],dt:number,onContact:(value:number)=>void,onPot:(ball:Ball)=>void) {
  for(const b of balls) {
    if(b.potted) continue;
    b.wx??=b.vz/RADIUS;b.wz??=-b.vx/RADIUS;b.wy??=0;
    const sx=b.vx+RADIUS*b.wz,sz=b.vz-RADIUS*b.wx,slip=Math.hypot(sx,sz);
    // Solid sphere I=2/5 mr². Clamp friction at the slide-to-roll transition.
    if(slip>.00001){const j=Math.min(CLOTH_SLIDING_FRICTION*9.81*dt,slip/3.5),fx=-sx/slip*j,fz=-sz/slip*j;b.vx+=fx;b.vz+=fz;b.wx-=2.5*fz/RADIUS;b.wz+=2.5*fx/RADIUS;}
    else{const v=Math.hypot(b.vx,b.vz),k=v?Math.max(0,v-CLOTH_ROLLING_DECELERATION*dt)/v:0;b.vx*=k;b.vz*=k;b.wx=b.vz/RADIUS;b.wz=-b.vx/RADIUS;}
    b.wy=Math.sign(b.wy)*Math.max(0,Math.abs(b.wy)-2*dt);
    b.x+=b.vx*dt; b.z+=b.vz*dt;
    if(POCKETS.some(([x,z])=>Math.hypot(b.x-x,b.z-z)<pocketCut(z)-RADIUS*.5)) { b.potted=true;b.vx=b.vz=b.wx=b.wz=b.wy=0;onPot(b);continue; }
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
    const impulse=relative*.97;
    a.vx-=impulse*nx;a.vz-=impulse*nz;b.vx+=impulse*nx;b.vz+=impulse*nz;
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
type ComputerShot={angle:number;power:number;spin:Spin};
function potOptions(balls:Ball[],target:number){
 const cue=balls[0],options:{angle:number;quality:number}[]=[];
 for(const ball of balls.filter(b=>!b.potted&&(target===-1?b.value>1:b.value===target)))for(const [px,pz] of POCKETS){
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
  options.push({angle:Math.atan2(dx,-dz)*180/Math.PI,quality:cut*3-(length+distance)*.35+ball.value*.12});
 }
 return options.sort((a,b)=>b.quality-a.quality);
}
export function computerShot(balls:Ball[],target:number):ComputerShot {
 let best:ComputerShot|undefined,bestScore=-Infinity;
 // Bounded search uses the same fixed-step physics as live play. No aim noise.
 // Wide power and screw/follow range so it plays for position, not just the pot.
 for(const option of potOptions(balls,target).slice(0,5))for(const power of [22,34,48,64,82])for(const top of [-1,-.5,0,.5,1]){
  const shot={angle:option.angle,power,spin:{top,side:0}},trial=balls.map(b=>({...b}));
  let first:number|null=null;const pots:Ball[]=[];
  strike(trial[0],shot.angle,power,shot.spin);
  for(let frame=0;frame<240*30&&moving(trial);frame++)step(trial,1/240,v=>{if(first===null)first=v;},b=>pots.push(b));
  const valid=(value:number)=>target===-1?value>1&&value===first:value===target;
  if(moving(trial)||first===null||!valid(first)||pots.some(b=>!valid(b.value)))continue;
  const points=pots.reduce((sum,b)=>sum+b.value,0);if(!points)continue;
  const reds=trial.some(b=>b.value===1&&!b.potted);
  for(const ball of pots)if(ball.value>1&&(reds||target===-1))respot(ball,trial);
  const nextTarget=target===1?-1:reds?1:Math.min(...trial.filter(b=>b.value>1&&!b.potted).map(b=>b.value));
  const nextOptions=potOptions(trial,nextTarget),next=nextOptions[0];
  // Break-building: reward an easy next pot, spare options and a cue ball off
  // the cushions; power itself is barely penalised.
  const cueBall=trial[0],cushion=Math.min(WIDTH/2-Math.abs(cueBall.x),LENGTH/2-Math.abs(cueBall.z));
  const score=points+(next?10+next.quality*3+Math.min(nextOptions.length,4)*.6:0)-(cushion<RADIUS*3?1.5:0)-power*.004;
  if(score>bestScore){bestScore=score;best=shot;}
 }
 if(best)return best;
 const cue=balls[0],legal=balls.filter(b=>!b.potted&&(target===-1?b.value>1:b.value===target));
 const visible=legal.filter(ball=>!balls.some(b=>{
  if(b===cue||b===ball||b.potted)return false;
  const dx=ball.x-cue.x,dz=ball.z-cue.z,d2=dx*dx+dz*dz,t=((b.x-cue.x)*dx+(b.z-cue.z)*dz)/d2;
  return t>0&&t<1&&Math.hypot(b.x-cue.x-t*dx,b.z-cue.z-t*dz)<RADIUS*2;
 }));
 const ball=(visible.length?visible:legal).sort((a,b)=>Math.hypot(a.x-cue.x,a.z-cue.z)-Math.hypot(b.x-cue.x,b.z-cue.z))[0];
 return {angle:ball?Math.atan2(ball.x-cue.x,cue.z-ball.z)*180/Math.PI:0,power:26,spin:{top:0,side:0}};
}

// The table's pocket window is too narrow for continuous aim noise, so the
// computer instead misses outright now and then, more often on long shots.
export const COMPUTER_MISS_BASE = .07, COMPUTER_MISS_PER_METRE = .09;
export function humaniseShot(balls:Ball[],shot:ComputerShot,random:()=>number=Math.random):ComputerShot {
 const a=shot.angle*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a),c=balls[0];let reach=Infinity;
 for(const b of balls){if(b===c||b.potted)continue;const x=b.x-c.x,z=b.z-c.z,t=x*dx+z*dz;if(t>0&&x*x+z*z-t*t<4*RADIUS*RADIUS)reach=Math.min(reach,t);}
 if(random()>=COMPUTER_MISS_BASE+COMPUTER_MISS_PER_METRE*Math.min(Number.isFinite(reach)?reach:1,3))return shot;
 // A believable miss: a fraction of a degree, rattling the jaws rather than wild.
 return {...shot,angle:shot.angle+(random()<.5?-1:1)*(.3+random()*.6)};
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
