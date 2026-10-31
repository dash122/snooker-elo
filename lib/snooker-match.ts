import { rack, respot, respotAll, strike, type Spin, type Ball } from './snooker-game.ts';
export type Match={balls:Ball[];scores:number[];turn:number;target:number;break:number;breakBalls:number[];best:number;first:number|null;potted:Ball[];shotTarget:number;finished:boolean;message:string};
export function newMatch():Match{return {balls:rack(),scores:[0,0],turn:0,target:1,break:0,breakBalls:[],best:0,first:null,potted:[],shotTarget:1,finished:false,message:'你先開波。左右滑動轉向，開啟精細調整可慢慢修正角度。'};}
export function beginShot(m:Match,angle:number,power:number,spin:Spin={top:0,side:0}){
 m.first=null;m.potted=[];m.shotTarget=m.target;strike(m.balls[0],angle,power,spin);
}
export function finishShot(m:Match){
  const valid=(v:number)=>m.shotTarget===-1?v>1&&v===m.first:v===m.shotTarget;
  const foul=m.first===null||!valid(m.first)||m.potted.some(b=>!valid(b.value));
  const reds=m.balls.some(b=>b.value===1&&!b.potted);
  const penalty=Math.max(4,m.first??0,...m.potted.map(b=>b.value),m.shotTarget);
  const points=m.potted.reduce((sum,b)=>sum+b.value,0);
  // Colours return during the red/colour phase, including fouled colours.
  respotAll(m.potted.filter(b=>b.value===0||(b.value>1&&(reds||m.shotTarget===-1||foul))),m.balls);
  if(foul){m.scores[1-m.turn]+=penalty;m.turn=1-m.turn;m.break=0;m.breakBalls=[];m.message=`犯規，對手加 ${penalty} 分。`;}
  else if(points){m.scores[m.turn]+=points;m.break+=points;m.breakBalls=[...m.breakBalls,...m.potted.map(b=>b.value)];m.best=Math.max(m.best,m.break);m.message=`入球得 ${points} 分，繼續出桿。`;}
  else {m.turn=1-m.turn;m.break=0;m.breakBalls=[];m.message='未有入球，交換出桿。';}
  if(!foul&&points&&m.shotTarget===1)m.target=-1;
  else if(reds)m.target=1;
  else m.target=Math.min(...m.balls.filter(b=>b.value>1&&!b.potted).map(b=>b.value));
  if(!Number.isFinite(m.target)){
    if(m.scores[0]===m.scores[1]){respot(m.balls.find(b=>b.value===7)!,m.balls);m.target=7;m.message='平手，重置黑球決勝。';}
    else {m.finished=true;m.message=m.scores[0]>m.scores[1]?'你贏了這一局！':'電腦勝出這一局。';}
  }
}
