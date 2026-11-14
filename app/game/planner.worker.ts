// Plans shots off the main thread so the table keeps animating while the
// opponent (or the coach) thinks.
import { computerPlan, cueSpotInD, planShot, PRO_ERROR_SCALE, type Ball, type Level } from '../../lib/snooker-game';

type Request={id:number;kind:'computer'|'coach';balls:Ball[];target:number;level?:Level;inHand?:boolean};
self.onmessage=(event:MessageEvent<Request>)=>{
  const {id,kind,balls,target,level,inHand}=event.data;
  if(kind==='coach'){self.postMessage({id,kind,plan:planShot(balls,target,PRO_ERROR_SCALE,true)});return;}
  // Ball in hand: choose the spot in the D first, then plan from there.
  const spot=inHand?cueSpotInD(balls,target):undefined;
  if(spot)Object.assign(balls[0],spot);
  self.postMessage({id,kind,plan:computerPlan(balls,target,level),spot});
};
