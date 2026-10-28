// Plans shots off the main thread so the table keeps animating while the
// professional (or the coach) thinks.
import { computerShot, planShot, PRO_ERROR_SCALE, type Ball } from '../../lib/snooker-game';

type Request={id:number;kind:'computer'|'coach';balls:Ball[];target:number};
self.onmessage=(event:MessageEvent<Request>)=>{
  const {id,kind,balls,target}=event.data;
  if(kind==='computer')self.postMessage({id,shot:computerShot(balls,target,PRO_ERROR_SCALE,true)});
  else self.postMessage({id,plan:planShot(balls,target,PRO_ERROR_SCALE,true)});
};
