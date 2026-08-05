"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CalibrationTrend, DEFAULT_AVATAR, Empty, InteractiveEloChart, NavIcon, PlayerBadge, PlayerCombobox, PlayerForm, RecentMatches, Scoreline, SortArrow, SortControls, Term, avatarHex, sortLabels, type EloTrendPoint, type SortKey } from "./UiBits";
import Availability from "./Availability";
import { TonightStrip, actionableCount, useMatchmakingSummary } from "./MatchmakingBits";
import { registerServiceWorker } from "./push-client";
import { isEntertainmentMode, neutralRatingSnapshot, roundedTeamEloDifference } from "../lib/entertainment-match";
import { addDaysHongKong, dayRangeHongKong, hkClock, hkDate, hkDayLabel, type AvailabilitySlot } from "../lib/availability";

type Player = {
  id: string; name: string; short: string; handicap: number | null; rating: number; colour?: string; avatar?: string | null;
  initialRating: number; active: boolean; wins: number; losses: number; draws: number;
  framesWon: number; framesLost: number; lastChange: number; form: string[];
};
type MatchMode = "1v1" | "2v2" | "cup";
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
  tournamentId?: string;
  tournamentRound?: number;
  tournamentMatchIndex?: number;
};
type Tournament = {
  id: string;
  name: string;
  handicapMode: "suggested" | "none";
  signupDeadline: string;
  createdAt: string;
  createdBy?: string;
  signups: string[];
};
type CalibrationPoint = { estimate:number; usableMatches:number; at:string };
type Calibration = { rawEstimate:number; estimate:number; lower:number; upper:number; curvatureEstimate?:number; curvatureLower?:number; curvatureUpper?:number; usableMatches:number; handicapLevels:number; confidence:string; updatedAt:string; history?:CalibrationPoint[] };
type Settings = { start: number; provisionalGames: number; kProvisional: number; kRated: number; conversion: number; cap: number; curvature?:number; handicapSoftCap?:number; winnerBonus?:number; overHandicapBoost?:number; overHandicapScale?:number; modelVersion?:number; calibration?:Calibration };
type AppState = { players: Player[]; matches: Match[]; tournaments: Tournament[]; settings: Settings; audits: { id: string; text: string; at: string }[] };

const seed: AppState = {
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature:1.25, handicapSoftCap:800, winnerBonus:.5, overHandicapBoost:.75, overHandicapScale:200, modelVersion:3 },
  players: [],
  matches: [],
  tournaments: [],
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
type BreakChartMode="personal"|"monthly";
type BreakChartPoint={period:string;value:number};
function breakChartPoints(player:Player,data:AppState,mode:BreakChartMode):BreakChartPoint[]{
  const byPeriod=new Map<string,number>();
  const matches=[...data.matches]
    .filter(m=>m.status==="confirmed"&&isParticipant(m,player.id))
    .sort((a,b)=>(a.playedOn||a.createdAt.slice(0,10)).localeCompare(b.playedOn||b.createdAt.slice(0,10))||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  for(const match of matches){
    const values=(match.highBreaks??[]).filter(item=>item.playerId===player.id&&item.value>0&&item.value<=147).map(item=>item.value);
    const date=match.playedOn||match.createdAt.slice(0,10),period=mode==="monthly"?date.slice(0,7):date;
    byPeriod.set(period,Math.max(byPeriod.get(period)??0,...values,0));
  }
  const periods=[...byPeriod.keys()].sort();
  if(mode==="monthly")return periods.map(period=>({period,value:byPeriod.get(period)!}));
  if(!periods.length)return [];
  let best=byPeriod.get(periods[0])??0;
  const points:BreakChartPoint[]=[{period:periods[0],value:best}];
  for(const period of periods.slice(1)){
    const value=byPeriod.get(period)??0;
    if(value>best){best=value;points.push({period,value:best});}
  }
  if(today>points[points.length-1].period)points.push({period:today,value:best});
  return points;
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
      const averageA=teamRating(m,state,"A"),averageB=teamRating(m,state,"B");
      const snapshotA=neutralRatingSnapshot(a),snapshotA2=neutralRatingSnapshot(a2),snapshotB=neutralRatingSnapshot(b),snapshotB2=neutralRatingSnapshot(b2);
      updated.set(m.id,{
        ...m,
        beforeA:snapshotA.before,beforeA2:snapshotA2.before,beforeB:snapshotB.before,beforeB2:snapshotB2.before,
        afterA:snapshotA.after,afterA2:snapshotA2.after,afterB:snapshotB.after,afterB2:snapshotB2.after,
        deltaA:snapshotA.delta,expectedA:1/(1+10**((averageB-averageA)/400)),
        frameEvidence:0,evidenceWeight:0,overHandicapElo:0,overHandicapMultiplier:1,
      });
      continue;
    }
    const teamA=a2?[a,a2]:[a];
    const teamB=b2?[b,b2]:[b];
    const state = {players:rebuilt} as AppState;
    const teamAEntity = a2 ? {id:"teamA",name:teamLabel(m,state,"A"),short:teamLabel(m,state,"A"),handicap:teamHandicap(m,state,"A"),rating:teamRating(m,state,"A"),initialRating:0,active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]} as Player : a;
    const teamBEntity = b2 ? {id:"teamB",name:teamLabel(m,state,"B"),short:teamLabel(m,state,"B"),handicap:teamHandicap(m,state,"B"),rating:teamRating(m,state,"B"),initialRating:0,active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]} as Player : b;
    const giverSide = m.giver && teamA.some(p=>p.id===m.giver) ? "A" : m.giver && teamB.some(p=>p.id===m.giver) ? "B" : undefined;
    const result=calc(teamAEntity,teamBEntity,m.scoreA,m.scoreB,m.giver,Math.abs(m.actual),settings,giverSide);
    const resultA=m.scoreA===m.scoreB?"D":m.scoreA>m.scoreB?"W":"L";
    const resultB=resultA==="D"?"D":resultA==="W"?"L":"W";
    const beforeA=teamAEntity.rating,beforeB=teamBEntity.rating;
    const beforeA2=a2?.rating,beforeB2=b2?.rating;
    for(const player of teamA){ player.rating += result.deltaA; player.lastChange = result.deltaA; player.wins += resultA==="W"?1:0; player.losses += resultA==="L"?1:0; player.draws += resultA==="D"?1:0; player.framesWon += m.scoreA; player.framesLost += m.scoreB; player.form=[resultA,...player.form].slice(0,5); }
    for(const player of teamB){ player.rating -= result.deltaA; player.lastChange = -result.deltaA; player.wins += resultB==="W"?1:0; player.losses += resultB==="L"?1:0; player.draws += resultB==="D"?1:0; player.framesWon += m.scoreB; player.framesLost += m.scoreA; player.form=[resultB,...player.form].slice(0,5); }
    const updatedMatch: Match = {
      ...m,
      expectedA: result.expectedA,
      beforeA,
      beforeB,
      afterA: beforeA + result.deltaA,
      afterB: beforeB - result.deltaA,
      deltaA: result.deltaA,
      frameEvidence: result.frameEvidence,
      performanceScore: result.performanceScore,
      evidenceWeight: result.evidenceWeight,
      handicapAdjustment: result.adjustment,
      overHandicapElo: result.overHandicapElo,
      overHandicapMultiplier: result.overHandicapMultiplier,
      status: m.status,
      createdAt: m.createdAt,
    } as Match;
    if(a2){ updatedMatch.beforeA2 = beforeA2; updatedMatch.afterA2 = beforeA2! + result.deltaA; }
    if(b2){ updatedMatch.beforeB2 = beforeB2; updatedMatch.afterB2 = beforeB2! - result.deltaA; }
    updated.set(m.id,updatedMatch);
  }
  return {players:rebuilt,matches:matches.filter(m=>m.status==="confirmed").map(m=>updated.get(m.id)??m)};
}
function upgradeState(raw:AppState){
  const nextRaw = { ...raw, tournaments: raw.tournaments ?? [] };
  if((nextRaw.settings.modelVersion??1)>=3)return {state:nextRaw,changed:false};
  let settings:Settings={...nextRaw.settings,curvature:nextRaw.settings.curvature??1.25,handicapSoftCap:nextRaw.settings.handicapSoftCap??800,winnerBonus:nextRaw.settings.winnerBonus??.5,overHandicapBoost:nextRaw.settings.overHandicapBoost??.75,overHandicapScale:nextRaw.settings.overHandicapScale??200,modelVersion:3};
  settings=recalibrate(settings,nextRaw.matches);
  let rebuilt=replay(nextRaw.players,nextRaw.matches,settings);
  settings=recalibrate(settings,rebuilt.matches);
  rebuilt=replay(nextRaw.players,rebuilt.matches,settings);
  return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"加入超額讓分表現加乘；完整重播歷史 ELO",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
}

const today = new Date().toISOString().slice(0,10);
// Module scope, not render: reading the clock during render is impure.
const thirtyDaysAgo = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
const tenDaysAgo = new Date(Date.now()-10*864e5).toISOString().slice(0,10);
function isInPastThirtyDays(playedOn:string){
  return playedOn>=thirtyDaysAgo&&playedOn<=today;
}
function isInPastTenDays(playedOn:string){
  return playedOn>=tenDaysAgo&&playedOn<=today;
}
export default function Home({user}:{user:{displayName:string;email:string;role:"admin"|"member";statePlayerId?:string}|null}) {
  const [data,setData] = useState<AppState>(seed);
  const [tab,setTab] = useState("leaderboard");
  const [availabilityDirty,setAvailabilityDirty] = useState(false);
  const [leavingAvailability,setLeavingAvailability] = useState<string|null>(null);
  const [jumpToAvailability,setJumpToAvailability] = useState<{playerId:string;date:string}|null>(null);
  const [matchesView,setMatchesView] = useState<"history"|"calendar"|"cup">("history");
  const [headToHead,setHeadToHead] = useState({a:"",b:""});
  const [highlightMatch,setHighlightMatch] = useState<string|null>(null);
  // localStorage can't be read during render without a hydration mismatch, so
  // the restore lands in an effect — which means the writer must skip its own
  // first run or it would persist the pre-restore default over the real value.
  const focusRestored = useRef(false);
  const [modal,setModal] = useState<"match"|"player"|"settings"|"detail"|"deleteMatch"|"tournament"|"signIn"|null>(null);
  const [detail,setDetail] = useState<Player|null>(null);
  const [editingPlayer,setEditingPlayer] = useState<Player|null>(null);
  const [editingMatch,setEditingMatch] = useState<Match|null>(null);
  const [editingTournament,setEditingTournament] = useState<Tournament|null>(null);
  const [deletingMatch,setDeletingMatch] = useState<Match|null>(null);
  const [toast,setToast] = useState("");
  const [undoSnapshot,setUndoSnapshot] = useState<AppState|null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [saving,setSaving] = useState(false);
  const [recordMenuOpen,setRecordMenuOpen] = useState(false);
  const [pullDistance,setPullDistance] = useState(0);
  const [refreshing,setRefreshing] = useState(false);
  const [draft,setDraft] = useState({mode:"1v1" as MatchMode,teamAName:"Team A",teamBName:"Team B",a:"",b:"",a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[] as {playerId:string;value:number}[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1});
  const [playerForm,setPlayerForm] = useState({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});
  const ownPlayerId=user?.statePlayerId;
  /* The badge is the whole reason matchmaking stops being invisible: it runs in the app shell, so a
     member looking at the leaderboard finds out that three people are waiting on them. */
  const {summary:matchmakingSummary,refresh:refreshMatchmaking}=useMatchmakingSummary(Boolean(ownPlayerId));
  const matchmakingBadge=actionableCount(matchmakingSummary?.counts);
  /* Registered from the shell rather than the matchmaking tab so a notification can be delivered to
     a member who has never opened that tab — which is exactly the member worth reaching. */
  useEffect(()=>{void registerServiceWorker()},[]);
  /* Notifications deep-link to /?tab=availability, and the click handler navigates an already-open
     tab there, so the parameter has to be honoured on mount and on subsequent navigations alike. */
  useEffect(()=>{
    const wanted=new URLSearchParams(window.location.search).get("tab");
    if(wanted&&["leaderboard","matches","availability","players","settings"].includes(wanted))setTab(wanted);
  },[]);
  const isAdmin=user?.role==="admin";
  const [tournamentForm,setTournamentForm] = useState<{name:string;handicapMode:"suggested"|"none";signupDeadline:string}>({name:"",handicapMode:"suggested",signupDeadline:`${today}T23:59`});
  const canManageMatch=(match:Match)=>Boolean(isAdmin||ownPlayerId&&isParticipant(match,ownPlayerId));

  useEffect(()=>{
    const local = localStorage.getItem("scaa-draft");
    if(local) try { setDraft(JSON.parse(local)); } catch {}
    fetch("/api/state").then(r=>r.ok?r.json():null).then(v=>{if(!v?.players)return;const upgraded=upgradeState(v);setData(upgraded.state);if(upgraded.changed)fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(upgraded.state)}).catch(()=>{});}).catch(()=>{});
  },[]);
  async function refreshData(){
    try{
      const r=await fetch("/api/state",{cache:"no-store"});
      const v=r.ok?await r.json():null;
      if(v?.players)setData(upgradeState(v).state);
    }catch{}
  }
  useEffect(()=>{
    const timer=setInterval(()=>{
      if(document.visibilityState!=="visible"||saving)return;
      refreshData();
    },15000);
    return ()=>clearInterval(timer);
  },[saving]);
  // Standalone/PWA mode drops the browser's native pull-to-refresh along with
  // its chrome, so members on the home-screen app have no gesture at all for
  // "someone else might have just recorded a match" — this reimplements it by
  // hand, only engaging when the page is already scrolled to the very top so
  // it can't hijack an ordinary upward scroll mid-page.
  const pullStart = useRef<number|null>(null);
  const PULL_THRESHOLD = 72;
  useEffect(()=>{
    const onTouchStart=(e:TouchEvent)=>{
      if(window.scrollY>0||refreshing)return;
      pullStart.current=e.touches[0].clientY;
    };
    const onTouchMove=(e:TouchEvent)=>{
      if(pullStart.current==null)return;
      const delta=e.touches[0].clientY-pullStart.current;
      if(delta<=0){setPullDistance(0);return;}
      if(window.scrollY>0){pullStart.current=null;setPullDistance(0);return;}
      setPullDistance(Math.min(delta,PULL_THRESHOLD*1.5));
    };
    const onTouchEnd=async ()=>{
      if(pullStart.current==null)return;
      pullStart.current=null;
      const shouldRefresh=pullDistance>=PULL_THRESHOLD;
      setPullDistance(0);
      if(!shouldRefresh)return;
      setRefreshing(true);
      await refreshData();
      setRefreshing(false);
    };
    window.addEventListener("touchstart",onTouchStart,{passive:true});
    window.addEventListener("touchmove",onTouchMove,{passive:true});
    window.addEventListener("touchend",onTouchEnd);
    return ()=>{
      window.removeEventListener("touchstart",onTouchStart);
      window.removeEventListener("touchmove",onTouchMove);
      window.removeEventListener("touchend",onTouchEnd);
    };
  },[pullDistance,refreshing]);
  useEffect(()=>{ localStorage.setItem("scaa-draft",JSON.stringify(draft)); },[draft]);
  // The match tab is egocentric in practice — a member opens it to check their
  // own last result, not the club archive. Restore whatever they were last
  // looking at; failing that, start a signed-in member on their own record.
  useEffect(()=>{
    const stored=localStorage.getItem("scaa-match-focus");
    if(stored){
      try{
        const value=JSON.parse(stored);
        if(typeof value?.a==="string"&&typeof value?.b==="string"){setHeadToHead({a:value.a,b:value.b});return;}
      }catch{}
    }
    if(ownPlayerId)setHeadToHead({a:ownPlayerId,b:""});
  },[ownPlayerId]);
  useEffect(()=>{
    if(!focusRestored.current){focusRestored.current=true;return;}
    localStorage.setItem("scaa-match-focus",JSON.stringify(headToHead));
  },[headToHead]);
  // A restored id can outlive the player it points at; drop it once the roster
  // arrives so the filter never names someone who is no longer in the club.
  useEffect(()=>{
    if(!data.players.length)return;
    setHeadToHead(pair=>{
      const known=(id:string)=>!id||data.players.some(p=>p.id===id);
      if(known(pair.a)&&known(pair.b))return pair;
      return known(pair.a)?{a:pair.a,b:""}:{a:"",b:""};
    });
  },[data.players]);
  // Navigating away retires the highlight, so returning later doesn't re-flash
  // a result the user has already seen. Cleared on the click rather than in an
  // effect keyed on `tab` — saveMatch sets both in one batch, and an effect
  // would race that.
  /* Leaving the availability tab unmounts its editor, taking any unsaved slot work with it, so a
     dirty editor gets to intercept the move first. */
  const goTab=(next:string)=>{if(availabilityDirty&&tab==="availability"&&next!==tab)return setLeavingAvailability(next);setRecordMenuOpen(false);setHighlightMatch(null);if(next!=="availability")setJumpToAvailability(null);window.scrollTo(0,0);setTab(next)};
  useEffect(()=>{
    if(data.players.length<2)return;
    setDraft(d=>{
      const validA=data.players.some(p=>p.id===d.a);
      const validB=data.players.some(p=>p.id===d.b);
      const validA2=data.players.some(p=>p.id===d.a2);
      const validB2=data.players.some(p=>p.id===d.b2);
      if(validA&&validB&&d.a!==d.b&&(d.mode!=="2v2"||(
        validA2&&validB2&&d.a!==d.a2&&d.b!==d.b2&&d.a!==d.b&&d.a2!==d.b2)))return d;
      const sorted=[...data.players].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,"zh-HK"));
      return {...d,mode:d.mode||"1v1",a:sorted[0]?.id??"",b:sorted[1]?.id??"",a2:"",b2:"",giver:""};
    });
  },[data.players]);

  // `undo` holds the pre-change snapshot; while the toast is on screen it can be persisted back.
  async function persist(next:AppState,message:string,undo?:AppState) {
    if(!user){setToast("請先登入會員帳戶，才可更改球會資料。");return;}
    const baseline=data;
    setData(next); setSaving(true);
    if(toastTimer.current) clearTimeout(toastTimer.current);
    if(undoTimer.current) clearTimeout(undoTimer.current);
    const restorable=Boolean(undo);
    setToast(message);
    setUndoSnapshot(restorable?undo??null:null);
    if(restorable)undoTimer.current=setTimeout(()=>setUndoSnapshot(null),2600);
    toastTimer.current=setTimeout(()=>{setToast("");setUndoSnapshot(null)},restorable?2600:3200);
    try {
      // The client only polls every 15s, so another member's match saved in
      // that window is invisible here. Sending `next` as-is would silently
      // drop it from the payload, which the server reads as tampering with a
      // match that isn't ours and rejects with a permission error — even
      // though nothing about this save was actually about their match. Pull
      // the latest matches first and merge back in anything we don't know
      // about yet, so an unrelated concurrent save can't masquerade as one.
      const latest=await fetch("/api/state",{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
      let payload=next;
      if(Array.isArray(latest?.matches)){
        // A match absent from `next` is only "unknown to us" — and worth
        // restoring — if it was also absent from the snapshot this edit
        // started from. One we already had and deliberately removed (a
        // delete/edit) must stay gone, or every delete would silently
        // resurrect the very match it just removed.
        const knownIds=new Set([...next.matches,...baseline.matches].map(m=>m.id));
        const missing=latest.matches.filter((m:Match)=>!knownIds.has(m.id));
        if(missing.length)payload={...next,matches:[...next.matches,...missing]};
      }
      const r=await fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      if(!r.ok){
        const body=await r.json().catch(()=>null);
        throw new Error(typeof body?.error==="string"?body.error:"");
      }
    } catch (error) {
      if(toastTimer.current)clearTimeout(toastTimer.current);
      if(undoTimer.current)clearTimeout(undoTimer.current);
      setUndoSnapshot(null);
      const reason=error instanceof Error?error.message:"";
      setToast(reason?`未能儲存：${reason}`:"未能連接伺服器；資料仍保留在此畫面，請稍後再試。");
      toastTimer.current=setTimeout(()=>setToast(""),3200);
    } finally { setSaving(false); }
  }
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);if(undoTimer.current)clearTimeout(undoTimer.current)},[]);

  async function resetAll(){
    if(user?.role!=="admin"){setToast("只有管理員可以清除並重設資料。");return;}
    const typed=prompt("此操作會永久刪除所有球員、比賽及審計記錄。請輸入 RESET 繼續：");
    if(typed!=="RESET")return;
    if(!confirm("最後確認：清除並重設所有共用資料？此操作無法復原。"))return;
    setSaving(true);
    try{
      const response=await fetch("/api/state",{method:"DELETE"});
      if(!response.ok)throw new Error();
      const fresh=await response.json();
      setData(fresh);
      localStorage.removeItem("scaa-draft");
      setDraft({mode:"1v1",teamAName:"Team A",teamBName:"Team B",a:"",b:"",a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1});
      setToast("所有共用資料已清除並重設。");
    }catch{setToast("重設失敗，資料沒有被清除。請稍後再試。");}
    finally{setSaving(false);setUndoSnapshot(null);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3200);}
  }

  function deleteTournament(tournament:Tournament){
    if(!isAdmin){setToast("只有管理員可以刪除盃賽。");return;}
    if(!confirm(`確定刪除「${tournament.name}」？盃賽及其已記錄賽事都會永久刪除。`))return;
    const matches=data.matches.filter(match=>match.tournamentId!==tournament.id);
    const base={...data,tournaments:data.tournaments.filter(item=>item.id!==tournament.id),matches,audits:[{id:crypto.randomUUID(),text:`刪除盃賽：${tournament.name}`,at:new Date().toISOString()},...data.audits]};
    const settings=recalibrate(data.settings,matches),next={...base,settings,...replay(data.players,matches,settings)};
    setData(next);persist(next,"盃賽已刪除。",data);
  }

  const ranked=useMemo(()=>[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),[data]);
  const a=data.players.find(p=>p.id===draft.a)??data.players[0];
  const b=data.players.find(p=>p.id===draft.b)??data.players[1];
  const a2=data.players.find(p=>p.id===draft.a2);
  const b2=data.players.find(p=>p.id===draft.b2);
  const valid2v2 = draft.mode==="2v2" && a && b && a2 && b2 && new Set([a.id,b.id,a2.id,b2.id]).size===4;
  const teamMatch = {a:a?.id??"",b:b?.id??"",a2:a2?.id,b2:b2?.id,mode:draft.mode,teamAName:draft.teamAName?.trim()||"Team A",teamBName:draft.teamBName?.trim()||"Team B"} as Match;
  const aEntity = draft.mode==="2v2" && valid2v2 ? {
    id:"teamA",name:teamLabel(teamMatch,data,"A"),short:teamLabel(teamMatch,data,"A"),handicap:teamHandicap(teamMatch,data,"A"),rating:teamRating(teamMatch,data,"A"),initialRating:0,active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]
  } as Player : a;
  const bEntity = draft.mode==="2v2" && valid2v2 ? {
    id:"teamB",name:teamLabel(teamMatch,data,"B"),short:teamLabel(teamMatch,data,"B"),handicap:teamHandicap(teamMatch,data,"B"),rating:teamRating(teamMatch,data,"B"),initialRating:0,active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]
  } as Player : b;
  const preview=a&&b&&(!draft.mode||draft.mode==="1v1"||valid2v2||draft.mode==="cup")
    ? calc(aEntity,bEntity,+draft.scoreA,+draft.scoreB,draft.giver,+draft.points,data.settings,
        draft.mode==="2v2"?([a.id,a2?.id].includes(draft.giver) ? "A" : [b.id,b2?.id].includes(draft.giver) ? "B" : undefined):undefined)
    : null;
  const openHeadToHead=(player:Player,selectedOpponent?:Player)=>{
    const opponent=selectedOpponent??data.players.find(candidate=>candidate.id!==player.id&&candidate.active)??data.players.find(candidate=>candidate.id!==player.id);
    setHeadToHead({a:player.id,b:opponent?.id??""});
    setMatchesView("history");
    goTab("matches");
  };
  const openPlayerMatches=(player:Player)=>{
    setHeadToHead({a:player.id,b:""});
    setMatchesView("history");
    goTab("matches");
  };
  const jumpToPlayerAvailability=(playerId:string,date:string)=>{
    setModal(null);
    setJumpToAvailability({playerId,date});
    goTab("availability");
  };

  function saveMatch(){
    if(saving)return;
    if(!isAdmin&&(!ownPlayerId||(a?.id!==ownPlayerId&&b?.id!==ownPlayerId&&a2?.id!==ownPlayerId&&b2?.id!==ownPlayerId))){setToast("你只能記錄或修改自己參與的比賽。");return;}
    const valid1v1 = draft.mode==="1v1";
    const valid2v2 = draft.mode==="2v2" && a && b && a2 && b2 && new Set([a.id,b.id,a2.id,b2.id]).size===4;
    const validCup = draft.mode==="cup" && Boolean(draft.tournamentId&&a&&b) && Number(draft.tournamentRound)>=1 && Number(draft.tournamentMatchIndex)>=1;
    if(!valid1v1 && !valid2v2 && !validCup){setToast("請選擇有效賽事配置；會友盃需選擇盃賽、輪次和場次。");return;}
    if(draft.scoreA<0||draft.scoreB<0||(+draft.scoreA+ +draft.scoreB)===0){setToast("比分總局數必須大於 0。");return;}
    if(!preview)return;
    const now=new Date().toISOString(), id=editingMatch?.id??crypto.randomUUID();
    const beforeA = a.rating;
    const beforeB = b.rating;
    const entertainment=valid2v2;
    const match:Match={id,a:a.id,b:b.id,mode:draft.mode,teamAName:valid2v2?(draft.teamAName?.trim()||"Team A"):undefined,teamBName:valid2v2?(draft.teamBName?.trim()||"Team B"):undefined,scoreA:+draft.scoreA,scoreB:+draft.scoreB,playedOn:draft.date||today,
      a2:valid2v2?String(draft.a2):undefined,b2:valid2v2?String(draft.b2):undefined,
      actual:preview.actual,giver:draft.giver||null,official:preview.official,extra:preview.extra,expectedA:preview.expectedA,
      beforeA,beforeB,afterA:entertainment?beforeA:beforeA+preview.deltaA,afterB:entertainment?beforeB:beforeB-preview.deltaA,deltaA:entertainment?0:preview.deltaA,
      entryMode:"match",highBreaks:valid2v2?[]:(draft.highBreaks??[]).filter((item:{playerId:string;value:number})=>(item.playerId===a.id||item.playerId===b.id)&&item.value>0&&item.value<=147),
      frameEvidence:preview.frameEvidence,performanceScore:preview.performanceScore,evidenceWeight:preview.evidenceWeight,handicapAdjustment:preview.adjustment,overHandicapElo:preview.overHandicapElo,overHandicapMultiplier:preview.overHandicapMultiplier,status:"confirmed",createdAt:editingMatch?.createdAt??now,
      tournamentId:validCup?String(draft.tournamentId):undefined,tournamentRound:validCup?Math.max(1,Number(draft.tournamentRound)||1):undefined,tournamentMatchIndex:validCup?Math.max(1,Number(draft.tournamentMatchIndex)||1):undefined};
    if(valid2v2){
      match.beforeA2=a2!.rating;match.beforeB2=b2!.rating;
      match.afterA2=a2!.rating;match.afterB2=b2!.rating;
    }
    const matches=editingMatch
      ? data.matches.map(existing=>existing.id===editingMatch.id?match:existing)
      : [match,...data.matches];
    const settings=valid2v2?data.settings:recalibrate(data.settings,matches);
    const rebuilt=replay(data.players,matches,settings);
    const action=editingMatch?"編輯":"記錄";
    const matchLabel=valid2v2?`${teamLabel(match,data,"A")} ${draft.scoreA}–${draft.scoreB} ${teamLabel(match,data,"B")}`:`${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}`;
    const next={...data,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}${valid2v2?"潮拍娛樂賽":validCup?"會友盃賽果":"賽果"}：${matchLabel}${valid2v2?"；不影響 ELO":validCup?`；盃賽第 ${match.tournamentRound} 輪第 ${match.tournamentMatchIndex} 場`:"；重播歷史 ELO"}`,at:now},...data.audits]};
    localStorage.removeItem("scaa-draft"); setEditingMatch(null); setModal(null);
    // Land on the saved card rather than a toast that vanishes: focus the list
    // on the recorder (or clear it, for an admin logging someone else's game)
    // so the new row is guaranteed to be in the filtered set, and drop the
    // comparison — the date range only applies while comparing, and a stale
    // range could otherwise hide the very match we just navigated to.
    setHeadToHead({a:ownPlayerId&&(match.a===ownPlayerId||match.b===ownPlayerId)?ownPlayerId:"",b:""});
    setHighlightMatch(id); setMatchesView("history"); setTab("matches");
    persist(next,valid2v2?(editingMatch?"潮拍 2v2 已更新；ELO 與統計維持不變。":"潮拍 2v2 賽果已儲存；ELO 與統計維持不變。"):(validCup?(editingMatch?"會友盃賽果已更新。":"會友盃賽果已儲存。"):(editingMatch?"賽事已更新，所有後續 ELO 已重建。":"賽果已儲存，雙方 ELO 已更新。")));
  }

  function editMatch(m:Match){
    if(!canManageMatch(m)){setToast("你只能修改自己參與的比賽。");return;}
    setEditingMatch(m);
    setDraft({
      mode:m.mode??"1v1",teamAName:m.teamAName?.trim()||"Team A",teamBName:m.teamBName?.trim()||"Team B",a:m.a,b:m.b,a2:m.a2??"",b2:m.b2??"",scoreA:m.scoreA,scoreB:m.scoreB,
      date:m.playedOn,giver:m.actual>0?m.a:m.actual<0?m.b:"",points:Math.abs(m.actual),highBreaks:m.highBreaks??[],tournamentId:m.tournamentId??"",tournamentRound:m.tournamentRound??1,tournamentMatchIndex:m.tournamentMatchIndex??1
    });
    setModal("match");
  }

  function newMatch(mode:MatchMode="1v1",opponentId?:string,playedOn?:string){
    setRecordMenuOpen(false);
    if(!user){setModal("signIn");return;}
    setEditingMatch(null);
    const sorted=[...data.players].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,"zh-HK"));
    const first=ownPlayerId&&sorted.some(player=>player.id===ownPlayerId)?ownPlayerId:sorted[0]?.id??"";
    const remaining=sorted.filter(player=>player.id!==first);
    const second=opponentId&&opponentId!==first&&remaining.some(player=>player.id===opponentId)?opponentId:remaining[0]?.id??"";
    const rest=remaining.filter(player=>player.id!==second);
    setDraft({
      mode,teamAName:"Team A",teamBName:"Team B",a:first,b:second,
      a2:mode==="2v2"?rest[0]?.id??"":"",b2:mode==="2v2"?rest[1]?.id??"":"",
      scoreA:0,scoreB:0,date:playedOn??today,giver:"",points:0,highBreaks:[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1
    });
    setModal("match");
  }

  function savePlayer(){
    if(!isAdmin&&(!editingPlayer||editingPlayer.id!==ownPlayerId)){setToast("你只能修改自己的球員資料。");return;}
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast("請輸入顯示名稱及縮寫。");return;}
    const rating=playerForm.rating?+playerForm.rating:data.settings.start;
    const p:Player=editingPlayer
      ? {...editingPlayer,name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),handicap:playerForm.handicap===""?null:+playerForm.handicap,initialRating:rating,colour:playerForm.colour||DEFAULT_AVATAR}
      : {id:crypto.randomUUID(),name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),colour:playerForm.colour||DEFAULT_AVATAR,
        handicap:playerForm.handicap===""?null:+playerForm.handicap,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,
        framesWon:0,framesLost:0,lastChange:0,form:[]};
    const action=editingPlayer?"編輯":"新增";
    const players=editingPlayer?data.players.map(x=>x.id===p.id?p:x):[...data.players,p];
    const rebuilt=editingPlayer?replay(players,data.matches,data.settings):{players,matches:data.matches};
    const next={...data,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}球員：${p.name}${editingPlayer?"；重播歷史評分":""}`,at:new Date().toISOString()},...data.audits]};
    setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal(null);persist(next,editingPlayer?"球員資料已更新。":"球員已新增。");
  }

  function editPlayer(p:Player){
    if(!isAdmin&&p.id!==ownPlayerId){setToast("你只能修改自己的球員資料。");return;}
    setEditingPlayer(p);
    setPlayerForm({name:p.name,short:p.short,handicap:p.handicap==null?"":String(p.handicap),rating:String(Math.round(p.initialRating)),colour:p.colour||DEFAULT_AVATAR});
    setModal("player");
  }

  function deletePlayer(p:Player){
    if(!isAdmin){setToast("只有管理員可以刪除球員。");return;}
    const hasHistory=data.matches.some(m=>m.a===p.id||m.b===p.id);
    if(!confirm(`永久刪除 ${p.name}？${hasHistory?"歷史賽事會保留並顯示為「已刪除球員」。":""}此操作無法復原。`))return;
    const next={...data,players:data.players.filter(x=>x.id!==p.id),
      audits:[{id:crypto.randomUUID(),text:`永久刪除球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
    persist(next,"球員已永久刪除。");
  }

  function closeModal(){ setModal(null); setDeletingMatch(null); }

  function requestDeleteMatch(m:Match){ setDeletingMatch(m); setModal("deleteMatch"); }

  function confirmDeleteMatch(){
    const m=deletingMatch;
    if(!m)return;
    const snapshot=data;
    const matches=data.matches.filter(x=>x.id!==m.id);
    const entertainment=isEntertainmentMode(m.mode);
    const settings=entertainment?data.settings:recalibrate(data.settings,matches);
    const rebuilt=replay(data.players,matches,settings);
    const next={...data,settings,...rebuilt,
      audits:[{id:crypto.randomUUID(),text:`永久刪除賽事：${m.id.slice(0,8)}${entertainment?"；娛樂記錄，不影響評分":"；重建評分及近況"}`,at:new Date().toISOString()},...data.audits]};
    setDeletingMatch(null); setModal(null);
    persist(next,entertainment?"娛樂賽事已刪除；ELO 與統計維持不變。":"賽事已刪除，ELO、統計及近況已重建。",snapshot);
  }

  function undoDelete(){
    const snapshot=undoSnapshot;
    if(!snapshot)return;
    setUndoSnapshot(null);
    if(undoTimer.current)clearTimeout(undoTimer.current);
    // Restore the exact pre-delete state, but keep the rewind itself traceable.
    persist({...snapshot,audits:[{id:crypto.randomUUID(),text:"復原已刪除的賽事；還原評分及近況",at:new Date().toISOString()},...snapshot.audits]},"已復原賽事，ELO 及統計已還原。");
  }

  /* Signing up for a cup belongs to 比賽, not 約戰 — entering a competition and pitching a friendly
     are different jobs. Lifted out of the matchmaking tab's props so the cup bracket and the
     per-slot shortcut can both call the same thing. */
  const signUpTournament=async(tournamentId:string)=>{
        if(!ownPlayerId){setToast("請先登入會員帳戶，才可報名盃賽。");return}
        const tournament=data.tournaments.find(item=>item.id===tournamentId),deadline=tournament?.signupDeadline?new Date(`${tournament.signupDeadline.length===10?tournament.signupDeadline+"T23:59":tournament.signupDeadline}:00+08:00`):null;
        if(deadline&&!Number.isNaN(deadline.getTime())&&deadline.getTime()<Date.now()){setToast("此盃賽報名已截止。");return}
        const snapshot=data;
        const nextTournaments = data.tournaments.map(t=>t.id===tournamentId?{...t,signups: (t.signups||[]).includes(ownPlayerId)?t.signups.filter(s=>s!==ownPlayerId):[... (t.signups||[]), ownPlayerId]}:t);
        const next={...data,tournaments:nextTournaments,audits:[{id:crypto.randomUUID(),text:`${(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?'報名':'取消報名'} 會友盃：${nextTournaments.find(t=>t.id===tournamentId)?.name}`,at:new Date().toISOString()},...data.audits]};
        setData(next);persist(next,(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?"已報名會友盃。":"已取消報名會友盃。",snapshot);
  };

  return <><style>{`.read-only .card-tools,.read-only .hero.small > .primary{display:none}`}</style><div className={`shell${user?"":" read-only"}`}>
    <div className={`pull-refresh${refreshing?" spinning":""}`} style={{height:refreshing?PULL_THRESHOLD:pullDistance,opacity:refreshing||pullDistance>0?1:0}} aria-hidden="true">
      <span/>
    </div>
    <aside className="side">
      <div className="brand"><span>S</span><div><b>SCAA</b><small>Snooker ELO</small></div></div>
      <nav>{[["leaderboard","排行榜"],["matches","比賽"],["availability","約戰"],["players","球員"],["settings","設定"]].map(([id,label])=>
        <button key={id} className={tab===id?"active":""} onClick={()=>goTab(id)}><i><NavIcon id={id as "leaderboard"|"matches"|"availability"|"players"|"settings"} active={tab===id}/>{id==="availability"&&matchmakingBadge>0&&<b className="nav-badge" aria-hidden="true">{matchmakingBadge>9?"9+":matchmakingBadge}</b>}</i>{label}{id==="availability"&&matchmakingBadge>0&&<span className="sr-only">，{matchmakingBadge} 項待處理</span>}</button>)}</nav>
      <div className="public-note"><b>{user?"會員模式":"公開瀏覽"}</b><span>{user?"已登入，可更新球會資料":"登入會員後即可記錄比賽"}</span></div>
    </aside>
    <main>
      <header><div className="mobile-brand">SCAA <span>Snooker ELO</span></div><div className="account-actions"><div className="status"><i/> 共用資料庫 · {saving?"儲存中…":"已同步"}</div><button className={`header-settings${tab==="settings"?" active":""}`} aria-label="評分設定與紀錄" aria-current={tab==="settings"?"page":undefined} onClick={()=>goTab("settings")}><NavIcon id="settings" active={tab==="settings"}/></button>{user?<a className="account-link" href="/account" title={user.email}>{user.displayName}</a>:<a className="account-link sign-in" href="/login">登入／註冊</a>}</div></header>
      {/* The club's pulse, on the screen members actually open. Matchmaking used to live entirely
          behind a tab, so "is anyone playing tonight?" was unanswerable without going to look. */}
      {tab==="leaderboard"&&<TonightStrip summary={matchmakingSummary?.tonight??null} signedIn={Boolean(ownPlayerId)} onOpen={()=>goTab("availability")}/>}
      {tab==="leaderboard"&&<Leaderboard ranked={ranked} data={data} onRecord={()=>newMatch()} onPlayer={(p)=>{setDetail(p);setModal("detail")}} onMatch={(match)=>{setHeadToHead({a:"",b:""});setHighlightMatch(match.id);setMatchesView("history");setTab("matches")}} onRivalry={(first,second)=>openHeadToHead(first,second)}/>}
      {tab==="matches"&&<Matches data={data} canManageMatch={canManageMatch} onEdit={editMatch} onVoid={requestDeleteMatch} onPlayer={(player)=>{setDetail(player);setModal("detail")}} view={matchesView} setView={setMatchesView} pair={headToHead} setPair={setHeadToHead} highlight={highlightMatch} isAdmin={Boolean(isAdmin)} onCreateTournament={()=>{setEditingTournament(null);setTournamentForm({name:"",handicapMode:"suggested",signupDeadline:`${today}T23:59`});setModal("tournament")}} onEditTournament={tournament=>{setEditingTournament(tournament);setTournamentForm({name:tournament.name,handicapMode:tournament.handicapMode,signupDeadline:tournament.signupDeadline.length===10?`${tournament.signupDeadline}T23:59`:tournament.signupDeadline});setModal("tournament")}} onDeleteTournament={deleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={signUpTournament}/>}
      {tab==="availability"&&<Availability userPlayerId={ownPlayerId} matches={data.matches} tournaments={data.tournaments} provisionalGames={data.settings.provisionalGames} onDirtyChange={setAvailabilityDirty} jumpTo={jumpToAvailability} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player){setDetail(player);setModal("detail")}}} onRecordMatch={(opponentId,date)=>newMatch("1v1",opponentId,date)} onActivity={refreshMatchmaking} onSignUpTournament={signUpTournament}/>} 
      {tab==="players"&&<Players data={data} ownPlayerId={ownPlayerId} canAdd={Boolean(isAdmin)} canManagePlayer={player=>Boolean(isAdmin||player.id===ownPlayerId)} onAdd={()=>{if(!isAdmin){setToast("只有管理員可以新增球員。");return;}setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal("player")}} onEdit={editPlayer} onDelete={deletePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}} onCompare={(p)=>openHeadToHead(p,data.players.find(candidate=>candidate.id===ownPlayerId))} onRecordAgainst={(p)=>newMatch("1v1",p.id)} onFindOpponent={jumpToPlayerAvailability}/>}
      {tab==="settings"&&<SettingsView data={data} onEdit={()=>isAdmin?setModal("settings"):setToast("只有管理員可以修改 ELO 設定。")} onReset={resetAll} canReset={user?.role==="admin"}/>}
    </main>
    {/* Record sits dead centre as the one thing this app exists to do; the four content tabs split
        evenly around it. 設定 is not a peer of them — it lives with the account controls instead. */}
    {recordMenuOpen&&<button type="button" className="record-menu-scrim" aria-label="關閉比賽模式選單" onClick={()=>setRecordMenuOpen(false)}/>}
    <div className={`record-speed-dial${recordMenuOpen?" open":""}`} aria-hidden={!recordMenuOpen}>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("1v1")}><i>1v1</i><span><b>正式 1v1</b><small>賽果會改變實際 ELO 與球員統計</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("2v2")}><i>2v2</i><span><b>潮拍 2v2</b><small>純娛樂模式，不影響目前 ELO 與統計</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("cup")}><i>會友盃</i><span><b>會友盃記錄</b><small>選擇盃賽場次並儲存，不可手動設定讓分</small></span></button>
    </div>
    <nav className="bottom" aria-label="主導覽">{[["leaderboard","排行榜"],["matches","比賽"],["record","記錄"],["availability","約戰"],["players","球員"]].map(([id,label])=>
      <button key={id} className={`${id==="record"?"bottom-record":tab===id?"active":""}${id==="record"&&recordMenuOpen?" menu-open":""}`} aria-current={tab===id?"page":undefined} aria-expanded={id==="record"?recordMenuOpen:undefined} aria-haspopup={id==="record"?"menu":undefined} onClick={()=>id==="record"?setRecordMenuOpen(open=>!open):goTab(id)}>
        <i>{id==="record"?"＋":<NavIcon id={id as "leaderboard"|"matches"|"availability"|"players"|"settings"} active={tab===id}/>}{id==="availability"&&matchmakingBadge>0&&<b className="nav-badge" aria-hidden="true">{matchmakingBadge>9?"9+":matchmakingBadge}</b>}</i>
        <small>{label}</small>
        {id==="availability"&&matchmakingBadge>0&&<span className="sr-only">，{matchmakingBadge} 項待處理</span>}
      </button>)}</nav>
    {modal&&<div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&closeModal()}>
      {/* `.close` is a sibling of `.sheet`, not a child: `.sheet` is the scrolling box, and a
          descendant can never sit outside it or straddle its edge without being clipped by that
          same overflow. As a sibling inside `.sheet-shell` it floats above the corner, stays put
          while the sheet content scrolls underneath it, and can cross the sheet's edge freely. */}
      <div className={`sheet-shell${modal==="detail"?" player-detail-sheet":""}${modal==="match"?" match-entry-sheet":""}`}>
        <button className="close" aria-label="關閉" onClick={closeModal}>×</button>
        <section className={`sheet${modal==="deleteMatch"?" confirm-sheet":""}`} role="dialog" aria-modal="true">
          {modal==="match"&&<MatchForm data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} editing={!!editingMatch} saving={saving} onSave={saveMatch}/>}
          {modal==="tournament"&&<div>
            <p className="kicker">會友盃</p>
            <h2>{editingTournament?"編輯盃賽":"建立新盃賽"}</h2>
            <p className="sub">建立盃賽以便球員報名與賽事管理。</p>
            <form className="tournament-form" onSubmit={ev=>{ev.preventDefault();
              if(!tournamentForm.name.trim()){setToast("請輸入盃賽名稱。");return}
              const id=editingTournament?.id??crypto.randomUUID();
              const now=new Date().toISOString();
              const tournament: Tournament = {id,name:tournamentForm.name.trim(),handicapMode:tournamentForm.handicapMode,signupDeadline:tournamentForm.signupDeadline,createdAt:editingTournament?.createdAt??now,createdBy:editingTournament?.createdBy??ownPlayerId,signups:editingTournament?.signups??[]};
              const tournaments = editingTournament? data.tournaments.map(t=>t.id===id?tournament:t) : [tournament,...data.tournaments];
              const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text:`${editingTournament?"更新":"建立"} 盃賽：${tournament.name}`,at:now},...data.audits]};
              setEditingTournament(null);setModal(null);setToast(editingTournament?"盃賽已更新。":"盃賽已建立。");setData(next);persist(next,editingTournament?"盃賽已更新。":"盃賽已建立。",data);
            }}>
              <label>盃賽名稱<input type="text" value={tournamentForm.name} onChange={e=>setTournamentForm({...tournamentForm,name:e.target.value})} required/></label>
              <label>讓分模式<select value={tournamentForm.handicapMode} onChange={e=>setTournamentForm({...tournamentForm,handicapMode:e.target.value as "suggested"|"none"})}><option value="suggested">建議讓分（系統會自動套用建議）</option><option value="none">不設讓分</option></select></label>
              <label>報名截止日期及時間<input type="datetime-local" value={tournamentForm.signupDeadline} onChange={e=>setTournamentForm({...tournamentForm,signupDeadline:e.target.value})} required/></label>
              <div className="sheet-actions"><button className="primary" type="submit">儲存盃賽</button><button type="button" className="secondary" onClick={()=>{setModal(null);setEditingTournament(null)}}>取消</button></div>
            </form>
          </div>}
          {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} editing={!!editingPlayer} onSave={savePlayer}/>}
          {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{const applied={...settings,modelVersion:3},rebuilt=replay(data.players,data.matches,applied);setModal(null);persist({...data,settings:applied,...rebuilt,audits:[{id:crypto.randomUUID(),text:"更新 ELO 設定；完整重播歷史評分",at:new Date().toISOString()},...data.audits]},"設定已更新，歷史 ELO 已重播。")}}/>}
          {modal==="deleteMatch"&&deletingMatch&&<ConfirmDeleteMatch match={deletingMatch} data={data} onCancel={closeModal} onConfirm={confirmDeleteMatch}/>}
          {modal==="signIn"&&<><p className="kicker">會員功能</p><h2>先登入或建立帳戶</h2><p className="sub">記錄賽果前，請登入會員帳戶；新會員註冊時會同時建立球員檔案。</p><div className="auth-buttons"><a className="primary" href="/login">登入</a><a className="more" href="/login?mode=signup">建立帳戶</a></div></>}
          {modal==="detail"&&detail&&<PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data} onCompare={opponent=>{setModal(null);openHeadToHead(detail,opponent)}} onViewAllMatches={()=>{setModal(null);openPlayerMatches(detail)}} onMatch={matchId=>{setModal(null);setHeadToHead({a:detail.id,b:""});setHighlightMatch(matchId);setMatchesView("history");setTab("matches")}} onFindOpponent={jumpToPlayerAvailability}/>}
        </section>
      </div>
    </div>}
    {leavingAvailability&&<div className="availability-dialog-backdrop" onMouseDown={()=>setLeavingAvailability(null)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-availability-title" onMouseDown={e=>e.stopPropagation()}><small>未儲存的變更</small><h2 id="leave-availability-title">離開後變更會消失</h2><p>你在「可配對」的時段變更尚未儲存，離開這一頁後不會保留。</p><div><button className="secondary" onClick={()=>setLeavingAvailability(null)}>留在此頁</button><button className="danger" onClick={()=>{const next=leavingAvailability;setLeavingAvailability(null);setAvailabilityDirty(false);setHighlightMatch(null);setTab(next)}}>捨棄變更離開</button></div></section></div>}
    {toast&&<div className={`toast${undoSnapshot?" toast-expiring":""}`} role="status"><span>{toast}</span>{undoSnapshot&&<button type="button" onClick={undoDelete}>復原</button>}</div>}
  </div></>;
}

/**
 * The three headline club stats used to live in their own full-width card
 * above the podium; folded in here as an inline strip so the leaderboard
 * reaches its actual content (the standings) sooner.
 */
function Overview({top,data,onPlayer}:{top:Player[];data:AppState;onPlayer:(p:Player)=>void}) {
  // DOM order is always rank order (1, 2, 3) so mobile — a vertical stack —
  // reads top to bottom correctly. The classic "winner in the middle" podium
  // look is applied with CSS `order` on the desktop 3-column layout only.
  return <section className="podium-section" aria-label="總覽及排名前三">
    {top.length>=3&&<div className="podium">
      {top.map((player,index)=>{const place=index+1;return <button key={player.id} className={`podium-card place-${place}`} onClick={()=>onPlayer(player)}>
        <span className="podium-place">{place===1?"♛":place}</span>
        <PlayerBadge player={player}/>
        <h3>{player.name}</h3>
        <b>{Math.round(player.rating)}<em>ELO</em></b>
        <span className="form">{player.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <small>建議讓分 {Math.round(suggestedHandicap(player,data))}</small>
      </button>})}
    </div>}
  </section>;
}

function Leaderboard({ranked,data,onRecord,onPlayer,onMatch,onRivalry}:{ranked:Player[];data:AppState;onRecord:()=>void;onPlayer:(p:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[breakView,setBreakView]=useState<"players"|"overall"|"recent">("players"),[homeView,setHomeView]=useState<"ranking"|"breaks"|"recent">("ranking"),[officialOnly,setOfficialOnly]=useState(false);
  const confirmed=data.matches.filter(m=>m.status==="confirmed");
  const month=confirmed.filter(m=>m.playedOn.slice(0,7)===today.slice(0,7)).length,total=confirmed.length;
  // Toggling to 正式球手 re-sequences ranks among only the visible players,
  // rather than keeping their position in the full board with gaps.
  const visibleRanked=useMemo(()=>officialOnly?ranked.filter(p=>games(p)>=data.settings.provisionalGames):ranked,[ranked,officialOnly,data.settings.provisionalGames]);
  const shown=sortPlayers(visibleRanked,data,sort,dir),rankOf=new Map(visibleRanked.map((p,i)=>[p.id,i+1]));
  // Movement compares today's table against the standings 30 days ago. A single
  // Ten days balances recent momentum with enough matches for a meaningful comparison.
  const movement=useMemo(()=>{
    const recent=confirmed.filter(m=>isInPastTenDays(m.playedOn));
    if(!recent.length)return {map:new Map<string,number>(),active:false};
    const before=visibleRanked.map(p=>{
      const swing=recent.filter(m=>m.a===p.id||m.b===p.id)
        .reduce((sum,m)=>sum+(m.a===p.id?m.deltaA:-m.deltaA),0);
      return {id:p.id,rating:p.rating-swing,name:p.name};
    }).sort((a,b)=>b.rating-a.rating||a.name.localeCompare(b.name));
    const priorRank=new Map(before.map((p,i)=>[p.id,i+1]));
    return {map:new Map(visibleRanked.map((p,i)=>[p.id,(priorRank.get(p.id)??i+1)-(i+1)])),active:true};
  },[confirmed,visibleRanked]);
  const breakRecords=useMemo(()=>{
    const playerById=new Map(data.players.map(player=>[player.id,player]));
    const records=data.matches.flatMap(match=>match.status==="confirmed"?(match.highBreaks??[])
      .filter(item=>Number.isFinite(item.value)&&item.value>0&&item.value<=147&&playerById.has(item.playerId))
      .map((item,index)=>({player:playerById.get(item.playerId)!,opponent:playerById.get(match.a===item.playerId?match.b:match.a)?.name??"已移除球員",value:item.value,date:match.playedOn,createdAt:match.createdAt,key:`${match.id}-${index}`})):[])
      .sort((a,b)=>b.value-a.value||(b.date||b.createdAt).localeCompare(a.date||a.createdAt)||b.createdAt.localeCompare(a.createdAt));
    const seen=new Set<string>();
    return {
      overall:records.slice(0,10),
      players:records.filter(record=>seen.has(record.player.id)?false:(seen.add(record.player.id),true)).slice(0,10),
      recent:records.filter(record=>isInPastThirtyDays(record.date)).slice(0,10)
    };
  },[data.matches,data.players]);
  const displayedBreaks=breakRecords[breakView];
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  return <><section className="hero"><div><p className="kicker">SCAA CLUB RANKING</p><h1>讓每一局，<br/><span>都推動進步。</span></h1><p>追蹤實力、看見成長，找到旗鼓相當的對手。</p>
      <div className="podium-stats">
        <span><b>{ranked.length}</b><small>活躍球員</small></span>
        <span><b>{month}</b><small>本月比賽</small></span>
        <span><b>{total}</b><small>歷來總場數</small></span>
      </div>
    </div><button className="primary hero-action" onClick={onRecord}><span aria-hidden="true">＋</span><b>記錄新賽果</b><small>更新排名與近期狀態</small></button></section>
    <nav className="home-view-nav" aria-label="首頁內容" role="tablist">
      <button role="tab" aria-selected={homeView==="ranking"} className={homeView==="ranking"?"active":""} onClick={()=>setHomeView("ranking")}><span>目前排名</span></button>
      <button role="tab" aria-selected={homeView==="breaks"} className={homeView==="breaks"?"active":""} onClick={()=>setHomeView("breaks")}><span>最高單桿紀錄</span></button>
      <button role="tab" aria-selected={homeView==="recent"} className={homeView==="recent"?"active":""} onClick={()=>setHomeView("recent")}><span>近三十日統計</span></button>
    </nav>
    {homeView==="ranking"&&<>
    <Overview top={visibleRanked.slice(0,3)} data={data} onPlayer={onPlayer}/>
    <section className="home-view-panel ranking-panel" aria-labelledby="ranking-title">
      <div className="home-panel-head"><div><p className="kicker">即時競爭形勢</p><h2 id="ranking-title">目前排名</h2><p>每場結果都會即時反映在 ELO 與近期狀態。</p></div><div className="mini-toggle ranking-scope-toggle" aria-label="排名球員範圍"><button aria-pressed={!officialOnly} className={!officialOnly?"active":""} onClick={()=>setOfficialOnly(false)}>全部球員</button><button aria-pressed={officialOnly} className={officialOnly?"active":""} onClick={()=>setOfficialOnly(true)}>正式球手</button></div></div>
    <SortControls sort={sort} dir={dir} onSort={sortBy}/>
    <div className="table-card">{visibleRanked.length===0?<Empty text={officialOnly?"尚未有正式球手":"尚未有球員"} sub={officialOnly?"未有球員完成臨時門檻，暫時未有正式評分。":"前往球員頁面新增第一位球員。"}/>:<><div className="table-head sortable"><button title="箭嘴為過去 10 天的排名升跌" onClick={()=>sortBy("rank")}>排名<SortArrow active={sort==="rank"} dir={dir}/></button><button onClick={()=>sortBy("name")}>球員<SortArrow active={sort==="name"} dir={dir}/></button><button title="最近五筆比賽；較近期結果權重較高" onClick={()=>sortBy("form")}>近況<SortArrow active={sort==="form"} dir={dir}/></button><button onClick={()=>sortBy("winRate")}>場數／勝率<SortArrow active={sort==="winRate"} dir={dir}/></button><button onClick={()=>sortBy("suggested")}>建議／正式評分<SortArrow active={sort==="suggested"} dir={dir}/></button><button title="ELO 及近10天ELO變化" onClick={()=>sortBy("rating")}>ELO<SortArrow active={sort==="rating"} dir={dir}/></button></div>
      <MobileSortHead sort={sort}/>
      {shown.map(p=>{const rank=rankOf.get(p.id)??0,suggested=Math.round(suggestedHandicap(p,data)),swing=recentDeltaDays(p,data,10),played=games(p),rate=played?Math.round(p.wins/played*100):0,provisional=played<data.settings.provisionalGames,trailing=trailingStat(sort,p,data,suggested);
        return <button className={`row ${rank===1?"top":""} ${provisional?"provisional":""}`} key={p.id} onClick={()=>onPlayer(p)} aria-label={`${p.name}，排名 ${rank}，ELO ${Math.round(p.rating)}，近10天ELO變化 ${swing>=0?"+":""}${Math.round(swing)}，建議讓分 ${suggested}${provisional?"，臨時評分":""}`}>
        <span className="rank">{rank===1?"♛":rank}{(()=>{if(!movement.active)return null;const move=movement.map.get(p.id)??0;
          return move===0?<em className="move flat" aria-label="10 天內排名不變">–</em>
          :<em className={`move ${move>0?"up":"down"}`} aria-label={`較 10 天前${move>0?"上升":"下跌"} ${Math.abs(move)} 位`}>{move>0?"▲":"▼"}{Math.abs(move)}</em>})()}</span><span className="person"><PlayerBadge player={p}/><b>{p.name}<small>{played<data.settings.provisionalGames?"臨時":<span className="official-only">正式</span>}<span className="rating-kind-suffix">評分</span><em className="person-meta"> · {played} 場</em></small></b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{played} 場<small>{rate}% 勝率</small></span><span className="dual-rating"><b>{suggested}</b><small>正式 {p.handicap==null?"—":p.handicap}</small></span>
        {trailing?<span className="elo"><b className={trailing.cls}>{trailing.big}</b><small>{trailing.sub}</small></span>
        :<span className="elo"><b>{Math.round(p.rating)}</b><small className={swing>=0?"positive":"negative"}>{swing>=0?"+":""}{Math.round(swing)}</small><em className="elo-suggested">建議 {suggested}</em></span>}</button>})}</>}</div>
    </section></>}
    {homeView==="breaks"&&<section className="home-view-panel break-records-panel" aria-labelledby="break-records-title">
      <div className="home-panel-head"><div><p className="kicker">HIGH BREAK RECORDS</p><h2 id="break-records-title">最高單桿紀錄</h2><p>查看每位球員的個人最佳、歷史最高，或近 30 日最高紀錄。</p></div><div className="mini-toggle break-toggle" aria-label="單桿紀錄顯示方式"><button aria-pressed={breakView==="players"} className={breakView==="players"?"active":""} onClick={()=>setBreakView("players")}>球員最高</button><button aria-pressed={breakView==="overall"} className={breakView==="overall"?"active":""} onClick={()=>setBreakView("overall")}>歷史最高</button><button aria-pressed={breakView==="recent"} className={breakView==="recent"?"active":""} onClick={()=>setBreakView("recent")}>近30日最高</button></div></div>
      <ol className="break-ranking">{Array.from({length:10},(_,index)=>{const record=displayedBreaks[index];const medal=["gold","silver","bronze"][index];return <li key={record?.key??`empty-${index}`} className={`${record?"":"empty-rank"}${medal?` medal medal-${medal}`:""}`}><span className="break-position">{medal?<i className="medal-icon" aria-hidden="true">{["🥇","🥈","🥉"][index]}</i>:index+1}</span>{record?<><PlayerBadge player={record.player}/><b><span>{record.player.name}</span><small>對 {record.opponent}<span className="break-date-inline"> · {record.date}</span></small></b><time dateTime={record.date}>{record.date}</time><strong>{record.value>=100&&<em className="century-badge" title="破百單桿">破百</em>}{record.value}</strong></>:<b>N/A</b>}</li>})}</ol>
      <p className="chart-summary">{breakView==="players"?"每位球員只顯示其最高單桿。":breakView==="overall"?"按所有已確認賽事的單桿記錄排名，同一球員可重複上榜。":`${thirtyDaysAgo} 至 ${today} 的最高單桿，同一球員可重複上榜。`}</p>
    </section>}
    {homeView==="recent"&&<ThirtyDayStats data={data} onPlayer={onPlayer} onMatch={onMatch} onRivalry={onRivalry}/>}</>;
}

function RecentStatIcon({kind}:{kind:"matches"|"frames"|"players"|"average"|"active"|"elo"|"win"|"break"}) {
  const paths={
    matches:<><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="m10.5 10.5 3 3"/></>,
    frames:<><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 9h8M8 13h5"/></>,
    players:<><circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.4-5.3 5.5-5.3s5.5 2.3 5.5 5.3M15 6.5a3 3 0 0 1 0 5.8M16 14c2.6.3 4.5 2.3 4.5 5"/></>,
    average:<><path d="M5 18V9M12 18V5M19 18v-6"/><path d="M3 18h18"/></>,
    active:<><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    elo:<><path d="m5 15 4-4 3 3 7-8"/><path d="M14 6h5v5"/></>,
    win:<><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M5 6H3v1a4 4 0 0 0 4 4M19 6h2v1a4 4 0 0 1-4 4M12 13v4M8 20h8"/></>,
    break:<><circle cx="7" cy="15" r="3"/><circle cx="14" cy="9" r="3"/><circle cx="17" cy="17" r="3"/></>
  };
  return <span className="recent-stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24">{paths[kind]}</svg></span>;
}
function ThirtyDayStats({data,onPlayer,onMatch,onRivalry}:{data:AppState;onPlayer:(player:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}){
  const stats=useMemo(()=>{
    const matches=data.matches.filter(match=>match.status==="confirmed"&&isInPastThirtyDays(match.playedOn));
    const playerById=new Map(data.players.map(player=>[player.id,player]));
    const perPlayer=new Map<string,{matches:number;wins:number;delta:number;frames:number}>();
    const touch=(id:string)=>{const current=perPlayer.get(id)??{matches:0,wins:0,delta:0,frames:0};perPlayer.set(id,current);return current};
    for(const match of matches){
      const a=touch(match.a),b=touch(match.b),frames=match.scoreA+match.scoreB;
      a.matches++;b.matches++;a.frames+=frames;b.frames+=frames;a.delta+=match.deltaA;b.delta-=match.deltaA;
      if(match.scoreA>match.scoreB)a.wins++;else if(match.scoreB>match.scoreA)b.wins++;
    }
    const entries=[...perPlayer.entries()].filter(([id])=>playerById.has(id));
    const pick=(sorter:(a:[string,{matches:number;wins:number;delta:number;frames:number}],b:[string,{matches:number;wins:number;delta:number;frames:number}])=>number)=>entries.slice().sort(sorter)[0];
    const busiest=pick((a,b)=>b[1].matches-a[1].matches||b[1].frames-a[1].frames);
    const mover=pick((a,b)=>b[1].delta-a[1].delta||b[1].matches-a[1].matches);
    const qualified=entries.filter(([,value])=>value.matches>=3).sort((a,b)=>b[1].wins/b[1].matches-a[1].wins/a[1].matches||b[1].matches-a[1].matches)[0];
    const topBreak=matches.flatMap(match=>(match.highBreaks??[]).map(item=>({player:playerById.get(item.playerId),value:item.value,date:match.playedOn}))).filter(item=>item.player&&item.value>0&&item.value<=147).sort((a,b)=>b.value-a.value||(b.date||"").localeCompare(a.date||""))[0];
    const pairCounts=new Map<string,{a:string;b:string;matches:number;framesA:number;framesB:number}>();
    for(const match of matches){const first=match.a<match.b,key=first?`${match.a}|${match.b}`:`${match.b}|${match.a}`,record=pairCounts.get(key)??{a:first?match.a:match.b,b:first?match.b:match.a,matches:0,framesA:0,framesB:0};record.matches++;record.framesA+=first?match.scoreA:match.scoreB;record.framesB+=first?match.scoreB:match.scoreA;pairCounts.set(key,record)}
    const rivalry=[...pairCounts.values()].filter(pair=>playerById.has(pair.a)&&playerById.has(pair.b)).sort((a,b)=>b.matches-a.matches||(b.framesA+b.framesB)-(a.framesA+a.framesB))[0];
    const closest=matches.slice().sort((a,b)=>Math.abs(a.scoreA-a.scoreB)-Math.abs(b.scoreA-b.scoreB)||(b.scoreA+b.scoreB)-(a.scoreA+a.scoreB)||(b.playedOn||b.createdAt).localeCompare(a.playedOn||a.createdAt))[0];
    const totalFrames=matches.reduce((sum,match)=>sum+match.scoreA+match.scoreB,0);
    const weekCounts=[0,0,0,0];
    for(const match of matches){const age=Math.max(0,Math.floor((Date.parse(`${today}T00:00:00+08:00`)-Date.parse(`${match.playedOn}T00:00:00+08:00`))/864e5)),bucket=Math.min(3,Math.floor(age/7));weekCounts[3-bucket]++}
    const decisive=matches.filter(match=>match.scoreA!==match.scoreB).length,draws=matches.length-decisive;
    const closeMatches=matches.filter(match=>Math.abs(match.scoreA-match.scoreB)<=1).length;
    const averageMargin=matches.reduce((sum,match)=>sum+Math.abs(match.scoreA-match.scoreB),0)/matches.length;
    return {matches,totalFrames,active:entries.length,average:matches.length?totalFrames/matches.length:0,busiest:busiest&&{player:playerById.get(busiest[0])!,...busiest[1]},mover:mover&&{player:playerById.get(mover[0])!,...mover[1]},winRate:qualified&&{player:playerById.get(qualified[0])!,...qualified[1]},topBreak,rivalry:rivalry&&{...rivalry,aPlayer:playerById.get(rivalry.a)!,bPlayer:playerById.get(rivalry.b)!},closest,weekCounts,decisive,draws,closeMatches,averageMargin};
  },[data]);
  // Historical imports can contain a non-string participant/name value. Keep
  // the dashboard presentable instead of letting an unexpected record reach JSX.
  const playerName=(id:unknown)=>{
    const player=typeof id==="string"?data.players.find(candidate=>candidate.id===id):undefined;
    return typeof player?.name==="string"?player.name:"已移除球員";
  };
  if(!stats.matches.length)return <section className="home-view-panel recent-stats-panel"><div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2>近三十日統計</h2><p>最近三十日暫時未有已確認賽事。</p></div></div><Empty text="未有近期賽事" sub="記錄新賽果後，活躍度與近期焦點會顯示在這裡。"/></section>;
  const maxWeek=Math.max(1,...stats.weekCounts);
  return <section className="home-view-panel recent-stats-panel" aria-labelledby="recent-stats-title">
    <div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2 id="recent-stats-title">近三十日統計</h2><p>{thirtyDaysAgo} 至 {today} 的已確認賽事。</p></div></div>
    <div className="recent-stat-metrics">
      <div><RecentStatIcon kind="matches"/><span><small>比賽場數</small><b>{stats.matches.length}</b></span></div>
      <div><RecentStatIcon kind="frames"/><span><small>總局數</small><b>{stats.totalFrames}</b></span></div>
      <div><RecentStatIcon kind="players"/><span><small>活躍球員</small><b>{stats.active}</b></span></div>
      <div><RecentStatIcon kind="average"/><span><small>平均每場</small><b>{stats.average.toFixed(1)}<em>局</em></b></span></div>
    </div>
    <div className="recent-focus-grid">
      {stats.busiest&&<button onClick={()=>onPlayer(stats.busiest!.player)}><span className="recent-focus-label"><RecentStatIcon kind="active"/>最活躍球員</span><PlayerBadge className="recent-player-badge" player={stats.busiest.player}/><span className="recent-focus-person"><b>{stats.busiest.player.name}</b><em>{stats.busiest.matches} 場 · {stats.busiest.frames} 局</em></span></button>}
      {stats.mover&&<button onClick={()=>onPlayer(stats.mover!.player)}><span className="recent-focus-label"><RecentStatIcon kind="elo"/>ELO 升幅最高</span><PlayerBadge className="recent-player-badge" player={stats.mover.player}/><span className="recent-focus-person"><b>{stats.mover.player.name}</b><em className={stats.mover.delta>=0?"positive":"negative"}>{stats.mover.delta>=0?"+":""}{Math.round(stats.mover.delta)} ELO</em></span></button>}
      {stats.winRate&&<button onClick={()=>onPlayer(stats.winRate!.player)}><span className="recent-focus-label"><RecentStatIcon kind="win"/>最高勝率 · 至少 3 場</span><PlayerBadge className="recent-player-badge" player={stats.winRate.player}/><span className="recent-focus-person"><b>{stats.winRate.player.name}</b><em>{Math.round(stats.winRate.wins/stats.winRate.matches*100)}% · {stats.winRate.wins}/{stats.winRate.matches} 勝</em></span></button>}
      {stats.topBreak&&<button onClick={()=>onPlayer(stats.topBreak!.player!)}><span className="recent-focus-label"><RecentStatIcon kind="break"/>近三十日最高單桿</span><PlayerBadge className="recent-player-badge" player={stats.topBreak.player!}/><span className="recent-focus-person"><b>{stats.topBreak.player!.name}</b><em>{stats.topBreak.value} 分 · {stats.topBreak.date}</em></span></button>}
    </div>
    <div className="recent-chart-grid">
      <article className="recent-chart-card recent-activity-chart"><header><div><small>ACTIVITY</small><h3>每週比賽走勢</h3></div><strong>{stats.matches.length}<small>場</small></strong></header><div className="recent-week-chart" aria-label={`過去四週比賽場數：${stats.weekCounts.join("、")}`}>{stats.weekCounts.map((value,index)=><div key={`week-${index}`}><span><i style={{height:`${Math.max(8,value/maxWeek*100)}%`}}/></span><b>{value}</b><small>第 {index+1} 週</small></div>)}</div></article>
      <article className="recent-chart-card recent-outcome-chart"><header><div><small>OUTCOMES</small><h3>賽事結果分布</h3></div></header><div className="recent-donut-wrap"><div className="recent-donut" style={{"--decisive":`${stats.decisive/stats.matches.length*360}deg`} as Record<string,string>}><span><b>{Math.round(stats.decisive/stats.matches.length*100)}%</b><small>分勝負</small></span></div><div className="recent-chart-legend"><span><i className="decisive"/><b>分勝負</b><em>{stats.decisive} 場</em></span><span><i className="draw"/><b>和局</b><em>{stats.draws} 場</em></span></div></div></article>
      <article className="recent-chart-card recent-balance-chart"><header><div><small>COMPETITION</small><h3>對賽緊湊度</h3></div></header><div className="recent-balance-hero"><b>{Math.round(stats.closeMatches/stats.matches.length*100)}<small>%</small></b><span>賽事僅相差一局或以下</span></div><footer><span>緊湊賽事 <b>{stats.closeMatches}</b></span><span>平均差距 <b>{stats.averageMargin.toFixed(1)} 局</b></span></footer></article>
    </div>
    <div className="recent-detail-grid">
      {stats.rivalry&&<button className="recent-detail-card" onClick={()=>onRivalry(stats.rivalry!.aPlayer,stats.rivalry!.bPlayer)} aria-label={`查看 ${stats.rivalry.aPlayer.name} 對 ${stats.rivalry.bPlayer.name} 的對賽紀錄`}><small>熱門對賽</small><b>{stats.rivalry.aPlayer.name} × {stats.rivalry.bPlayer.name}</b><p>{stats.rivalry.matches} 場 · 局數 {stats.rivalry.framesA}–{stats.rivalry.framesB}</p><span>查看對賽紀錄 →</span></button>}
      {stats.closest&&<button className="recent-detail-card recent-close-card" onClick={()=>onMatch(stats.closest!)} aria-label={`查看 ${playerName(stats.closest.a)} 對 ${playerName(stats.closest.b)} 的賽事`}><small>最接近賽事</small><b>{playerName(stats.closest.a)} {stats.closest.scoreA}–{stats.closest.scoreB} {playerName(stats.closest.b)}</b><p>{stats.closest.playedOn} · 相差 {Math.abs(stats.closest.scoreA-stats.closest.scoreB)} 局</p><span>查看賽事 →</span></button>}
    </div>  </section>;
}
function fadeHex(hex:string,alpha:number){
  const value=hex.replace("#","");
  const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const monthGroupLabel=(month:string)=>{
  const [y,m]=month.split("-").map(Number);
  const now=new Date(),thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  if(month===thisMonth)return "本月";
  const last=shiftMonth(thisMonth,-1);
  if(month===last)return "上月";
  return `${y}年${m}月`;
};

function Matches({data,canManageMatch,onEdit,onVoid,onPlayer,view,setView,pair,setPair,highlight,isAdmin,onCreateTournament,onEditTournament,onDeleteTournament,ownPlayerId,onSignUpTournament}:{data:AppState;canManageMatch:(match:Match)=>boolean;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onPlayer:(player:Player)=>void;view:"history"|"calendar"|"cup";setView:(view:"history"|"calendar"|"cup")=>void;pair:{a:string;b:string};setPair:(pair:{a:string;b:string})=>void;highlight:string|null;isAdmin:boolean;onCreateTournament:()=>void;onEditTournament:(tournament:Tournament)=>void;onDeleteTournament:(tournament:Tournament)=>void;ownPlayerId?:string;onSignUpTournament:(id:string)=>void}) {
  const [sortBy,setSortBy]=useState<"playedOn"|"createdAt">("playedOn");
  const [monthOpen,setMonthOpen]=useState<Record<string,boolean>>({});
  const [sortDirection,setSortDirection]=useState<"desc"|"asc">("desc");
  const [modeFilter,setModeFilter]=useState<"all"|MatchMode>("all");
  const [selectedTournament,setSelectedTournament]=useState<string>("");
  useEffect(()=>{
    if(selectedTournament && data.tournaments.some(item=>item.id===selectedTournament))return;
    if(selectedTournament)setSelectedTournament("");
  },[data.tournaments,selectedTournament]);
  // This component unmounts on every trip to another tab, so without a round
  // trip through storage a scouting session loses its sort and date range the
  // moment the user glances at 排行榜. Same restore-then-write shape as the
  // focus above, including the skipped first write.
  const prefsRestored=useRef(false);
  useEffect(()=>{
    const stored=localStorage.getItem("scaa-match-prefs");
    if(!stored)return;
    try{
      const value=JSON.parse(stored);
      if(value?.sortBy==="playedOn"||value?.sortBy==="createdAt")setSortBy(value.sortBy);
      if(value?.sortDirection==="asc"||value?.sortDirection==="desc")setSortDirection(value.sortDirection);
      if(value?.modeFilter==="all"||value?.modeFilter==="1v1"||value?.modeFilter==="2v2"||value?.modeFilter==="cup")setModeFilter(value.modeFilter);
    }catch{}
  },[]);
  useEffect(()=>{
    if(!prefsRestored.current){prefsRestored.current=true;return;}
    localStorage.setItem("scaa-match-prefs",JSON.stringify({sortBy,sortDirection,modeFilter}));
  },[sortBy,sortDirection,modeFilter]);
  // A stale "2v2" mode filter from a previous session would otherwise hide the
  // dedicated head-to-head view whenever a fresh pair is picked to compare.
  const pairMounted=useRef(false);
  useEffect(()=>{
    if(!pairMounted.current){pairMounted.current=true;return;}
    setModeFilter(current=>current==="2v2"?"all":current);
  },[pair.a,pair.b]);
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  const roster=[...data.players].sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const focusPlayer=pair.a;
  const opponent=data.players.find(p=>p.id===pair.b);
  const a=data.players.find(p=>p.id===pair.a);
  // Picking a second player switches the same list into a head-to-head
  // comparison instead of jumping to a separate screen — one mental model,
  // one match card, for both "my results" and "us against each other".
  const pairSelected=Boolean(a&&opponent&&a.id!==opponent.id);
  const comparing=pairSelected&&modeFilter!=="2v2";
  const filteringShared2v2=pairSelected&&modeFilter==="2v2";
  const matchesMode=(match:Match)=>modeFilter==="all"||matchMode(match)===modeFilter;
  const matches=useMemo(()=>{
    if(comparing){
      return data.matches
        .filter(m=>matchesMode(m)&&m.status==="confirmed"&&(
          matchMode(m)==="2v2"
            ? modeFilter==="all"&&isParticipant(m,a!.id)&&isParticipant(m,opponent!.id)
            : (m.a===a!.id&&m.b===opponent!.id)||(m.a===opponent!.id&&m.b===a!.id)
        ))
        .sort((left,right)=>{const primary=left[sortBy].localeCompare(right[sortBy]);const tieBreak=left.createdAt.localeCompare(right.createdAt);return sortDirection==="asc"?(primary||tieBreak):-(primary||tieBreak)});
    }
    return [...data.matches]
      .filter(m=>matchesMode(m)&&(
        filteringShared2v2
          ? isParticipant(m,a!.id)&&isParticipant(m,opponent!.id)
          : !focusPlayer||isParticipant(m,focusPlayer)
      ))
      .sort((left,right)=>{
        const primary=left[sortBy].localeCompare(right[sortBy]);
        const tieBreak=left.createdAt.localeCompare(right.createdAt);
        return sortDirection==="asc"?(primary||tieBreak):-(primary||tieBreak);
      });
  },[data.matches,sortBy,sortDirection,modeFilter,focusPlayer,comparing,filteringShared2v2,a,opponent]);
  // When one player is in focus, their record across the filtered set is the
  // headline; the raw list alone makes you tally it yourself.
  const focusSummary=useMemo(()=>{
    if(!focusPlayer||pairSelected)return null;
    return matches.reduce((total,m)=>{
      if(m.status!=="confirmed"||isEntertainmentMode(m.mode))return total;
      const first=m.a===focusPlayer,own=first?m.scoreA:m.scoreB,other=first?m.scoreB:m.scoreA;
      total.net+=first?m.deltaA:-m.deltaA;
      if(own>other)total.wins++;else if(own<other)total.losses++;else total.draws++;
      return total;
    },{wins:0,losses:0,draws:0,net:0});
  },[matches,focusPlayer,pairSelected]);
  const headToHeadMatches=useMemo(
    ()=>matches.filter(match=>matchMode(match)==="1v1").sort((left,right)=>right.playedOn.localeCompare(left.playedOn)||right.createdAt.localeCompare(left.createdAt)),
    [matches]
  );
  const h2hStats=useMemo(()=>{
    if(!comparing)return null;
    return headToHeadMatches.reduce((total,match)=>{const first=match.a===a!.id,scoreA=first?match.scoreA:match.scoreB,scoreB=first?match.scoreB:match.scoreA;total.framesA+=scoreA;total.framesB+=scoreB;if(scoreA>scoreB)total.winsA++;else if(scoreA<scoreB)total.winsB++;else total.draws++;return total;},{winsA:0,winsB:0,draws:0,framesA:0,framesB:0});
  },[headToHeadMatches,comparing,a]);
  const decided=Math.max(1,(h2hStats?.winsA??0)+(h2hStats?.winsB??0)+(h2hStats?.draws??0));
  const aShare=h2hStats?Math.round((h2hStats.winsA+h2hStats.draws/2)/decided*100):50;
  // Last 5 meetings, most recent first — the quick "who's hot" read that a
  // plain win/loss tally can't give you.
  const recentForm=useMemo(()=>{
    if(!comparing||!a)return [];
    return headToHeadMatches.slice(0,5).map(match=>{
      const first=match.a===a.id,own=first?match.scoreA:match.scoreB,other=first?match.scoreB:match.scoreA;
      return own>other?"W":own<other?"L":"D";
    });
  },[headToHeadMatches,comparing,a]);
  const setFocus=(id:string)=>setPair(id
    ? {a:id,b:id===pair.b?"":pair.b}
    : {a:pair.b,b:""});
  const setOpponent=(id:string)=>setPair({...pair,b:id});
  const clearAll=()=>{setPair({a:"",b:""});setModeFilter("all")};
  // Grouped by month with a sticky header instead of a flat list — long
  // history stays scannable without repeating the full date on every row.
  const groups=useMemo(()=>{
    const order:string[]=[],map=new Map<string,Match[]>();
    for(const m of matches){
      const key=comparing?"__all__":m.playedOn.slice(0,7);
      if(!map.has(key)){map.set(key,[]);order.push(key)}
      map.get(key)!.push(m);
    }
    return order.map(key=>({key,matches:map.get(key)!}));
  },[matches,comparing]);
  const newestMonth=groups.reduce((latest,group)=>group.key>latest?group.key:latest,"");
  return <><section className="hero small"><div><p className="kicker">完整可追溯</p><h1>比賽記錄</h1><p>查看比分、讓分與每場 ELO 變化。</p></div></section>
    <div className="match-view-toggle" role="tablist" aria-label="比賽資料檢視"><button role="tab" aria-selected={view==="history"} className={view==="history"?"active":""} onClick={()=>setView("history")}>賽事記錄</button><button role="tab" aria-selected={view==="calendar"} className={view==="calendar"?"active":""} onClick={()=>setView("calendar")}>日曆</button><button role="tab" aria-selected={view==="cup"} className={view==="cup"?"active":""} onClick={()=>setView("cup")}>盃賽紀錄</button></div>
    {view==="calendar"?<CalendarView data={data} canManageMatch={canManageMatch} onPlayer={onPlayer} onEdit={onEdit} onVoid={onVoid}/> : view==="cup" ? <CupBracketView data={data} selectedTournament={selectedTournament} setSelectedTournament={setSelectedTournament} canManageMatch={canManageMatch} onEdit={onEdit} isAdmin={isAdmin} onCreateTournament={onCreateTournament} onEditTournament={onEditTournament} onDeleteTournament={onDeleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={onSignUpTournament}/> : <>
    <section className="match-filter-toolbar" aria-label="篩選及排序比賽記錄">
      <div className="match-filter-control player-control">
        <span className="match-filter-label">球員</span>
        <div className="match-player-picker">
          {a&&<span className="match-player-chip">{a.name}<button type="button" aria-label={`取消選擇 ${a.name}`} onClick={()=>setFocus("")}>×</button></span>}
          {opponent&&<span className="match-player-chip compare">{opponent.name}<button type="button" aria-label={`取消比較 ${opponent.name}`} onClick={()=>setOpponent("")}>×</button></span>}
          {!focusPlayer&&<PlayerCombobox players={roster} value="" onChange={setFocus} placeholder="全部球員" ariaLabel="球員"/>}
          {focusPlayer&&!opponent&&<PlayerCombobox players={roster.filter(p=>p.id!==focusPlayer)} value="" onChange={setOpponent} placeholder="＋ 比較球員" ariaLabel="選擇比較球員"/>}
        </div>
      </div>
      <div className="match-filter-control type-control">
        <span className="match-filter-label">類型</span>
        <div className="match-filter-options" role="group" aria-label="比賽類型">
          {([['all','全部'],['1v1','1v1'],['2v2','2v2'],['cup','盃賽']] as const).map(([value,label])=><button type="button" key={value} className={modeFilter===value?"active":""} aria-pressed={modeFilter===value} onClick={()=>setModeFilter(value)}>{label}</button>)}
        </div>
      </div>
      <div className="match-filter-control sort-control"><span className="match-filter-label">排序</span><div className="match-sort-compact"><select aria-label="排序依據" value={sortBy} onChange={event=>setSortBy(event.target.value as "playedOn"|"createdAt")}><option value="playedOn">比賽日期</option><option value="createdAt">加入日期</option></select><button type="button" aria-label={sortDirection==="desc"?"目前最新至最舊；按下改為最舊至最新":"目前最舊至最新；按下改為最新至最舊"} title={sortDirection==="desc"?"最新至最舊":"最舊至最新"} onClick={()=>setSortDirection(value=>value==="desc"?"asc":"desc")}>{sortDirection==="desc"?"↓":"↑"}</button></div></div>
    </section>
    {(focusPlayer||modeFilter!=="all")&&<div className="match-filter-status"><span>{matches.length} 場符合記錄</span><button type="button" onClick={clearAll}>清除篩選</button></div>}    {comparing&&a&&opponent&&h2hStats&&<div className="h2h-summary neutral">
      <div className="h2h-hero-players">
        <div className="h2h-hero-player"><PlayerBadge player={a}/><b>{a.name}</b><small>{Math.round(a.rating)} ELO</small></div>
        <div className="h2h-hero-score"><span><b>{h2hStats.winsA}</b><em>–</em><b>{h2hStats.winsB}</b></span>{h2hStats.draws>0&&<small>{h2hStats.draws} 和</small>}</div>
        <div className="h2h-hero-player right"><PlayerBadge player={opponent}/><b>{opponent.name}</b><small>{Math.round(opponent.rating)} ELO</small></div>
      </div>
      {/* Both sides stay in their own avatar colour (so the bar still ties
          back to the avatars above), but the trailing side fades to ~38%
          opacity — that guarantees contrast against the leader regardless
          of how close the two avatar hues happen to be. Tied share fades
          neither side. */}
      <div className="h2h-hero-bar" aria-hidden="true">
        <i style={{width:`${aShare}%`,background:fadeHex(avatarHex(a.colour),aShare<50?.38:1)}}/>
        <i style={{width:`${100-aShare}%`,background:fadeHex(avatarHex(opponent.colour),aShare>50?.38:1)}}/>
      </div>
      <div className="h2h-hero-bar-labels"><span>{aShare}%</span><span>{100-aShare}%</span></div>
      {recentForm.length>0&&<div className="h2h-hero-form"><small>近{recentForm.length}場</small><div className="h2h-form-dots">{recentForm.map((result,index)=><i key={index} className={`form-dot ${result.toLowerCase()}`} aria-label={result==="W"?"勝":result==="L"?"負":"和"}>{result}</i>)}</div></div>}
      <div className="h2h-hero-stats">
        <div><small>局數比例</small><b>{h2hStats.framesA}<em>–</em>{h2hStats.framesB}</b></div>
        <div><small>總場數</small><b>{headToHeadMatches.length}</b></div>
        <div><small>最近交手</small><b>{headToHeadMatches[0]?.playedOn??"—"}</b></div>
      </div>
    </div>}
    <div className="match-list">{groups.length===0?<Empty text={comparing?"沒有符合的對賽記錄":filteringShared2v2?"沒有兩人共同參與的 2v2 記錄":focusPlayer?"沒有符合的比賽記錄":"尚未有比賽記錄"} sub={comparing?"記錄兩人的第一場比賽後，對賽記錄會顯示在這裡。":filteringShared2v2?"兩位球員可以是隊友或對手；目前沒有同時包含兩人的賽事。":focusPlayer?"這位球員暫時沒有已記錄的賽事。":"記錄第一場比賽後，詳情會顯示在這裡。"}/>:groups.map(group=>{
      const cards=group.matches.map(m=><MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} highlighted={m.id===highlight}/>);
      if(comparing)return <Fragment key={group.key}>{cards}</Fragment>;
      const open=monthOpen[group.key]??(group.key===newestMonth||group.matches.some(m=>m.id===highlight));
      const panelId=`match-month-${group.key}`;
      return <section className="match-month-group" key={group.key}>
        <button type="button" className="match-month-header" aria-expanded={open} aria-controls={panelId} onClick={()=>setMonthOpen(value=>({...value,[group.key]:!open}))}>
          <span>{monthGroupLabel(group.key)}</span><small>{group.matches.length} 場</small><i aria-hidden="true"/>
        </button>
        {open&&<div className="match-month-cards" id={panelId}>{cards}</div>}
      </section>;
    })}</div></>}</>;
}

function CupBracketView({data,selectedTournament,setSelectedTournament,canManageMatch,onEdit,isAdmin,onCreateTournament,onEditTournament,onDeleteTournament,ownPlayerId,onSignUpTournament}:{data:AppState;selectedTournament:string;setSelectedTournament:(id:string)=>void;canManageMatch:(match:Match)=>boolean;onEdit:(match:Match)=>void;isAdmin:boolean;onCreateTournament:()=>void;onEditTournament:(tournament:Tournament)=>void;onDeleteTournament:(tournament:Tournament)=>void;ownPlayerId?:string;onSignUpTournament:(id:string)=>void}){
  const recentTournaments=[...data.tournaments].sort((left,right)=>right.createdAt.localeCompare(left.createdAt)).slice(0,3);
  const tournament=data.tournaments.find(item=>item.id===selectedTournament);
  const tournamentMatches=data.matches.filter(match=>match.mode==="cup"&&match.tournamentId===selectedTournament&&match.status==="confirmed");
  const deadline=tournament?.signupDeadline?new Date(`${tournament.signupDeadline.length===10?tournament.signupDeadline+"T23:59":tournament.signupDeadline}:00+08:00`):null;
  const deadlinePassed=Boolean(deadline&&!Number.isNaN(deadline.getTime())&&deadline.getTime()<=Date.now());
  const signedUp=Boolean(ownPlayerId&&(tournament?.signups||[]).includes(ownPlayerId));
  const name=(id:string)=>data.players.find(player=>player.id===id)?.name??"待定";
  const hash=(value:string)=>{let result=2166136261;for(const character of value){result^=character.charCodeAt(0);result=Math.imul(result,16777619)}return result>>>0;};
  const draw=deadlinePassed&&tournament?[...(tournament.signups??[])].sort((left,right)=>hash(`${tournament.id}:${left}`)-hash(`${tournament.id}:${right}`) ):[];
  const bracketSize=draw.length>0?2**Math.ceil(Math.log2(Math.max(2,draw.length))):0;
  const totalRounds=bracketSize?Math.max(1,Math.log2(bracketSize)):0;
  const matchBySlot=(round:number,index:number)=>tournamentMatches.find(match=>(match.tournamentRound??1)===round&&(match.tournamentMatchIndex??1)===index);
  const winner=(match:Match|undefined)=>match?(match.scoreA>match.scoreB?match.a:match.scoreB>match.scoreA?match.b:""):"";
  const participants=(round:number,index:number):[string,string]=>{
    if(round===1)return [draw[(index-1)*2]??"",draw[(index-1)*2+1]??""];
    const first=participants(round-1,(index-1)*2+1),second=participants(round-1,(index-1)*2+2);
    const firstMatch=matchBySlot(round-1,(index-1)*2+1),secondMatch=matchBySlot(round-1,(index-1)*2+2);
    return [winner(firstMatch)||(!first[1]?first[0]:""),winner(secondMatch)||(!second[1]?second[0]:"")];
  };
  const roundLabel=(round:number,total:number)=>{const remaining=total-round;return remaining<=0?"決賽":remaining===1?"四強":remaining===2?"八強":`${2**(remaining+1)}強`;};
  const projectedBracketSize=(tournament?.signups?.length??0)>0?2**Math.ceil(Math.log2(Math.max(2,tournament!.signups.length))):0;
  const projectedRounds=projectedBracketSize?Math.max(1,Math.log2(projectedBracketSize)):0;
  const controls=(item:Tournament)=><><button type="button" className="more" onClick={()=>onEditTournament(item)}>編輯</button><button type="button" className="danger-link" onClick={()=>onDeleteTournament(item)}>刪除</button></>;
  if(!selectedTournament)return <section className="bracket-view"><div className="bracket-header"><label>選擇盃賽<select value="" onChange={event=>setSelectedTournament(event.target.value)}><option value="">選擇盃賽</option>{data.tournaments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{isAdmin&&<button type="button" className="primary" onClick={onCreateTournament}>＋ 新增盃賽</button>}</div><div className="recent-tournaments"><h3>最近盃賽</h3>{recentTournaments.length===0?<p className="mm-note">尚未建立盃賽。</p>:recentTournaments.map(item=><article className="recent-tournament-row" key={item.id}><button type="button" className="recent-tournament-open" onClick={()=>setSelectedTournament(item.id)}><span><b>{item.name}</b><small>{item.signups.length} 人報名 · 報名截止 {item.signupDeadline.replace("T"," ")}</small></span></button>{isAdmin&&controls(item)}</article>)}</div></section>;
  if(!tournament)return null;
  return <section className="bracket-view"><div className="bracket-header"><div><label>選擇盃賽<select value={selectedTournament} onChange={event=>setSelectedTournament(event.target.value)}><option value="">選擇盃賽</option>{data.tournaments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>{tournament.signups.length} 人報名 · 報名截止 {tournament.signupDeadline.replace("T"," ")}</small></div><div className="bracket-actions">{isAdmin&&<button type="button" className="primary" onClick={onCreateTournament}>＋ 新增盃賽</button>}{isAdmin&&controls(tournament)}</div></div>
    {!deadlinePassed?<div className="bracket-body">
      {/* Entering a cup is a competition decision, so it sits with the bracket it leads to rather
          than in 約戰, where it competed for attention with arranging tonight's frame. */}
      <p className="mm-note">報名截止後會按報名名單抽籤並建立賽事對陣。</p>
      <div className="cup-signup-row">
        <span><b>{(tournament?.signups||[]).length} 人已報名</b><small>報名截止 {tournament?.signupDeadline.replace("T"," ")}</small></span>
        {ownPlayerId
          ?<button type="button" className={signedUp?"secondary":"primary"} onClick={()=>onSignUpTournament(selectedTournament)}>{signedUp?"取消報名":"報名"}</button>
          :<a className="secondary" href="/login">登入後報名</a>}
      </div>
      {projectedBracketSize>=2?<TournamentBracketChart totalRounds={projectedRounds} bracketSize={projectedBracketSize} roundLabel={roundLabel} participants={()=>["",""]} matchBySlot={()=>undefined} winner={()=>""} name={name} canManageMatch={canManageMatch} onEdit={onEdit} started={false}/>:<p className="mm-note">報名人數不足兩人，暫未能預覽對陣圖。</p>}
    </div>:draw.length<2?<div className="bracket-body"><p className="mm-note">報名人數不足兩人，未能建立賽事。</p></div>:<TournamentBracketChart totalRounds={totalRounds} bracketSize={bracketSize} roundLabel={roundLabel} participants={participants} matchBySlot={matchBySlot} winner={winner} name={name} canManageMatch={canManageMatch} onEdit={onEdit} started/>}
  </section>;
}

// A horizontal, left-to-right bracket tree: each round is a column of match
// boxes vertically centred against the pair feeding it, using the flex
// "stretch + space-around" trick so pairing lines up correctly without
// needing to measure pixel positions in JS.
function TournamentBracketChart({totalRounds,bracketSize,roundLabel,participants,matchBySlot,winner,name,canManageMatch,onEdit,started}:{
  totalRounds:number;
  bracketSize:number;
  roundLabel:(round:number,total:number)=>string;
  participants:(round:number,index:number)=>[string,string];
  matchBySlot:(round:number,index:number)=>Match|undefined;
  winner:(match:Match|undefined)=>string;
  name:(id:string)=>string;
  canManageMatch:(match:Match)=>boolean;
  onEdit:(match:Match)=>void;
  started:boolean;
}){
  return <div className="bracket-chart" role="group" aria-label="賽事對陣圖">
    {Array.from({length:totalRounds},(_,roundIndex)=>{
      const round=roundIndex+1,count=bracketSize/(2**round);
      return <div className={`bracket-round${round===totalRounds?" final":""}`} key={round}>
        <h3 className="bracket-round-title">{roundLabel(round,totalRounds)}</h3>
        <div className="bracket-round-matches">
          {Array.from({length:count},(_,slotIndex)=>{
            const index=slotIndex+1;
            const match=started?matchBySlot(round,index):undefined;
            const [first,second]=started?participants(round,index):["",""];
            const firstName=first?name(first):"待定",secondName=second?name(second):"待定";
            const win=winner(match);
            const bye=started&&Boolean((first&&!second)||(!first&&second));
            return <div className={`bracket-match${match?" played":""}`} key={`${round}-${index}`}>
              <div className={`bracket-slot${win&&win===first?" winner":""}${!first?" tbd":""}`}><span>{firstName}</span>{match&&<b>{match.scoreA}</b>}</div>
              <div className={`bracket-slot${win&&win===second?" winner":""}${!second?" tbd":""}`}><span>{secondName}</span>{match&&<b>{match.scoreB}</b>}</div>
              {bye&&<small className="bracket-bye">輪空晉級</small>}
              {match&&canManageMatch(match)&&<button type="button" className="more bracket-edit" onClick={()=>onEdit(match)}>編輯賽果</button>}
            </div>;
          })}
        </div>
      </div>;
    })}
  </div>;
}

// Collapsed by default: who played, the score, and each player's own ELO
// swing — the facts a user scans for. Edit/delete controls and the deeper
// math (before→after, predicted ratio, handicap detail) stay one tap away.
function MatchCard({data,match:m,canManage,name,onPlayer,onEdit,onVoid,highlighted=false}:{data:AppState;match:Match;canManage:boolean;name:(id:string)=>string;onPlayer:(id:string)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;highlighted?:boolean}) {
  const [open,setOpen]=useState(false);
  // Scrolling to the card beats trusting it to be at the top: a backdated
  // result, or an ascending sort, can drop it anywhere in the month groups.
  const card=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!highlighted)return;
    card.current?.scrollIntoView({behavior:"smooth",block:"center"});
  },[highlighted]);
  // Only the highest break per player is worth a glance — a player who ran
  // three centuries in one match still shows once, at their best number.
  const topBreaks=[m.a,m.a2,m.b,m.b2].filter((id):id is string=>Boolean(id))
    .map(id=>{
      const best=m.highBreaks?.filter(b=>b.playerId===id).reduce((max,item)=>Math.max(max,item.value),0)??0;
      return best>0?{playerId:id,value:best}:null;
    })
    .filter((entry):entry is {playerId:string;value:number}=>entry!=null);
  const leftLabel = isEntertainmentMode(m.mode) ? teamLabel(m,data,"A") : name(m.a);
  const rightLabel = isEntertainmentMode(m.mode) ? teamLabel(m,data,"B") : name(m.b);
  const preMatchLeftElo=m.beforeA2==null?m.beforeA:(m.beforeA+m.beforeA2)/2;
  const preMatchRightElo=m.beforeB2==null?m.beforeB:(m.beforeB+m.beforeB2)/2;
  const recommendedActual=matchMode(m)==="2v2"?Math.round(eloToHandicap(preMatchLeftElo-preMatchRightElo,data.settings)):roundToEven(eloToHandicap(preMatchLeftElo-preMatchRightElo,data.settings));
  const handicapText=(actual:number)=>
    actual>0?`${leftLabel} 每局讓 ${rightLabel} ${actual} 分`
    :actual<0?`${rightLabel} 每局讓 ${leftLabel} ${Math.abs(actual)} 分`
    :"不設讓分";
  return <article ref={card} className={`match ${m.status}${isEntertainmentMode(m.mode)?" entertainment":""}${highlighted?" just-saved":""}`}>
    <div className="match-board"><div className="match-top"><span className="match-when"><time dateTime={m.playedOn}>{m.playedOn}</time>{isEntertainmentMode(m.mode)?<small className="match-entertainment-badge">潮拍 2v2 · 不計 ELO</small>:<small className="match-net-elo" aria-label={`ELO ${Math.round(Math.abs(m.deltaA))}`}>ELO {Math.round(Math.abs(m.deltaA))}</small>}{highlighted&&<span className="pill just-saved-pill">剛剛記錄</span>}{m.status==="void"&&<span className="pill">已作廢</span>}{m.entryMode==="aggregate"&&<span className="pill muted">歷史匯總</span>}</span>
      {canManage&&<span className="card-tools"><button className="card-tool" aria-label={`編輯 ${leftLabel} 對 ${rightLabel} 的賽事`} onClick={()=>onEdit(m)}>✎</button><button className="card-tool danger" aria-label={`刪除 ${leftLabel} 對 ${rightLabel} 的賽事`} onClick={()=>onVoid(m)}>✕</button></span>}</div>
    <Scoreline left={leftLabel} right={rightLabel} onLeftClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.a)} onRightClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.b)} scoreLeft={m.scoreA} scoreRight={m.scoreB}
      eloLeft={{before:m.beforeA,after:m.afterA,delta:m.deltaA}} eloRight={{before:m.beforeB,after:m.afterB,delta:-m.deltaA}}/>
    {isEntertainmentMode(m.mode)&&<div className="match-team-rosters">{(["A","B"] as const).map(side=><div className={`match-team-roster ${side==="B"?"right":""}`} key={side}>{teamMemberIds(m,side).map(id=>{const player=data.players.find(item=>item.id===id);return <button type="button" key={id} onClick={()=>onPlayer(id)} aria-label={`查看 ${name(id)} 的球員卡`}><PlayerBadge player={player??{short:"?"}}/><span>{name(id)}</span></button>})}</div>)}</div>}
    <button type="button" className="match-summary-row" aria-expanded={open} aria-label={open?"收起比賽詳情":"展開比賽詳情"} onClick={()=>setOpen(value=>!value)}>
      {!!topBreaks.length&&<span className="match-net-breaks">★ {topBreaks.map((item,index)=><Fragment key={item.playerId}>{index>0&&"、"}{name(item.playerId)} 單桿 {item.value}</Fragment>)}</span>}
      <span className="match-expand-toggle" aria-hidden="true"><i/></span>
    </button>
    </div>
    {open&&<div className="match-body">
    {isEntertainmentMode(m.mode)?<div className="elo-impact entertainment-impact"><small>娛樂賽記錄；不影響四位球員的 ELO 或統計。</small></div>:<div className="elo-impact" aria-label="本場 ELO 影響"><small>預測 {name(m.a)} 局數比例 {Math.round(m.expectedA*100)}%</small></div>}
    {!!topBreaks.length&&<div className="match-breaks"><span>單桿</span>{topBreaks.map(item=><b key={item.playerId}>{name(item.playerId)} {item.value}</b>)}</div>}
    <div className="match-handicap-summary">
      <small>本場讓分</small>
      <b>{handicapText(m.actual)}</b>
      <span>賽前建議：{handicapText(recommendedActual)}</span>
    </div>
    <small className="match-added">加入於 {new Date(m.createdAt).toLocaleString("zh-HK")}</small></div>}
  </article>;
}

const weekdayLabels=["一","二","三","四","五","六","日"];
function shiftMonth(month:string,delta:number){
  const [y,m]=month.split("-").map(Number);
  const d=new Date(y,m-1+delta,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function monthGrid(month:string){
  const [y,m]=month.split("-").map(Number);
  const startOffset=(new Date(y,m-1,1).getDay()+6)%7;
  const daysInMonth=new Date(y,m,0).getDate();
  const cells:(string|null)[]=Array.from({length:startOffset},()=>null);
  for(let d=1;d<=daysInMonth;d++)cells.push(`${month}-${String(d).padStart(2,"0")}`);
  while(cells.length%7!==0)cells.push(null);
  return cells;
}
function monthLabel(month:string){
  const [y,m]=month.split("-").map(Number);
  return `${y}年${m}月`;
}

function CalendarView({data,canManageMatch,onPlayer,onEdit,onVoid}:{data:AppState;canManageMatch:(match:Match)=>boolean;onPlayer:(player:Player)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void}) {
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  const confirmed=useMemo(()=>data.matches.filter(m=>m.status==="confirmed"),[data.matches]);
  const currentMonth=today.slice(0,7);
  const bounds=useMemo(()=>{
    const months=new Set(confirmed.map(m=>m.playedOn.slice(0,7)));
    months.add(currentMonth);
    const sorted=[...months].sort();
    return {min:sorted[0],max:sorted[sorted.length-1]};
  },[confirmed,currentMonth]);
  const [month,setMonth]=useState(currentMonth);
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const dayMatches=useMemo(()=>{
    const map=new Map<string,Match[]>();
    for(const m of confirmed){
      if(!m.playedOn.startsWith(month))continue;
      const list=map.get(m.playedOn)??[];
      list.push(m);
      map.set(m.playedOn,list);
    }
    return map;
  },[confirmed,month]);
  const maxCount=Math.max(1,...[...dayMatches.values()].map(list=>list.length));
  const grid=useMemo(()=>monthGrid(month),[month]);
  const goToMonth=(next:string)=>{setMonth(next);setSelectedDay(null)};
  const selectedMatches=selectedDay?dayMatches.get(selectedDay)??[]:[];
  return <section className="calendar-view">
    <div className="calendar-nav">
      <button type="button" className="calendar-nav-btn" aria-label="上一個月" disabled={month<=bounds.min} onClick={()=>goToMonth(shiftMonth(month,-1))}>‹</button>
      <b>{monthLabel(month)}</b>
      <button type="button" className="calendar-nav-btn" aria-label="下一個月" disabled={month>=bounds.max} onClick={()=>goToMonth(shiftMonth(month,1))}>›</button>
    </div>
    <div className="calendar-body">
      <div className="calendar-weekdays">{weekdayLabels.map(w=><span key={w}>{w}</span>)}</div>
      <div className="calendar-grid">{grid.map((date,index)=>{
        if(!date)return <span key={index} className="calendar-cell-blank" aria-hidden="true"/>;
        const list=dayMatches.get(date)??[];
        const count=list.length;
        const hasCentury=list.some(m=>m.highBreaks?.some(b=>b.value>=100));
        const tint=count?Math.max(1,Math.min(5,Math.ceil(count/maxCount*5))):0;
        const isToday=date===today;
        const isSelected=date===selectedDay;
        return <button key={date} type="button" disabled={!count}
          className={`calendar-cell${count?` has-matches tint-${tint}`:""}${isToday?" today":""}${isSelected?" selected":""}`}
          aria-pressed={isSelected} aria-label={`${date}${count?`，${count} 場比賽`:"，沒有比賽"}`}
          onClick={()=>setSelectedDay(isSelected?null:date)}>
          <span className="calendar-date">{Number(date.slice(8))}</span>
          {count>0&&<span className="calendar-count">{count}</span>}
          {hasCentury&&<i className="calendar-century" aria-hidden="true" title="破百單桿">★</i>}
        </button>;
      })}</div>
      {dayMatches.size===0&&<div className="calendar-empty-overlay"><Empty text="本月沒有比賽記錄" sub="使用上方箭嘴切換到有記錄的月份。"/></div>}
    </div>
    {selectedDay&&<div className="calendar-day-detail">
      <div className="calendar-day-head"><h3><time dateTime={selectedDay}>{selectedDay}</time></h3><span>{selectedMatches.length} 場</span></div>
      <div className="calendar-day-list">{selectedMatches.map(m=>
        <MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid}/>)}</div>
    </div>}
  </section>;
}

function ConfirmDeleteMatch({match,data,onCancel,onConfirm}:{match:Match;data:AppState;onCancel:()=>void;onConfirm:()=>void}) {
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  const later=data.matches.filter(m=>m.status==="confirmed"&&m.id!==match.id&&(m.playedOn||m.createdAt)>=(match.playedOn||match.createdAt)).length;
  const leftLabel=isEntertainmentMode(match.mode)?teamLabel(match,data,"A"):name(match.a);
  const rightLabel=isEntertainmentMode(match.mode)?teamLabel(match,data,"B"):name(match.b);
  return <><p className="kicker">需要確認</p><h2>刪除這場比賽？</h2>
    <p className="sub">{isEntertainmentMode(match.mode)?"這是潮拍娛樂賽；刪除只會移除歷史記錄，不會改變任何 ELO 或球員統計。":"確認後會由這場比賽起重新計算，其後所有 ELO、勝負、局數及近況都會重建。"}</p>
    <div className="confirm-target">
      <small>比賽日期 {match.playedOn}</small>
      <div className="confirm-scoreline"><span>{leftLabel}</span><b>{match.scoreA}</b><em>–</em><b>{match.scoreB}</b><span>{rightLabel}</span></div>
      <p>{match.actual>0?`${leftLabel} 讓 ${match.actual} 分`:match.actual<0?`${rightLabel} 讓 ${Math.abs(match.actual)} 分`:"沒有讓分"} · ELO {match.deltaA>=0?"+":""}{Math.round(match.deltaA)} / {-match.deltaA>=0?"+":""}{Math.round(-match.deltaA)}</p>
      {!!match.highBreaks?.length&&<div className="match-breaks"><span>單桿</span>{match.highBreaks.map((item,index)=><b key={`${item.playerId}-${index}`}>{name(item.playerId)} {item.value}</b>)}</div>}
    </div>
    {later>1&&<p className="confirm-impact">此賽事之後還有 <b>{later-1}</b> 場比賽會一併重新計算。</p>}
    <div className="confirm-actions"><button type="button" className="confirm-cancel" onClick={onCancel}>保留賽事</button><button type="button" className="confirm-delete" onClick={onConfirm}>刪除賽事</button></div>
    <p className="confirm-hint">刪除後可在提示訊息按「復原」還原。</p></>;
}


type PlayersChip = "near"|"free"|"soon"|"hot"|"all";
const PLAYERS_SORT_CYCLE:SortKey[]=["rank","rating","form","suggested"];
const playersSortDir=(key:SortKey):"asc"|"desc"=>key==="rank"||key==="name"?"asc":"desc";

function Players({data,ownPlayerId,canAdd,canManagePlayer,onAdd,onEdit,onDelete,onOpen,onCompare,onRecordAgainst,onFindOpponent}:{
  data:AppState;ownPlayerId?:string;canAdd:boolean;canManagePlayer:(player:Player)=>boolean;
  onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void;
  onCompare:(p:Player)=>void;onRecordAgainst:(p:Player)=>void;onFindOpponent:(playerId:string,date:string)=>void;
}) {
  const me=data.players.find(p=>p.id===ownPlayerId);
  const [query,setQuery]=useState("");
  const [chip,setChip]=useState<PlayersChip>(me?"near":"all");
  const [openId,setOpenId]=useState("");
  const [sort,setSort]=useState<SortKey>("rank");
  const [freeToday,setFreeToday]=useState<Record<string,string>>({});

  // Availability is fetched separately (not part of `data`) — the roster's "今晚有空" chip and
  // per-row free time both key off whoever has a published slot for tonight (Hong Kong time).
  useEffect(()=>{
    let cancelled=false;
    fetch("/api/availability?upcoming=1").then(r=>r.ok?r.json():null).then(v=>{
      if(cancelled||!Array.isArray(v?.members))return;
      const map:Record<string,string>={};
      for(const member of v.members as {id:string;slots:{startAt:string}[]}[]){
        const earliest=[...member.slots].sort((a,b)=>a.startAt.localeCompare(b.startAt))[0];
        if(earliest)map[member.id]=earliest.startAt;
      }
      setFreeToday(map);
    }).catch(()=>{});
    return ()=>{cancelled=true};
  },[]);

  const freeLabel=(free:string)=>{
    const freeDate=hkDate(new Date(free));
    if(freeDate===hkDate())return `今日 ${hkClock(free)} 有空`;
    const[,m,d]=freeDate.split("-");
    return `${Number(d)}/${Number(m)} ${hkClock(free)} 有空`;
  };
  const ranked=[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name));
  const rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  const myRank=me?rankOf.get(me.id):undefined;
  const myDelta=me?recentDelta(me,data,5):0;
  const superior=myRank&&myRank>1?ranked[myRank-2]:null;
  const isFreeToday=(p:Player)=>{const free=freeToday[p.id];return Boolean(free)&&hkDate(new Date(free))===hkDate()};
  const freeCount=data.players.filter(isFreeToday).length;
  const soonCount=data.players.filter(p=>Boolean(freeToday[p.id])).length;

  const tests:Record<PlayersChip,(p:Player)=>boolean>={
    all:()=>true,
    near:p=>Boolean(me)&&Math.abs(p.rating-me!.rating)<=200,
    free:isFreeToday,
    soon:p=>Boolean(freeToday[p.id]),
    hot:p=>recentDeltaDays(p,data,30)>0,
  };
  const counts:Record<PlayersChip,number>={
    all:data.players.length,
    near:me?data.players.filter(tests.near).length:0,
    free:freeCount,
    soon:soonCount,
    hot:data.players.filter(tests.hot).length,
  };
  const activeChip:PlayersChip=chip==="near"&&!me?"all":chip;
  const chipDefs:[PlayersChip,string][]=[["all","全部"],["near","水平相約"],["free","今日有空"],["soon","近期有空"],["hot","狀態 🔥"]];

  const cycleSort=()=>setSort(current=>PLAYERS_SORT_CYCLE[(PLAYERS_SORT_CYCLE.indexOf(current)+1)%PLAYERS_SORT_CYCLE.length]);
  const q=query.trim().toLowerCase();
  const filtered=(activeChip==="hot"
    ? [...data.players].sort((a,b)=>recentDeltaDays(b,data,30)-recentDeltaDays(a,data,30))
    : sortPlayers(data.players,data,sort,playersSortDir(sort))
  ).filter(p=>{
    if(q&&!(p.name.toLowerCase().includes(q)||p.short.toLowerCase().includes(q)))return false;
    return tests[activeChip](p);
  });
  const empty=filtered.length===0;

  return <div className="players-view">
    <div className={`players-self-panel${me?"":" is-guest"}`}>
      <div className="players-self-top"><span>球員 · {data.players.length} 位</span><span>今日 {freeCount} 位有空</span></div>
      {me&&<div className="players-self-main">
        <b className="players-self-rank">#{myRank}</b>
        <div className="players-self-id">
          <div className="players-self-name">我 · {Math.round(me.rating)} ELO{myDelta!==0&&<span className={myDelta>0?"positive":"negative"}>{myDelta>0?"+":""}{Math.round(myDelta)}</span>}</div>
          <div className="players-self-gap">{superior?`距離 #${myRank!-1} 只差 ${Math.max(0,Math.ceil(superior.rating-me.rating))} 分`:"暫列榜首"} · 建議讓分 {suggestedHandicap(me,data)} 分</div>
        </div>
        <span className="players-self-form">{me.form.map((x,i)=><i className={x.toLowerCase()} key={i}>{x}</i>)}</span>
      </div>}
    </div>
    <div className="players-toolbar">
      <div className="players-search"><input type="text" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜尋姓名或縮寫" aria-label="搜尋球員"/></div>
      <button type="button" className="players-sort-btn" onClick={cycleSort}>排序 · {sortLabels[sort]}</button>
    </div>
    <div className="players-chips" role="tablist" aria-label="球員篩選">
      {chipDefs.map(([id,label])=>{
        const n=counts[id],isEmpty=n===0&&id!=="all",isActive=activeChip===id&&!isEmpty;
        return <button key={id} type="button" role="tab" aria-selected={isActive} disabled={isEmpty} className={`players-chip${isActive?" active":""}${isEmpty?" empty":""}`} onClick={()=>setChip(id)}>{label} {n}</button>;
      })}
    </div>
    <div className="players-list-head">
      <span>{filtered.length} 位球員</span>
      {canAdd&&<button type="button" className="players-add-btn" onClick={onAdd}>＋ 新增球員</button>}
      <span className="players-list-hint">{activeChip==="hot"?"ELO · 近30日ELO變化":"ELO · 建議評分"}</span>
    </div>
    {data.players.length===0
      ? <Empty text="尚未有球員" sub="新增球員後便可開始記錄比賽。"/>
      : empty
        ? <div className="players-empty"><b>{q?`找不到「${query}」`:"這個篩選暫時沒有人"}</b><span>試試其他篩選，或按「全部」查看整個名單。</span></div>
        : <div className="players-rows">{filtered.map(p=>{
            const isSelf=Boolean(me)&&me!.id===p.id;
            const open=openId===p.id;
            const delta=recentDeltaDays(p,data,30);
            const rank=rankOf.get(p.id)??0;
            const provisional=games(p)<data.settings.provisionalGames;
            const free=freeToday[p.id];
            const high=highestBreak(p,data);
            const suggested=suggestedHandicap(p,data);
            return <div className={`players-row${open?" open":""}${provisional?" provisional":""}`} key={p.id}>
              <button type="button" className="players-row-hit" aria-expanded={open} onClick={()=>setOpenId(current=>current===p.id?"":p.id)}>
                <span className="players-row-badge"><PlayerBadge player={p}/><i className="players-row-free-dot" style={{background:free?"#4ade80":"#d7dbd4"}}/></span>
                <span className="players-row-id">
                  <span className="players-row-name-line"><b>{p.name}</b><em className={`players-tag${provisional?" provisional":""}`}>{provisional?"臨時":`#${rank}`}</em></span>
                  <span className="players-row-meta">
                    <span className="players-row-form">{p.form.map((x,i)=><i className={x.toLowerCase()} key={i}/>)}</span>
                    {games(p)} 場{free?` · ${freeLabel(free)}`:""}
                  </span>
                </span>
                <span className="players-row-elo"><b>{Math.round(p.rating)}</b>{activeChip==="hot"
                  ? <em className={delta>=0?"positive":"negative"}>{delta>=0?"+":"−"}{Math.abs(Math.round(delta))}</em>
                  : <em className="neutral">{suggested}</em>}</span>
              </button>
              {open&&<div className="players-row-expand">
                {me&&!isSelf&&<div className="players-verdict">
                  <div className="players-verdict-main">{handicapVerdict(me,p,data.settings)}</div>
                  <div className="players-verdict-sub">建議評分 {suggestedHandicap(p,data)} 分 · 相差 {Math.abs(Math.round(me.rating-p.rating))} ELO</div>
                </div>}
                <div className="players-expand-stats">
                  <span>勝率／局率 <b>{Math.round(winRate(p)*100)}／{Math.round(frameRate(p)*100)}%</b></span>
                  <span>最高單桿 <b>{high??"—"}</b></span>
                  {free&&<span className="players-expand-free">{freeLabel(free)}</span>}
                </div>
                <div className="players-expand-actions">
                  {isSelf
                    ? <button type="button" className="primary players-expand-open-self" onClick={()=>onOpen(p)}>查看完整球員頁 ›</button>
                    : <>
                        <button type="button" className="primary" onClick={()=>onRecordAgainst(p)}>記錄對局</button>
                        <button type="button" onClick={()=>onCompare(p)}>對戰紀錄</button>
                        <button type="button" onClick={()=>onFindOpponent(p.id,today)}>約戰</button>
                        <button type="button" className="players-row-open" aria-label={`開啟 ${p.name} 的球員卡`} onClick={()=>onOpen(p)}>›</button>
                      </>}
                </div>
                {(canManagePlayer(p)||canAdd)&&<div className="players-expand-manage">
                  {canManagePlayer(p)&&<button type="button" className="card-tool" aria-label={`編輯 ${p.name}`} onClick={()=>onEdit(p)}>✎</button>}
                  {canAdd&&<button type="button" className="card-tool danger" aria-label={`刪除 ${p.name}`} onClick={()=>onDelete(p)}>✕</button>}
                </div>}
              </div>}
            </div>;
          })}</div>}
  </div>;
}

function SettingsView({data,onEdit,onReset,canReset}:{data:AppState;onEdit:()=>void;onReset:()=>void;canReset:boolean}) {
  const s=data.settings,c=s.calibration; return <><section className="hero small"><div><p className="kicker">公開設定</p><h1>ELO 設定</h1><p>實際讓分直接影響 ELO；正式讓分只作參考。</p></div><button className="primary" onClick={onEdit}>編輯設定</button></section>
    <div className="settings-grid"><div className="setting"><small><Term label="起始 ELO" tip="球員加入時的評分起點；個別球員可另行設定，修改後會重播歷史賽果。"/></small><b>{s.start}</b></div><div className="setting"><small><Term label="臨時門檻" tip="球員完成此數量的比賽前會標示為臨時評分，並使用較大的臨時 K 值。"/></small><b>{s.provisionalGames} 場</b></div><div className="setting"><small><Term label="K 值" tip="控制每次賽果令 ELO 改變多少；數值越高，評分調整越快。"/></small><b>{s.kProvisional} / {s.kRated}</b></div><div className="setting"><small><Term label="持續校準換算率" tip="10 分附近每 1 分實際讓分相當於多少 ELO；會按累積賽果逐步重新估算。"/></small><b>{s.conversion} ELO／分</b></div><div className="setting"><small><Term label="讓分曲線" tip="大讓分難度的非線性增幅；1 為線性，數值越高，20、40、100 分的難度上升越快。"/></small><b>{s.curvature??1.25}</b></div><div className="setting"><small><Term label="軟上限" tip="用平滑曲線限制極端讓分的等效 ELO；額外讓分仍有影響，但不會無限增長。"/></small><b>±{s.handicapSoftCap??800} ELO</b></div><div className="setting"><small><Term label="勝者獎勵" tip="勝方加入的虛擬局數；預設半局，使 3–2 略優於 3–3，但不會出現巨大跳升。"/></small><b>{s.winnerBonus??.5} 局</b></div><div className="setting"><small><Term label="超額讓分加乘" tip="球員承受比雙方 ELO 公平線更艱難的讓分，仍打和或勝出時，額外放大其 ELO 回報；不利程度越高，加乘越大。"/></small><b>最高 +{Math.round((s.overHandicapBoost??.75)*100)}%</b></div><div className="setting"><small><Term label="加乘尺度" tip="控制超額讓分加乘增長速度；數值越小，加乘越快接近上限。"/></small><b>{s.overHandicapScale??200} ELO</b></div></div>
    <section className="calibration-card"><div><p className="kicker">每場自動更新</p><h2><Term label="讓分換算持續學習" tip="每次賽果變動後，同時估計 10 分附近的 ELO 換算率與大讓分的非線性曲線。"/></h2><p>目前每讓 1 分約等於 <b>{s.conversion} ELO</b>，曲線為 <b>{s.curvature??1.25}</b>。系統比較預測與真實局數比例，最多採計每筆 20 局；正式讓分不參與計算。</p>{c?.history&&c.history.length>1&&<small className="calibration-history">最近校準：{c.history.slice(-5).map(x=>x.estimate).join(" → ")} ELO／分</small>}</div><div className="calibration-stats"><span><small><Term label="可用記錄" tip="具備有效局數、賽前 ELO，而且實際讓分不為 0 的記錄數量。"/></small><b>{c?.usableMatches??0}</b></span><span><small><Term label="實際讓分種類" tip="歷史資料出現過多少種不同的非零實際讓分數值；例如 4、8、12 分代表 3 種。"/></small><b>{c?.handicapLevels??0}</b></span><span><small><Term label="信心" tip="按可用記錄數及實際讓分種類評估校準可靠程度。"/></small><b>{c?.confidence??"資料不足"}</b></span><span><small><Term label="換算率範圍" tip="與最佳估算表現接近的一段 ELO／分換算率。"/></small><b>{c?`${c.lower}–${c.upper}`:"—"}</b></span><span><small><Term label="曲線範圍" tip="數據支持的非線性曲線範圍；資料不足時會保持接近 1.25。"/></small><b>{c?.curvatureLower!=null?`${c.curvatureLower}–${c.curvatureUpper}`:"—"}</b></span></div></section>
    {c?.history&&c.history.length>1&&<CalibrationTrend history={c.history} lower={c.lower} upper={c.upper} conversion={s.conversion} confidence={c.confidence} example={{points:10,elo:Math.round(handicapAdjustment(10,s))}}/>}
    <section className="audit"><h2>審計記錄</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString("zh-HK")}</small></div>)}</section>
    {canReset&&<section className="danger-zone"><div><h2>清除並重設資料</h2><p>永久刪除共用資料庫內所有球員、比賽及審計記錄，並恢復預設 ELO 設定。</p></div><button onClick={onReset}>清除所有資料</button></section>}</>;
}

function MatchForm({data,draft,setDraft,preview,a,b,editing,saving,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;editing:boolean;saving:boolean;onSave:()=>void}) {
  const [breakInput,setBreakInput]=useState<Record<string,string>>({});
  const [breakMessage,setBreakMessage]=useState<Record<string,string>>({});
  const [breakReminder,setBreakReminder]=useState(false);
  const eloPreviewRef=useRef<HTMLElement|null>(null);
  const hadEloPreview=useRef(false);
  const [breakOpen,setBreakOpen]=useState<Record<string,boolean>>({});
  const [customHandicap,setCustomHandicap]=useState(editing||Boolean(draft.giver));
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  const players=[...data.players].filter(p=>p.active).sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const isTeamMode=draft.mode==="2v2";
  const isCupMode=draft.mode==="cup";
  const a2=isTeamMode?data.players.find(player=>player.id===draft.a2):undefined;
  const b2=isTeamMode?data.players.find(player=>player.id===draft.b2):undefined;
  const tournament=data.tournaments.find(t=>t.id===draft.tournamentId);
  const cupMatches=data.matches.filter(match=>match.mode==="cup"&&match.tournamentId===draft.tournamentId&&match.status==="confirmed");
  const tournamentHandicap=isCupMode&&tournament?.handicapMode==="suggested";
  const tournamentDeadline=tournament?.signupDeadline;
  const tournamentDeadlineDate=tournamentDeadline?new Date(`${tournamentDeadline.length===10?tournamentDeadline+"T23:59":tournamentDeadline}:00+08:00`):null;
  const cupDeadlinePassed=Boolean(tournamentDeadlineDate&&!Number.isNaN(tournamentDeadlineDate.getTime())&&tournamentDeadlineDate.getTime()<=Date.now());
  const cupHash=(value:string)=>{let result=2166136261;for(const character of value){result^=character.charCodeAt(0);result=Math.imul(result,16777619)}return result>>>0;};
  const cupDraw=isCupMode&&tournament&&cupDeadlinePassed?[...(tournament.signups??[])].sort((left,right)=>cupHash(`${tournament.id}:${left}`)-cupHash(`${tournament.id}:${right}`)):[];
  const tournamentLabel=tournament?.name||"未選擇盃賽";
  const playersForA=players.filter(p=>p.id!==draft.b&&p.id!==draft.b2&&p.id!==draft.a2);
  const playersForB=players.filter(p=>p.id!==draft.a&&p.id!==draft.a2&&p.id!==draft.b2);
  const playersForA2=players.filter(p=>p.id===draft.a2||(p.id!==draft.a&&p.id!==draft.b&&p.id!==draft.b2));
  const playersForB2=players.filter(p=>p.id===draft.b2||(p.id!==draft.b&&p.id!==draft.a&&p.id!==draft.a2));
  const [openASignal,setOpenASignal]=useState(0);
  const [openBSignal,setOpenBSignal]=useState(0);
  const [openA2Signal,setOpenA2Signal]=useState(0);
  const [openB2Signal,setOpenB2Signal]=useState(0);
  const pickA=(id:string)=>{update("a",id);if(id&&!draft.b)setOpenBSignal(s=>s+1);if(id&&!draft.a2&&draft.mode==="2v2")setOpenA2Signal(s=>s+1)};
  const pickB=(id:string)=>{update("b",id);if(id&&!draft.a)setOpenASignal(s=>s+1);if(id&&!draft.b2&&draft.mode==="2v2")setOpenB2Signal(s=>s+1)};
  const pickA2=(id:string)=>{update("a2",id);if(id&&!draft.b2)setOpenB2Signal(s=>s+1)};
  const pickB2=(id:string)=>{update("b2",id);if(id&&!draft.a2)setOpenA2Signal(s=>s+1)};
  const cupSlotPlayers=(round:number,index:number):[string,string]=>{
    if(round===1)return [cupDraw[(index-1)*2]??"",cupDraw[(index-1)*2+1]??""];
    const previous=(slot:number)=>cupMatches.find(match=>(match.tournamentRound??1)===round-1&&(match.tournamentMatchIndex??1)===slot);
    const winner=(match:Match|undefined)=>match?match.scoreA>match.scoreB?match.a:match.scoreB>match.scoreA?match.b:"":"";
    return [winner(previous((index-1)*2+1)),winner(previous((index-1)*2+2))];
  };
  const cupSlots=useMemo(()=>{
    if(!isCupMode||!tournament)return [] as {round:number;index:number;a:string;b:string;played:boolean}[];
    const size=2**Math.ceil(Math.log2(Math.max(2,cupDraw.length))),rounds=Math.max(1,Math.log2(size));
    return Array.from({length:rounds},(_,roundIndex)=>Array.from({length:Math.max(1,size/(2**(roundIndex+1)))},(_,index)=>{
      const round=roundIndex+1,[first,second]=cupSlotPlayers(round,index+1);
      return {round,index:index+1,a:first,b:second,played:cupMatches.some(match=>(match.tournamentRound??1)===round&&(match.tournamentMatchIndex??1)===index+1)};
    })).flat();
  },[isCupMode,tournament,cupMatches,cupDraw]);
  const pickCupPlayer=(id:string)=>{
    const slot=cupSlots.find(candidate=>!candidate.played&&candidate.a&&candidate.b&&(candidate.a===id||candidate.b===id));
    update("a",id);update("b",slot?(slot.a===id?slot.b:slot.a):"");
    if(slot){update("tournamentRound",slot.round);update("tournamentMatchIndex",slot.index);}
  };
  const chooseCupTournament=(id:string)=>{
    update("tournamentId",id);
    const nextTournament=data.tournaments.find(item=>item.id===id);
    const nextMatches=data.matches.filter(match=>match.mode==="cup"&&match.tournamentId===id&&match.status==="confirmed");
    const nextDeadline=nextTournament?.signupDeadline?new Date(`${nextTournament.signupDeadline.length===10?nextTournament.signupDeadline+"T23:59":nextTournament.signupDeadline}:00+08:00`):null;
    const nextDeadlinePassed=Boolean(nextDeadline&&!Number.isNaN(nextDeadline.getTime())&&nextDeadline.getTime()<=Date.now());
    const nextDraw=nextTournament&&nextDeadlinePassed?[...(nextTournament.signups??[])].sort((left,right)=>cupHash(`${nextTournament.id}:${left}`)-cupHash(`${nextTournament.id}:${right}`)):[];
    const size=2**Math.ceil(Math.log2(Math.max(2,nextDraw.length))),rounds=Math.max(1,Math.log2(size));
    const winner=(match:Match|undefined)=>match?match.scoreA>match.scoreB?match.a:match.scoreB>match.scoreA?match.b:"":"";
    for(let round=1;round<=rounds;round++)for(let index=1;index<=Math.max(1,size/(2**round));index++){
      if(nextMatches.some(match=>(match.tournamentRound??1)===round&&(match.tournamentMatchIndex??1)===index))continue;
      const previous=(slot:number)=>nextMatches.find(match=>(match.tournamentRound??1)===round-1&&(match.tournamentMatchIndex??1)===slot);
      const first=round===1?nextDraw[(index-1)*2]??"":winner(previous((index-1)*2+1)),second=round===1?nextDraw[(index-1)*2+1]??"":winner(previous((index-1)*2+2));
      if(first&&second){update("a",first);update("b",second);update("tournamentRound",round);update("tournamentMatchIndex",index);return;}
    }
    update("a","");update("b","");
  };

  const addBreak=(playerId:string)=>{
    const value=Number(breakInput[playerId]);
    if(!Number.isInteger(value)||value<1||value>147)return;
    setDraft((d:any)=>({...d,highBreaks:[...(d.highBreaks??[]),{playerId,value}]}));
    setBreakInput(current=>({...current,[playerId]:""}));
    const previousBest=data.matches.filter(match=>match.status==="confirmed").flatMap(match=>(match.highBreaks??[]).filter(item=>item.playerId===playerId).map(item=>item.value)).reduce((best,item)=>Math.max(best,item),0);
    setBreakReminder(false);
    setBreakMessage(current=>({...current,[playerId]:value>previousBest&&previousBest>0?`新個人最佳！比之前高 ${value-previousBest} 分 🎉`:value>previousBest?"第一個單桿紀錄，繼續突破！":previousBest-value<=5?`距離個人最佳 ${previousBest} 只差 ${previousBest-value} 分`:"已記低，下一桿再挑戰更高！"}));
  };
  const removeBreak=(index:number)=>setDraft((d:any)=>({...d,highBreaks:(d.highBreaks??[]).filter((_:unknown,itemIndex:number)=>itemIndex!==index)}));
  const teamEloDifference=draft.mode==="2v2"&&a2&&b2?roundedTeamEloDifference([a,a2],[b,b2]):a.rating-b.rating;
  const teamAHandicap=isTeamMode&&a2?Math.round((suggestedHandicap(a,data)+suggestedHandicap(a2,data))/2):null;
  const teamBHandicap=isTeamMode&&b2?Math.round((suggestedHandicap(b,data)+suggestedHandicap(b2,data))/2):null;
  const fairActual=preview?(isTeamMode&&teamAHandicap!=null&&teamBHandicap!=null?teamBHandicap-teamAHandicap:roundToEven(eloToHandicap(teamEloDifference,data.settings))):null;
  const probabilities=preview?matchProbabilities(preview.expectedA,+draft.scoreA+ +draft.scoreB):null;
  const applyFair=()=>{
    if(fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.abs(fairActual)}));
    setCustomHandicap(false);
  };
  const setNoHandicap=()=>{
    setDraft((d:any)=>({...d,giver:"",points:0}));
    setCustomHandicap(false);
  };
  useEffect(()=>{
    if(isCupMode && tournament && tournament.handicapMode === "suggested" && preview){
      if(fairActual!=null){
        setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.abs(fairActual)}));
        setCustomHandicap(false);
      }
    }
  },[isCupMode,tournament,preview,fairActual]);
  useEffect(()=>{
    if(isCupMode && tournament && tournament.handicapMode === "none"){
      setDraft((d:any)=>({...d,giver:"",points:0}));
      setCustomHandicap(false);
    }
  },[isCupMode,tournament]);
  const changeScore=(key:"scoreA"|"scoreB",amount:number)=>setDraft((d:any)=>({...d,[key]:Math.max(0,+d[key]+amount)}));
  const totalFrames=+draft.scoreA + +draft.scoreB;
  const hasEloPreview=Boolean(preview&&totalFrames>0);
  useEffect(()=>{
    if(hasEloPreview&&!hadEloPreview.current){
      requestAnimationFrame(()=>eloPreviewRef.current?.scrollIntoView({behavior:"smooth",block:"center"}));
    }
    hadEloPreview.current=hasEloPreview;
  },[hasEloPreview]);
  const validTeamSelection=Boolean(isTeamMode&&a2&&b2&&new Set([a.id,b.id,a2.id,b2.id]).size===4);
  const teamAName=(draft.teamAName?.trim()||"Team A"),teamBName=(draft.teamBName?.trim()||"Team B");
  const valid=Boolean(a&&b&&a.id!==b.id&&totalFrames>0&&(!isTeamMode||validTeamSelection)&&(!isCupMode||Boolean(draft.tournamentId&&draft.tournamentRound&&draft.tournamentMatchIndex)));
  const resultLabel=!valid?"輸入最終比分":draft.scoreA===draft.scoreB?`${draft.scoreA}–${draft.scoreB} 和局`:draft.scoreA>draft.scoreB?`${isTeamMode?teamAName:a.name} 勝 ${draft.scoreA}–${draft.scoreB}`:`${isTeamMode?teamBName:b.name} 勝 ${draft.scoreB}–${draft.scoreA}`;
  const handicapLabel=draft.giver&&+draft.points>0?`${draft.mode==="2v2"?([a.id,a2?.id].includes(draft.giver)?teamAName:teamBName):draft.giver===a?.id?a?.name:b?.name} 每局讓 ${draft.points} 分`:"沒有讓分";
  const dateLabel=draft.date===today?"今天":draft.date;
  const fairPoints=Math.abs(fairActual??0);
  return <div className="match-form"><div className="match-form-head"><div className="match-title-row"><h2 className="accent">{editing?"編輯比賽":"記錄比賽"}</h2><div className="match-date-chip"><span aria-hidden="true">{dateLabel}<i aria-hidden="true">›</i></span><input aria-label={`比賽日期，目前為${dateLabel}`} type="date" value={draft.date} onChange={e=>update("date",e.target.value)} onClick={e=>{const input=e.currentTarget;if(typeof input.showPicker==="function")input.showPicker()}}/></div></div></div>
    {editing&&<p className="sub">{draft.mode==="2v2"?"潮拍娛樂賽只會更新這筆歷史記錄，不會重播或改變 ELO。":"儲存後會按日期重播全部賽事，重建雙方及後續 ELO。"}</p>}
    {data.players.length<2&&<p className="warning">請先新增至少兩位活躍球員。</p>}
    {isCupMode && <div className="tournament-selector tournament-selector-first">
      <label>盃賽<select value={draft.tournamentId||""} onChange={e=>chooseCupTournament(e.target.value)}>
        <option value="">選擇盃賽</option>
        {data.tournaments.map(t=> <option key={t.id} value={t.id}>{t.name}{t.signupDeadline?` · 截止 ${t.signupDeadline.replace("T"," ")}`:""}</option>)}
      </select></label>
    </div>}
    <section className="match-players" aria-labelledby="match-players-title"><h3 id="match-players-title" className="visually-hidden">選擇球員</h3>
      {isTeamMode&&<div className="team-name-grid"><label><span>Team A 隊名</span><input type="text" maxLength={40} value={draft.teamAName??""} placeholder="Team A" onChange={event=>update("teamAName",event.target.value)}/></label><b aria-hidden="true">對</b><label><span>Team B 隊名</span><input type="text" maxLength={40} value={draft.teamBName??""} placeholder="Team B" onChange={event=>update("teamBName",event.target.value)}/></label></div>}
      {!isTeamMode&&!isCupMode&&<div className="matchup-card">
        <div className="matchup-slot"><PlayerCombobox players={playersForA} value={draft.a} onChange={pickA} placeholder="選擇球員" ariaLabel="球員 A" autoOpenSignal={openASignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
        <span className="matchup-vs" aria-hidden="true">對</span>
        <div className="matchup-slot"><PlayerCombobox players={playersForB} value={draft.b} onChange={pickB} placeholder="選擇球員" ariaLabel="球員 B" autoOpenSignal={openBSignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
      </div>}
      {isCupMode&&<div className="matchup-card cup-matchup-card">
        <div className="matchup-slot"><PlayerCombobox players={players} value={draft.a} onChange={pickCupPlayer} placeholder="選擇球員" ariaLabel="選擇球員" autoOpenSignal={openASignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO` : "未完成盃賽場次"}</small></span></button>}/></div>
        <span className="matchup-vs" aria-hidden="true">對</span>
        <div className="matchup-slot derived-opponent"><span className="matchup-trigger"><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={b??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{draft.b?b.name:"對手會由賽事名單帶出"}</b><small>{draft.b?"已按未完成場次配對":"先選擇一位球員"}</small></span></span></div>
      </div>}
      {isTeamMode&&<div className="matchup-card team-2v2">
        <div className="matchup-team">
          <div className="matchup-slot"><PlayerCombobox players={playersForA} value={draft.a} onChange={pickA} placeholder="選擇球員" ariaLabel="球員 A" autoOpenSignal={openASignal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
          <div className="matchup-slot"><PlayerCombobox players={playersForA2} value={draft.a2} onChange={pickA2} placeholder="選擇隊友" ariaLabel="球員 A2" autoOpenSignal={openA2Signal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇隊友"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
        </div>
        <span className="matchup-vs" aria-hidden="true">對</span>
        <div className="matchup-team">
          <div className="matchup-slot"><PlayerCombobox players={playersForB} value={draft.b} onChange={pickB} placeholder="選擇球員" ariaLabel="球員 B" autoOpenSignal={openBSignal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
          <div className="matchup-slot"><PlayerCombobox players={playersForB2} value={draft.b2} onChange={pickB2} placeholder="選擇隊友" ariaLabel="球員 B2" autoOpenSignal={openB2Signal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇隊友"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
        </div>
      </div>}
    </section>
    {isCupMode && <div className="tournament-stage"><label>輪次<input type="number" min={1} value={draft.tournamentRound||1} onChange={e=>update("tournamentRound",Math.max(1,Number(e.target.value)||1))}/></label>
      <label>場次<input type="number" min={1} value={draft.tournamentMatchIndex||1} onChange={e=>update("tournamentMatchIndex",Math.max(1,Number(e.target.value)||1))}/></label></div>}
    <section className="quick-handicap" aria-labelledby="handicap-title"><h3 id="handicap-title">讓分 <small>{handicapLabel}</small></h3>
      {isCupMode
        ? <div className="tournament-handicap-note"><b>盃賽模式</b><span>{tournament ? (tournament.handicapMode==="suggested" ? `自動套用建議讓分：每局 ${fairPoints} 分` : "此盃賽不設讓分") : "未選擇盃賽"}</span></div>
        : <>
            {validTeamSelection&&<div className="entertainment-handicap-note recommended"><b>建議讓分</b><span>{fairPoints===0?`${teamAName} 與 ${teamBName} 毋須讓分`:`${fairActual!>0?teamAName:teamBName} 每局讓 ${fairActual!>0?teamBName:teamAName} ${fairPoints} 分`}</span><small>{teamAHandicap!=null&&teamBHandicap!=null?`${teamAName} 平均 ${Math.round(teamAHandicap)} · ${teamBName} 平均 ${Math.round(teamBHandicap)}`:`隊伍平均 ELO 相差 ${Math.abs(teamEloDifference)}`}；按球員 ELO 建議讓分計算。</small></div>}
            <div className="handicap-segment"><button type="button" className={!draft.giver&&!customHandicap?"active":""} onClick={setNoHandicap}>沒有讓分</button><button type="button" disabled={fairActual==null} className={draft.giver&&+draft.points===fairPoints&&!customHandicap?"active":""} onClick={fairPoints===0?setNoHandicap:applyFair}>ELO 建議</button><button type="button" className={customHandicap?"active":""} onClick={()=>setCustomHandicap(value=>!value)}>自訂</button></div>
            {customHandicap&&<div className="custom-handicap"><label>{draft.mode==="2v2"?"讓分隊伍":"讓分球員"}<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">沒有讓分</option><option value={a?.id}>{draft.mode==="2v2"?`${teamAName}（${a.name} / ${a2?.name}）`:a?.name}</option><option value={b?.id}>{draft.mode==="2v2"?`${teamBName}（${b.name} / ${b2?.name}）`:b?.name}</option></select></label><label>每局分數<input type="number" inputMode="numeric" min="0" step="1" value={draft.points} onChange={e=>update("points",Math.max(0,+e.target.value))}/></label></div>}
          </>
      }
    </section>
    <section className="score-panel" aria-labelledby="score-title">{preview&&<div className="predicted-ratio"><div><span>預測局數比例</span><b>{isTeamMode?teamAName:a.short} {Math.round(preview.expectedA*100)}% · {Math.round((1-preview.expectedA)*100)}% {isTeamMode?teamBName:b.short}</b></div><em aria-label={`${isTeamMode?teamAName:a.name} ${Math.round(preview.expectedA*100)}%，${isTeamMode?teamBName:b.name} ${Math.round((1-preview.expectedA)*100)}%`}><i style={{width:`${Math.round(preview.expectedA*100)}%`}}/></em></div>}<h3 id="score-title">最終比分</h3>{!isTeamMode&&<div className="break-invitation"><b>今場有冇值得記低嘅單桿？</b><span>每次突破，都係進步嘅紀錄。</span></div>}<div className="scoreboard-entry">
      <div><b>{isTeamMode?teamAName:(a?.name??"球員 A")}</b><div className="score-row"><button type="button" aria-label={`${isTeamMode?teamAName:(a?.name??"球員 A")}減一局`} onClick={()=>changeScore("scoreA",-1)}>−</button><input className="score-value" aria-label={`${isTeamMode?teamAName:(a?.name??"球員 A")}局數`} type="number" inputMode="numeric" min="0" value={draft.scoreA} onChange={e=>update("scoreA",Math.max(0,+e.target.value))}/><button type="button" aria-label={`${isTeamMode?teamAName:(a?.name??"球員 A")}加一局`} onClick={()=>changeScore("scoreA",1)}>＋</button></div>
        {!isTeamMode&&a&&<div className="break-inline">{(breakOpen[a.id]||(draft.highBreaks??[]).some((item:{playerId:string})=>item.playerId===a.id))&&<p className="break-heading">已記錄嘅單桿</p>}<div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===a.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={`移除 ${a.name} 的 ${item.value} 分單桿度數`}>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[a.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(a.id)}}><input autoFocus className="break-value" aria-label={`${a.name} 單桿度數`} type="number" inputMode="numeric" min="1" max="147" placeholder="輸入度數" enterKeyHint="done" value={breakInput[a.id]??""} onChange={event=>setBreakInput(current=>({...current,[a.id]:event.target.value}))}/><button type="submit">記低</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[a.id]:true}))}>＋ 記錄單桿</button>}
        {breakMessage[a.id]&&<p className="break-encouragement" role="status">{breakMessage[a.id]}</p>}</div>}
      </div>
      <strong aria-hidden="true">–</strong>
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
function BreakMilestoneChart({player,data}:{player:Player;data:AppState}){
  const [mode,setMode]=useState<BreakChartMode>("personal");
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const points=useMemo(()=>breakChartPoints(player,data,mode),[player,data,mode]);
  if(!points.length)return null;
  const max=Math.max(...points.map(point=>point.value));
  const yMax=Math.max(10,Math.ceil(max/10)*10);
  const x=(index:number)=>points.length===1?50:5+index/(points.length-1)*90;
  const y=(value:number)=>53-(value/yMax)*43;
  const linePath=points.reduce((path,point,index)=>index===0?`M ${x(index)} ${y(point.value)}`:`${path} L ${x(index)} ${y(point.value)}`,"");
  const areaPath=points.length>1?`${linePath} V 53 H ${x(0)} Z`:"";
  const tickIndexes=[...new Set([0,Math.floor((points.length-1)/2),points.length-1])];
  const periodLabel=mode==="monthly"?"月份":"日期";
  const active=activeIndex==null?null:points[activeIndex]??null;
  return <div className="break-milestone-chart">
    <div className="break-milestone-plot">
      <div className="break-chart-y-axis" aria-hidden="true"><span>{yMax}</span><span>{Math.round(yMax/2)}</span><span>0</span></div>
      <div className="break-chart-canvas" onPointerLeave={()=>setActiveIndex(null)}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={`${player.name} ${mode==="personal"?"個人最佳":"每月最高"}單桿圖表`}>
          {[10,31,53].map(line=><line key={line} x1="5" y1={line} x2="95" y2={line} className="break-chart-grid"/>)}
           {active&&<line x1={x(activeIndex!)} y1="6" x2={x(activeIndex!)} y2="56" className="trend-guide"/>}
          {areaPath&&<path d={areaPath} className="break-chart-area"/>}
          <path d={linePath} className="break-chart-line"/>
        </svg>
               {active&&<div className={`trend-tooltip ${x(activeIndex!)>70?"align-right":x(activeIndex!)<30?"align-left":""}`} style={{left:`${x(activeIndex!)}%`,top:`${Math.max(3,y(active.value)/60*100-7)}%`}} role="status"><small>{active.period}</small><b>{active.value?`${active.value} 分`:"N/A"}</b><span>{active.value?(mode==="personal"?"個人最佳":"該月最高"):"未記錄單桿"}</span></div>}        {points.map((point,index)=><button key={`${point.period}-${point.value}`} type="button" className={`break-chart-point${activeIndex===index?" active":""}`} style={{left:`${x(index)}%`,top:`${y(point.value)/60*100}%`}} onPointerEnter={()=>setActiveIndex(index)} onFocus={()=>setActiveIndex(index)} onBlur={()=>setActiveIndex(null)} onClick={()=>setActiveIndex(current=>current===index?null:index)} title={`${periodLabel} ${point.period}：${point.value?`${mode==="personal"?"個人最佳":"該月最高"} ${point.value} 分`:"N/A"}`} aria-label={`${periodLabel} ${point.period}，${point.value?`${mode==="personal"?"個人最佳":"該月最高"} ${point.value} 分`:"未記錄單桿"}`}/>) }
      </div>
    </div>
    <div className="break-chart-x-axis" aria-hidden="true">{tickIndexes.map(index=><span key={index} style={{left:`${x(index)}%`}}>{points[index].period}</span>)}</div>
    <p className="chart-summary">{mode==="personal"?`共 ${points.length} 次個人最佳里程碑。`:`共 ${points.length} 個有賽事記錄月份；N/A 代表該月未記錄單桿。`}</p>
    <div className="mini-toggle break-milestone-toggle" role="group" aria-label="高桿圖表顯示方式"><button type="button" aria-pressed={mode==="personal"} className={mode==="personal"?"active":""} onClick={()=>{setMode("personal");setActiveIndex(null)}}>個人最佳</button><button type="button" aria-pressed={mode==="monthly"} className={mode==="monthly"?"active":""} onClick={()=>{setMode("monthly");setActiveIndex(null)}}>每月最高</button></div>
  </div>;
}

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
    <div className="profile-section-head break-milestone-head"><div><p className="kicker">高桿里程碑</p><h3>突破軌跡</h3></div><div className="break-stats-record"><small>最高單桿</small><b>{highest}</b></div></div>
    <BreakMilestoneChart player={player} data={data}/>
    <div className="break-stats-subhead"><span>單桿表現</span><b>{highest}</b></div>
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