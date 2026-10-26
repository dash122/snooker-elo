import type { Ball } from './snooker-game.ts';

/** Start a shot facing the nearest legal object ball, without mutating the rack. */
export function nearestAim(balls:Ball[],target:number,fallback=0):number {
  const cue=balls.find(ball=>ball.value===0&&!ball.potted);
  if(!cue)return fallback;
  let nearest:Ball|undefined,distance=Infinity;
  for(const ball of balls){
    if(ball.potted||!(target===-1?ball.value>1:ball.value===target))continue;
    const next=Math.hypot(ball.x-cue.x,ball.z-cue.z);
    if(next>0&&next<distance){nearest=ball;distance=next;}
  }
  return nearest?Math.atan2(nearest.x-cue.x,cue.z-nearest.z)*180/Math.PI:fallback;
}

/** One screen-width swipe turns 120° normally, or 3° in precision mode. */
export function swipeAim(angle:number,deltaX:number,width:number,precise:boolean):number {
  const next=angle+deltaX/Math.max(1,width)*(precise?3:120);
  return ((next+180)%360+360)%360-180;
}
