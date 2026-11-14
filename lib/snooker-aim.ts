import { aimReach, RADIUS, type Ball } from './snooker-game.ts';

/** Start a shot facing the nearest legal object ball the cue ball can reach
 * (falling back to the nearest one when snookered), without mutating the rack. */
export function nearestAim(balls:Ball[],target:number,fallback=0):number {
  const cue=balls.find(ball=>ball.value===0&&!ball.potted);
  if(!cue)return fallback;
  const facing=(ball:Ball)=>Math.atan2(ball.x-cue.x,cue.z-ball.z)*180/Math.PI;
  const legal=balls.filter(ball=>!ball.potted&&ball!==cue&&(target===-1?ball.value>1:ball.value===target))
    .sort((a,b)=>Math.hypot(a.x-cue.x,a.z-cue.z)-Math.hypot(b.x-cue.x,b.z-cue.z));
  if(!legal.length)return fallback;
  // Reachable: nothing else is met first along the line to its centre.
  const open=legal.find(ball=>Math.abs(aimReach(balls,facing(ball))-(Math.hypot(ball.x-cue.x,ball.z-cue.z)-RADIUS*2))<1e-6);
  return facing(open??legal[0]);
}
