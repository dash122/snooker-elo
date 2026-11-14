import { BAULK_Z, clampToD, freeSpot, LENGTH, RADIUS, rack, respot, strike, WIDTH, type Spin, type Ball } from './snooker-game.ts';
export type Match={balls:Ball[];scores:number[];turn:number;target:number;break:number;breakBalls:number[];best:number;first:number|null;potted:Ball[];shotTarget:number;finished:boolean;message:string;
  /** The striker may place the cue ball anywhere in the D (break-off, or after an in-off). */
  inHand:boolean;
  /** Solo break-building: no opponent, a miss just ends the break, and the cue ball may be placed anywhere. */
  practice?:boolean;
  /** Bumped after every completed shot, for anything that caches the layout. */
  shots:number;
  /** What the last shot did, for the commentary line and the coach. */
  last:null|{player:number;points:number;foul:boolean;penalty:number};
  /** Match length and progress. A frame ends with `finished`; the match with `matchOver`. */
  bestOf:number;frames:number[];frame:number;frameScores:number[][];matchOver:boolean};
export function newMatch(bestOf=1):Match{return {balls:rack(),scores:[0,0],turn:0,target:1,break:0,breakBalls:[],best:0,first:null,potted:[],shotTarget:1,finished:false,inHand:true,shots:0,last:null,message:'你先開波。',
  bestOf,frames:[0,0],frame:0,frameScores:[],matchOver:false};}
/** Frames needed to win the match. */
export function framesToWin(m:Pick<Match,'bestOf'>){return Math.floor(m.bestOf/2)+1;}
/** Rack the next frame. Players alternate the break-off, as in a real match. */
export function nextFrame(m:Match){
  if(!m.finished||m.matchOver)return;
  m.frame++;
  Object.assign(m,{balls:rack(),scores:[0,0],turn:m.frame%2,target:1,break:0,breakBalls:[],first:null,potted:[],shotTarget:1,finished:false,inHand:true,last:null,
    message:m.frame%2?'第 '+(m.frame+1)+' 局，電腦開波。':'第 '+(m.frame+1)+' 局，你開波。'});
  m.shots++;
}
/** The line-up: colours on their spots and fifteen reds down the middle of the
 * table. The standard routine for learning to keep the cue ball near the
 * black and pink, red–colour–red, without running out of position. */
export function lineUpRack():Ball[] {
  const colours=rack().filter(b=>b.value!==1).map(b=>b.value===0?{...b,x:.34,z:-1.02}:b);
  const reds=[-1.345,-1.235,-1.125,-1.01,-.77,-.66,-.55,-.44,-.33,-.22,-.11,.12,.23,.34,.45];
  return [...colours,...reds.map(z=>({id:0,value:1,x:0,z,vx:0,vz:0,potted:false}))].map((b,id)=>({...b,id}));
}
export function newPractice():Match{return {...newMatch(),balls:lineUpRack(),practice:true,message:'Line-up 練習：紅、彩、紅，一桿打到底。白球可以隨意擺位。'};}
export function beginShot(m:Match,angle:number,power:number,spin:Spin={top:0,side:0}){
 m.first=null;m.potted=[];m.shotTarget=m.target;m.inHand=false;strike(m.balls[0],angle,power,spin);
}
/** Ball in hand: move the cue ball inside the D. Returns false if another ball is in the way. */
export function placeCueBall(m:Match,x:number,z:number){
  if(!m.inHand)return false;
  const spot=m.practice?{x:Math.max(-WIDTH/2+RADIUS,Math.min(WIDTH/2-RADIUS,x)),z:Math.max(-LENGTH/2+RADIUS,Math.min(LENGTH/2-RADIUS,z))}:clampToD(x,z);
  if(!freeSpot(m.balls,spot.x,spot.z))return false;
  Object.assign(m.balls[0],spot);return true;
}
// After an in-off the cue ball comes back to the D, on the first free spot.
function cueToD(m:Match){
  const cue=m.balls[0];
  for(const [x,z] of [[0,BAULK_Z+.15],[-.14,BAULK_Z+.15],[.14,BAULK_Z+.15],[0,BAULK_Z+.25],[-.2,BAULK_Z+.05],[.2,BAULK_Z+.05]]){
    if(freeSpot(m.balls,x,z)){Object.assign(cue,{x,z,potted:false,vx:0,vz:0,wx:0,wz:0,wy:0});return;}
  }
  respot(cue,m.balls);
}
/** Points still on the table for the player at the table. */
export function pointsRemaining(m:Pick<Match,'balls'|'target'>){
  const reds=m.balls.filter(b=>b.value===1&&!b.potted).length;
  if(reds||m.target===-1)return reds*8+27+(m.target===-1?7:0);
  return m.balls.filter(b=>b.value>1&&!b.potted).reduce((sum,b)=>sum+b.value,0);
}
export function finishShot(m:Match){
  const valid=(v:number)=>m.shotTarget===-1?v>1&&v===m.first:v===m.shotTarget;
  const foul=m.first===null||!valid(m.first)||m.potted.some(b=>!valid(b.value));
  const reds=m.balls.some(b=>b.value===1&&!b.potted);
  const penalty=Math.max(4,m.first??0,...m.potted.map(b=>b.value),m.shotTarget);
  const points=m.potted.reduce((sum,b)=>sum+b.value,0),inOff=m.potted.some(b=>b.value===0);
  // Colours return during the red/colour phase, including fouled colours.
  for(const b of m.potted) if(b.value>1&&(reds||m.shotTarget===-1||foul))respot(b,m.balls);
  if(inOff){cueToD(m);m.inHand=true;}
  m.shots=(m.shots??0)+1;m.last={player:m.turn,points:foul?0:points,foul,penalty:foul?penalty:0};
  if(m.practice&&(foul||!points)){
    // Practising alone: nothing is conceded, the break simply starts again.
    m.break=0;m.breakBalls=[];m.message=foul?'犯規，單桿由零再嚟。':'未有入球，單桿由零再嚟。';
  }
  else if(foul){m.scores[1-m.turn]+=penalty;m.turn=1-m.turn;m.break=0;m.breakBalls=[];m.message=`犯規，對手加 ${penalty} 分。`;}
  else if(points){m.scores[m.turn]+=points;m.break+=points;m.breakBalls=[...m.breakBalls,...m.potted.map(b=>b.value)];m.best=Math.max(m.best,m.break);m.message=`入球得 ${points} 分，繼續出桿。`;}
  else {m.turn=1-m.turn;m.break=0;m.breakBalls=[];m.message='未有入球，交換出桿。';}
  if(!foul&&points&&m.shotTarget===1)m.target=-1;
  else if(reds)m.target=1;
  else m.target=Math.min(...m.balls.filter(b=>b.value>1&&!b.potted).map(b=>b.value));
  if(!Number.isFinite(m.target)){
    if(m.scores[0]===m.scores[1]&&!m.practice){respot(m.balls.find(b=>b.value===7)!,m.balls);m.target=7;m.message='平手，重置黑球決勝。';}
    else {
      m.finished=true;
      if(m.practice)m.message='清枱！';
      else{
        const winner=m.scores[0]>m.scores[1]?0:1;
        m.frames[winner]++;m.frameScores.push([...m.scores]);m.matchOver=m.frames[winner]>=framesToWin(m);
        m.message=winner===0?'你贏了這一局！':'電腦勝出這一局。';
      }
    }
  }
}
