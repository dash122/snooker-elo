import { TABLE_POCKETS } from './snooker-table.ts';
// Metres and seconds. Fixed 240 Hz stepping keeps fast balls from tunnelling.
export const WIDTH = 1.778, LENGTH = 3.569, RADIUS = .02625;
export const POCKETS = [[-WIDTH/2,-LENGTH/2],[WIDTH/2,-LENGTH/2],[-WIDTH/2,0],[WIDTH/2,0],[-WIDTH/2,LENGTH/2],[WIDTH/2,LENGTH/2]];
export type Ball = { id:number; value:number; x:number; z:number; vx:number; vz:number; potted:boolean; wx?:number; wz?:number; wy?:number; pocket?:number };
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
// A squared response puts most of the bar where most real shots are played:
// 25% ≈ half a table, 50% ≈ two lengths, 75% ≈ six (cue ball, no cushions).
export const CUE_SPEED_MIN = .4, CUE_SPEED_MAX = 4.02, POWER_RESPONSE_EXPONENT = 2;
const CUE_EFFECTIVE_MASS = .5, BALL_MASS = .141, TIP_RESTITUTION = .73;
/** How many table lengths a centre-ball strike at this power runs on open cloth. */
export function paceLengths(power:number){
 const b={id:0,value:0,x:0,z:0,vx:0,vz:0,potted:false};strike(b,0,power);
 const v=Math.hypot(b.vx,b.vz),rolling=5/7*v;
 return ((v*v-rolling*rolling)/(2*CLOTH_SLIDING_FRICTION*9.81)+rolling*rolling/(2*CLOTH_ROLLING_DECELERATION))/LENGTH;
}
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
// Cushion impact after Mathavan, Jackson & Parkin (2010), "A theoretical
// analysis of billiard ball dynamics under cushion impacts", fitted to their
// snooker measurements. The cushion nose touches the ball 7R/5 above the cloth
// (θ = asin .4 above the centre), so it also presses the ball into the slate.
// Two contacts act at once: the cushion (restitution .98, friction .14) and the
// cloth under the ball (sliding friction .21). The impulse is integrated in
// small steps through compression and then restitution, ending when the
// restitution work reaches e² of the compression work. That is why a rolling
// ball leaves with its topspin largely killed and a fast ball "checks" off
// the cushion, and why side spin, screw and follow each change the angle.
export const CUSHION_RESTITUTION=.98, CUSHION_FRICTION=.14;
const CUSHION_SIN=.4,CUSHION_COS=Math.sqrt(1-CUSHION_SIN*CUSHION_SIN);
function cushion(b:Ball,nx:number,nz:number){
 // Local frame: x into the cushion, y along it, z up (right-handed).
 const ax=-nx,az=-nz,tx=az,tz=-ax,R=RADIUS,s=CUSHION_SIN,c=CUSHION_COS,mw=CUSHION_FRICTION,ms=CLOTH_SLIDING_FRICTION;
 let vx=b.vx*ax+b.vz*az;if(vx<=0)return;
 let vy=b.vx*tx+b.vz*tz,wx=(b.wx??0)*ax+(b.wz??0)*az,wy=(b.wx??0)*tx+(b.wz??0)*tz,wz=b.wy??0;
 const dP=vx/100,k=1/(.4*R*R); // impulse per unit mass per step
 const push=()=>{
  // Slip at the cushion contact, in its tangent plane (along y, and up the nose).
  const u1=vy+R*(c*wz-s*wx),u2=-s*vx-R*wy,u=Math.hypot(u1,u2);
  const f1=u>1e-9?-mw*dP*u1/u:0,f2=u>1e-9?-mw*dP*u2/u:0;
  const fIx=-s*f2,fIy=f1,fIz=c*f2;
  // The cloth carries the downward push; its friction opposes slip at the base.
  const dPC=Math.max(0,s*dP-fIz),ux=vx-R*wy,uy=vy+R*wx,uc=Math.hypot(ux,uy);
  const fCx=uc>1e-9?-ms*dPC*ux/uc:0,fCy=uc>1e-9?-ms*dPC*uy/uc:0;
  vx+=-c*dP+fIx+fCx;vy+=fIy+fCy;
  wx+=k*(-R*s*fIy+R*fCy);wy+=k*(R*(s*fIx-c*fIz)-R*fCx);wz+=k*R*c*fIy;
 };
 let work=0;
 for(let i=0;i<4000&&vx>0;i++){push();work+=dP*c*Math.max(0,vx);}
 const target=CUSHION_RESTITUTION**2*work;let back=0;
 for(let i=0;i<4000&&back<target;i++){push();back+=dP*c*Math.max(0,-vx);}
 b.vx=vx*ax+vy*tx;b.vz=vx*az+vy*tz;b.wx=wx*ax+wy*tx;b.wz=wx*az+wy*tz;b.wy=wz;
}
export function moving(balls:Ball[]) { return balls.some(b=>!b.potted && (Math.hypot(b.vx,b.vz)>.001||RADIUS*Math.hypot(b.wx??0,b.wz??0)>.001)); }
// Pockets. Each cushion ends in a rounded jaw: a circle of JAW radius tangent
// to the nose line where the cut begins (matching the rounded cushion ends the
// table draws). A ball that clips a jaw is deflected like any cushion contact,
// so a slow ball can wobble in and a hard one rattles out, as on a real table.
// The ball drops once its centre passes the slate fall. The fall radii are
// tuned so a dead-weight ball has roughly the margin of a club table: about
// ±21 mm either side of centre into a corner or straight into a middle. The
// middle fall is set back behind the nose line, so a ball running along the
// side cushion has to get between the jaws rather than roll over the hole.
export const JAW_RADIUS=.02, CORNER_FALL=.056, MIDDLE_FALL=TABLE_POCKETS.middleCut, MIDDLE_SETBACK=TABLE_POCKETS.middleSetback;
const W2=WIDTH/2,L2=LENGTH/2;
/** The pocket (index into POCKETS) whose fall the ball centre is over, or -1. */
export function pocketAt(x:number,z:number){
  const ax=Math.abs(x),az=Math.abs(z);
  if(Math.hypot(W2+MIDDLE_SETBACK-ax,az)<MIDDLE_FALL||(ax>W2+RADIUS*.5&&az<TABLE_POCKETS.middleCut))return x<0?2:3;
  if(Math.hypot(W2-ax,L2-az)<CORNER_FALL||ax>W2+RADIUS*.5||az>L2+RADIUS*.5)return (z<0?0:4)+(x<0?0:1);
  return -1;
}
// Cushions and jaws, solved in the positive quadrant and mirrored back.
function rails(b:Ball,onImpact?:Impact){
  const sx=b.x<0?-1:1,sz=b.z<0?-1:1,ax=Math.abs(b.x),az=Math.abs(b.z),c=TABLE_POCKETS.cornerCut,m=TABLE_POCKETS.middleCut;
  if(ax<W2-RADIUS-JAW_RADIUS&&az<L2-RADIUS-JAW_RADIUS)return;
  const before=onImpact?Math.hypot(b.vx,b.vz):0;let hit=false;
  if(ax>W2-RADIUS&&az>=m&&az<=L2-c){b.x=sx*(W2-RADIUS);hit=b.vx*sx>0;cushion(b,-sx,0);}
  else if(az>L2-RADIUS&&ax<=W2-c){b.z=sz*(L2-RADIUS);hit=b.vz*sz>0;cushion(b,0,-sz);}
  else for(const [jx,jz] of [[W2+JAW_RADIUS,m],[W2+JAW_RADIUS,L2-c],[W2-c,L2+JAW_RADIUS]]){
    const dx=ax-jx,dz=az-jz,d=Math.hypot(dx,dz);
    if(d>=JAW_RADIUS+RADIUS||d<1e-9)continue;
    // As with ball contacts, back up along the path to the moment of touching
    // so the jaw turns the ball through the true angle.
    const cx=jx*sx,cz=jz*sz,rx=b.x-cx,rz=b.z-cz,vv=b.vx*b.vx+b.vz*b.vz,rv=rx*b.vx+rz*b.vz,reach=JAW_RADIUS+RADIUS;
    const back=vv>1e-12&&rv<0?Math.min(1/120,(rv+Math.sqrt(Math.max(0,rv*rv-vv*(d*d-reach*reach))))/vv):0;
    b.x-=b.vx*back;b.z-=b.vz*back;
    const ex=b.x-cx,ez=b.z-cz,e=Math.hypot(ex,ez)||1,nx=ex/e,nz=ez/e,k=Math.max(0,reach-e);
    b.x+=nx*k;b.z+=nz*k;hit=hit||b.vx*nx+b.vz*nz<0;cushion(b,nx,nz);
    b.x+=b.vx*back;b.z+=b.vz*back;
  }
  if(hit&&onImpact)onImpact('cushion',before);
}
export type Impact=(kind:'ball'|'cushion'|'pocket',speed:number)=>void;
export function step(balls:Ball[],dt:number,onContact:(value:number)=>void,onPot:(ball:Ball)=>void,onImpact?:Impact) {
  for(const b of balls) {
    if(b.potted) continue;
    b.wx??=b.vz/RADIUS;b.wz??=-b.vx/RADIUS;b.wy??=0;
    // Most of the table is at rest for most of a shot.
    if(b.vx!==0||b.vz!==0||b.wx!==0||b.wz!==0||b.wy!==0){
    const sx=b.vx+RADIUS*b.wz,sz=b.vz-RADIUS*b.wx,slip=Math.hypot(sx,sz);
    // Solid sphere I=2/5 mr². Clamp friction at the slide-to-roll transition.
    if(slip>.00001){const j=Math.min(CLOTH_SLIDING_FRICTION*9.81*dt,slip/3.5),fx=-sx/slip*j,fz=-sz/slip*j;b.vx+=fx;b.vz+=fz;b.wx-=2.5*fz/RADIUS;b.wz+=2.5*fx/RADIUS;}
    else{const v=Math.hypot(b.vx,b.vz),k=v?Math.max(0,v-CLOTH_ROLLING_DECELERATION*dt)/v:0;b.vx*=k;b.vz*=k;b.wx=b.vz/RADIUS;b.wz=-b.vx/RADIUS;}
    // Spin about the vertical axis is bled off by the contact patch: about
    // 5μR g/2R with μR≈.011 for a napped cloth, roughly 10 rad/s².
    b.wy=Math.sign(b.wy)*Math.max(0,Math.abs(b.wy)-SIDE_SPIN_DECAY*dt);
    b.x+=b.vx*dt; b.z+=b.vz*dt;
    rails(b,onImpact);
    }
    const pocket=pocketAt(b.x,b.z);
    if(pocket>=0) { onImpact?.('pocket',Math.hypot(b.vx,b.vz));b.potted=true;b.pocket=pocket;b.vx=b.vz=b.wx=b.wz=b.wy=0;onPot(b); }
  }
  for(let i=0;i<balls.length;i++) for(let j=i+1;j<balls.length;j++) {
    const a=balls[i],b=balls[j]; if(a.potted||b.potted||(a.vx===0&&a.vz===0&&b.vx===0&&b.vz===0)) continue;
    const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    if(d>=RADIUS*2||d<1e-9) continue;
    // Rewind the pair to the instant they touched. Resolving the collision
    // where a fast ball has already sunk in would turn the cut angle by a
    // degree or more, differently for every pace: pots would be a lottery.
    const wx=b.vx-a.vx,wz=b.vz-a.vz,ww=wx*wx+wz*wz,rw=dx*wx+dz*wz;
    const back=ww>1e-12&&rw<0?Math.min(dt,(rw+Math.sqrt(Math.max(0,rw*rw-ww*(d*d-RADIUS*RADIUS*4))))/ww):0;
    a.x-=a.vx*back;a.z-=a.vz*back;b.x-=b.vx*back;b.z-=b.vz*back;
    const cx=b.x-a.x,cz=b.z-a.z,gap=Math.hypot(cx,cz),nx=cx/gap,nz=cz/gap,overlap=Math.max(0,RADIUS*2-gap)/2;
    a.x-=nx*overlap;a.z-=nz*overlap;b.x+=nx*overlap;b.z+=nz*overlap;
    const relative=(a.vx-b.vx)*nx+(a.vz-b.vz)*nz;
    if(relative<=0) continue;
    const impulse=relative*(1+BALL_RESTITUTION)/2;onImpact?.('ball',relative);
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
    a.x+=a.vx*back;a.z+=a.vz*back;b.x+=b.vx*back;b.z+=b.vz*back;
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
export type PotOption={angle:number;quality:number;value:number;pocket:number;cut:number;ball:number};
const isLegal=(target:number,b:Ball)=>!b.potted&&(target===-1?b.value>1:b.value===target);
// Is any other ball within a ball's width of the segment (x,z)→(ex,ez)?
function blocked(balls:Ball[],a:Ball,b:Ball|null,x:number,z:number,ex:number,ez:number){
 const vx=ex-x,vz=ez-z,d2=vx*vx+vz*vz;
 return balls.some(o=>{if(o===a||o===b||o.potted)return false;
  const t=Math.max(0,Math.min(1,((o.x-x)*vx+(o.z-z)*vz)/d2));
  return Math.hypot(o.x-x-t*vx,o.z-z-t*vz)<RADIUS*2.03;
 });
}
function optionsFor(balls:Ball[],wanted:(b:Ball)=>boolean):PotOption[]{
 const cue=balls[0],options:PotOption[]=[];
 for(const ball of balls.filter(b=>!b.potted&&b!==cue&&wanted(b)))for(const [pocket,[px,pz]] of POCKETS.entries()){
  const distance=Math.hypot(px-ball.x,pz-ball.z);if(distance<1e-6)continue;
  const nx=(px-ball.x)/distance,nz=(pz-ball.z)/distance;
  const gx=ball.x-nx*RADIUS*2,gz=ball.z-nz*RADIUS*2,dx=gx-cue.x,dz=gz-cue.z,length=Math.hypot(dx,dz),cut=(dx*nx+dz*nz)/length;
  if(!Number.isFinite(cut)||cut<.18||Math.abs(gx)>WIDTH/2-RADIUS||Math.abs(gz)>LENGTH/2-RADIUS)continue;
  // A middle pocket closes up as the ball comes in along the cushion.
  if(pz===0&&Math.abs(nx)<.42)continue;
  if(blocked(balls,cue,ball,cue.x,cue.z,gx,gz)||blocked(balls,cue,ball,ball.x,ball.z,px,pz))continue;
  options.push({angle:Math.atan2(dx,-dz)*180/Math.PI,quality:cut*3-(length+distance)*.35+ball.value*.12,value:ball.value,pocket,cut,ball:ball.id});
 }
 return options.sort((a,b)=>b.quality-a.quality);
}
export function potOptions(balls:Ball[],target:number):PotOption[]{return optionsFor(balls,b=>isLegal(target,b));}
/** Can the cue ball reach any legal ball in a straight line (i.e. not snookered)? */
export function canSee(balls:Ball[],target:number){
 const cue=balls[0];
 return balls.some(b=>b!==cue&&isLegal(target,b)&&!blocked(balls,cue,b,cue.x,cue.z,b.x,b.z));
}
// Does this stroke pot the given ball in the given pocket?
function potsBall(balls:Ball[],id:number,pocket:number,angle:number,power:number,spin:Spin){
 const trial=balls.map(b=>({...b})),ball=trial.find(b=>b.id===id)!;let struck=false;strike(trial[0],angle,power,spin);
 // Only the object ball's journey matters here, so stop as soon as it ends.
 for(let frame=0;frame<240*20;frame++){
  step(trial,1/240,()=>{},()=>{});
  if(ball.potted)return ball.pocket===pocket;
  const rolling=ball.vx!==0||ball.vz!==0;
  if(rolling)struck=true;else if(struck||!moving(trial))return false;
 }
 return false;
}
// The middle of the run of aims around `angle` (degrees) that satisfies `pots`,
// searching outwards from the ghost-ball aim so few strokes need simulating.
function windowCentre(angle:number,pots:(angle:number)=>boolean){
 const STEP=.08,REACH=13,seen=new Map<number,boolean>();
 const hit=(k:number)=>{if(Math.abs(k)>REACH)return false;let v=seen.get(k);if(v===undefined){v=pots(angle+k*STEP);seen.set(k,v);}return v;};
 for(let n=0;n<=REACH;n++)for(const k of n?[n,-n]:[0]){
  if(!hit(k))continue;
  let low=k,high=k;while(hit(low-1))low--;while(hit(high+1))high++;
  return angle+(low+high)/2*STEP;
 }
 return null;
}
/** Aim assist: line the cue ball up to pot ball `id`. `cycle` steps through
 * the pockets that ball can go in (best first). The aim allows for throw, so
 * it is the true potting angle rather than the textbook ghost ball. Returns
 * a full-ball aim with pocket -1 when the ball has no pot on. */
export function aimAtBall(balls:Ball[],id:number,cycle=0,power=50,spin:Spin={top:0,side:0}):{angle:number;pocket:number}{
 const cue=balls[0],ball=balls.find(b=>b.id===id&&!b.potted&&b!==cue);
 if(!ball)return {angle:0,pocket:-1};
 const options=optionsFor(balls,b=>b.id===id);
 if(!options.length)return {angle:Math.atan2(ball.x-cue.x,cue.z-ball.z)*180/Math.PI,pocket:-1};
 const option=options[((cycle%options.length)+options.length)%options.length],pace=Math.max(power,40);
 return {angle:windowCentre(option.angle,a=>potsBall(balls,id,option.pocket,a,pace,spin))??option.angle,pocket:option.pocket};
}
/** The easiest pot on, lined up; null when nothing is pottable. */
export function bestAim(balls:Ball[],target:number,power=50){
 const option=potOptions(balls,target)[0];
 return option?{...aimAtBall(balls,option.ball,0,power),ball:option.ball}:null;
}
// Baulk line and the D, for ball in hand.
export const BAULK_Z=1.047, D_RADIUS=.292;
export function clampToD(x:number,z:number){
 const dz=Math.max(0,z-BAULK_Z),d=Math.hypot(x,dz),k=d>D_RADIUS-.001?(D_RADIUS-.001)/d:1;
 return {x:x*k,z:BAULK_Z+dz*k};
}
export function freeSpot(balls:Ball[],x:number,z:number){return balls.every(b=>b.value===0||b.potted||Math.hypot(b.x-x,b.z-z)>RADIUS*2.02);}
/** Where a player would put the cue ball in the D: on the easiest pot. */
export function cueSpotInD(balls:Ball[],target:number){
 const spots=[[-.12,1.22],[.12,1.22],[0,1.2],[-.22,1.1],[.22,1.1],[0,1.3],[-.2,1.24],[.2,1.24],[0,1.08]].filter(([x,z])=>freeSpot(balls,x,z));
 let best=spots[0]??[0,1.2],bestQuality=-Infinity;
 for(const [x,z] of spots){
  const trial=balls.map(b=>b.value===0?{...b,x,z,potted:false}:b),quality=potOptions(trial,target)[0]?.quality??-9;
  if(quality>bestQuality+1e-9){bestQuality=quality;best=[x,z];}
 }
 return {x:best[0],z:best[1]};
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
 const powers=wide?[28,44,62,82]:[34,54,74],tops=wide?[-1,-.5,0,.5,1]:[-1,0,1];
 for(const option of potOptions(balls,target).slice(0,wide?4:3)){
  // Contact friction throws a cut ball off the line of centres, so the textbook
  // ghost-ball aim often misses. Aim at the middle of the angles that pot it,
  // as a player who allows for throw does, and judge the shot from there.
  const aim=windowCentre(option.angle,a=>potsBall(balls,option.ball,option.pocket,a,55,{top:0,side:0}))??option.angle;
  for(const power of powers){
  // Long pots and thin cuts are percentage shots, as for a real player: weigh
  // the normal mass of each one-sigma bin of cue error that still pots. Screw
  // and follow do not move the object ball, so one estimate serves every tip height.
  const error=cueError(power,{top:0,side:0},aimReach(balls,aim))*errorScale;
  const chance=[.061,.242,.383,.242,.061].reduce((sum,w,i)=>sum+(i===2||potsBall(balls,option.ball,option.pocket,aim+(i-2)*error,power,{top:0,side:0})?w:0),0)/.989;
  for(const top of tops){
  const shot={angle:aim,power,spin:{top,side:0}},{ok,trial,pots}=simulate(balls,target,shot.angle,power,shot.spin);
  if(!ok)continue;
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
  }
 }
 return found.sort((a,b)=>b.score-a.score);
}
/** Plans like a player of the given cue error: weighs every pot by how it
 * survives that error, looks one shot further ahead for the strongest
 * candidates (as a professional plans the next ball, not just this one), and
 * turns to safety when the percentage is poor. `errorScale` 1 is a club
 * player; lower is stronger. `lookAhead` costs roughly twice the time. */
export function planShot(balls:Ball[],target:number,errorScale=1,lookAhead=false,attack=.5):ShotPlan|null {
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
 if(best?.kind==='pot')best={...best,shot:{...best.shot,angle:allowForThrow(balls,target,best.shot)}};
 // Shot selection: take the pot on when the percentage justifies it,
 // otherwise play safe, as a real player weighs a miss against the leave.
 if(best&&best.chance>=attack)return best;
 const safety=planSafety(balls,target,errorScale);
 return safety??best;
}
// Contact friction throws a cut ball off the line of centres, so the
// ghost-ball aim sits near one edge of the window that pots it. Like a
// professional allowing for throw, aim at the middle of that window instead.
function allowForThrow(balls:Ball[],target:number,shot:ComputerShot){
 return windowCentre(shot.angle,a=>simulate(balls,target,a,shot.power,shot.spin).ok)??shot.angle;
}
// How awkward a position is for the player coming to the table (higher is
// better for whoever left it): no pot on, snookered behind another ball, a
// long way from the target, tight on a cushion, back in baulk.
function leave(trial:Ball[],reply:number){
 const cue=trial[0],threat=potOptions(trial,reply)[0];
 const far=Math.min(...trial.filter(b=>b!==cue&&isLegal(reply,b)).map(b=>Math.hypot(b.x-cue.x,b.z-cue.z)));
 const onRail=Math.min(W2-Math.abs(cue.x),L2-Math.abs(cue.z))<RADIUS*2.2;
 return (threat?-(threat.quality+1.5)*2.5:6)+(canSee(trial,reply)?0:5)+Math.min(far,2.6)*1.2+(onRail?1:0)+(cue.z>BAULK_Z?1:0);
}
// Safety: touch a legal ball at a range of thicknesses and paces (thin clips
// back to baulk, fuller contact to tuck in behind a colour) and keep the one
// that leaves the opponent least, checking it survives the player's cue error.
function planSafety(balls:Ball[],target:number,errorScale=1):ShotPlan|null {
 const cue=balls[0],found:{shot:ComputerShot;score:number;cueEnd:{x:number;z:number}}[]=[];
 const reply=(trial:Ball[])=>target===-1&&trial.some(b=>b.value===1&&!b.potted)?1:target;
 const legal=balls.filter(b=>b!==cue&&isLegal(target,b)).sort((a,b)=>Math.hypot(a.x-cue.x,a.z-cue.z)-Math.hypot(b.x-cue.x,b.z-cue.z)).slice(0,3);
 for(const ball of legal){
  const centre=Math.atan2(ball.x-cue.x,cue.z-ball.z)*180/Math.PI,half=Math.asin(Math.min(1,RADIUS*2/Math.hypot(ball.x-cue.x,ball.z-cue.z)))*180/Math.PI;
  for(const offset of [-.9,-.7,-.4,0,.4,.7,.9])for(const power of [20,32,46,62]){
   const shot={angle:centre+offset*half,power,spin:{top:0,side:0}},{fair,trial,pots}=simulate(balls,target,shot.angle,power,shot.spin);
   if(!fair||pots.length)continue;
   found.push({shot,score:leave(trial,reply(trial)),cueEnd:{x:trial[0].x,z:trial[0].z}});
  }
 }
 let best:ShotPlan|null=null,bestScore=-Infinity;
 for(const c of found.sort((a,b)=>b.score-a.score).slice(0,4)){
  const error=cueError(c.shot.power,c.shot.spin,aimReach(balls,c.shot.angle))*errorScale;
  let score=c.score*.5;
  for(const side of [-1,1]){
   const {fair,trial,pots}=simulate(balls,target,c.shot.angle+side*error,c.shot.power,c.shot.spin);
   score+=.25*(fair&&!pots.length?leave(trial,reply(trial)):-10);
  }
  if(score>bestScore){bestScore=score;best={shot:c.shot,kind:'safety',chance:1,cueEnd:c.cueEnd};}
 }
 return best;
}
/** Cue error scales. The coach plans as a professional (a full-length pot
 * about 60% of the time, a long 30° cut about 75%). The default opponent is a
 * decent club player: a straight black off its spot about nine times in ten,
 * a mid-range red about half the time, a long red one time in three. Your own
 * delivery uses a much smaller error so shots stay close to the preview. */
export const PRO_ERROR_SCALE = .32, PLAYER_ERROR_SCALE = .12;
export const COMPUTER_ERROR_SCALE = .45;
/** Opponent standards. `error` scales cue delivery, `attack` is the pot
 * percentage needed before taking a shot on, `touch` the pace/spin error. */
export const LEVELS={
 casual:{label:'初哥',error:.9,lookAhead:false,attack:.25,touch:.2},
 club:{label:'球會',error:COMPUTER_ERROR_SCALE,lookAhead:false,attack:.4,touch:.12},
 pro:{label:'職業',error:.25,lookAhead:true,attack:.6,touch:.05},
};
export type Level=keyof typeof LEVELS;
function touchShot(balls:Ball[],target:number):ShotPlan {
 const cue=balls[0],ball=balls.filter(b=>b!==cue&&isLegal(target,b)).sort((a,b)=>Math.hypot(a.x-cue.x,a.z-cue.z)-Math.hypot(b.x-cue.x,b.z-cue.z))[0];
 return {shot:{angle:ball?Math.atan2(ball.x-cue.x,cue.z-ball.z)*180/Math.PI:0,power:26,spin:{top:0,side:0}},kind:'safety',chance:1,cueEnd:{x:cue.x,z:cue.z}};
}
/** The opponent's chosen shot at a given standard; always returns a stroke. */
export function computerPlan(balls:Ball[],target:number,level:Level='club'):ShotPlan {
 const l=LEVELS[level];
 return planShot(balls,target,l.error,l.lookAhead,l.attack)??touchShot(balls,target);
}
export function computerShot(balls:Ball[],target:number,errorScale=COMPUTER_ERROR_SCALE,lookAhead=false):ComputerShot {
 return (planShot(balls,target,errorScale,lookAhead)??touchShot(balls,target)).shot;
}

// Cue delivery is never perfect, so long pots and thin cuts (where the error
// is magnified) go in only sometimes. Hitting harder and using side spin widen
// it, as on a real table. `errorScale` sets the player's standard.
export const CUE_ERROR_BASE = .06, CUE_ERROR_POWER = .1, CUE_ERROR_SIDE = .08;
// Judging the contact point is its own error (metres at the object ball). The
// physics turns it into a much larger miss on thin cuts, as on a real table.
export const CONTACT_ERROR = .0025;
export function cueError(power:number,spin:Spin,reach=Infinity){
 return CUE_ERROR_BASE+CUE_ERROR_POWER*(power/100)**2+CUE_ERROR_SIDE*Math.abs(spin.side)+(Number.isFinite(reach)?Math.atan(CONTACT_ERROR/Math.max(reach,RADIUS*2))*180/Math.PI:0);
}
/** How far the cue ball travels along `angle` before it meets a ball. */
export function aimReach(balls:Ball[],angle:number){
 const a=angle*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a),c=balls[0];let reach=Infinity;
 for(const b of balls){if(b===c||b.potted)continue;const x=b.x-c.x,z=b.z-c.z,t=x*dx+z*dz,h=x*x+z*z-t*t;if(t>0&&h<4*RADIUS*RADIUS)reach=Math.min(reach,t-Math.sqrt(4*RADIUS*RADIUS-h));}
 return reach;
}
export function deliverShot(shot:ComputerShot,random:()=>number=Math.random,errorScale=1,balls?:Ball[]):ComputerShot {
 const gauss=Math.sqrt(-2*Math.log(1-random()))*Math.cos(2*Math.PI*random());
 return {...shot,angle:shot.angle+gauss*cueError(shot.power,shot.spin,balls?aimReach(balls,shot.angle):Infinity)*errorScale};
}

// Apply the opponent's delivery once, after planning; never retry a missed shot.
export function deliverComputerShot(shot:ComputerShot,balls:Ball[],random:()=>number=Math.random,level:Level='club'):ComputerShot {
 const {error:scale,touch}=LEVELS[level],delivered=deliverShot(shot,random,scale,balls);
 const error=()=>random()+random()-1;
 return {...delivered,power:Math.max(5,Math.min(100,shot.power*(1+error()*touch))),
  spin:{top:Math.max(-1,Math.min(1,shot.spin.top+error()*touch)),side:shot.spin.side}};
}

export type Prediction=ReturnType<typeof predictShot>;
export function predictShot(balls:Ball[],angle:number,power:number,spin:Spin){
 const a=angle*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a),c=balls[0];
 let distance=Math.min(dx?(Math.sign(dx)*(WIDTH/2-RADIUS)-c.x)/dx:Infinity,dz?(Math.sign(dz)*(LENGTH/2-RADIUS)-c.z)/dz:Infinity),object:Ball|undefined;
 for(const b of balls){if(b===c||b.potted)continue;const x=b.x-c.x,z=b.z-c.z,t=x*dx+z*dz,h=x*x+z*z-t*t;if(t<=0||h>4*RADIUS*RADIUS)continue;const d=t-Math.sqrt(Math.max(0,4*RADIUS*RADIUS-h));if(d>=0&&d<distance){distance=d;object=b;}}
 const contact={x:c.x+dx*distance,z:c.z+dz*distance},copies=balls.map(b=>({...b})),cuePath:{x:number;z:number}[]=[],objectPath:{x:number;z:number}[]=[];
 const pots:{value:number;pocket:number;id:number}[]=[];let first:number|null=null;
 strike(copies[0],angle,power,spin);
 cuePath.push({x:c.x,z:c.z});
 // Follow the complete shot using the same fixed step as live play. Sampling
 // limits line geometry without truncating the predicted stopping position.
 for(let i=0;i<240*120;i++){
   step(copies,1/240,v=>{first??=v;},b=>pots.push({value:b.value,pocket:b.pocket??-1,id:b.id}));
   const settled=!moving(copies);
   if(i%2===0||settled){
     if(!copies[0].potted)cuePath.push({x:copies[0].x,z:copies[0].z});
     const b=copies.find(b=>b.id===object?.id);
     if(b&&!b.potted&&(objectPath.length||Math.hypot(b.x-object!.x,b.z-object!.z)>1e-8))objectPath.push({x:b.x,z:b.z});
   }
   if(settled)break;
 }
 const cueEnd={x:copies[0].x,z:copies[0].z,potted:copies[0].potted};
 // A visual sensitivity allowance, independent of random cue delivery.
 const approach=Math.hypot(contact.x-c.x,contact.z-c.z);
 const alignment=object?((object.x-contact.x)*dx+(object.z-contact.z)*dz)/(2*RADIUS):1;
 const cut=Math.sqrt(Math.max(0,1-alignment*alignment));
 const spread=.004+Math.min(1,approach/LENGTH)*.009+cut*.014+(power/100)**2*.006+Math.hypot(spin.top,spin.side)*.004;
 // How much of the object ball the cue ball covers, as a player sees it:
 // 1 is full ball, .5 half ball (a 30° cut), 0 the finest edge. `side` is
 // which side of the object ball the cue ball passes (-1 left, 1 right).
 const fraction=object?1-cut:0,side=object?-Math.sign(dx*(object.z-contact.z)-dz*(object.x-contact.x)):0;
 const objectPocket=pots.find(p=>p.id===object?.id)?.pocket??-1;
 return {contact,object,cuePath,objectPath,cueEnd,spread,approach,first,pots,objectPocket,fraction,side};
}
