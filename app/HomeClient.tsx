Exit code: 0
Wall time: 0.3 seconds
Total output lines: 1786
Output:
"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CalibrationTrend, DEFAULT_AVATAR, Empty, InteractiveEloChart, NavIcon, PlayerBadge, PlayerCombobox, PlayerForm, RecentMatches, Scoreline, SortArrow, SortControls, Term, avatarHex, sortLabels, type EloTrendPoint, type SortKey } from "./UiBits";
import Availability from "./Availability";
import { isEntertainmentMode, neutralRatingSnapshot, roundedTeamEloDifference } from "../lib/entertainment-match";
import { addDaysHongKong, dayRangeHongKong, hkClock, hkDate, hkDayLabel, type AvailabilitySlot } from "../lib/availability";

type Player = {
  id: string; name: string; short: string; handicap: number | null; rating: number; colour?: string; avatar?: string | null;
  initialRating: number; active: boolean; wins: number; losses: number; draws: number;
  framesWon: number; framesLost: number; lastChange: number; form: string[];
};
type MatchMode = "1v1" | "2v2";
type Match = {
  id: string;
  a: string;
  b: string;
  a2?: string;
  b2?: string;
  mode?: MatchMode;
  teamAName?: string;
  teamBName?: string;
  scoreA: number;
  scoreB: number;
  playedOn: string;
  entryMode?: "match" | "aggregate";
  frameEvidence?: number;
  performanceScore?: number;
  evidenceWeight?: number;
  handicapAdjustment?: number;
  overHandicapElo?: number;
  overHandicapMultiplier?: number;
  highBreaks?: { playerId: string; value: number }[];
  actual: number;
  giver: string | null;
  official: number | null;
  extra: number;
  expectedA: number;
  beforeA: number;
  beforeB: number;
  afterA: number;
  afterB: number;
  beforeA2?: number;
  afterA2?: number;
  beforeB2?: number;
  afterB2?: number;
  deltaA: number;
  marginMultiplier?: number;
  status: "confirmed" | "void";
  createdAt: string;
};
type CalibrationPoint = { estimate:number; usableMatches:number; at:string };
type Calibration = { rawEstimate:number; estimate:number; lower:number; upper:number; curvatureEstimate?:number; curvatureLower?:number; curvatureUpper?:number; usableMatches:number; handicapLevels:number; confidence:string; updatedAt:string; history?:CalibrationPoint[] };
type Settings = { start: number; provisionalGames: number; kProvisional: number; kRated: number; conversion: number; cap: number; curvature?:number; handicapSoftCap?:number; winnerBonus?:number; overHandicapBoost?:number; overHandicapScale?:number; modelVersion?:number; calibration?:Calibration };
type AppState = { players: Player[]; matches: Match[]; settings: Settings; audits: { id: string; text: string; at: string }[] };

const seed: AppState = {
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature:1.25, handicapSoftCap:800, winnerBonus:.5, overHandicapBoost:.75, overHandicapScale:200, modelVersion:3 },
  players: [],
  matches: [],
  audits: [{ id:"seed",text:"建立 SCAA 公開群組及預設 ELO 設定",at:new Date().toISOString() }]
};

function games(p: Player) { return p.wins + p.losses + p.draws; }
function handicapAdjustment(points:number,s:Settings,conversion=s.conversion,curvature=s.curvature??1.25){
  if(!points)return 0;
  const raw=Math.sign(points)*conversion*10*(Math.abs(points)/10)**curvature;
  const ceiling=s.handicapSoftCap??800;
  return ceiling*Math.tanh(raw/ceiling);
}
function eloToHandicap(eloDifference:number,s:Settings){
  if(!eloDifference)return 0;
  const ceiling=s.handicapSoftCap??800,clamped=Math.min(Math.abs(eloDifference),ceiling*.995);
  const raw=ceiling*Math.atanh(clamped/ceiling);
  return Math.sign(eloDifference)*10*(raw/(Math.max(.01,s.conversion)*10))**(1/(s.curvature??1.25));
}
function roundToEven(value:number) {
  const rounded=Math.round(value/2)*2;
  return Object.is(rounded,-0)?0:rounded;
}
function clubMeanRating(data:AppState) {
  return data.players.length?data.players.reduce((sum,x)=>sum+x.rating,0)/data.players.length:data.settings.start;
}
function officialHandicapAnchor(data:AppState) {
  const official=data.players.map(x=>x.handicap).filter((x):x is number=>x!=null);
  return official.length?official.reduce((sum,x)=>sum+x,0)/official.length:0;
}
function suggestedHandicap(p: Player,data: AppState) {
  return roundToEven(officialHandicapAnchor(data)-eloToHandicap(p.rating-clubMeanRating(data),data.settings));
}
function recentFramesPerMatch(p:Player,data:AppState,count:number) {
  const matches=[...data.matches].filter(m=>m.status==="confirmed"&&!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const recent=matches.slice(0,count),prior=matches.slice(count,count*2);
  const perMatch=(list:Match[])=>list.length?list.reduce((sum,m)=>{const side=playerSide(m,p.id);return sum+(side==="A"?m.scoreA:m.scoreB)},0)/list.length:null;
  return {recent:perMatch(recent),prior:perMatch(prior)};
}
function winRate(p:Player){return games(p)?p.wins/games(p):0}
function frameRate(p:Player){const total=p.framesWon+p.framesLost;return total?p.framesWon/total:0}
function formScore(p:Player){return p.form.reduce((sum,x,i)=>sum+(x==="W"?1:x==="D"?.5:0)*(5-i),0)}
const DEFAULT_TRAILING_KEYS:SortKey[]=["rank","name","rating","form"];
function trailingStat(key:SortKey,p:Player,data:AppState,suggested:number){
  const eloText=`ELO ${Math.round(p.rating)}`;
  if(key==="change"){const swing=recentDeltaDays(p,data,10);return {big:`${swing>=0?"+":""}${Math.round(swing)}`,cls:swing>=0?"positive":"negative",sub:eloText}}
  if(key==="official")return {big:p.handicap==null?"—":p.handicap,sub:eloText};
  if(key==="suggested")return {big:suggested,sub:eloText};
  if(key==="games")return {big:games(p),sub:`${Math.round(winRate(p)*100)}% 勝率`};
  if(key==="winRate")return {big:`${Math.round(winRate(p)*100)}%`,sub:`${games(p)} 場`};
  if(key==="frameRate")return {big:`${Math.round(frameRate(p)*100)}%`,sub:eloText};
  return null;
}
function MobileSortHead({sort}:{sort:SortKey}){
  const trailingLabel=DEFAULT_TRAILING_KEYS.includes(sort)?"ELO":sortLabels[sort];
  return <div className="row-head-mobile" aria-hidden="true"><span>排名</span><span>球員</span><span>近況</span><span>{trailingLabel}</span></div>;
}
function sortPlayers(players:Player[],data:AppState,key:SortKey,dir:"asc"|"desc"){
  const ranks=new Map([...players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)).map((p,i)=>[p.id,i+1]));
  const value=(p:Player):number|string|null=>key==="rank"?ranks.get(p.id)??999:key==="name"?p.name:key==="rating"?p.rating:key==="change"?recentDeltaDays(p,data,10):key==="form"?formScore(p):key==="official"?p.handicap:key==="suggested"?suggestedHandicap(p,data):key==="games"?games(p):key==="winRate"?winRate(p):frameRate(p);
  return [...players].sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av==null&&bv==null)return a.name.localeCompare(b.name);
    if(av==null)return 1;if(bv==null)return -1;
    const cmp=typeof av==="string"?av.localeCompare(String(bv)):av-Number(bv);
    return (dir==="asc"?cmp:-cmp)||a.name.localeCompare(b.name);
  });
}
function matchMode(match: Match): MatchMode { return match.mode ?? "1v1"; }
function matchParticipants(match: Match){
  const result=[match.a,match.b];
  if(match.a2)result.push(match.a2);
  if(match.b2)result.push(match.b2);
  return result;
}
function isParticipant(match: Match,id:string){
  return match.a===id||match.b===id||match.a2===id||match.b2===id;
}
function playerSide(match: Match,id:string):"A"|"B"|null{
  if(match.a===id||match.a2===id) return "A";
  if(match.b===id||match.b2===id) return "B";
  return null;
}
function teamMemberIds(match: Match, side:"A"|"B"){ return side==="A"?[match.a,match.a2].filter(Boolean) as string[]:[match.b,match.b2].filter(Boolean) as string[]; }
function teamLabel(match: Match,data:AppState,side:"A"|"B"){
  if(isEntertainmentMode(match.mode)){
    const custom=(side==="A"?match.teamAName:match.teamBName)?.trim();
    return custom||`Team ${side}`;
  }
  const ids=teamMemberIds(match,side).map(id=>data.players.find(p=>p.id===id)?.short||"?");
  return ids[0]??"?";
}
function teamFullName(match: Match,data:AppState,side:"A"|"B"){
  if(isEntertainmentMode(match.mode)){
    const custom=(side==="A"?match.teamAName:match.teamBName)?.trim();
    return custom||`Team ${side}`;
  }
  const names=teamMemberIds(match,side).map(id=>data.players.find(p=>p.id===id)?.name||"已移除球員");
  return names.join(" & ")||"已移除球員";
}
function teamRating(match: Match,data:AppState,side:"A"|"B"){
  const ids=teamMemberIds(match,side);
  const ratings=ids.map(id=>data.players.find(p=>p.id===id)?.rating).filter((value):value is number=>typeof value==="number");
  return ratings.length?ratings.reduce((sum,value)=>sum+value,0)/ratings.length:0;
}
function teamHandicap(match: Match,data:AppState,side:"A"|"B"){
  const players=teamMemberIds(match,side).map(id=>data.players.find(p=>p.id===id)).filter((player):player is Player=>Boolean(player));
  return players.length?Math.round(players.reduce((sum,player)=>sum+suggestedHandicap(player,data),0)/players.length):null;
}
function playerMatchBefore(match:Match,playerId:string){
  if(match.a===playerId) return match.beforeA;
  if(match.b===playerId) return match.beforeB;
  if(match.a2===playerId) return match.beforeA2 ?? match.beforeA;
  if(match.b2===playerId) return match.beforeB2 ?? match.beforeB;
  return 0;
}
function playerMatchAfter(match:Match,playerId:string){
  if(match.a===playerId) return match.afterA;
  if(match.b===playerId) return match.afterB;
  if(match.a2===playerId) return match.afterA2 ?? match.afterA;
  if(match.b2===playerId) return match.afterB2 ?? match.afterB;
  return 0;
}
function playerSeries(p:Player,data:AppState){
  const related=[...data.matches].filter(m=>!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)).sort((a,b)=>(a.playedOn||a.createdAt).localeCompare(b.playedOn||b.createdAt)||a.createdAt.localeCompare(b.createdAt));
  return [p.initialRating,...related.map(m=>playerMatchAfter(m,p.id))];
}
function playerTrendPoints(p:Player,data:AppState):EloTrendPoint[]{
  const related=[...data.matches].filter(m=>m.status==="confirmed"&&!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)).sort((a,b)=>(a.playedOn||a.createdAt).localeCompare(b.playedOn||b.createdAt)||a.createdAt.localeCompare(b.createdAt));
  const start:EloTrendPoint={id:`${p.id}-start`,elo:p.initialRating,before:p.initialRating,delta:0,date:"",opponent:"",opponentShort:"",score:"",result:"start"};
  return [start,...related.map(match=>{
    const side=playerSide(match,p.id);
    const opponentSide=side==="A"?"B":"A";
    const opponentNames=teamFullName(match,data,opponentSide);
    const opponentShort=teamLabel(match,data,opponentSide);
    const ownScore=side==="A"?match.scoreA:match.scoreB;
    const opponentScore=side==="A"?match.scoreB:match.scoreA;
    const before=playerMatchBefore(match,p.id),elo=playerMatchAfter(match,p.id),delta=elo-before;
    return {id:match.id,elo,before,delta,date:match.playedOn,opponent:opponentNames,opponentShort,score:`${ownScore}–${opponentScore}`,result:ownScore===opponentScore?"D":ownScore>opponentScore?"W":"L"} satisfies EloTrendPoint;
  })];
}
function recentDelta(p:Player,data:AppState,count:number){
  return [...data.matches].filter(m=>!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,count).reduce((sum,m)=>{
    const side=playerSide(m,p.id);
    return sum + (side==="A"?m.deltaA:-m.deltaA);
  },0);
}
function recentDeltaDays(p:Player,data:AppState,days:number){
  const cutoff=new Date(Date.now()-days*864e5).toISOString().slice(0,10);
  const today=new Date().toISOString().slice(0,10);
  return data.matches.filter(m=>m.status==="confirmed"&&!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)&&(m.playedOn||m.createdAt.slice(0,10))>=cutoff&&(m.playedOn||m.createdAt.slice(0,10))<=today).reduce((sum,m)=>{
    const side=playerSide(m,p.id);
    return sum + (side==="A"?m.deltaA:-m.deltaA);
  },0);
}
function highestBreak(p:Player,data:AppState){
  const values=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>(m.highBreaks??[]).filter(b=>b.playerId===p.id&&b.value>0&&b.value<=147).map(b=>b.value));
  return values.length?Math.max(...values):null;
}
/** "我讓他 X 分" / "他讓我 X 分" — the same fair-handicap conversion the match form uses, read as a verdict about `me` vs. `p` rather than as a giver/points pair to apply. */
function handicapVerdict(me:Player,p:Player,s:Settings){
  const eloDifference=me.rating-p.rating;
  const points=roundToEven(eloToHandicap(eloDifference,s));
  const base=points===0?"平手":points>0?`建議我讓 ${points} 分`:`建議他讓 ${Math.abs(points)} 分`;
  return points!==0&&Math.abs(eloDifference)<30?`${base} · 勢均力敵`:base;
}
function calc(a: Player,b: Player,scoreA:number,scoreB:number,giver:string|null,points:number,s:Settings,giverSide?:"A"|"B"|null) {
  const actual = giverSide === "A" ? points : giverSide === "B" ? -points
    : giver === a.id ? points : giver === b.id ? -points : 0;
  const official = a.handicap == null || b.handicap == null ? null : b.handicap - a.handicap;
  const extra = actual - (official ?? 0);
  const adjustment = handicapAdjustment(actual,s);
  const expectedA = 1/(1+10**(((b.rating+adjustment)-a.rating)/400));
  const k = games(a)<s.provisionalGames || games(b)<s.provisionalGames ? s.kProvisional : s.kRated;
  const totalFrames = scoreA + scoreB;
  const frameShare = totalFrames ? scoreA/totalFrames : .5;
  const frameEvidence = Math.min(totalFrames,20);
  const bonus=s.winnerBonus??.5;
  const performanceScore=scoreA===scoreB?.5:scoreA>scoreB?(scoreA+bonus)/(totalFrames+bonus):scoreA/(totalFrames+bonus);
  // Below 4 frames there just isn't much evidence: sqrt(frameEvidence/4) alone
  // still let a single frame swing a rating almost as hard as a full match, so
  // scale linearly under 4 frames instead (continuous with the sqrt curve at
  // frameEvidence===4, unchanged above it).
  const evidenceWeight=frameEvidence<4?frameEvidence/4:Math.sqrt(frameEvidence/4);
  const baseDelta=k*evidenceWeight*(performanceScore-expectedA);
  const ratingDifference=a.rating-b.rating;
  const performerIsA=performanceScore>.5||(performanceScore===.5&&expectedA<.5);
  const overHandicapElo=performerIsA
    ? Math.max(0,adjustment-ratingDifference)
    : Math.max(0,ratingDifference-adjustment);
  const performanceMargin=performanceScore===.5?.6:.6+.4*Math.min(1,Math.abs(performanceScore-.5)/.5);
  // A generous handicap can make an early scratch match look like a lopsided
  // favourite; don't let a single low-evidence frame collect the full
  // over-handicap bonus/penalty for that gap — scale it down with the same
  // evidence weight (uncapped once there's a real match's worth of frames).
  const overHandicapMultiplier=1+(s.overHandicapBoost??.75)*Math.min(1,evidenceWeight)*(1-Math.exp(-overHandicapElo/(s.overHandicapScale??200)))*performanceMargin;
  const deltaA=baseDelta*overHandicapMultiplier;
  return { official,actual,extra,expectedA,deltaA,frameShare,frameEvidence,performanceScore,evidenceWeight,adjustment,overHandicapElo,overHandicapMultiplier };
}
function matchProbabilities(frameProbability:number,frames:number){
  if(frames<=0)return {win:0,draw:0,loss:0};
  const choose=(n:number,k:number)=>{let value=1;for(let i=1;i<=k;i++)value=value*(n-k+i)/i;return value};
  let win=0,draw=0;
  for(let k=0;k<=frames;k++){const probability=choose(frames,k)*frameProbability**k*(1-frameProbability)**(frames-k);if(k>frames/2)win+=probability;else if(k===frames/2)draw=probability;}
  return {win,draw,loss:1-win-draw};
}

function recalibrate(settings:Settings,matches:Match[]):Settings {
  const usable=matches.filter(m=>m.status==="confirmed"&&!isEntertainmentMode(m.mode)&&m.actual!==0&&(m.scoreA+m.scoreB)>0&&Number.isFinite(m.beforeA)&&Number.isFinite(m.beforeB));
  const n=usable.length, prior=8,priorCurve=1.25,currentCurve=settings.curvature??priorCurve;
  const levels=new Set(usable.map(m=>Math.abs(m.actual))).size;
  const now=new Date().toISOString();
  const oldHistory=settings.calibration?.history??[];
  if(n<10||levels<2) return {...settings,curvature:currentCurve,handicapSoftCap:settings.handicapSoftCap??800,winnerBonus:settings.winnerBonus??.5,overHandicapBoost:settings.overHandicapBoost??.75,overHandicapScale:settings.overHandicapScale??200,calibration:{rawEstimate:prior,estimate:settings.conversion,lower:1,upper:20,curvatureEstimate:currentCurve,curvatureLower:1,curvatureUpper:1.6,usableMatches:n,handicapLevels:levels,confidence:"資料不足",updatedAt:now,history:oldHistory}};
  let best=prior,bestCurve=priorCurve,bestLoss=Infinity;
  const losses:{candidate:number;curve:number;loss:number}[]=[];
  for(let candidate=1;candidate<=20;candidate+=.25){
    for(let curve=1;curve<=1.6001;curve+=.05){
      let loss=0,weight=0;
      for(const m of usable){
        const adjustment=handicapAdjustment(m.actual,settings,candidate,curve);
        const predicted=1/(1+10**(((m.beforeB+adjustment)-m.beforeA)/400));
        const frames=m.scoreA+m.scoreB,actual=m.scoreA/frames,evidence=Math.min(frames,20);
        loss+=evidence*(predicted-actual)**2;weight+=evidence;
      }
      loss/=weight;
      losses.push({candidate,curve,loss});
      if(loss<bestLoss){bestLoss=loss;best=candidate;bestCurve=curve;}
    }
  }
  const shrunk=(30*prior+n*best)/(30+n);
  const estimate=Math.max(1,Math.min(20,settings.conversion+Math.max(-.25,Math.min(.25,shrunk-settings.conversion))));
  const curveTarget=(60*priorCurve+n*bestCurve)/(60+n);
  const curvature=Math.max(1,Math.min(1.6,currentCurve+Math.max(-.02,Math.min(.02,curveTarget-currentCurve))));
  const threshold=bestLoss+Math.max(.0025,bestLoss*.1);
  const plausible=losses.filter(x=>x.loss<=threshold),rates=plausible.map(x=>x.candidate),curves=plausible.map(x=>x.curve);
  const lower=Math.min(...rates),upper=Math.max(...rates),curveLower=Math.min(...curves),curveUpper=Math.max(...curves);
  const confidence=n>=150&&levels>=5?"高":n>=75&&levels>=4?"中":n>=30&&levels>=3?"低":"初步";
  const rounded=Number(estimate.toFixed(2)),roundedCurve=Number(curvature.toFixed(2));
  const history=[...oldHistory,{estimate:rounded,usableMatches:n,at:now}].slice(-20);
  return {...settings,conversion:rounded,curvature:roundedCurve,handicapSoftCap:settings.handicapSoftCap??800,winnerBonus:settings.winnerBonus??.5,overHandicapBoost:settings.overHandicapBoost??.75,overHandicapScale:settings.overHandicapScale??200,calibration:{rawEstimate:Number(best.toFixed(2)),estimate:rounded,lower:Number(lower.toFixed(2)),upper:Number(upper.toFixed(2)),curvatureEstimate:roundedCurve,curvatureLower:Number(curveLower.toFixed(2)),curvatureUpper:Number(curveUpper.toFixed(2)),usableMatches:n,handicapLevels:levels,confidence,updatedAt:now,history}};
}

function replay(players:Player[],matches:Match[],settings:Settings) {
  const rebuilt=players.map(p=>({...p,rating:p.initialRating,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[] as string[]}));
  const byId=new Map(rebuilt.map(p=>[p.id,p]));
  const ordered=[...matches].filter(m=>m.status==="confirmed").sort((x,y)=>(x.playedOn||x.createdAt).localeCompare(y.playedOn||y.createdAt)||x.createdAt.localeCompare(y.createdAt));
  const updated=new Map<string,Match>();
  for(const m of ordered){
    const a=byId.get(m.a),b=byId.get(m.b);
    if(!a||!b)continue;
    const a2=m.a2?byId.get(m.a2):null;
    const b2=m.b2?byId.get(m.b2):null;
    if(isEntertainmentMode(m.mode)){
      if(!a2||!b2)continue;
      const state={players:rebuilt} as AppState;
      const averageA=tea…29030 tokens truncated…="true">–</strong>
      <div><b>{isTeamMode?teamBName:(b?.name??"球員 B")}</b><div className="score-row"><button type="button" aria-label={`${isTeamMode?teamBName:(b?.name??"球員 B")}減一局`} onClick={()=>changeScore("scoreB",-1)}>−</button><input className="score-value" aria-label={`${isTeamMode?teamBName:(b?.name??"球員 B")}局數`} type="number" inputMode="numeric" min="0" value={draft.scoreB} onChange={e=>update("scoreB",Math.max(0,+e.target.value))}/><button type="button" aria-label={`${isTeamMode?teamBName:(b?.name??"球員 B")}加一局`} onClick={()=>changeScore("scoreB",1)}>＋</button></div>
        {!isTeamMode&&b&&<div className="break-inline">{(breakOpen[b.id]||(draft.highBreaks??[]).some((item:{playerId:string})=>item.playerId===b.id))&&<p className="break-heading">已記錄嘅單桿</p>}<div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===b.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={`移除 ${b.name} 的 ${item.value} 分單桿度數`}>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[b.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(b.id)}}><input autoFocus className="break-value" aria-label={`${b.name} 單桿度數`} type="number" inputMode="numeric" min="1" max="147" placeholder="輸入度數" enterKeyHint="done" value={breakInput[b.id]??""} onChange={event=>setBreakInput(current=>({...current,[b.id]:event.target.value}))}/><button type="submit">記低</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[b.id]:true}))}>＋ 記錄單桿</button>}
        {breakMessage[b.id]&&<p className="break-encouragement" role="status">{breakMessage[b.id]}</p>}</div>}
      </div>
    </div></section>
    {preview&&totalFrames>0&&(draft.mode==="2v2"?<section ref={eloPreviewRef} className="elo-preview entertainment-preview"><b>潮拍娛樂模式</b><p>本場只記錄隊伍、讓分與比分；四位球員的目前 ELO、勝負、局數及近況均不會改變。</p></section>:<section ref={eloPreviewRef} className="elo-preview"><div><span><small>{a.name}</small><b className={preview.deltaA>=0?"positive":"negative"}>{preview.deltaA>=0?"+":""}{Math.round(preview.deltaA)} ELO</b></span><i aria-hidden="true">↔</i><span className="right"><small>{b.name}</small><b className={preview.deltaA<=0?"positive":"negative"}>{-preview.deltaA>=0?"+":""}{Math.round(-preview.deltaA)} ELO</b></span></div><details><summary>查看計算詳情</summary><p>{probabilities?`A 勝 ${Math.round(probabilities.win*100)}% · 和 ${Math.round(probabilities.draw*100)}% · `:""}表現分 {Math.round(preview.performanceScore*100)}% · 證據權重 ×{preview.evidenceWeight.toFixed(2)} · 讓分等效 {preview.adjustment>=0?"+":""}{Math.round(preview.adjustment)} ELO</p></details></section>)}
    <div className="match-save">{breakReminder&&<div className="break-save-reminder" role="status"><b>今場有冇值得記低嘅單桿？</b><span><button type="button" onClick={()=>{setBreakReminder(false);setBreakOpen({[a.id]:true,[b.id]:true})}}>返回記錄</button><button type="button" onClick={onSave}>今場沒有，照樣儲存</button></span></div>}<button className="primary full" disabled={!valid||data.players.length<2||saving} aria-busy={saving} onClick={()=>{if(!isTeamMode&&!editing&&(draft.highBreaks??[]).length===0){setBreakReminder(true);return}onSave()}}>{saving?"儲存中…":editing?"儲存變更":"儲存賽果"}<small>{saving?"請稍候":resultLabel}</small></button></div>
  </div>;
}

function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) { const [s,setS]=useState(data.settings);const field=(k:"start"|"provisionalGames"|"kProvisional"|"kRated"|"conversion"|"curvature"|"handicapSoftCap"|"winnerBonus"|"overHandicapBoost"|"overHandicapScale",label:string,step=1)=><label>{label}<input type="number" step={step} value={s[k]??""} onChange={e=>setS({...s,[k]:+e.target.value})}/></label>;return <><p className="kicker">公開管理</p><h2>編輯 ELO 設定</h2><p className="warning">任何人都可修改。儲存後會以新規則重播全部歷史評分。</p><div className="two">{field("start","起始 ELO")}{field("provisionalGames","臨時門檻")}{field("kProvisional","臨時 K")}{field("kRated","正式 K")}{field("conversion","10 分附近每點換算",.25)}{field("curvature","非線性讓分曲線",.01)}{field("handicapSoftCap","讓分等效 ELO 軟上限")}{field("winnerBonus","勝者虛擬局數",.1)}{field("overHandicapBoost","超額讓分最高加乘",.05)}{field("overHandicapScale","超額讓分加乘尺度")}</div><button className="primary full" onClick={()=>confirm("確定更新並重播全部歷史 ELO？")&&onSave(s)}>儲存並重播</button></>}
type RivalSnapshot = {
  opponent:Player; wins:number; losses:number; draws:number; matches:number;
  framesWon:number; framesLost:number; frameRate:number;
  latest:string; hasAggregate:boolean; label?:string;
};

function rivalSnapshots(player:Player,data:AppState):RivalSnapshot[] {
  const byOpponent=new Map<string,RivalSnapshot>();
  for(const match of data.matches){
    if(match.status!=="confirmed"||isEntertainmentMode(match.mode)||(match.a!==player.id&&match.b!==player.id))continue;
    const opponentId=match.a===player.id?match.b:match.a;
    const opponent=data.players.find(candidate=>candidate.id===opponentId);
    if(!opponent)continue;
    const first=match.a===player.id;
    const scored=first?match.scoreA:match.scoreB,conceded=first?match.scoreB:match.scoreA;
    const current=byOpponent.get(opponentId)??{opponent,wins:0,losses:0,draws:0,matches:0,framesWon:0,framesLost:0,frameRate:0,latest:"",hasAggregate:false};
    current.framesWon+=scored;current.framesLost+=conceded;
    current.latest=current.latest>match.playedOn?current.latest:match.playedOn;
    if(match.entryMode==="aggregate")current.hasAggregate=true;
    else{
      current.matches++;
      if(scored>conceded)current.wins++;else if(scored<conceded)current.losses++;else current.draws++;
    }
    byOpponent.set(opponentId,current);
  }
  const rivals=[...byOpponent.values()].map(rival=>{
    const totalFrames=rival.framesWon+rival.framesLost;
    return {...rival,frameRate:totalFrames?rival.framesWon/totalFrames:0};
  });
  const picks:{label:string;sort:(a:RivalSnapshot,b:RivalSnapshot)=>number}[]=[
    {label:"最多交手",sort:(a,b)=>b.matches-a.matches||(b.framesWon+b.framesLost)-(a.framesWon+a.framesLost)},
    {label:"最難應付",sort:(a,b)=>a.frameRate-b.frameRate||b.matches-a.matches},
    {label:"最佳對賽",sort:(a,b)=>b.frameRate-a.frameRate||b.matches-a.matches},
    {label:"勢均力敵",sort:(a,b)=>Math.abs(a.frameRate-.5)-Math.abs(b.frameRate-.5)||b.matches-a.matches},
    {label:"最近交手",sort:(a,b)=>b.latest.localeCompare(a.latest)}
  ];
  const selected:RivalSnapshot[]=[];
  for(const pick of picks){
    const rival=[...rivals].filter(item=>!selected.some(chosen=>chosen.opponent.id===item.opponent.id)).sort(pick.sort)[0];
    if(rival)selected.push({...rival,label:pick.label});
  }
  return selected;
}

function RivalrySnapshot({player,data,onCompare}:{player:Player;data:AppState;onCompare:(opponent:Player)=>void}) {
  const rivals=rivalSnapshots(player,data);
  return <section className="profile-section rivalry-snapshot"><div className="profile-section-head"><div><p className="kicker">對賽概覽</p><h3>主要對手</h3></div></div>
    {rivals.length===0?<div className="rivalry-empty"><b>尚未有對賽記錄</b><span>記錄第一場比賽後，主要對手會顯示在這裡。</span></div>:<div className="rivalry-list">{rivals.map(rival=>{
      const percent=Math.round(rival.frameRate*100);
      const confidence=Math.min(1,.28+Math.max(rival.matches,(rival.framesWon+rival.framesLost)/12)*.18);
      return <button key={rival.opponent.id} className="rivalry-row" onClick={()=>onCompare(rival.opponent)} aria-label={`查看 ${player.name} 對 ${rival.opponent.name} 的詳細對賽`}>
        <PlayerBadge player={rival.opponent}/><span className="rivalry-person"><small>{rival.label}</small><b>{rival.opponent.name}</b><em>{rival.matches?`${rival.wins} 勝 · ${rival.losses} 負 · ${rival.draws} 和`:`歷史局數匯總`}{rival.hasAggregate&&rival.matches?" · 另有匯總":""}</em></span>
        <span className="rivalry-heat"><b>{percent}%</b><small>局數勝率</small><em aria-hidden="true"><i style={{width:`${percent}%`,opacity:confidence}}/></em></span><strong>›</strong>
      </button>;
    })}</div>}
  </section>;
}

/** Buckets a break value into its ten-point band, e.g. 47→"40-49", 100+→"100+". */
function breakBand(value:number){ return value>=100?"100+":`${Math.floor(value/10)*10}-${Math.floor(value/10)*10+9}`; }
/** Groups the player's recorded breaks into ten-point bands (20-29 up to 100+) so the shape of their form shows at a glance, rather than a flat list of individual scores. */
function BreakStats({player,data}:{player:Player;data:AppState}) {
  const breaks=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>
    (m.highBreaks??[]).filter(item=>item.playerId===player.id&&item.value>0&&item.value<=147).map(item=>item.value));
  if(!breaks.length)return null;
  const highest=Math.max(...breaks);
  const bands=["20-29","30-39","40-49","50-59","60-69","70-79","80-89","90-99","100+"];
  const band=(v:number)=>v<20?"<20":breakBand(v);
  const allBands=breaks.some(v=>v<20)?["<20",...bands]:bands;
  const counts=new Map<string,number>();
  for(const v of breaks) counts.set(band(v),(counts.get(band(v))??0)+1);
  const maxCount=Math.max(1,...allBands.map(b=>counts.get(b)??0));
  return <section className="profile-section break-stats">
    <div className="profile-section-head"><div><p className="kicker">單桿表現</p><h3>最高單桿</h3></div><b>{highest}</b></div>
    <div className="break-bar-chart">{allBands.map(band=>{const count=counts.get(band)??0;return <div className="break-bar-row" key={band}>
      <span className="break-bar-label">{band}</span>
      <span className="break-bar-track"><i style={{width:count?`${8+count/maxCount*92}%`:"0%"}}/></span>
      <span className="break-bar-count">{count||""}</span>
    </div>})}</div>
    <p className="chart-summary">共 {breaks.length} 桿記錄。</p>
  </section>;
}

/** A player's public, upcoming availability — one glance at whether they're worth approaching for a
    game, without leaving their profile. Fetched per player id rather than folded into `data`, since
    most profile views never open this section and the rest of `AppState` has no concept of slots. */
const SLOT_PREVIEW_DAYS=3; // days shown before the section needs expanding
const hoursFromDayStart=(day:string,iso:string)=>(Date.parse(iso)-Date.parse(dayRangeHongKong(day).startAt))/3600000;
function PlayerUpcomingSlots({player,onFindOpponent}:{player:Player;onFindOpponent:(playerId:string,date:string)=>void}) {
  /* Keyed by player id rather than reset in the effect: the fetch resolving is what flips this out of
     its loading state, so a stale response for a previously-viewed player can never paint. */
  const [loaded,setLoaded] = useState<{playerId:string;slots:AvailabilitySlot[]}|null>(null);
  const [expanded,setExpanded] = useState(false);
  const [now] = useState(()=>Date.now());
  useEffect(() => {
    let cancelled = false;
    setExpanded(false); // a previous player's "show all" must not carry into this one
    const settle=(slots:AvailabilitySlot[])=>{if(!cancelled)setLoaded({playerId:player.id,slots})};
    fetch(`/api/availability?player=${player.id}`).then(r=>r.json()).then(b=>settle(b.slots??[])).catch(()=>settle([]));
    return () => { cancelled = true; };
  }, [player.id]);
  const slots = loaded?.playerId===player.id ? loaded.slots : null;
  /* Grouped by *playing* day, not calendar day: a slot running past midnight belongs to the evening
     it started, e.g. a 00:30 slot is that day's, not the next calendar day's. */
  const groups = useMemo(() => {
    if(!slots) return null;
    const byDay = new Map<string,{from:number;label:string}[]>();
    for(const slot of slots){
      const calendarDate=hkDate(new Date(slot.startAt));
      const day=hoursFromDayStart(calendarDate,slot.startAt)<2?addDaysHongKong(calendarDate,-1):calendarDate;
      const bar={from:hoursFromDayStart(day,slot.startAt),label:`${hkClock(slot.startAt)}–${hkClock(slot.endAt)}`};
      byDay.set(day,[...(byDay.get(day)??[]),bar]);
    }
    for(const bars of byDay.values()) bars.sort((a,b)=>a.from-b.from); // read left-to-right by start time
    return [...byDay.entries()].sort(([a],[b])=>a.localeCompare(b));
  }, [slots]);
  const today = hkDate(new Date(now)), tomorrow = hkDate(new Date(now+86400000));
  const relativeLabel = (day:string) => day===today ? "今天" : day===tomorrow ? "明天" : null;
  const total=slots?.length??0;
  /* Open by default and capped at three days: the section is the reason most people open a profile,
     but a fortnight of published slots would push the ELO history off the screen. */
  const shown=groups&&(expanded?groups:groups.slice(0,SLOT_PREVIEW_DAYS));
  return <section className="profile-section profile-slots">
    <div className="profile-section-head">
      <div><p className="kicker">約戰時間</p><h3>即將可約的時段</h3></div>
      <span className="profile-slots-count">{slots===null?"載入中…":total?`${groups!.length} 天 · ${total} 個時段`:"未有時段"}</span>
    </div>
    <div className="profile-slots-body">
      {slots===null
        ? <p className="profile-slots-empty">載入時段中…</p>
        : shown && shown.length>0
          ? <>
              {/* Day, then the times. No timeline track and no 10:00–02:00 axis: the visualisation
                  cost three rows per day and asked the reader to decode a scale, when the only
                  questions here are "which day" and "what times". */}
              {/* Every row shares one date treatment — small grey weekday/date text — with today and
                  tomorrow additionally called out by a pill above it, rather than getting their own
                  larger bold line that the rest of the week didn't have. */}
              <ul className="slot-viz-list">{shown.map(([day,bars])=>{const relative=relativeLabel(day);return <li className="slot-day" key={day}>
                <div className="slot-day-name">{relative&&<b className="slot-day-badge">{relative}</b>}<small>{hkDayLabel(day)}</small></div>
                <div className="slot-chips">{bars.map(bar=><span key={bar.label}>{bar.label}</span>)}</div>
              </li>})}</ul>
              {groups!.length>SLOT_PREVIEW_DAYS&&<button type="button" className={`slot-more${expanded?" expanded":""}`} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?"只顯示最近 3 天":`顯示全部 ${groups!.length} 天`}<i aria-hidden="true">▾</i></button>}
            </>
          : <p className="profile-slots-empty">目前未有公開的可配對時段</p>}
    </div>
  </section>;
}
function PlayerDetail({player,rank,data,onCompare,onViewAllMatches,onMatch,onFindOpponent}:{player:Player;rank:number;data:AppState;onCompare:(opponent:Player)=>void;onViewAllMatches:()=>void;onMatch:(matchId:string)=>void;onFindOpponent:(playerId:string,date:string)=>void}) { const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data),series=playerSeries(player,data),trendPoints=playerTrendPoints(player,data),high=Math.max(...series),low=Math.min(...series);const provisional=g<data.settings.provisionalGames;
  const frameTrend=recentFramesPerMatch(player,data,5);
  const highestBreak=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>(m.highBreaks??[]).filter(item=>item.playerId===player.id).map(item=>item.value)).reduce((max,value)=>Math.max(max,value),0);
  /* One hero, then a single `.profile-body` grid: every section below is a `.profile-section`, so the
     gaps, surfaces and heads come from one place rather than from each section's own margins. */
  /* A plain div, not a <header>: the global `header{height:62px}` page rule would clamp this and
     clip the chip row. */
  return <><div className="profile-head">
    <PlayerBadge player={player}/>
    <div className="profile-identity">
      <h2>{player.name}</h2>
      <div className="profile-chips"><span className="profile-chip">排名 #{rank||"—"}</span><span className={`profile-chip${provisional?" provisional":""}`}>{provisional?"臨時 ELO":"正式 ELO"}</span><span className="profile-chip">{g} 場</span></div>
      <div className="profile-hero-form"><div><small>近期 5 場</small><span className="profile-form-dots">{player.form.slice(0,5).map((result,index)=><i key={`${result}-${index}`} className={result.toLowerCase()}>{result}</i>)}</span></div></div>
    </div>
    <div className="profile-hero-elo"><small>目前 ELO</small><b>{Math.round(player.rating)}</b></div>
  </div>
  <div className="profile-body">
    {/* Current ELO already leads the hero above, so it isn't repeated here. */}
    <div className="profile-stats profile-progress">
      <div><small>ELO 建議評分</small><b>{suggested==null?"未提供":Math.round(suggested)}</b></div>
      <div><small>正式讓分評分</small><b>{player.handicap??"未提供"}</b></div>
      <div><small>勝／負／和</small><b>{player.wins}/{player.losses}/{player.draws}</b></div>
      <div>
        <small>近 5 場局均得分</small>
        <b className={frameTrend.prior!=null&&frameTrend.recent!=null&&frameTrend.recent>frameTrend.prior?"positive":undefined}>{frameTrend.recent!=null?`${frameTrend.recent.toFixed(1)} 局`:"—"}</b>
        {frameTrend.prior!=null&&<span className="profile-progress-sub">前 5 場 {frameTrend.prior.toFixed(1)} 局</span>}
      </div>
      <div>
        <small>局數勝率</small>
        <b>{Math.round(frameRate(player)*100)}%</b>
        <span className="profile-progress-sub">{player.framesWon} 局獲勝</span>
      </div>
      <div><small>最高單桿</small><b>{highestBreak||"—"}</b><span className="profile-progress-sub">{highestBreak?"歷史記錄":"尚未有單桿記錄"}</span></div>
    </div>
    <PlayerUpcomingSlots player={player} onFindOpponent={onFindOpponent}/>
    <BreakStats player={player} data={data}/>
    <RecentMatches points={trendPoints} onViewAll={onViewAllMatches} onMatch={onMatch}/>
    <section className="profile-section interactive-detail">
      <div className="profile-section-head"><div><p className="kicker">評分軌跡</p><h3>ELO 走勢</h3></div><span>最高 {Math.round(high)} · 最低 {Math.round(low)}</span></div>
      <InteractiveEloChart points={trendPoints} label={`${player.name} 從起始評分至目前的互動 ELO 走勢`}/>
      <div className="chart-axis"><span>起始 {Math.round(series[0])}</span><span>目前 {Math.round(player.rating)}</span></div>
    </section>
    <RivalrySnapshot player={player} data={data} onCompare={onCompare}/>
    <section className="profile-section">
      <div className="profile-section-head"><div><p className="kicker">綜合分析</p><h3>表現摘要</h3></div></div>
      <p className="summary">{player.name} 目前為 {Math.round(player.rating)} ELO，最近五場錄得 {player.form.filter(x=>x==="W").length} 勝、{player.form.filter(x=>x==="L").length} 負、{player.form.filter(x=>x==="D").length} 和；局數勝率為 {Math.round(frameRate(player)*100)}%。ELO 曾介乎 {Math.round(low)} 至 {Math.round(high)}，共有 {related.length} 筆可追溯賽事記錄。</p>
    </section>
  </div></>}
