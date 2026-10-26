import { RADIUS, type Spin } from './snooker-game.ts';

/** Offset the whole cue line towards the selected point, in the shooter's view. */
export function cueContactOffset(angle:number,spin:Spin){
  const a=angle*Math.PI/180,k=Math.max(1,Math.hypot(spin.top,spin.side));
  const side=spin.side/k*RADIUS*.65,top=spin.top/k*RADIUS*.65;
  return {x:Math.cos(a)*side,y:top,z:Math.sin(a)*side};
}

export const STROKE_CONTACT_MS=1720;
export type Stroke={id:number;angle:number;power:number;origin:{x:number;z:number};startedAt:number;player:number;spin?:{top:number;side:number}};
export const CUE_HEIGHT=.035;
export const REST_SUPPORT_DISTANCE=.38;
export const REST_HEAD_CENTRE_HEIGHT=.026;
/** The rest stays on the aim line while the cue slides through its cross head. */
export function restSupport(origin:{x:number;z:number},angle:number){
  const a=angle*Math.PI/180;
  return {x:origin.x-Math.sin(a)*REST_SUPPORT_DISTANCE,y:REST_HEAD_CENTRE_HEIGHT,z:origin.z+Math.cos(a)*REST_SUPPORT_DISTANCE};
}
// Deliberately authored timing, inspired by fluid professional cueing rather
// than claiming frame measurements of one player's changing match routine.
export const CUE_LENGTH=58*.0254;
export const CUE_TIP_RADIUS=.00475;
export const CUE_BUTT_RADIUS=.01475;
export const CUE_ADDRESS_GAP=.004;
export const STROKE_END_MS=2720;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
export function bridgeDistance(power:number){return .23+.06*clamp(power/100);}
/** Discrete screw-on/telescopic butt section; the original cue is never scaled. */
export function cueExtension(gripFromTip:number){
  return Math.max(0,Math.ceil((gripFromTip+.12-CUE_LENGTH)/.30-1e-8))*.30;
}
function feather(t:number,duration:number,amplitude:number){
  const split=duration*.56;
  return CUE_ADDRESS_GAP+amplitude*(t<split?smooth(t/split):1-smooth((t-split)/(duration-split)));
}
/** Three relaxed feathers and a quiet look at the object ball, in milliseconds. */
export function cueFeather(elapsed:number,power:number){
  let t=((elapsed%1750)+1750)%1750;const amplitude=.027+.035*clamp(power/100);
  for(const [duration,scale] of [[470,1],[430,.85],[500,1.08]]){
    if(t<duration)return feather(t,duration,amplitude*scale);t-=duration;
  }
  return CUE_ADDRESS_GAP;
}
/** Positive = tip behind the ball surface; zero is the shared contact instant. */
export function cueStroke(elapsed:number,power:number,initial=CUE_ADDRESS_GAP){
  const p=clamp(power/100),back=CUE_ADDRESS_GAP+.065+.135*p;
  if(elapsed<120)return initial+(CUE_ADDRESS_GAP-initial)*smooth(elapsed/120);
  if(elapsed<530)return feather(elapsed-120,410,.025+.035*p);
  if(elapsed<910)return feather(elapsed-530,380,.023+.030*p);
  if(elapsed<1090)return CUE_ADDRESS_GAP;
  if(elapsed<1450)return CUE_ADDRESS_GAP+(back-CUE_ADDRESS_GAP)*smooth((elapsed-1090)/360);
  if(elapsed<1540)return back;
  if(elapsed<STROKE_CONTACT_MS){const t=(elapsed-1540)/(STROKE_CONTACT_MS-1540);return back*(1-t*t);}
  // Hermite continuation keeps velocity continuous through contact, then eases
  // to a power-dependent finish. Stay down and hold, never recoil after impact.
  const t=clamp((elapsed-STROKE_CONTACT_MS)/180),follow=.075+.065*p;
  return -2*back*(t*t*t-2*t*t+t)-follow*(-2*t*t*t+3*t*t);
}
