import { NAMES, potOptions, type Ball, type ShotPlan, type Spin } from './snooker-game.ts';

/* A break-building coach. It reads the same physics as the game, but its
   advice is phrased for a real table: pace, cue-ball position, and the order
   of balls a century needs. */

// Seen from the baulk end, as the player addresses the table.
export const POCKET_NAMES = ['左頂袋','右頂袋','左中袋','右中袋','左底袋','右底袋'];

export function powerWord(power:number){return power<30?'輕力':power<50?'中力':power<70?'中大力':'大力';}
export function spinWord(spin:Spin){return spin.top>.3?'高桿跟進':spin.top<-.3?'低桿拉桿':Math.abs(spin.top)>.1?(spin.top>0?'略高桿':'略低桿'):'中桿';}
export function difficulty(quality:number){return quality>1.8?'容易':quality>.9?'中等':'困難';}

export function describePlan(plan:ShotPlan):string {
  const {shot}=plan;
  if(plan.kind==='safety')return `做防守：${powerWord(shot.power)}輕碰目標球，白球留遠，令對手無球可打。職業球員冇高把握入球時就會咁做。`;
  const option=plan.option!,next=plan.next;
  const pot=`打${NAMES[option.value]}入${POCKET_NAMES[option.pocket]}，${powerWord(shot.power)}（約 ${shot.power}%）${spinWord(shot.spin)}。`;
  const chance=plan.chance<.99?`入球把握約 ${Math.round(plan.chance*100)}%。`:'';
  const after=next?`白球會停喺可以打${NAMES[next.value]}入${POCKET_NAMES[next.pocket]}嘅位置（${difficulty(next.quality)}）。`:'白球位置一般，下一球要再諗。';
  return pot+chance+after;
}

export type ShotReview={potted:boolean;foul:boolean;power:number;spin:Spin;target:number;pottedValues:number[];ballsAfter:Ball[];targetAfter:number;stillTurn:boolean;advised?:ShotPlan};
export type Verdict={headline:string;tip:string;positionOk:boolean|null};

export function reviewShot(r:ShotReview):Verdict {
  if(r.foul)return {headline:'犯規',tip:'先確保白球第一下碰到合法目標球。冇把握入球時，安全碰到目標球都好過送分。',positionOk:null};
  if(!r.potted){
    if(r.power>70)return {headline:'失手',tip:'大力出桿誤差最大。除非要走位，入球優先用 40–60% 力度，出桿要直、跟進要完整。',positionOk:null};
    if(Math.abs(r.spin.side)>.3)return {headline:'失手',tip:'側旋會令白球偏離瞄準線。未練熟之前，用中桿配高低桿走位已經足夠打出 100 度。',positionOk:null};
    return {headline:'失手',tip:'薄切同長台成功率低。上一球要預留角度，令呢一球變得近同直；冇把握就做防守。',positionOk:null};
  }
  if(!r.stillTurn)return {headline:'入球',tip:'',positionOk:null};
  const next=potOptions(r.ballsAfter,r.targetAfter)[0];
  const colourChoice=r.target===-1&&r.pottedValues.some(v=>v>1&&v<6)&&r.ballsAfter.filter(b=>b.value===1&&!b.potted).length>3;
  if(!next)return {headline:'入球，但走位失敗',tip:'出桿前先決定白球要停喺邊，再揀力度同高低桿。'+(r.advised?.kind==='pot'?`教練建議係${powerWord(r.advised.shot.power)}${spinWord(r.advised.shot.spin)}。`:'試吓「教練建議」睇職業球員點走位。'),positionOk:false};
  const level=difficulty(next.quality);
  if(colourChoice)return {headline:`入球 · 下一球${level}`,tip:'紅球之後盡量打黑或粉紅：100 度大約要 10 粒紅配黑。練習時留位喺黑球附近。',positionOk:level!=='困難'};
  if(level==='困難')return {headline:'入球 · 下一球困難',tip:'下一球太遠或太薄。走位目標係「近、有少少角度」：完全直線會冇得走位，太薄就難入。',positionOk:false};
  return {headline:`入球 · 下一球${level}`,tip:level==='容易'?'好走位！保持呢個節奏：每球都諗定之後兩球。':'',positionOk:true};
}

export type CoachStats={shots:number;pots:number;positions:number;positionsOk:number;best:number};
export const EMPTY_STATS:CoachStats={shots:0,pots:0,positions:0,positionsOk:0,best:0};

export function record(stats:CoachStats,review:ShotReview,verdict:Verdict,breakNow:number):CoachStats {
  return {shots:stats.shots+1,pots:stats.pots+(review.potted?1:0),
    positions:stats.positions+(verdict.positionOk===null?0:1),positionsOk:stats.positionsOk+(verdict.positionOk?1:0),
    best:Math.max(stats.best,breakNow)};
}

/** What to practise next, on the game and on a real table, from where the
 *  player is now. Potting comes first, then pace, then the route to 100. */
export function focus(stats:CoachStats):{title:string;game:string;table:string} {
  if(stats.shots<10)return {title:'先打 10 球建立數據',game:'正常打，每球出桿前講出：打邊粒、入邊個袋、白球停邊。',table:'熱身：藍球放置點，白球放 D 區，直線入中袋 10 次。'};
  const potRate=stats.pots/stats.shots,positionRate=stats.positions?stats.positionsOk/stats.positions:0;
  if(potRate<.6)return {title:'重點：入球穩定度',game:'只揀近、直嘅球，用 30–50% 力度，唔用側旋，目標入球率 70%。',table:'直線練習：藍球入頂袋，白球由開球線出發，連續 10 球；再加長距離。'};
  if(positionRate<.55)return {title:'重點：力度與走位',game:'每球之前睇「教練建議」，留意佢揀嘅力度同高低桿，同你自己嘅諗法比較。',table:'中藍定點：藍球入中袋，用定桿、跟進、拉桿各打 10 次，令白球停喺指定區域。'};
  if(stats.best<50)return {title:'重點：線路規劃',game:'紅球後盡量打黑球，白球留喺紅球堆附近；連續 5 球冇失位先算過關。',table:'T 字練習：黑、粉紅、藍加一列紅球，紅–黑順序清枱；目標由 30 度做到 50 度。'};
  return {title:'重點：拆球堆與 100 度',game:'練習用跟進或拉桿入黑後撞開紅球堆，再接紅球。',table:'Line-up：15 粒紅排喺中線，配彩色球清枱；記錄最高分，目標 100。'};
}
