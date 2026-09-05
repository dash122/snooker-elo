"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type TouchEvent as ReactTouchEvent } from "react";
import { CupMark, DEFAULT_AVATAR, Empty, InteractiveEloChart, NavIcon, PlayerBadge, PlayerCombobox, PlayerForm, RecentMatches, Scoreline, SortArrow, SortControls, avatarHex, sortLabels, type EloTrendPoint, type SortKey } from "./UiBits";
import MatchmakingFormation from "./MatchmakingFormation";
import GuestIntro from "./GuestIntro";
import CupBracketChart, { storyBracket, type BracketChartData } from "./CupBracketChart";
import { TonightStrip, actionableCount, useMatchmakingSummary } from "./MatchmakingBits";
import { isEntertainmentMode, neutralRatingSnapshot, roundedTeamEloDifference } from "../lib/entertainment-match";
import { addDaysHongKong, dayRangeHongKong, hkClock, hkDate, hkDayLabel, type AvailabilitySlot } from "../lib/availability";
import { cupShareCta, cupShareMessage, cupShareState, cupShareUrl, cupUrgency, whatsappLink } from "../lib/cup-share";
import { applyCupHandicap } from "../lib/cup-handicap-draft";
import { ShareGlyph, shareSheetTitle } from "./ShareSheet";
import CupShareButtons from "./CupShareButtons";
import { HANDICAP_ELO_PER_POINT, proposeHandicap, suggestedHandicap as clubSuggestedHandicap } from "../lib/handicap";
import { calculateSnookerElo } from "../lib/snooker-elo";
import { matchDate, matchupKey, meetingsSince } from "../lib/elo-replay";
import { describeMatch, honourText, matchShareMessage, matchShareTitle, matchShareUrl, playerShareUrl, recordShareMessage, recordShareTitle, type RecordShareState } from "../lib/match-share";
import { recordStoryCard, resultStoryCard, type StoryPerson } from "../lib/story-card";
import ShareSheet from "./ShareSheet";
import { AppShell, PageFrame } from "./components/shell/AppShell";
import { DesktopNavigation, MobileBottomNav, type Destination } from "./components/shell/Navigation";
import { BrandLogo } from "./components/BrandLogo";
import { buildBracket, canManageTournament, cupMatches, currentRoundLabel, formatTournamentDateTime, isTournamentHost, matchRoundLabel, opponentIn, playerHonours, playerEliminated, playerSlot, reorderDraw, rosterOrder, roundLabel, shuffleDraw, signupsClosed, slotAt, swapPlayer, type Bracket, type BracketSlot, type Walkover } from "../lib/tournament";
import { Button, IconButton, InlineNotice, SegmentedControl, Skeleton, SlidingToggleGroup, StatTile, Surface } from "./components/ui/Primitives";
import { Sheet, ConfirmDialog } from "./components/ui/Overlay";

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
  deltaB?: number;
  deltaA2?: number;
  deltaB2?: number;
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
  startAt?: string | null;
  signupDeadline: string;
  createdAt: string;
  createdBy?: string;
  coHosts?: string[];
  rosterOrder?: string[];
  signups: string[];
  /** Written once by POST /api/tournaments/[id]/draw; absent until sign-ups close. */
  draw?: string[];
  drawnAt?: string;
  walkovers?: Walkover[];
  /** Each entrant's own optional "when I'll arrive" (HH:MM), keyed by player id. Self-reported. */
  arrivalTimes?: Record<string, string> | null;
};
type Settings = {
  start: number;
  provisionalGames: number;
  /** The "150" multiplying the match-length scaling factor S(n). */
  frameScaleCoefficient: number;
  /** The "15" added to n in S(n). */
  frameScaleNumeratorOffset: number;
  /** The "10" dividing S(n). */
  frameScaleDenominator: number;
  /** The "500" scaling ELO differences (incl. the handicap) into a win probability. */
  handicapEloScale: number;
  /** Display-only conversion for the individual 建議讓分 value. Pairwise match ELO uses the
      rating-sensitive handicap curve below. */
  handicapPointsToElo: number;
  /** Minimum ELO represented by one handicap point at high ratings. */
  handicapMinimumElo: number;
  /** Additional ELO represented per handicap point at low ratings. */
  handicapSensitivityRange: number;
  /** Rating width controlling how quickly sensitivity transitions. */
  handicapSensitivityWidth: number;
  /** The "3" multiplying the adaptive compression width. */
  compressionWidthBase: number;
  /** The "0.1" in 10^(-0.1/n). */
  compressionWidthExponent: number;
  /** The "2" and "7" in the repetition decay factor 2^(-t/7). */
  repetitionDecayBase: number;
  repetitionDecayPeriod: number;
  /** How much of a handicap's ELO-equivalent offsets the underlying rating gap (0–1). Below 1,
      even the "fair" suggested handicap leaves the stronger player a residual edge that grows
      with the ELO gap, instead of forcing every handicapped match to a flat 50/50. */
  handicapEffectiveness: number;
  modelVersion?: number;
};
export type AppState = { players: Player[]; matches: Match[]; tournaments: Tournament[]; settings: Settings; audits: { id: string; text: string; at: string }[] };
type StateLoadStatus = "loading" | "ready" | "failed";
const AUDIT_LOG_LIMIT = 300;
// A hung request here (a stalled DB connection, a dropped network segment) must not be able to
// wedge `saving` on forever — that leaves the header stuck on 儲存中 and blocks every later save,
// since `saveMatch` no-ops while `saving` is true. Aborting after a bound turns a hang into an
// ordinary failed-fetch error, which `persist`'s catch/finally already knows how to recover from.
const STATE_FETCH_TIMEOUT_MS = 15000;
const SAVE_CONFIRMATION_TIMEOUT_MS = 5000;
function fetchWithTimeout(input:string,init?:RequestInit,timeoutMs=STATE_FETCH_TIMEOUT_MS){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(input,{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));
}

// The client only polls every 15s, so another member's match or signup saved in that window is
// invisible to `next`. Sending `next` as-is would silently drop it from the payload — the server
// then either overwrites it outright, or (for a member write) reads the missing match as
// tampering with one that isn't theirs and rejects it — even though nothing about this save was
// actually about that match. Pull the latest matches/tournaments first and merge back in anything
// this save doesn't know about yet, so an unrelated concurrent save can't be clobbered or mistaken
// for one.
function mergeStatePayload(next:AppState,baseline:AppState,latest:Record<string,unknown>|null):AppState{
  let payload=next;
  if(Array.isArray(latest?.matches)){
    // A match absent from `next` is only "unknown to us" — and worth restoring — if it was also
    // absent from the snapshot this edit started from. One we already had and deliberately
    // removed (a delete/edit) must stay gone, or every delete would silently resurrect the very
    // match it just removed.
    const knownIds=new Set([...next.matches,...baseline.matches].map(m=>m.id));
    const missing=(latest.matches as Match[]).filter(m=>!knownIds.has(m.id));
    if(missing.length)payload={...next,matches:[...next.matches,...missing]};
  }
  if(Array.isArray(latest?.tournaments)){
    // Same problem, same fix, for tournaments: a cup someone else created, or a signup someone
    // else toggled, since this client's last poll is invisible to `next`. Sending `next` as-is
    // would silently delete that tournament — or roll its signup list back — the moment this
    // save lands, and for a member write it also trips the "signup changed by someone other than
    // me" permission check in state-write-rules.ts.
    const knownIds=new Set([...payload.tournaments,...baseline.tournaments].map(t=>t.id));
    const missing=(latest.tournaments as Tournament[]).filter(t=>!knownIds.has(t.id));
    const known=new Map(baseline.tournaments.map(t=>[t.id,t]));
    const merged=payload.tournaments.map(tournament=>{
      const before=known.get(tournament.id);
      const after=(latest.tournaments as Tournament[]).find(t=>t.id===tournament.id);
      if(!before||!after)return tournament;
      // Only carry forward signups we didn't already know about and didn't ourselves change —
      // this save's own signup edit (if any) still wins.
      const beforeSignups=new Set(before.signups??[]);
      const oursSignups=new Set(tournament.signups??[]);
      if(JSON.stringify([...beforeSignups].sort())!==JSON.stringify([...oursSignups].sort()))return tournament;
      const afterSignups:string[]=after.signups??[];
      if(JSON.stringify([...beforeSignups].sort())===JSON.stringify([...new Set(afterSignups)].sort()))return tournament;
      return {...tournament,signups:afterSignups};
    });
    if(missing.length||merged.some((t,i)=>t!==payload.tournaments[i]))payload={...payload,tournaments:[...merged,...missing]};
  }
  return payload;
}

const seed: AppState = {
  settings: {
    start: 1500, provisionalGames:10,
    frameScaleCoefficient:250, frameScaleNumeratorOffset:15, frameScaleDenominator:10,
    handicapEloScale:1250, handicapPointsToElo:25, handicapMinimumElo:7,
    handicapSensitivityRange:16, handicapSensitivityWidth:250, compressionWidthBase:3,
    compressionWidthExponent:.1, repetitionDecayBase:2, repetitionDecayPeriod:7,
    handicapEffectiveness:1, modelVersion:15,
  },
  players: [],
  matches: [],
  tournaments: [],
  audits: [{ id:"seed",text:"建立 SCAA 公開群組及預設 ELO 設定",at:new Date().toISOString() }]
};

function games(p: Player) { return p.wins + p.losses + p.draws; }
function provisionalMultiplier(matchCount: number) {
  return matchCount === 0 ? 2 : matchCount === 1 ? 1.5 : matchCount === 2 ? 1.25 : 1;
}
/* A thin wrapper over `lib/handicap`, which owns the arithmetic so the leaderboard, the cup roster
   and the shared cup page can never quote three different 建議讓分 for the same player. */
function suggestedHandicap(p: Player,data: AppState) {
  return clubSuggestedHandicap(p,data.players,data.settings);
}
function suggestedHandicapAtRating(rating:number,data:AppState) {
  return clubSuggestedHandicap({rating},data.players,data.settings);
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
function isParticipant(match: Match,id:string){
  return match.a===id||match.b===id||match.a2===id||match.b2===id;
}
function playerSide(match: Match,id:string):"A"|"B"|null{
  if(match.a===id||match.a2===id) return "A";
  if(match.b===id||match.b2===id) return "B";
  return null;
}
/* A past match can name a player who has since been permanently deleted — the delete flow keeps the
   match on purpose ("歷史賽事會保留並顯示為「已刪除球員」"). Falling back to an unrelated player's
   object (e.g. data.players[0]) for a missing id would silently misattribute the match, and falls
   apart entirely once the club has fewer than two players left. A synthetic placeholder keeps the
   editor showing the right (absent) identity instead of a wrong one. */
function deletedPlayerPlaceholder(id:string,startRating:number):Player{
  return {id,name:"已刪除球員",short:"?",handicap:null,rating:startRating,initialRating:startRating,
    active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]};
}
/* Same shape, different reason: a cup slot with no ready tie clears the draft's player id back to
   "" rather than leaving a stale one selected. `data.players[0]`/`[1]` used to stand in for that
   gap, which crashes the moment the club has fewer than two players (see above) and, worse, silently
   showed an unrelated player as one of the two sides of a cup match nobody has actually been paired
   for yet. An empty-id placeholder keeps the form rendering with an honest "no player yet" identity. */
function unselectedPlayerPlaceholder(startRating:number):Player{
  return {id:"",name:"未選擇球員",short:"?",handicap:null,rating:startRating,initialRating:startRating,
    active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]};
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
function eloTrendSeries(players:Player[],data:AppState){
  const perPlayer=players.map(p=>({player:p,pts:playerTrendPoints(p,data).filter(pt=>pt.date!=="")}));
  const dates=Array.from(new Set(perPlayer.flatMap(x=>x.pts.map(pt=>pt.date)))).sort();
  const series=perPlayer.map(({player,pts})=>{
    let index=0,current=player.initialRating;
    const values:(number|null)[]=[],counts:number[]=[];
    for(const date of dates){
      while(index<pts.length&&pts[index].date<=date){current=pts[index].elo;index++}
      values.push(index===0?null:current);
      counts.push(index);
    }
    return {player,values,counts};
  });
  return {dates,series};
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
/** "我讓他 X 分" / "他讓我 X 分" — the same displayed-handicap difference the match form uses. */
function handicapVerdict(me:Player,p:Player,s:Settings){
  const eloDifference=me.rating-p.rating;
  const points=proposeHandicap(me.rating,p.rating,s).points;
  const base=points===0?"平手":points>0?`建議我讓 ${points} 分`:`建議他讓 ${Math.abs(points)} 分`;
  return points!==0&&Math.abs(eloDifference)<30?`${base} · 勢均力敵`:base;
}
function calc(a: Player,b: Player,scoreA:number,scoreB:number,giver:string|null,points:number,s:Settings,giverSide?:"A"|"B"|null,repetitionCount=0) {
  const actual = giverSide === "A" ? points : giverSide === "B" ? -points
    : giver === a.id ? points : giver === b.id ? -points : 0;
  const official = a.handicap == null || b.handicap == null ? null : b.handicap - a.handicap;
  const formula = calculateSnookerElo({
    ratingA:a.rating, ratingB:b.rating, handicapA:-actual, framesA:scoreA, framesB:scoreB,
    handicapEloScale:s.handicapEloScale,
    handicapEloPerPoint:HANDICAP_ELO_PER_POINT,
    handicapEffectiveness:1, frameScaleCoefficient:s.frameScaleCoefficient,
    frameScaleNumeratorOffset:s.frameScaleNumeratorOffset, frameScaleDenominator:s.frameScaleDenominator,
    compressionWidthBase:s.compressionWidthBase, compressionWidthExponent:s.compressionWidthExponent,
    repetitionDecayBase:s.repetitionDecayBase, repetitionDecayPeriod:s.repetitionDecayPeriod,
    repetitionCount,
  });
  const totalFrames = scoreA + scoreB;
  return {
    official, actual, extra:actual-(official??0), expectedA:formula.probabilityA, deltaA:formula.deltaA,
    frameShare:totalFrames?scoreA/totalFrames:.5, frameEvidence:totalFrames, performanceScore:formula.performance,
    evidenceWeight:formula.confidence, adjustment:-actual, overHandicapElo:0, overHandicapMultiplier:1,
  };
}
function matchProbabilities(frameProbability:number,frames:number){
  if(frames<=0)return {win:0,draw:0,loss:0};
  const choose=(n:number,k:number)=>{let value=1;for(let i=1;i<=k;i++)value=value*(n-k+i)/i;return value};
  let win=0,draw=0;
  for(let k=0;k<=frames;k++){const probability=choose(frames,k)*frameProbability**k*(1-frameProbability)**(frames-k);if(k>frames/2)win+=probability;else if(k===frames/2)draw=probability;}
  return {win,draw,loss:1-win-draw};
}

function replay(players:Player[],matches:Match[],settings:Settings) {
  const rebuilt=players.map(p=>({...p,rating:p.initialRating,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[] as string[]}));
  const byId=new Map(rebuilt.map(p=>[p.id,p]));
  const ordered=[...matches].filter(m=>m.status==="confirmed").sort((x,y)=>(x.playedOn||x.createdAt).localeCompare(y.playedOn||y.createdAt)||x.createdAt.localeCompare(y.createdAt));
  const updated=new Map<string,Match>();
  /* Repetition decay needs "how often have these two met in the last 30 days?" for every match.
     Rescanning the earlier matches for each one is quadratic, which on a club with a few thousand
     results is enough main-thread work to leave the browser sitting on 正在載入球會資料 forever.
     Recording each meeting under an order-independent matchup key turns the question into a lookup.
     Every ordered match is recorded, including ones skipped below for a missing player — the old
     prefix scan saw those too. */
  const meetings=new Map<string,number[]>();
  for(const m of ordered){
    const key=matchupKey(m);
    const history=meetings.get(key);
    const priorDates=history??[];
    if(!history)meetings.set(key,priorDates);
    const playedAt=matchDate(m);
    const repetitionCount=meetingsSince(priorDates,playedAt-30*864e5);
    priorDates.push(playedAt);
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
    const result=calc(teamAEntity,teamBEntity,m.scoreA,m.scoreB,m.giver,Math.abs(m.actual),settings,giverSide,repetitionCount);
    const resultA=m.scoreA===m.scoreB?"D":m.scoreA>m.scoreB?"W":"L";
    const resultB=resultA==="D"?"D":resultA==="W"?"L":"W";
    const beforeA=teamAEntity.rating,beforeB=teamBEntity.rating;
    const beforeA2=a2?.rating,beforeB2=b2?.rating;
    const deltaA = result.deltaA * provisionalMultiplier(games(a));
    const deltaA2 = a2 ? result.deltaA * provisionalMultiplier(games(a2)) : undefined;
    const deltaB = -result.deltaA * provisionalMultiplier(games(b));
    const deltaB2 = b2 ? -result.deltaA * provisionalMultiplier(games(b2)) : undefined;
    for(const [index,player] of teamA.entries()){ const delta=index===0?deltaA:deltaA2!; player.rating += delta; player.lastChange = delta; player.wins += resultA==="W"?1:0; player.losses += resultA==="L"?1:0; player.draws += resultA==="D"?1:0; player.framesWon += m.scoreA; player.framesLost += m.scoreB; player.form=[resultA,...player.form].slice(0,5); }
    for(const [index,player] of teamB.entries()){ const delta=index===0?deltaB:deltaB2!; player.rating += delta; player.lastChange = delta; player.wins += resultB==="W"?1:0; player.losses += resultB==="L"?1:0; player.draws += resultB==="D"?1:0; player.framesWon += m.scoreB; player.framesLost += m.scoreA; player.form=[resultB,...player.form].slice(0,5); }
    const updatedMatch: Match = {
      ...m,
      expectedA: result.expectedA,
      beforeA,
      beforeB,
      afterA: beforeA + deltaA,
      afterB: beforeB + deltaB,
      deltaA,
      deltaB,
      frameEvidence: result.frameEvidence,
      performanceScore: result.performanceScore,
      evidenceWeight: result.evidenceWeight,
      handicapAdjustment: result.adjustment,
      overHandicapElo: result.overHandicapElo,
      overHandicapMultiplier: result.overHandicapMultiplier,
      status: m.status,
      createdAt: m.createdAt,
    } as Match;
    if(a2){ updatedMatch.beforeA2 = beforeA2; updatedMatch.afterA2 = beforeA2! + deltaA2!; updatedMatch.deltaA2 = deltaA2; }
    if(b2){ updatedMatch.beforeB2 = beforeB2; updatedMatch.afterB2 = beforeB2! + deltaB2!; updatedMatch.deltaB2 = deltaB2; }
    updated.set(m.id,updatedMatch);
  }
  return {players:rebuilt,matches:matches.filter(m=>m.status==="confirmed").map(m=>updated.get(m.id)??m)};
}
function upgradeState(raw:AppState){
  const nextRaw = { ...raw, tournaments: raw.tournaments ?? [] };
  const modelVersion=nextRaw.settings.modelVersion??1;
  if(modelVersion>=15)return {state:nextRaw,changed:false};
  if(modelVersion>=14){
    const settings={...nextRaw.settings,frameScaleCoefficient:250,modelVersion:15};
    const rebuilt=replay(nextRaw.players,nextRaw.matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"將表現敏感度由 300 調整至 250 並重播歷史評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
  if(modelVersion>=13){
    const settings={...nextRaw.settings,modelVersion:14};
    const rebuilt=replay(nextRaw.players,nextRaw.matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"加入超額讓分曲線並重播歷史評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
  if(modelVersion>=12){
    const settings={...nextRaw.settings,frameScaleCoefficient:300,modelVersion:13};
    const rebuilt=replay(nextRaw.players,nextRaw.matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"改用局數百分比與漸進信心權重並重播歷史評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
  if(modelVersion>=11){
    const settings={...nextRaw.settings,frameScaleCoefficient:300,handicapEloScale:1250,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:13};
    const rebuilt=replay(nextRaw.players,nextRaw.matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"固定讓分換算為每分 25 ELO 並重播歷史評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
  if(modelVersion>=10){
    const settings={...nextRaw.settings,frameScaleCoefficient:300,handicapEloScale:1250,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:13};
    const rebuilt=replay(nextRaw.players,nextRaw.matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"校準勝率曲線至 1250；固定每分 25 ELO 並重播歷史評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
  if(modelVersion>=9){
    const settings={...nextRaw.settings,frameScaleCoefficient:300,handicapEloScale:1250,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:13};
    const rebuilt=replay(nextRaw.players,nextRaw.matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"統一讓分換算：每分 25 ELO，建議讓分按 100% 抵銷並重播歷史評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
  const players=nextRaw.players.map(player=>({...player,initialRating:1500,rating:1500}));
  const stale=nextRaw.settings as Partial<Settings>&{frameScaleBase?:number};
  const settings:Settings={
    start:1500,
    provisionalGames:stale.provisionalGames??10,
    frameScaleCoefficient:250,
    frameScaleNumeratorOffset:stale.frameScaleNumeratorOffset??15,
    frameScaleDenominator:stale.frameScaleDenominator??stale.frameScaleBase??10,
    handicapEloScale:1250,
    handicapPointsToElo:HANDICAP_ELO_PER_POINT,
    handicapMinimumElo:stale.handicapMinimumElo===14?7:stale.handicapMinimumElo??7,
    handicapSensitivityRange:stale.handicapSensitivityRange===32?16:stale.handicapSensitivityRange??16,
    handicapSensitivityWidth:stale.handicapSensitivityWidth??250,
    compressionWidthBase:stale.compressionWidthBase??3,
    compressionWidthExponent:stale.compressionWidthExponent??.1,
    repetitionDecayBase:stale.repetitionDecayBase??2,
    repetitionDecayPeriod:stale.repetitionDecayPeriod??7,
    handicapEffectiveness:1,
    modelVersion:15,
  };
  const rebuilt=replay(players,nextRaw.matches,settings);
  return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"移除舊評分系統；以 1500 起始並套用可調整參數的 PDF Snooker Elo 公式",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
}

const today = new Date().toISOString().slice(0,10);
/* Last-known club document, kept in localStorage so a return visit paints from it immediately
   instead of sitting on 正在載入球會資料 for a cold serverless function plus a database read.
   What is cached is the raw server document, not the replayed state: a deploy that changes the
   rating replay must recompute from source, and restoring goes through exactly the same
   upgrade + replay path as a network response. */
const STATE_CACHE_KEY = "scaa-state-cache";
type CachedDocument = { version:string; document:AppState };
function readStateCache():CachedDocument|null{
  try{
    const raw=localStorage.getItem(STATE_CACHE_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw) as CachedDocument|null;
    if(!parsed?.version||!Array.isArray(parsed.document?.players)||!Array.isArray(parsed.document?.matches))return null;
    return parsed;
  }catch{ return null }
}
function writeStateCache(version:string,document:AppState){
  if(!version)return;
  try{ localStorage.setItem(STATE_CACHE_KEY,JSON.stringify({version,document})) }
  /* A long enough history can exceed the origin's storage quota. Drop the key rather than
     leaving a truncated or stale document behind; the next load simply goes to the network. */
  catch{ try{ localStorage.removeItem(STATE_CACHE_KEY) }catch{} }
}

// Module scope, not render: reading the clock during render is impure.
const thirtyDaysAgo = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
const tenDaysAgo = new Date(Date.now()-10*864e5).toISOString().slice(0,10);
function isInPastThirtyDays(playedOn:string){
  return playedOn>=thirtyDaysAgo&&playedOn<=today;
}
function isInPastTenDays(playedOn:string){
  return playedOn>=tenDaysAgo&&playedOn<=today;
}
export default function Home({user,initialData}:{user:{displayName:string;email:string;role:"admin"|"member";statePlayerId?:string;needsOnboarding?:boolean}|null;initialData?:AppState|null}) {
  const [data,setData] = useState<AppState>(initialData ?? seed);
  const [stateLoadStatus,setStateLoadStatus] = useState<StateLoadStatus>(initialData ? "ready" : "loading");
  const [stateLoadError,setStateLoadError] = useState("");
  const [stateRetry,setStateRetry] = useState(0);
  const [,setStateLoadAttempt] = useState(0);
  const [tab,setTab] = useState("leaderboard");
  const [availabilityDirty,setAvailabilityDirty] = useState(false);
  const [leavingAvailability,setLeavingAvailability] = useState<string|null>(null);
  const [pendingConfirm,setPendingConfirm] = useState<{kicker:string;title:string;description:string;confirmLabel:string;onConfirm:()=>void}|null>(null);
  const askConfirm=(opts:{kicker:string;title:string;description:string;confirmLabel:string;onConfirm:()=>void})=>setPendingConfirm(opts);
  const [,setJumpToAvailability] = useState<{playerId:string;date:string}|null>(null);
  const [matchesView,setMatchesView] = useState<"history"|"calendar"|"cup"|"matrix">("history");
  const [headToHead,setHeadToHead] = useState({a:"",b:""});
  const [highlightMatch,setHighlightMatch] = useState<string|null>(null);
  // localStorage can't be read during render without a hydration mismatch, so
  // the restore lands in an effect — which means the writer must skip its own
  // first run or it would persist the pre-restore default over the real value.
  const focusRestored = useRef(false);
  const [modal,setModal] = useState<"match"|"player"|"settings"|"detail"|"deleteMatch"|"tournament"|"signIn"|"share"|null>(null);
  const [detail,setDetail] = useState<Player|null>(null);
  /* What the share sheet is about. Held as the subject rather than as a built card so the card is
     rebuilt from live state — a result edited while the sheet is open must not be shared stale. */
  const [shareTarget,setShareTarget] = useState<{kind:"match";id:string}|{kind:"player";id:string}|null>(null);
  const [editingPlayer,setEditingPlayer] = useState<Player|null>(null);
  const [editingMatch,setEditingMatch] = useState<Match|null>(null);
  const [editingTournament,setEditingTournament] = useState<Tournament|null>(null);
  const [coHostSearch,setCoHostSearch] = useState("");
  const [deletingMatch,setDeletingMatch] = useState<Match|null>(null);
  const [toast,setToast] = useState("");
  const [undoSnapshot,setUndoSnapshot] = useState<AppState|null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [saving,setSaving] = useState(false);
  const [recordMenuOpen,setRecordMenuOpen] = useState(false);
  const [pullDistance,setPullDistance] = useState(0);
  const [refreshing,setRefreshing] = useState(false);
  const refreshingStateRef = useRef(false);
  /* The version of the club document currently on screen, so the background poll below can ask
     the server "still this one?" instead of re-downloading it. Kept in a ref rather than state
     because nothing renders from it and every write to it would otherwise cost a render. */
  const stateVersionRef = useRef("");
  const [draft,setDraft] = useState({mode:"1v1" as MatchMode,teamAName:"Team A",teamBName:"Team B",a:"",b:"",a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[] as {playerId:string;value:number}[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1,cupSlotLocked:false});
  const [playerForm,setPlayerForm] = useState({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});
  const [managementMode,setManagementMode] = useState(false);
  const ownPlayerId=user?.statePlayerId;
  /* The badge is the whole reason matchmaking stops being invisible: it runs in the app shell, so a
     member looking at the leaderboard finds out that three people are waiting on them.

     Two different signals share the one red circle a nav icon can carry, so they take turns rather
     than sum: something owed *to me* (an invite, an offer, a follow-up) is the more personal, more
     urgent claim on the number, so it wins when it is nonzero. Otherwise the badge falls back to how
     many 開局卡 are open club-wide right now — a discovery nudge rather than an obligation, and one a
     signed-out visitor sees too, since `tonight.openSlots` is public. */
  const {summary:matchmakingSummary,refresh:refreshMatchmaking}=useMatchmakingSummary(Boolean(ownPlayerId));
  const matchmakingBadge=actionableCount(matchmakingSummary?.counts)||matchmakingSummary?.tonight.openSlots||0;
  /* Notifications deep-link to /?tab=availability, and the click handler navigates an already-open
     tab there, so the parameter has to be honoured on mount and on subsequent navigations alike. */
  useEffect(()=>{
    const search=new URLSearchParams(window.location.search);
    const wanted=search.get("tab");
    if(wanted&&["leaderboard","matches","availability","players","settings"].includes(wanted))setTab(wanted);
    setManagementMode(search.get("manage")==="1");
    /* The draw notification deep-links to the bracket itself, not merely to 比賽 — landing on the
       match history after being told who you drew is a dead end. */
    if(search.get("view")==="cup")setMatchesView("cup");
  },[]);
  const isAdmin=user?.role==="admin";
  // Primitive, so the state loader's dependency list can name it without the prop's identity
  // re-triggering a full club refetch on every parent render.
  const signedIn=Boolean(user);
  const [tournamentForm,setTournamentForm] = useState<{name:string;handicapMode:"suggested"|"none";startAt:string;signupDeadline:string;coHosts:string[]}>({name:"",handicapMode:"suggested",startAt:"",signupDeadline:`${today}T23:59`,coHosts:[]});
  const canManageMatch=(match:Match)=>Boolean(isAdmin||ownPlayerId&&isParticipant(match,ownPlayerId));
  const canManageCup=(tournament:Tournament)=>canManageTournament(tournament,ownPlayerId,Boolean(isAdmin));
  const canManageCupHosts=(tournament:Tournament)=>Boolean(isAdmin||isTournamentHost(tournament,ownPlayerId));
  /* Open cups are a discovery nudge: keep the number visible on 比賽 even for signed-out visitors,
     because anyone can browse the cup and see the route to signing up. */
  const openTournamentCount=useMemo(()=>data.tournaments.filter(tournament=>!signupsClosed(tournament)).length,[data.tournaments]);

  useEffect(()=>{
    const local = localStorage.getItem("scaa-draft");
    if(local) try { setDraft(JSON.parse(local)); } catch {}
    /* The server already hydrated this page with the same state. Refetching it immediately adds
       database reads while the matchmaking summary and 約戰 board are trying to open. */
    if(initialData)return;
    let cancelled=false;
    let retryTimer:ReturnType<typeof setTimeout>|undefined;
    let requestController:AbortController|undefined;
    /* Show the cached club first, then reconcile with the server. The rating replay is the same
       one the network path runs, so what is on screen is never a different calculation — only an
       older set of matches, replaced the moment the server answers with something newer. */
    const cached=readStateCache();
    const apply=(document:AppState,version:string)=>{
      const upgraded=upgradeState(document);
      const loaded=upgraded.state;
      const replayed={...loaded,...replay(loaded.players,loaded.matches,loaded.settings)};
      setData(replayed);
      setStateLoadStatus("ready");
      setStateLoadError("");
      if(version)stateVersionRef.current=version;
      return {upgraded,loaded,replayed,version};
    };
    if(cached) try{ apply(cached.document,cached.version) }catch{}
    const load=async(attempt:number):Promise<void>=>{
      setStateLoadAttempt(attempt);
      requestController=new AbortController();
      const timeout=setTimeout(()=>requestController?.abort(),15000);
      try{
        const response=await fetch("/api/state",{
          cache:"no-store",
          signal:requestController.signal,
          /* `no-store` opts out of the browser's own revalidation, so the conditional request is
             made explicitly. An unchanged club then costs one small version query and an empty
             304 instead of the whole document. */
          headers:cached?{"if-none-match":`"${cached.version}"`}:undefined,
        });
        if(response.status===304&&cached){
          if(!cancelled)setStateLoadStatus("ready");
          return;
        }
        const value=await response.json().catch(()=>null) as Record<string,unknown>|null;
        if(!response.ok||!Array.isArray(value?.players)||!Array.isArray(value?.matches)){
          throw new Error(typeof value?.error==="string"?value.error:"資料格式無效");
        }
        if(cancelled)return;
        const document=value as AppState;
        const version=(response.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"");
        const {upgraded,loaded,replayed}=apply(document,version);
        writeStateCache(version,document);
        const replayChanged=JSON.stringify({players:loaded.players,matches:loaded.matches})!==JSON.stringify({players:replayed.players,matches:replayed.matches});
        /* Persisting the recomputed ratings keeps the server-rendered pages (/p, /m, /admin),
           which read stored values without replaying, in step. Only a signed-in visitor can
           write, so firing this for anyone else just spends a serverless invocation on a
           guaranteed 401. */
        if(signedIn&&(upgraded.changed||replayChanged))fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(replayed)}).catch(()=>{});
      }catch(error){
        if(cancelled)return;
        if(attempt<2){
          retryTimer=setTimeout(()=>void load(attempt+1),1000*2**attempt);
          return;
        }
        /* A visitor already looking at the cached club keeps it; a failed refresh is not a
           reason to replace real data with an error. */
        if(cached)return;
        setStateLoadStatus("failed");
        setStateLoadError(error instanceof Error&&error.name==="AbortError"?"資料載入逾時。":"資料暫時未能載入。請稍後再試。");
      }finally{clearTimeout(timeout)}
    };
    void load(0);
    return()=>{cancelled=true;clearTimeout(retryTimer);requestController?.abort()};
  },[initialData,stateRetry,signedIn]);
  async function refreshData(){
    if(refreshingStateRef.current)return;
    refreshingStateRef.current=true;
    try{
      /* Conditional, like the initial load. This runs every 15 seconds in every visible tab, so
         without the ETag it rebuilt and shipped the entire club document — every player, every
         match, every audit entry — several times a minute per member, almost always to discover
         nothing had changed. The server answers an unchanged club with an empty 304 costing one
         indexed fingerprint query. */
      const version=stateVersionRef.current;
      const r=await fetch("/api/state",{cache:"no-store",headers:version?{"if-none-match":`"${version}"`}:undefined});
      if(r.status===304)return;
      const v=r.ok?await r.json():null;
      if(v?.players){
        const next=(r.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"");
        if(next)stateVersionRef.current=next;
        setData(upgradeState(v).state);
      }
    }catch{}
    finally{refreshingStateRef.current=false}
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
  async function persist(rawNext:AppState,message:string,undo?:AppState) {
    if(!user){setToast("請先登入會員帳戶，才可更改球會資料。");return;}
    const baseline=data;
    // The audit log is prepended to on every write and the UI only ever shows the first 12 entries,
    // so an old club's full history is dead weight in every save from here on — weight that,
    // uncapped, eventually pushes a save past the platform's request-size limit and fails the least
    // forgiving action to retry: recording a match.
    const next=rawNext.audits.length>AUDIT_LOG_LIMIT?{...rawNext,audits:rawNext.audits.slice(0,AUDIT_LOG_LIMIT)}:rawNext;
    setData(next); setSaving(true);
    if(toastTimer.current) clearTimeout(toastTimer.current);
    if(undoTimer.current) clearTimeout(undoTimer.current);
    const restorable=Boolean(undo);
    setToast(message);
    setUndoSnapshot(restorable?undo??null:null);
    if(restorable)undoTimer.current=setTimeout(()=>setUndoSnapshot(null),2600);
    toastTimer.current=setTimeout(()=>{setToast("");setUndoSnapshot(null)},restorable?2600:3200);
    try {
      // Merging onto `latest` closes most of the gap, but two saves can still both fetch
      // `latest` before either PUT lands — each merges onto the same base and one silently
      // overwrites the other. The server rejects a PUT whose base version has moved on since,
      // so a genuine race surfaces as a 409 here instead of a lost write; re-running the fetch
      // + merge + PUT once against the now-current document resolves it in the common case.
      for(let attempt=0;attempt<3;attempt++){
        const latestResponse=await fetchWithTimeout("/api/state",{cache:"no-store"}).catch(()=>null);
        const latest=latestResponse?.ok?await latestResponse.json().catch(()=>null):null;
        const baseVersion=(latestResponse?.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"");
        const payload=mergeStatePayload(next,baseline,latest);
        const r=await fetchWithTimeout("/api/state",{method:"PUT",headers:{"content-type":"application/json",...(baseVersion?{"if-match":`"${baseVersion}"`}:{})},body:JSON.stringify(payload)});
        if(r.status===409&&attempt<2)continue;
        if(!r.ok){
          const body=await r.json().catch(()=>null);
          throw new Error(typeof body?.error==="string"?body.error:"");
        }
        break;
      }
    } catch (error) {
      if(toastTimer.current)clearTimeout(toastTimer.current);
      if(undoTimer.current)clearTimeout(undoTimer.current);
      setUndoSnapshot(null);
      /* A timeout is not proof of failure. fetchWithTimeout aborts the request from this side; the
         write it was waiting on may well have committed on the server a moment later. Confirm the
         save marker below before showing an uncertainty notice. This also avoids surfacing the
         browser's own untranslated abort text — "signal is aborted without reason" — to members. */
      const aborted=error instanceof Error&&error.name==="AbortError";
      if(aborted){
        /* PUT writes the state before it finishes syncing the member profile rows. If that
           follow-up is slow, the client can time out after the document — including this fresh
           audit entry — is already durable. Confirm the marker once before showing an uncertainty
           notice, so a slow response does not look like a failed save. */
        const auditId=next.audits[0]?.id;
        const confirmation=await fetchWithTimeout("/api/state",{cache:"no-store"},SAVE_CONFIRMATION_TIMEOUT_MS)
          .then(async response=>{
            if(!response.ok)return null;
            const document=await response.json().catch(()=>null) as Record<string,unknown>|null;
            return document?{document,version:(response.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"")}:null;
          })
          .catch(()=>null);
        const saved=Boolean(auditId&&Array.isArray(confirmation?.document.audits)&&confirmation.document.audits.some(entry=>entry&&typeof entry==="object"&&(entry as {id?:unknown}).id===auditId));
        if(saved){
          if(confirmation?.version)stateVersionRef.current=confirmation.version;
          setData(upgradeState(confirmation!.document as AppState).state);
          setToast(message);
          toastTimer.current=setTimeout(()=>setToast(""),3200);
          return;
        }
      }
      const reason=aborted?"":error instanceof Error?error.message:"";
      setToast(aborted?"伺服器回應逾時，未能確認是否已儲存。請重新整理頁面查看最新資料。"
        :reason?`未能儲存：${reason}`
        :"未能連接伺服器；資料仍保留在此畫面，請稍後再試。");
      toastTimer.current=setTimeout(()=>setToast(""),aborted?5200:3200);
    } finally { setSaving(false); }
  }
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);if(undoTimer.current)clearTimeout(undoTimer.current)},[]);

  function resetAll(){
    if(user?.role!=="admin"){setToast("只有管理員可以清除並重設資料。");return;}
    const typed=prompt("此操作會永久刪除所有球員、比賽及審計記錄。請輸入 RESET 繼續：");
    if(typed!=="RESET")return;
    askConfirm({kicker:"清除並重設資料",title:"最後確認",description:"清除並重設所有共用資料？此操作無法復原。",confirmLabel:"清除並重設",onConfirm:doResetAll});
  }
  async function doResetAll(){
    setSaving(true);
    try{
      const response=await fetch("/api/state",{method:"DELETE"});
      if(!response.ok)throw new Error();
      const fresh=await response.json();
      setData(fresh);
      localStorage.removeItem("scaa-draft");
      setDraft({mode:"1v1",teamAName:"Team A",teamBName:"Team B",a:"",b:"",a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1,cupSlotLocked:false});
      setToast("所有共用資料已清除並重設。");
    }catch{setToast("重設失敗，資料沒有被清除。請稍後再試。");}
    finally{setSaving(false);setUndoSnapshot(null);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3200);}
  }

  function deleteTournament(tournament:Tournament){
    if(!isAdmin){setToast("只有管理員可以刪除盃賽。");return;}
    askConfirm({kicker:"刪除盃賽",title:`確定刪除「${tournament.name}」？`,description:"盃賽及其已記錄賽事都會永久刪除。",confirmLabel:"永久刪除",onConfirm:()=>{
      const matches=data.matches.filter(match=>match.tournamentId!==tournament.id);
      const base={...data,tournaments:data.tournaments.filter(item=>item.id!==tournament.id),matches,audits:[{id:crypto.randomUUID(),text:`刪除盃賽：${tournament.name}`,at:new Date().toISOString()},...data.audits]};
      const settings=data.settings,next={...base,settings,...replay(data.players,matches,settings)};
      setData(next);persist(next,"盃賽已刪除。",data);
    }});
  }

  const ranked=useMemo(()=>[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),[data]);
  const a=data.players.find(p=>p.id===draft.a)??(draft.a?deletedPlayerPlaceholder(draft.a,data.settings.start):data.players[0]??unselectedPlayerPlaceholder(data.settings.start));
  const b=data.players.find(p=>p.id===draft.b)??(draft.b?deletedPlayerPlaceholder(draft.b,data.settings.start):data.players[1]??unselectedPlayerPlaceholder(data.settings.start));
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
    const validCup = draft.mode==="cup" && Boolean(draft.tournamentId&&draft.a&&draft.b&&a&&b) && Number(draft.tournamentRound)>=1 && Number(draft.tournamentMatchIndex)>=1;
    if(!valid1v1 && !valid2v2 && !validCup){setToast("請選擇有效賽事配置；盃賽賽果需選擇盃賽、輪次和場次。");return;}
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
    const settings=data.settings;
    const rebuilt=replay(data.players,matches,settings);
    const action=editingMatch?"編輯":"記錄";
    const matchLabel=valid2v2?`${teamLabel(match,data,"A")} ${draft.scoreA}–${draft.scoreB} ${teamLabel(match,data,"B")}`:`${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}`;
    const next={...data,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}${valid2v2?"潮拍娛樂賽":validCup?"盃賽賽果":"賽果"}：${matchLabel}${valid2v2?"；不影響 ELO":validCup?`；盃賽第 ${match.tournamentRound} 輪第 ${match.tournamentMatchIndex} 場`:"；重播歷史 ELO"}`,at:now},...data.audits]};
    localStorage.removeItem("scaa-draft"); setEditingMatch(null); setModal(null);
    // Land on the saved card rather than a toast that vanishes: focus the list
    // on the recorder (or clear it, for an admin logging someone else's game)
    // so the new row is guaranteed to be in the filtered set, and drop the
    // comparison — the date range only applies while comparing, and a stale
    // range could otherwise hide the very match we just navigated to.
    setHeadToHead({a:ownPlayerId&&(match.a===ownPlayerId||match.b===ownPlayerId)?ownPlayerId:"",b:""});
    setHighlightMatch(id); setMatchesView("history"); setTab("matches");
    persist(next,valid2v2?(editingMatch?"潮拍 2v2 已更新；ELO 與統計維持不變。":"潮拍 2v2 賽果已儲存；ELO 與統計維持不變。"):(validCup?(editingMatch?"盃賽賽果已更新。":"盃賽賽果已儲存。"):(editingMatch?"賽事已更新，所有後續 ELO 已重建。":"賽果已儲存，雙方 ELO 已更新。")));
  }

  function editMatch(m:Match){
    if(!canManageMatch(m)){setToast("你只能修改自己參與的比賽。");return;}
    setEditingMatch(m);
    setDraft({
      mode:m.mode??"1v1",teamAName:m.teamAName?.trim()||"Team A",teamBName:m.teamBName?.trim()||"Team B",a:m.a,b:m.b,a2:m.a2??"",b2:m.b2??"",scoreA:m.scoreA,scoreB:m.scoreB,
      date:m.playedOn,giver:m.actual>0?m.a:m.actual<0?m.b:"",points:Math.abs(m.actual),highBreaks:m.highBreaks??[],tournamentId:m.tournamentId??"",tournamentRound:m.tournamentRound??1,tournamentMatchIndex:m.tournamentMatchIndex??1,
      // Editing an existing cup result must not offer to re-pick the pairing either: the box it
      // belongs to is already decided.
      cupSlotLocked:m.mode==="cup"
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
      scoreA:0,scoreB:0,date:playedOn??today,giver:"",points:0,highBreaks:[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1,cupSlotLocked:false
    });
    setModal("match");
  }

  function savePlayer(){
    if(!isAdmin&&(!editingPlayer||editingPlayer.id!==ownPlayerId)){setToast("你只能修改自己的球員資料。");return;}
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast("請輸入顯示名稱及縮寫。");return;}
    const requestedRating=playerForm.rating.trim()===""?NaN:Number(playerForm.rating);
    const rating=editingPlayer
      ? isAdmin&&Number.isFinite(requestedRating)?requestedRating:editingPlayer.initialRating
      : isAdmin&&Number.isFinite(requestedRating)?requestedRating:data.settings.start;
    if(!Number.isFinite(rating)||rating<200||rating>3000){setToast("個人起始 ELO 必須介乎 200 至 3000。");return;}
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
    askConfirm({kicker:"刪除球員",title:`永久刪除 ${p.name}？`,description:`${hasHistory?"歷史賽事會保留並顯示為「已刪除球員」。":""}此操作無法復原。`,confirmLabel:"永久刪除",onConfirm:()=>{
      const next={...data,players:data.players.filter(x=>x.id!==p.id),
        audits:[{id:crypto.randomUUID(),text:`永久刪除球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
      persist(next,"球員已永久刪除。");
    }});
  }

  function closeModal(){ setModal(null); setDeletingMatch(null); setShareTarget(null); }

  /* Everything the share sheet needs, derived from live state at render time. Both surfaces — the
     WhatsApp text and the story image — come off the same description, so the message and the
     picture can never disagree about who won. */
  const sharePayload=useMemo(()=>{
    if(!shareTarget)return null;
    const origin=typeof window==="undefined"?"":window.location.origin;
    if(shareTarget.kind==="match"){
      const match=data.matches.find(item=>item.id===shareTarget.id);
      if(!match)return null;
      const state=describeMatch(match,data.players,cupFor(match,data));
      const url=matchShareUrl(origin,match.id);
      return {card:resultStoryCard(state,url),message:matchShareMessage(state,url),url,title:matchShareTitle(state)};
    }
    const player=data.players.find(item=>item.id===shareTarget.id);
    if(!player)return null;
    const played=games(player);
    const state:RecordShareState={
      name:player.name,short:player.short,colour:player.colour??null,avatar:player.avatar??null,
      rank:ranked.findIndex(item=>item.id===player.id)+1,
      rating:Math.round(player.rating),
      provisional:played<data.settings.provisionalGames,
      played,wins:player.wins,losses:player.losses,draws:player.draws,
      frameRate:frameRate(player),
      highestBreak:highestBreak(player,data)??0,
      form:player.form.slice(0,5),
      swing:Math.round(recentDeltaDays(player,data,10)),
      honours:playerHonours(data.tournaments,data.matches,player.id),
    };
    const url=playerShareUrl(origin,player.id);
    return {card:recordStoryCard(state,url,honourText(state.honours)),message:recordShareMessage(state,url),url,title:recordShareTitle(state)};
  },[shareTarget,data,ranked]);

  function shareMatch(match:Match){ setShareTarget({kind:"match",id:match.id}); setModal("share"); }
  function sharePlayer(player:Player){ setShareTarget({kind:"player",id:player.id}); setModal("share"); }

  function requestDeleteMatch(m:Match){ setDeletingMatch(m); setModal("deleteMatch"); }

  function confirmDeleteMatch(){
    const m=deletingMatch;
    if(!m)return;
    const snapshot=data;
    const matches=data.matches.filter(x=>x.id!==m.id);
    const entertainment=isEntertainmentMode(m.mode);
    const settings=data.settings;
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

  /* Recording from the bracket box rather than from a blank form. The round and match index travel
     with the tap, so they can no longer disagree with the tie the member was looking at — and the
     pairing is locked in the form, because a cup slot's two players are not a choice. */
  function recordCupSlot(tournament:Tournament,slot:BracketSlot<Match>){
    if(!user){setModal("signIn");return;}
    if(!isAdmin&&ownPlayerId!==slot.a&&ownPlayerId!==slot.b){setToast("你只能記錄自己參與的盃賽場次。");return;}
    setRecordMenuOpen(false);
    setEditingMatch(null);
    /* The member enters their own score first, so their own name leads. The bracket reads scores by
       player id rather than by side, so leading with either player is safe. */
    const first=ownPlayerId===slot.b?slot.b:slot.a,second=first===slot.a?slot.b:slot.a;
    setDraft(current=>({...current,mode:"cup",teamAName:"Team A",teamBName:"Team B",a:first,b:second,a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[],
      tournamentId:tournament.id,tournamentRound:slot.round,tournamentMatchIndex:slot.index,cupSlotLocked:true}));
    setModal("match");
  }
  const arrangeCupMatch=(opponentId:string)=>{if(opponentId)jumpToPlayerAvailability(opponentId,today)};
  /* A tie nobody ever plays used to have exactly one remedy: invent a score. A walkover advances the
     bracket without fabricating a result — no frames, no ELO, and reversible. */
  function declareWalkover(tournament:Tournament,slot:BracketSlot<Match>,winnerId:string){
    if(!canManageCup(tournament)){setToast("只有盃賽主持人或協辦主持人可以判定晉級。");return;}
    const playerName=(id:string)=>data.players.find(player=>player.id===id)?.name??"該球員";
    const apply=()=>{
      const others=(tournament.walkovers??[]).filter(item=>!(item.round===slot.round&&item.index===slot.index));
      const walkovers:Walkover[]=winnerId?[...others,{round:slot.round,index:slot.index,winner:winnerId}]:others;
      const tournaments=data.tournaments.map(item=>item.id===tournament.id?{...item,walkovers}:item);
      const text=winnerId?`判定晉級：${tournament.name} 第 ${slot.round} 輪第 ${slot.index} 場 — ${playerName(winnerId)}`:`取消判定晉級：${tournament.name} 第 ${slot.round} 輪第 ${slot.index} 場`;
      const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text,at:new Date().toISOString()},...data.audits]};
      setData(next);persist(next,winnerId?"已判定晉級。":"已取消判定晉級。",data);
    };
    if(winnerId)askConfirm({kicker:"判定晉級",title:`判定「${playerName(winnerId)}」因對手棄權晉級？`,description:"不會產生賽果，亦不影響 ELO。",confirmLabel:"確定判定",onConfirm:apply});
    else apply();
  }

  /* The roster is an admin's to edit, because the reasons it goes wrong are all off-app: a member
     signs up under the wrong account, a reserve takes a no-show's place the morning of the tie, a
     name is entered twice. Before the draw that is a plain edit of the sign-up list. After it the
     list *is* the bracket, so a replacement goes through `swapPlayer`, which moves the player inside
     the frozen draw rather than re-running it — re-running would re-pair everyone already told who
     they are playing. Adding and removing stay closed after the draw: there is no box to put a new
     entrant in, and removing one deletes a tie somebody else is waiting on. */
  /* Once the draw is frozen, a roster edit (swap, reshuffle, or a dragged reorder) goes through the
     server so the entrants whose opponent actually moved get told again — the same job the initial
     draw does. Before the freeze it is a plain edit of the sign-up list with nothing to announce, so
     that path still writes straight through `persist`. */
  async function submitRedraw(tournament:Tournament,body:{action:"shuffle"}|{action:"reorder";draggedId:string;targetId:string}|{action:"swap";outgoingId:string;incomingId:string},message:string){
    if(!user){setToast("請先登入會員帳戶，才可更改球會資料。");return;}
    setSaving(true);
    try{
      const r=await fetch(`/api/tournaments/${tournament.id}/redraw`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const json=await r.json().catch(()=>null);
      if(!r.ok)throw new Error(typeof json?.error==="string"?json.error:"");
      setToast(message);
      if(toastTimer.current)clearTimeout(toastTimer.current);
      toastTimer.current=setTimeout(()=>setToast(""),3200);
      await refreshData();
    }catch(error){
      setToast(error instanceof Error&&error.message?error.message:"更新失敗，請重試。");
    }finally{
      setSaving(false);
    }
  }

  function editCupRoster(tournament:Tournament,outgoingId:string,incomingId:string){
    if(!canManageCup(tournament)){setToast("只有盃賽主持人或協辦主持人可以編輯報名名單。");return;}
    const playerName=(id:string)=>data.players.find(player=>player.id===id)?.name??"該球員";
    const drawn=Boolean(tournament.draw?.length);
    const apply=(updated:Tournament,text:string,message:string)=>{
      const tournaments=data.tournaments.map(item=>item.id===tournament.id?updated:item);
      const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text,at:new Date().toISOString()},...data.audits]};
      setData(next);persist(next,message,data);
    };
    if(outgoingId&&incomingId){
      const message="已更換參賽球員。";
      if(drawn){
        const precheck=swapPlayer(tournament,outgoingId,incomingId,data.matches);
        if(!precheck.ok){setToast(precheck.error);return}
        askConfirm({kicker:"更換參賽球員",title:`在「${tournament.name}」籤表中以「${playerName(incomingId)}」代替「${playerName(outgoingId)}」？`,description:"對陣會即時更新，受影響的球員會收到通知。",confirmLabel:"確定更換",onConfirm:()=>submitRedraw(tournament,{action:"swap",outgoingId,incomingId},message)});
      }else{
        if(tournament.signups.includes(incomingId)){setToast("該球員已在名單內。");return}
        const text=`更換參賽球員：${tournament.name} — ${playerName(outgoingId)} → ${playerName(incomingId)}`;
        const updated:Tournament={...tournament,signups:tournament.signups.map(id=>id===outgoingId?incomingId:id)};
        askConfirm({kicker:"更換參賽球員",title:`在「${tournament.name}」報名名單中以「${playerName(incomingId)}」代替「${playerName(outgoingId)}」？`,description:"名單會即時更新。",confirmLabel:"確定更換",onConfirm:()=>apply(updated,text,message)});
      }
    }else if(incomingId){
      if(drawn){setToast("已抽籤，不能加入新球員；可改為替換名單上的球員。");return}
      if(tournament.signups.includes(incomingId)){setToast("該球員已在名單內。");return}
      const updated:Tournament={...tournament,signups:[...tournament.signups,incomingId]};
      apply(updated,`加入報名：${tournament.name} — ${playerName(incomingId)}`,"已加入報名名單。");
    }else if(outgoingId){
      if(drawn){setToast("已抽籤，不能移除球員；可改為替換名單上的球員。");return}
      askConfirm({kicker:"移除報名",title:`將「${playerName(outgoingId)}」移出「${tournament.name}」報名名單？`,description:"移除後可重新加入。",confirmLabel:"確定移除",onConfirm:()=>{
        const updated:Tournament={...tournament,signups:tournament.signups.filter(id=>id!==outgoingId)};
        apply(updated,`移除報名：${tournament.name} — ${playerName(outgoingId)}`,"已移除報名。");
      }});
    }
  }

  /* A draw an admin doesn't like — a lopsided pairing, a rivalry landing in round one — has one
     remedy from the moment sign-ups close up to the moment somebody actually plays: re-roll it.
     `shuffleDraw` refuses before the deadline (freezing early would strand later sign-ups outside
     the bracket) and once any tie in the cup has a recorded result. */
  function shuffleTournamentRoster(tournament:Tournament){
    if(!canManageCup(tournament)){setToast("只有盃賽主持人或協辦主持人可以重新抽籤。");return;}
    // Cheap client-side pre-check only, so an admin who has just recorded a
    // result gets an immediate "已有賽果" toast instead of a round trip — the
    // write and the notifications to affected entrants still happen server-side.
    const precheck=shuffleDraw(tournament,data.matches);
    if(!precheck.ok){setToast(precheck.error);return}
    askConfirm({kicker:"重新抽籤",title:`重新抽籤「${tournament.name}」？`,description:"會產生新的對陣，受影響的球員會收到通知。",confirmLabel:"確定重新抽籤",onConfirm:()=>submitRedraw(tournament,{action:"shuffle"},"已重新抽籤。")});
  }

  /* Dragging one name onto another is the same lever as the reshuffle button before a result, or a
     presentation-only roster edit after the cup is complete. No confirmation dialog: a drop is
     already the deliberate act a confirm would be asking about, and it is silently reversible by
     dragging again. A partially played cup stays locked until it is complete. */
  function reorderTournamentRoster(tournament:Tournament,draggedId:string,targetId:string){
    if(!canManageCup(tournament))return;
    const precheck=reorderDraw(tournament,draggedId,targetId,data.matches);
    if(!precheck.ok){setToast(precheck.error);return}
    const completed=Boolean(buildBracket<Match>(tournament,data.matches).champion);
    submitRedraw(tournament,{action:"reorder",draggedId,targetId},completed?"已調整參賽名單順序。":"已調整籤表順序。");
  }

  /* Signing up for a cup belongs to 比賽, not 約戰 — entering a competition and pitching a friendly
     are different jobs. Lifted out of the matchmaking tab's props so the cup bracket and the
     per-slot shortcut can both call the same thing. */
  const signUpTournament=async(tournamentId:string,arrivalTime?:string)=>{
        if(!ownPlayerId){setToast("請先登入會員帳戶，才可報名盃賽。");return}
        const tournament=data.tournaments.find(item=>item.id===tournamentId),deadline=tournament?.signupDeadline?new Date(`${tournament.signupDeadline.length===10?tournament.signupDeadline+"T23:59":tournament.signupDeadline}:00+08:00`):null;
        if(deadline&&!Number.isNaN(deadline.getTime())&&deadline.getTime()<Date.now()){setToast("此盃賽報名已截止。");return}
        const snapshot=data;
        const nextTournaments = data.tournaments.map(t=>{
          if(t.id!==tournamentId)return t;
          const joined=(t.signups||[]).includes(ownPlayerId);
          const arrivalTimes={...(t.arrivalTimes||{})};
          if(joined)delete arrivalTimes[ownPlayerId];
          else if(arrivalTime)arrivalTimes[ownPlayerId]=arrivalTime;
          return {...t,signups:joined?t.signups.filter(s=>s!==ownPlayerId):[...(t.signups||[]),ownPlayerId],arrivalTimes};
        });
        const next={...data,tournaments:nextTournaments,audits:[{id:crypto.randomUUID(),text:`${(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?'報名':'取消報名'} 盃賽：${nextTournaments.find(t=>t.id===tournamentId)?.name}`,at:new Date().toISOString()},...data.audits]};
        setData(next);persist(next,(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?"已報名盃賽。":"已取消報名盃賽。",snapshot);
  };

  /* Arrival time is a courtesy for the other entrants, not a competition decision, so it never asks
     for confirmation the way joining/leaving does — set it, change it, clear it, any time after
     signing up. */
  const setTournamentArrivalTime=(tournamentId:string,arrivalTime:string)=>{
    if(!ownPlayerId)return;
    const snapshot=data;
    const nextTournaments=data.tournaments.map(t=>{
      if(t.id!==tournamentId)return t;
      const arrivalTimes={...(t.arrivalTimes||{})};
      if(arrivalTime)arrivalTimes[ownPlayerId]=arrivalTime; else delete arrivalTimes[ownPlayerId];
      return {...t,arrivalTimes};
    });
    const next={...data,tournaments:nextTournaments};
    setData(next);persist(next,arrivalTime?"已更新到達時間。":"已清除到達時間。",snapshot);
  };

  const navBadge=(id:string)=>id==="availability"?matchmakingBadge:id==="matches"?openTournamentCount:0;
  /** The number on 約戰's badge means one of two different things depending on which source fed it
      (see `matchmakingBadge` above) — this says which, so a screen reader hears the right claim. */
  const navBadgeLabel=(id:string)=>{
    if(id==="matches")return `${openTournamentCount} 個盃賽開放報名`;
    if(id!=="availability")return undefined;
    const actionable=actionableCount(matchmakingSummary?.counts);
    return actionable>0?`${actionable} 項待處理`:`${matchmakingBadge} 個開緊局`;
  };

  return <><style>{`.read-only .card-tools,.read-only .hero.small > .primary{display:none}`}</style><AppShell signedIn={Boolean(user)}>
    <div className={`pull-refresh${refreshing?" spinning":""}`} style={{height:refreshing?PULL_THRESHOLD:pullDistance,opacity:refreshing||pullDistance>0?1:0}} aria-hidden="true">
      <span/>
    </div>
    <DesktopNavigation active={tab as Destination} onNavigate={goTab} badge={navBadge} badgeLabel={navBadgeLabel} signedIn={Boolean(user)} needsOnboarding={Boolean(user?.needsOnboarding)}/>
    <main>
      <header><div className="mobile-brand-wrap"><BrandLogo className="mobile-brand" compact/>{user?.needsOnboarding&&<a className="onboarding-alert-link" href="/onboarding?reminder=1" aria-label="完成會員問卷" title="完成會員問卷">⚠️</a>}</div><div className="account-actions"><div className="status"><i/> 共用資料庫 · {stateLoadStatus==="loading"?"載入中…":stateLoadStatus==="failed"?"載入失敗":saving?"儲存中…":"已同步"}</div><button className={`header-settings${tab==="settings"?" active":""}`} aria-label="評分設定與紀錄" aria-current={tab==="settings"?"page":undefined} onClick={()=>goTab("settings")}><NavIcon id="settings" active={tab==="settings"}/></button>{user?<a className="account-link" href="/account" title={user.email}>{user.displayName}</a>:<a className="account-link sign-in" href="/login">登入／註冊</a>}</div></header>
      <PageFrame className={`app-page-${tab}`}>
      {user?.needsOnboarding&&<InlineNotice tone="warning" title="完成新會員設定">
        <span>設定頭像同答幾條問題，即可取得初始評級 — 未完成前無法記錄比賽。</span>{" "}
        <a className="onboarding-notice-link" href="/onboarding?reminder=1">立即完成</a>
      </InlineNotice>}
      {stateLoadStatus==="loading"&&<HomeLoadingSkeleton/>}
      {stateLoadStatus==="failed"&&<InlineNotice tone="danger" title="未能載入球會資料"><span>{stateLoadError}</span> <Button variant="secondary" onClick={()=>{setStateLoadStatus("loading");setStateLoadError("");setStateRetry(value=>value+1)}}>重試</Button></InlineNotice>}
      {stateLoadStatus==="ready"&&<>
      {/* The club's pulse, on the screen members actually open. Matchmaking used to live entirely
          behind a tab, so "is anyone playing tonight?" was unanswerable without going to look. */}
      {tab==="leaderboard"&&!user&&<GuestIntro onNavigate={goTab}/>}
      {tab==="leaderboard"&&<TonightStrip summary={matchmakingSummary?.tonight??null} signedIn={Boolean(ownPlayerId)} onOpen={()=>goTab("availability")}/>}
      {tab==="leaderboard"&&<Leaderboard ranked={ranked} data={data} onRecord={()=>newMatch()} onPlayer={(p)=>{setDetail(p);setModal("detail")}} onMatch={(match)=>{setHeadToHead({a:"",b:""});setHighlightMatch(match.id);setMatchesView("history");setTab("matches")}} onRivalry={(first,second)=>openHeadToHead(first,second)}/>}
      {tab==="matches"&&<Matches data={data} canManageMatch={canManageMatch} canManageCup={canManageCup} onEdit={editMatch} onVoid={requestDeleteMatch} onShare={shareMatch} onPlayer={(player)=>{setDetail(player);setModal("detail")}} view={matchesView} setView={setMatchesView} pair={headToHead} setPair={setHeadToHead} highlight={highlightMatch} isAdmin={Boolean(isAdmin)} onCreateTournament={()=>{setEditingTournament(null);setCoHostSearch("");setTournamentForm({name:"",handicapMode:"suggested",startAt:"",signupDeadline:`${today}T23:59`,coHosts:[]});setModal("tournament")}} onEditTournament={tournament=>{setEditingTournament(tournament);setCoHostSearch("");setTournamentForm({name:tournament.name,handicapMode:tournament.handicapMode,startAt:tournament.startAt??"",signupDeadline:tournament.signupDeadline.length===10?`${tournament.signupDeadline}T23:59`:tournament.signupDeadline,coHosts:tournament.coHosts??[]});setModal("tournament")}} onDeleteTournament={deleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={signUpTournament} onSetArrivalTime={setTournamentArrivalTime} onRecordSlot={recordCupSlot} onArrange={arrangeCupMatch} onWalkover={declareWalkover} onEditRoster={editCupRoster} onShuffleRoster={shuffleTournamentRoster} onReorderRoster={reorderTournamentRoster} onRefresh={refreshData}/>}
      {tab==="availability"&&<MatchmakingFormation onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player){setDetail(player);setModal("detail")}}} onRecord={opponentId=>newMatch("1v1",opponentId)} onActivity={refreshMatchmaking}/>}
      {tab==="players"&&<Players data={data} ownPlayerId={ownPlayerId} managementMode={Boolean(isAdmin&&managementMode)} canAdd={Boolean(isAdmin)} canManagePlayer={player=>Boolean(isAdmin||player.id===ownPlayerId)} onAdd={()=>{if(!isAdmin){setToast("只有管理員可以新增球員。");return;}setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal("player")}} onEdit={editPlayer} onDelete={deletePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}} onCompare={(p)=>openHeadToHead(p,data.players.find(candidate=>candidate.id===ownPlayerId))} onRecordAgainst={(p)=>newMatch("1v1",p.id)} onFindOpponent={jumpToPlayerAvailability}/>}
      {tab==="settings"&&<SettingsView data={data} onEdit={()=>isAdmin?setModal("settings"):setToast("只有管理員可以修改 ELO 設定。")} onReset={resetAll} canReset={user?.role==="admin"}/>}
      </>}
      </PageFrame>
    </main>
    {/* Record sits dead centre as the one thing this app exists to do; the four content tabs split
        evenly around it. 設定 is not a peer of them — it lives with the account controls instead. */}
    {recordMenuOpen&&<button type="button" className="record-menu-scrim" aria-label="關閉比賽模式選單" onClick={()=>setRecordMenuOpen(false)}/>}
    <div className={`record-speed-dial${recordMenuOpen?" open":""}`} aria-hidden={!recordMenuOpen}>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("1v1")}><i>1v1</i><span><b>正式 1v1</b><small>賽果會改變實際 ELO 與球員統計</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("2v2")}><i>2v2</i><span><b>潮拍 2v2</b><small>純娛樂模式，不影響目前 ELO 與統計</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("cup")}><i>盃賽</i><span><b>盃賽記錄</b><small>選擇盃賽場次並儲存，不可手動設定讓分</small></span></button>
    </div>
    <MobileBottomNav active={tab as Destination} onNavigate={goTab} onRecord={()=>setRecordMenuOpen(open=>!open)} recordOpen={recordMenuOpen} badge={navBadge} badgeLabel={navBadgeLabel}/>
    {/* Share is the first modal kind migrated off this shared shell onto the `Sheet`
        primitive (see docs/ui-audit.md §3) — it owns its own scrim, safe-area handling,
        and close button now, so it is excluded from the block below and rendered
        separately underneath it. */}
    <Sheet open={modal==="share"} title={sharePayload?shareSheetTitle(sharePayload.card.kind):""} onClose={closeModal}>
      {sharePayload&&<ShareSheet card={sharePayload.card} message={sharePayload.message} url={sharePayload.url} title={sharePayload.title} heading={false}/>}
    </Sheet>
    {modal&&modal!=="share"&&<div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&closeModal()}>
      {/* `.close` is a sibling of `.sheet`, not a child: `.sheet` is the scrolling box, and a
          descendant can never sit outside it or straddle its edge without being clipped by that
          same overflow. As a sibling inside `.sheet-shell` it floats above the corner, stays put
          while the sheet content scrolls underneath it, and can cross the sheet's edge freely. */}
      <div className={`sheet-shell${modal==="detail"?" player-detail-sheet":""}${modal==="match"?" match-entry-sheet":""}`}>
        <IconButton className="close" label="關閉" onClick={closeModal}>×</IconButton>
        <section className={`sheet${modal==="deleteMatch"?" confirm-sheet":""}`} role="dialog" aria-modal="true">
          {modal==="match"&&<MatchForm data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} editing={!!editingMatch} saving={saving} onSave={saveMatch}/>}
          {modal==="tournament"&&<div>
            <p className="kicker">盃賽</p>
            <h2>{editingTournament?"編輯盃賽":"建立新盃賽"}</h2>
            <p className="sub">建立盃賽以便球員報名與賽事管理。</p>
            <form className="tournament-form" onSubmit={ev=>{ev.preventDefault();
              if(!tournamentForm.name.trim()){setToast("請輸入盃賽名稱。");return}
              if(!tournamentForm.startAt){setToast("請輸入盃賽開始日期及時間。");return}
              const id=editingTournament?.id??crypto.randomUUID();
              const now=new Date().toISOString();
              /* Pushing the deadline back into the future is how an admin reopens sign-ups, and a
                 draw made against the old roster cannot survive that: it would pair people who are
                 no longer the field. Clearing it here lets the freeze happen again, once, when the
                 new deadline passes. Recorded results are left alone — deleting them is the ✕. */
              const reopening=Boolean(editingTournament?.draw?.length)&&!signupsClosed({signupDeadline:tournamentForm.signupDeadline});
              const commit=()=>{
                const tournament: Tournament = {id,name:tournamentForm.name.trim(),handicapMode:tournamentForm.handicapMode,startAt:tournamentForm.startAt,signupDeadline:tournamentForm.signupDeadline,createdAt:editingTournament?.createdAt??now,createdBy:editingTournament?.createdBy??ownPlayerId,coHosts:editingTournament?(canManageCupHosts(editingTournament)?tournamentForm.coHosts:editingTournament.coHosts??[]):tournamentForm.coHosts,signups:editingTournament?.signups??[],
                  draw:reopening?undefined:editingTournament?.draw,drawnAt:reopening?undefined:editingTournament?.drawnAt,rosterOrder:reopening?undefined:editingTournament?.rosterOrder,walkovers:reopening?undefined:editingTournament?.walkovers,arrivalTimes:editingTournament?.arrivalTimes};
                const tournaments = editingTournament? data.tournaments.map(t=>t.id===id?tournament:t) : [tournament,...data.tournaments];
                const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text:`${editingTournament?"更新":"建立"} 盃賽：${tournament.name}`,at:now},...data.audits]};
                setEditingTournament(null);setModal(null);setToast(editingTournament?"盃賽已更新。":"盃賽已建立。");setData(next);persist(next,editingTournament?"盃賽已更新。":"盃賽已建立。",data);
              };
              if(reopening)askConfirm({kicker:"重新開放報名",title:`「${tournamentForm.name.trim()}」已經抽籤`,description:"重新開放報名會清除現有籤表，截止後重新抽籤（已記錄的賽果會保留）。繼續？",confirmLabel:"重新開放",onConfirm:commit});
              else commit();
            }}>
              <label>盃賽名稱<input type="text" value={tournamentForm.name} onChange={e=>setTournamentForm({...tournamentForm,name:e.target.value})} required/></label>
              <label>讓分模式<select value={tournamentForm.handicapMode} onChange={e=>setTournamentForm({...tournamentForm,handicapMode:e.target.value as "suggested"|"none"})}><option value="suggested">建議讓分（系統會自動套用建議）</option><option value="none">不設讓分</option></select></label>
              <label>盃賽開始日期及時間<input type="datetime-local" value={tournamentForm.startAt} onChange={e=>setTournamentForm({...tournamentForm,startAt:e.target.value})} required/></label>
              <label>報名截止日期及時間<input type="datetime-local" value={tournamentForm.signupDeadline} onChange={e=>setTournamentForm({...tournamentForm,signupDeadline:e.target.value})} required/></label>
              {(()=>{
                const canEditCoHosts=editingTournament?canManageCupHosts(editingTournament):Boolean(isAdmin||ownPlayerId);
                const tournamentOwnerId=editingTournament?.createdBy??ownPlayerId;
                const selectedPlayers=tournamentForm.coHosts.map(id=>data.players.find(player=>player.id===id)).filter((player):player is Player=>Boolean(player));
                const query=coHostSearch.trim().toLocaleLowerCase();
                const candidates=data.players.filter(player=>player.active&&player.id!==tournamentOwnerId&&(!query||player.name.toLocaleLowerCase().includes(query)));
                return <div className={`tournament-cohosts${canEditCoHosts?"":" is-readonly"}`} role="group" aria-labelledby="tournament-cohosts-title">
                  <div className="tournament-cohosts-head"><div><span className="tournament-cohosts-eyebrow">管理權限</span><h3 id="tournament-cohosts-title">協辦主持人</h3></div><span className="tournament-cohosts-count">{tournamentForm.coHosts.length} 位</span></div>
                  <p className="tournament-cohosts-intro">選擇可以協助編輯盃賽、調整籤表及管理名單的球員。</p>
                  {selectedPlayers.length>0&&<div className="tournament-cohosts-selected" aria-label="已選擇的協辦主持人">{selectedPlayers.map(player=><button type="button" className="tournament-cohost-chip" key={player.id} disabled={!canEditCoHosts} onClick={()=>setTournamentForm(current=>({...current,coHosts:current.coHosts.filter(id=>id!==player.id)}))}><PlayerBadge player={player}/><span>{player.name}</span><b aria-hidden="true">×</b></button>)}</div>}
                  <label className="tournament-cohosts-search"><span aria-hidden="true">⌕</span><input type="search" value={coHostSearch} disabled={!canEditCoHosts} onChange={event=>setCoHostSearch(event.target.value)} placeholder="搜尋球員" aria-label="搜尋協辦主持人"/></label>
                  <div className="tournament-cohosts-results" aria-label="可選擇的協辦主持人">{candidates.length>0?candidates.map(player=>{const selected=tournamentForm.coHosts.includes(player.id);return <button type="button" className={`tournament-cohost-option${selected?" is-selected":""}`} key={player.id} disabled={!canEditCoHosts} onClick={()=>setTournamentForm(current=>({...current,coHosts:selected?current.coHosts.filter(id=>id!==player.id):[...new Set([...current.coHosts,player.id])]}))}><PlayerBadge player={player}/><span>{player.name}</span><b>{selected?"已加入":"加入"}</b></button>}):<p className="tournament-cohosts-empty">沒有符合的球員</p>}</div>
                  <small>{canEditCoHosts?"協辦主持人可以編輯此盃賽、調整籤表及管理名單。":"只有盃賽主持人可以更改協辦主持人。"}</small>
                </div>;
              })()}
              {Boolean(editingTournament?.draw?.length)&&<p className="mm-note">此盃賽已抽籤（{editingTournament?.draw?.length} 人）。將截止時間改到未來即可重新開放報名，並在新截止時間後重新抽籤。</p>}
              <div className="sheet-actions"><Button type="submit">儲存盃賽</Button><Button variant="secondary" type="button" onClick={()=>{setModal(null);setEditingTournament(null)}}>取消</Button></div>
            </form>
          </div>}
          {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} editing={!!editingPlayer} canEditRating={isAdmin} onSave={savePlayer}/>}
          {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{const start=Number(settings.start ?? data.settings.start ?? 1500); const applied={...settings,start,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:15}; const rebuilt=replay(data.players.map(player=>({...player,initialRating:start,rating:start})),data.matches,applied); setModal(null); persist({...data,settings:applied,...rebuilt,audits:[{id:crypto.randomUUID(),text:`調整 Snooker Elo 公式參數；以 ${start} 起始並重播歷史評分`,at:new Date().toISOString()},...data.audits]},`設定已套用，歷史評分已從 ${start} 重播。`)}}/>}
          {modal==="deleteMatch"&&deletingMatch&&<ConfirmDeleteMatch match={deletingMatch} data={data} onCancel={closeModal} onConfirm={confirmDeleteMatch}/>}
          {modal==="signIn"&&<><p className="kicker">會員功能</p><h2>先登入或建立帳戶</h2><p className="sub">記錄賽果前，請登入會員帳戶；新會員註冊時會同時建立球員檔案。</p><div className="auth-buttons"><a className="primary" href="/login">登入</a><a className="more" href="/login?mode=signup">建立帳戶</a></div></>}
          {modal==="detail"&&detail&&<PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data} onCompare={opponent=>{setModal(null);openHeadToHead(detail,opponent)}} onViewAllMatches={()=>{setModal(null);openPlayerMatches(detail)}} onMatch={matchId=>{setModal(null);setHeadToHead({a:detail.id,b:""});setHighlightMatch(matchId);setMatchesView("history");setTab("matches")}} onFindOpponent={jumpToPlayerAvailability} onShare={()=>sharePlayer(detail)}/>}
        </section>
      </div>
    </div>}
    {leavingAvailability&&<ConfirmDialog kicker="未儲存的變更" titleId="leave-availability-title" title="離開後變更會消失" description="你在「可配對」的時段變更尚未儲存，離開這一頁後不會保留。" onClose={()=>setLeavingAvailability(null)}><Button variant="secondary" onClick={()=>setLeavingAvailability(null)}>留在此頁</Button><Button variant="danger" onClick={()=>{const next=leavingAvailability;setLeavingAvailability(null);setAvailabilityDirty(false);setHighlightMatch(null);setTab(next)}}>捨棄變更離開</Button></ConfirmDialog>}
    {pendingConfirm&&<ConfirmDialog kicker={pendingConfirm.kicker} titleId="pending-confirm-title" title={pendingConfirm.title} description={pendingConfirm.description} onClose={()=>setPendingConfirm(null)}><Button variant="secondary" onClick={()=>setPendingConfirm(null)}>取消</Button><Button variant="danger" onClick={()=>{const run=pendingConfirm.onConfirm;setPendingConfirm(null);run()}}>{pendingConfirm.confirmLabel}</Button></ConfirmDialog>}
    {toast&&<div className={`toast${undoSnapshot?" toast-expiring":""}`} role="status"><span>{toast}</span>{undoSnapshot&&<Button variant="quiet" onClick={undoDelete}>復原</Button>}</div>}
  </AppShell></>;
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

type BreakRecord={player:Player;opponent:string;value:number;date:string;createdAt:string;key:string};
type MonthlyBreak={month:string;record:BreakRecord|null;top:BreakRecord[]};
/** The highest break of every month from the first recorded break to today,
 *  newest last, plus up to the 5 highest breaks in that month. Months without
 *  a recorded break stay in the series as gaps so the timeline reads evenly;
 *  the chart scrolls when there are more than a screenful. */
function monthlyBreakRecords(records:BreakRecord[]):MonthlyBreak[]{
  const byMonth=new Map<string,BreakRecord[]>();
  // records arrive sorted by value desc, so each month's list stays sorted too.
  for(const record of records){const month=record.date.slice(0,7);const list=byMonth.get(month);if(list)list.push(record);else byMonth.set(month,[record]);}
  const sorted=[...byMonth.keys()].sort();
  if(!sorted.length)return [];
  const first=sorted[0],last=sorted[sorted.length-1];
  // Run through today, unless a record is somehow dated ahead of it.
  const end=last>today.slice(0,7)?last:today.slice(0,7);
  const months:MonthlyBreak[]=[];
  for(let month=first;month<=end;month=shiftMonth(month,1)){
    const top=byMonth.get(month)??[];
    months.push({month,record:top[0]??null,top:top.slice(0,5)});
  }
  return months;
}
/** Monthly high breaks as a column chart: the shape of the club's best month-to-month,
 *  with the holder and opponent for whichever month is selected. */
function MonthlyBreakChart({months,onPlayer}:{months:MonthlyBreak[];onPlayer:(p:Player)=>void}) {
  const withRecord=months.filter(month=>month.record);
  const lastIndex=months.map(month=>!!month.record).lastIndexOf(true);
  const [selected,setSelected]=useState<number|null>(lastIndex>=0?lastIndex:null);
  const active=selected!=null?months[selected]:null;
  const scroller=useRef<HTMLDivElement>(null);
  // The newest months matter most, so the track opens scrolled to its right end.
  useEffect(()=>{const node=scroller.current;if(node)node.scrollLeft=node.scrollWidth;},[months.length]);
  if(!withRecord.length)return <Empty text="尚未有單桿紀錄" sub="記錄賽果時加入單桿度數，這裡就會顯示每月最高。"/>;
  const peak=Math.max(...withRecord.map(month=>month.record!.value));
  const scale=Math.max(50,Math.ceil(peak/25)*25);
  return <div className="monthly-break">
    <div className="monthly-break-plot">
      <div className="monthly-break-axis" aria-hidden="true"><span>{scale}</span><span>{scale/2}</span><span>0</span></div>
      <div className="monthly-break-scroller" ref={scroller} tabIndex={0} role="group" aria-label={`每月最高單桿，${months[0].month} 至 ${months[months.length-1].month}，可左右捲動`}>
      <ol className="monthly-break-columns">{months.map((month,index)=>{
        const record=month.record;
        const label=`${month.month.slice(0,4)} 年 ${Number(month.month.slice(5))} 月`;
        return <li key={month.month}>
          <button type="button" className={`monthly-break-column${selected===index?" active":""}${record?"":" empty"}${record&&record.value>=100?" century":""}`}
            aria-pressed={selected===index} disabled={!record}
            aria-label={record?`${label}，最高單桿 ${record.value} 分，${record.player.name} 對 ${record.opponent}`:`${label}，未有單桿紀錄`}
            onClick={()=>setSelected(current=>current===index?null:index)}>
            {record?<><em>{record.value}</em><i style={{height:`${Math.max(6,record.value/scale*100)}%`}}/></>:<i className="monthly-break-gap"/>}
          </button>
          <small>{Number(month.month.slice(5))}月{(index===0||month.month.endsWith("-01"))&&<span>{month.month.slice(2,4)}</span>}</small>
        </li>})}</ol>
      </div>
    </div>
    {active?.record?<div className="monthly-break-detail">
      <button type="button" onClick={()=>onPlayer(active.record!.player)}>
        <PlayerBadge player={active.record.player}/>
        <span><small>{active.month.slice(0,4)} 年 {Number(active.month.slice(5))} 月最高單桿</small><b>{active.record.player.name}</b><em>對 {active.record.opponent} · {active.record.date}</em></span>
      </button>
      <strong>{active.record.value>=100&&<em className="century-badge" title="破百單桿">破百</em>}{active.record.value}</strong>
    </div>:<p className="monthly-break-hint">點擊柱狀圖查看該月的單桿紀錄保持者。</p>}
    {active&&active.top.length>1&&<ol className="monthly-break-top5">{active.top.map((record,index)=>
      <li key={record.key} className={index===0?"lead":""}>
        <span className="monthly-break-top5-rank">{index+1}</span>
        <button type="button" onClick={()=>onPlayer(record.player)}><PlayerBadge player={record.player}/><b>{record.player.name}</b></button>
        <em>對 {record.opponent} · {record.date}</em>
        <strong>{record.value>=100&&<i className="century-badge" title="破百單桿">破百</i>}{record.value}</strong>
      </li>)}
    </ol>}
    <p className="chart-summary">{months[0].month.slice(0,4)} 年 {Number(months[0].month.slice(5))} 月至今，共 {months.length} 個月{months.length>12?"；可左右捲動查看更早月份。":"。"}</p>
  </div>;
}
function Leaderboard({ranked,data,onRecord,onPlayer,onMatch,onRivalry}:{ranked:Player[];data:AppState;onRecord:()=>void;onPlayer:(p:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[breakView,setBreakView]=useState<"players"|"overall"|"recent"|"monthly">("players"),[homeView,setHomeView]=useState<"ranking"|"breaks"|"recent">("ranking"),[rankingMode,setRankingMode]=useState<"all"|"official"|"trend">("all");
  const officialOnly=rankingMode==="official";
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
      recent:records.filter(record=>isInPastThirtyDays(record.date)).slice(0,10),
      monthly:monthlyBreakRecords(records)
    };
  },[data.matches,data.players]);
  const displayedBreaks=breakView==="monthly"?breakRecords.overall:breakRecords[breakView];
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  return <><section className="hero"><div><p className="kicker">SCAA CLUB RANKING</p><h1>讓每一局，<br/><span>都推動進步。</span></h1><p>追蹤實力、看見成長，找到旗鼓相當的對手。</p>
      <div className="podium-stats">
        <span><b>{ranked.length}</b><small>活躍球員</small></span>
        <span><b>{month}</b><small>本月比賽</small></span>
        <span><b>{total}</b><small>歷來總場數</small></span>
      </div>
    </div><Button className="hero-action" onClick={onRecord}><span aria-hidden="true" className="hero-action-icon">＋</span><b>記錄新賽果</b><small>更新排名與近期狀態</small></Button></section>
    <SlidingToggleGroup as="nav" className="page-tabs home-view-nav" aria-label="首頁內容" role="tablist">
      <button role="tab" aria-selected={homeView==="ranking"} className={homeView==="ranking"?"active":""} onClick={()=>setHomeView("ranking")}><span>目前排名</span></button>
      <button role="tab" aria-selected={homeView==="breaks"} className={homeView==="breaks"?"active":""} onClick={()=>setHomeView("breaks")}><span>最高單桿紀錄</span></button>
      <button role="tab" aria-selected={homeView==="recent"} className={homeView==="recent"?"active":""} onClick={()=>setHomeView("recent")}><span>近三十日統計</span></button>
    </SlidingToggleGroup>
    {homeView==="ranking"&&<>
    <Overview top={visibleRanked.slice(0,3)} data={data} onPlayer={onPlayer}/>
    <section className="home-view-panel ranking-panel" aria-labelledby="ranking-title">
      <div className="home-panel-head"><div><p className="kicker">即時競爭形勢</p><h2 id="ranking-title">目前排名</h2><p>{rankingMode==="trend"?"各球員 ELO 評分隨日期的走勢，取每日最後一場賽事後的評分。":"每場結果都會即時反映在 ELO 與近期狀態。"}</p></div>
      <SlidingToggleGroup className="mini-toggle ranking-scope-toggle" aria-label="排名顯示方式"><button aria-pressed={rankingMode==="all"} className={rankingMode==="all"?"active":""} onClick={()=>setRankingMode("all")}>全部球員</button><button aria-pressed={rankingMode==="official"} className={rankingMode==="official"?"active":""} onClick={()=>setRankingMode("official")}>正式球手</button><button aria-pressed={rankingMode==="trend"} className={rankingMode==="trend"?"active":""} onClick={()=>setRankingMode("trend")}>ELO走勢</button></SlidingToggleGroup></div>
    {rankingMode!=="trend"?<>
    <SortControls sort={sort} dir={dir} onSort={sortBy}/>
    <Surface as="div" className="table-card">{visibleRanked.length===0?<Empty text={officialOnly?"尚未有正式球手":"尚未有球員"} sub={officialOnly?"未有球員完成臨時門檻，暫時未有正式評分。":"前往球員頁面新增第一位球員。"}/>:<><div className="table-head sortable"><button title="箭嘴為過去 10 天的排名升跌" onClick={()=>sortBy("rank")}>排名<SortArrow active={sort==="rank"} dir={dir}/></button><button onClick={()=>sortBy("name")}>球員<SortArrow active={sort==="name"} dir={dir}/></button><button title="最近五筆比賽；較近期結果權重較高" onClick={()=>sortBy("form")}>近況<SortArrow active={sort==="form"} dir={dir}/></button><button onClick={()=>sortBy("winRate")}>場數／勝率<SortArrow active={sort==="winRate"} dir={dir}/></button><button onClick={()=>sortBy("suggested")}>建議／正式評分<SortArrow active={sort==="suggested"} dir={dir}/></button><button title="ELO 及近10天ELO變化" onClick={()=>sortBy("rating")}>ELO<SortArrow active={sort==="rating"} dir={dir}/></button></div>
      <MobileSortHead sort={sort}/>
      {shown.map(p=>{const rank=rankOf.get(p.id)??0,suggested=Math.round(suggestedHandicap(p,data)),swing=recentDeltaDays(p,data,10),played=games(p),rate=played?Math.round(p.wins/played*100):0,provisional=played<data.settings.provisionalGames,trailing=trailingStat(sort,p,data,suggested);
        return <button className={`row ${rank===1?"top":""} ${provisional?"provisional":""}`} key={p.id} onClick={()=>onPlayer(p)} aria-label={`${p.name}，排名 ${rank}，ELO ${Math.round(p.rating)}，近10天ELO變化 ${swing>=0?"+":""}${Math.round(swing)}，建議讓分 ${suggested}${provisional?"，臨時評分":""}`}>
        <span className="rank">{rank===1?"♛":rank}{(()=>{if(!movement.active)return null;const move=movement.map.get(p.id)??0;
          return move===0?<em className="move flat" aria-label="10 天內排名不變">–</em>
          :<em className={`move ${move>0?"up":"down"}`} aria-label={`較 10 天前${move>0?"上升":"下跌"} ${Math.abs(move)} 位`}>{move>0?"▲":"▼"}{Math.abs(move)}</em>})()}</span><span className="person"><PlayerBadge player={p}/><b>{p.name}<small>{played<data.settings.provisionalGames?"臨時":<span className="official-only">正式</span>}<span className="rating-kind-suffix">評分</span><em className="person-meta"> · {played} 場</em></small></b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{played} 場<small>{rate}% 勝率</small></span><span className="dual-rating"><b>{suggested}</b><small>正式 {p.handicap==null?"—":p.handicap}</small></span>
        {trailing?<span className="elo"><b className={trailing.cls}>{trailing.big}</b><small>{trailing.sub}</small></span>
        :<span className="elo"><b>{Math.round(p.rating)}</b><small className={swing>=0?"positive":"negative"}>{swing>=0?"+":""}{Math.round(swing)}</small><em className="elo-suggested">建議 {suggested}</em></span>}</button>})}</>}</Surface>
    </>:<EloTrendChart players={visibleRanked} data={data}/>}
    </section></>}
    {homeView==="breaks"&&<section className="home-view-panel break-records-panel" aria-labelledby="break-records-title">
      <div className="home-panel-head"><div><p className="kicker">HIGH BREAK RECORDS</p><h2 id="break-records-title">最高單桿紀錄</h2><p>查看每位球員的個人最佳、歷史最高，或近 30 日最高紀錄。</p></div><SlidingToggleGroup className="mini-toggle break-toggle" aria-label="單桿紀錄顯示方式"><button aria-pressed={breakView==="players"} className={breakView==="players"?"active":""} onClick={()=>setBreakView("players")}>球員最高</button><button aria-pressed={breakView==="overall"} className={breakView==="overall"?"active":""} onClick={()=>setBreakView("overall")}>歷史</button><button aria-pressed={breakView==="recent"} className={breakView==="recent"?"active":""} onClick={()=>setBreakView("recent")}>近30日</button><button aria-pressed={breakView==="monthly"} className={breakView==="monthly"?"active":""} onClick={()=>setBreakView("monthly")}>每月</button></SlidingToggleGroup></div>
      {breakView==="monthly"?<MonthlyBreakChart months={breakRecords.monthly} onPlayer={onPlayer}/>:<><ol className="break-ranking">{Array.from({length:10},(_,index)=>{const record=displayedBreaks[index];const medal=["gold","silver","bronze"][index];return <li key={record?.key??`empty-${index}`} className={`${record?"":"empty-rank"}${medal?` medal medal-${medal}`:""}`}><span className="break-position">{medal?<i className="medal-icon" aria-hidden="true">{["🥇","🥈","🥉"][index]}</i>:index+1}</span>{record?<><PlayerBadge player={record.player}/><b><span>{record.player.name}</span><small>對 {record.opponent}<span className="break-date-inline"> · {record.date}</span></small></b><time dateTime={record.date}>{record.date}</time><strong>{record.value>=100&&<em className="century-badge" title="破百單桿">破百</em>}{record.value}</strong></>:<b>N/A</b>}</li>})}</ol>
      <p className="chart-summary">{breakView==="players"?"每位球員只顯示其最高單桿。":breakView==="overall"?"按所有已確認賽事的單桿記錄排名，同一球員可重複上榜。":`${thirtyDaysAgo} 至 ${today} 的最高單桿，同一球員可重複上榜。`}</p></>}
    </section>}
    {homeView==="recent"&&<ThirtyDayStats data={data} onPlayer={onPlayer} onMatch={onMatch} onRivalry={onRivalry}/>}</>;
}

function HomeLoadingSkeleton() {
  return <section className="home-loading-skeleton" aria-busy="true" aria-label="正在載入球會資料">
    <span className="sr-only">正在載入球會資料</span>
    <div className="home-loading-hero" aria-hidden="true">
      <div className="home-loading-hero-copy">
        <Skeleton width="8rem" height=".75rem" />
        <Skeleton width="min(24rem, 80%)" height="clamp(3.8rem, 9vw, 5.2rem)" className="home-loading-title" />
        <Skeleton width="min(30rem, 90%)" height="1rem" />
        <div className="home-loading-stats"><Skeleton width="5rem" height="2.2rem" /><Skeleton width="5rem" height="2.2rem" /><Skeleton width="5rem" height="2.2rem" /></div>
      </div>
      <Skeleton width="13rem" height="4.5rem" className="home-loading-action" />
    </div>
    <div className="home-loading-tabs" aria-hidden="true"><Skeleton width="5.5rem" height="1rem" /><Skeleton width="7rem" height="1rem" /><Skeleton width="7rem" height="1rem" /></div>
    <section className="home-loading-panel" aria-hidden="true">
      <div className="home-loading-panel-head"><div><Skeleton width="7rem" height=".75rem" /><Skeleton width="8rem" height="1.9rem" /><Skeleton width="min(26rem, 90%)" height=".9rem" /></div><Skeleton width="14rem" height="2.75rem" className="home-loading-toggle" /></div>
      <div className="home-loading-podium"><Skeleton height="8.5rem" /><Skeleton height="10rem" /><Skeleton height="8.5rem" /></div>
      <div className="home-loading-table"><div className="home-loading-table-head"><Skeleton height=".75rem" /><Skeleton height=".75rem" /><Skeleton height=".75rem" /><Skeleton height=".75rem" /></div>{Array.from({length:5},(_,index)=><div className="home-loading-row" key={index}><Skeleton width="2rem" height="1rem" /><span><Skeleton width="2.75rem" height="2.75rem" className="home-loading-avatar" /><Skeleton width="7rem" height=".9rem" /></span><Skeleton width="5rem" height="1.2rem" /><Skeleton width="4rem" height="1.2rem" /></div>)}</div>
    </section>
  </section>;
}

function trendDateLabel(date:string){return date.replace(/-/g,"/");}
function trendAxisDateLabel(date:string){return `${date.slice(2,4)}/${date.slice(5).replace("-","/")}`;}
function useMediaQuery(query:string){
  const [matches,setMatches]=useState(false);
  useEffect(()=>{
    const mq=window.matchMedia(query),update=()=>setMatches(mq.matches);
    update();
    mq.addEventListener("change",update);
    return ()=>mq.removeEventListener("change",update);
  },[query]);
  return matches;
}
function EloTrendChart({players,data}:{players:Player[];data:AppState}) {
  const narrow=useMediaQuery("(max-width:599px)");
  const ranked=useMemo(()=>players.filter(p=>games(p)>0).sort((a,b)=>b.rating-a.rating),[players]);
  const [hiddenIds,setHiddenIds]=useState<Set<string>>(()=>new Set(ranked.slice(5).map(p=>p.id)));
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const plotRef=useRef<HTMLDivElement>(null);
  const shownPlayers=ranked.filter(p=>!hiddenIds.has(p.id));
  const {dates,series}=useMemo(()=>eloTrendSeries(shownPlayers,data),[shownPlayers,data]);
  const toggle=(id:string)=>{setActiveIndex(null);setHiddenIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})};
  const deselectAll=()=>{setActiveIndex(null);setHiddenIds(new Set(ranked.map(p=>p.id)))};
  if(ranked.length===0) return players.length===0
    ? <Empty text="尚未有球員" sub="前往球員頁面新增第一位球員。"/>
    : <Empty text="尚未有賽事紀錄" sub="累積賽事後即可查看 ELO 走勢。"/>;
  const legend=<>
    <div className="trend-legend-actions"><button type="button" className="trend-clear-btn" onClick={deselectAll} disabled={shownPlayers.length===0}><span>取消全選</span></button></div>
    <ul className="trend-legend">{ranked.map(p=>{const hidden=hiddenIds.has(p.id);
      return <li key={p.id}><button type="button" className={`trend-legend-item${hidden?" hidden":""}`} aria-pressed={!hidden} onClick={()=>toggle(p.id)}><i style={{background:avatarHex(p.colour)}}/><span>{p.name}</span><b>{Math.round(p.rating)}</b></button></li>})}
    </ul>
  </>;
  if(shownPlayers.length===0) return <>
    <Empty text="尚未選擇球員" sub="請於下方選擇至少一位球員以顯示 ELO 走勢。"/>
    {legend}
  </>;
  if(dates.length===0) return <>
    <Empty text="尚未有賽事紀錄" sub="所選球員累積賽事後即可查看 ELO 走勢。"/>
    {legend}
  </>;
  const values=series.flatMap(s=>s.values).filter((v):v is number=>v!=null);
  const rawMin=Math.min(...values),rawMax=Math.max(...values);
  const observed=Math.max(1,rawMax-rawMin),visualRange=Math.max(24,observed*1.15);
  const middle=(rawMin+rawMax)/2,min=middle-visualRange/2,max=middle+visualRange/2;
  const lineEnd=78;
  const x=(index:number)=>dates.length<=1?50:3+index/(dates.length-1)*(lineEnd-3);
  const y=(value:number)=>54-(value-min)/(max-min)*46;
  const yTicks=[max,(max+middle)/2,middle,(middle+min)/2,min];
  const xTickCount=Math.min(dates.length,narrow?3:6);
  const xTickIndexes=Array.from(new Set(Array.from({length:xTickCount},(_,i)=>Math.round(i/(xTickCount-1||1)*(dates.length-1)))));
  const updateActive=(clientX:number)=>{
    const rect=plotRef.current?.getBoundingClientRect();
    if(!rect||dates.length===0) return;
    const fraction=Math.min(1,Math.max(0,(clientX-rect.left)/rect.width));
    const raw=((fraction*100-3)/(lineEnd-3))*(dates.length-1);
    setActiveIndex(Math.min(dates.length-1,Math.max(0,Math.round(raw))));
  };
  const activeAbove=activeIndex!=null&&x(activeIndex)>lineEnd-16;
  const lastIndex=dates.length-1;
  const endLabels=(()=>{
    const minGap=9;
    const lastValue=(s:typeof series[number])=>s.values[lastIndex]!;
    const sorted=[...series].sort((a,b)=>y(lastValue(a))-y(lastValue(b)));
    const tops=sorted.map(s=>y(lastValue(s))/60*100);
    for(let i=1;i<tops.length;i++) if(tops[i]-tops[i-1]<minGap) tops[i]=tops[i-1]+minGap;
    for(let i=tops.length-2;i>=0;i--) if(tops[i+1]-tops[i]<minGap) tops[i]=tops[i+1]-minGap;
    return sorted.map((s,i)=>({player:s.player,value:lastValue(s),anchor:y(lastValue(s))/60*100,top:tops[i]}));
  })();
  return <>
    <div className="multi-trend-chart">
      <div className="multi-trend-yaxis" aria-hidden="true">{yTicks.map((v,i)=><span key={i} style={{top:`${y(v)/60*100}%`}}>{Math.round(v)}</span>)}</div>
      <div className="trend-plot multi-trend-plot" ref={plotRef}
        onPointerMove={e=>updateActive(e.clientX)}
        onPointerDown={e=>updateActive(e.clientX)}
        onPointerLeave={()=>setActiveIndex(null)}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="各球員 ELO 走勢圖">
          {yTicks.map((v,i)=><line key={i} x1="0" y1={y(v)} x2="100" y2={y(v)} className="trend-grid"/>)}
          {activeIndex!=null&&<line x1={x(activeIndex)} y1="2" x2={x(activeIndex)} y2="58" className="trend-guide"/>}
          {series.map(s=><polyline key={s.player.id} points={s.values.map((v,i)=>v==null?null:`${x(i)},${y(v)}`).filter((p):p is string=>p!=null).join(" ")} className="multi-trend-line" style={{stroke:avatarHex(s.player.colour)}}/>)}
          {endLabels.map(({player,anchor,top})=>Math.abs(top-anchor)>0.6&&<line key={player.id} x1={x(lastIndex)} y1={anchor/100*60} x2={x(lastIndex)} y2={top/100*60} className="multi-trend-leader" style={{stroke:avatarHex(player.colour)}}/>)}
        </svg>
        {activeIndex!=null&&series.map(s=>s.values[activeIndex]!=null&&<span key={s.player.id} className="multi-trend-dot" style={{left:`${x(activeIndex)}%`,top:`${y(s.values[activeIndex]!)/60*100}%`,background:avatarHex(s.player.colour)}} aria-hidden="true"/>)}
        {endLabels.map(({player,anchor})=><span key={player.id} className="multi-trend-endpoint" style={{left:`${x(lastIndex)}%`,top:`${anchor}%`,background:avatarHex(player.colour)}} aria-hidden="true"/>)}
        {activeIndex!=null&&<div className={`multi-trend-tooltip${activeAbove?" align-right":""}`} style={{left:`${x(activeIndex)}%`}} role="status">
          <small>{trendDateLabel(dates[activeIndex])}</small>
          <ul>{[...series].filter(s=>s.values[activeIndex!]!=null).sort((a,b)=>b.values[activeIndex!]!-a.values[activeIndex!]!).map(s=><li key={s.player.id}><i style={{background:avatarHex(s.player.colour)}}/><span>{s.player.name}</span><em>{s.counts[activeIndex!]} 場</em><b>{Math.round(s.values[activeIndex!]!)}</b></li>)}</ul>
        </div>}
        <div className="multi-trend-endlabels" aria-hidden="true">{endLabels.map(({player,value,top})=><div key={player.id} className="multi-trend-endlabel" style={{left:`${x(lastIndex)}%`,top:`${top}%`,color:avatarHex(player.colour)}}><b>{narrow?player.short:player.name}</b><span>{Math.round(value)}</span></div>)}</div>
      </div>
      <div className="multi-trend-xaxis">{xTickIndexes.map(i=><span key={i} style={{left:`${x(i)}%`}}>{trendAxisDateLabel(dates[i])}</span>)}</div>
    </div>
    {legend}
    <p className="chart-summary">點按下方球員名稱可切換顯示；移至圖表可查看該日各球員的 ELO 及累積場數。目前顯示 {shownPlayers.length} 位球員，共 {dates.length} 個有賽事的日期。</p>
  </>;
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
      <Surface as="article" className="recent-chart-card recent-activity-chart"><header><div><small>ACTIVITY</small><h3>每週比賽走勢</h3></div><strong>{stats.matches.length}<small>場</small></strong></header><div className="recent-week-chart" aria-label={`過去四週比賽場數：${stats.weekCounts.join("、")}`}>{stats.weekCounts.map((value,index)=><div key={`week-${index}`}><span><i style={{height:`${Math.max(8,value/maxWeek*100)}%`}}/></span><b>{value}</b><small>第 {index+1} 週</small></div>)}</div></Surface>
      <Surface as="article" className="recent-chart-card recent-outcome-chart"><header><div><small>OUTCOMES</small><h3>賽事結果分布</h3></div></header><div className="recent-donut-wrap"><div className="recent-donut" style={{"--decisive":`${stats.decisive/stats.matches.length*360}deg`} as Record<string,string>}><span><b>{Math.round(stats.decisive/stats.matches.length*100)}%</b><small>分勝負</small></span></div><div className="recent-chart-legend"><span><i className="decisive"/><b>分勝負</b><em>{stats.decisive} 場</em></span><span><i className="draw"/><b>和局</b><em>{stats.draws} 場</em></span></div></div></Surface>
      <Surface as="article" className="recent-chart-card recent-balance-chart"><header><div><small>COMPETITION</small><h3>對賽緊湊度</h3></div></header><div className="recent-balance-hero"><b>{Math.round(stats.closeMatches/stats.matches.length*100)}<small>%</small></b><span>賽事僅相差一局或以下</span></div><footer><span>緊湊賽事 <b>{stats.closeMatches}</b></span><span>平均差距 <b>{stats.averageMargin.toFixed(1)} 局</b></span></footer></Surface>
    </div>
    <div className="recent-detail-grid">
      {stats.rivalry&&<Surface as="button" className="recent-detail-card" onClick={()=>onRivalry(stats.rivalry!.aPlayer,stats.rivalry!.bPlayer)} aria-label={`查看 ${stats.rivalry.aPlayer.name} 對 ${stats.rivalry.bPlayer.name} 的對賽紀錄`}><small>熱門對賽</small><b>{stats.rivalry.aPlayer.name} × {stats.rivalry.bPlayer.name}</b><p>{stats.rivalry.matches} 場 · 局數 {stats.rivalry.framesA}–{stats.rivalry.framesB}</p><span>查看對賽紀錄 →</span></Surface>}
      {stats.closest&&<Surface as="button" className="recent-detail-card recent-close-card" onClick={()=>onMatch(stats.closest!)} aria-label={`查看 ${playerName(stats.closest.a)} 對 ${playerName(stats.closest.b)} 的賽事`}><small>最接近賽事</small><b>{playerName(stats.closest.a)} {stats.closest.scoreA}–{stats.closest.scoreB} {playerName(stats.closest.b)}</b><p>{stats.closest.playedOn} · 相差 {Math.abs(stats.closest.scoreA-stats.closest.scoreB)} 局</p><span>查看賽事 →</span></Surface>}
    </div>  </section>;
}
function fadeHex(hex:string,alpha:number){
  const value=hex.replace("#","");
  const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* Projected win rate assumes a level match — no handicap, no frame evidence yet — so it
   reduces to the bare ELO-gap probability the formula already produces for match previews.
   Reusing calculateSnookerElo (rather than a second formula) keeps this in lockstep with
   whatever the club tunes the real rating curve to. */
function projectedWinRate(ratingA:number,ratingB:number,s:Settings){
  return calculateSnookerElo({
    ratingA, ratingB, handicapA:0, framesA:0, framesB:0,
    handicapEloScale:s.handicapEloScale, handicapEloPerPoint:HANDICAP_ELO_PER_POINT, handicapEffectiveness:1,
  }).probabilityA*100;
}
/* Diverging heat scale centred on the coin-flip: favoured players warm the brand green,
   underdogs warm the same red used for "behind" elsewhere, intensity tracking distance
   from 50/50 so a 51% toss-up reads as flat as the legend promises. */
function winRateHeat(rate:number){
  const diff=(rate-50)/50;
  const intensity=Math.min(1,Math.abs(diff));
  const hex=diff>=0?"#155e52":"#ad5149";
  return {background:fadeHex(hex,.1+intensity*.55),color:intensity>.62?"#fff":undefined};
}

const monthGroupLabel=(month:string)=>{
  const [y,m]=month.split("-").map(Number);
  const now=new Date(),thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  if(month===thisMonth)return "本月";
  const last=shiftMonth(thisMonth,-1);
  if(month===last)return "上月";
  return `${y}年${m}月`;
};

/* Every pair that has ever met, keyed by the two ids in a stable order, so a
   meeting counts the same whichever way round it was recorded. Any singles
   match counts — regular 1v1 and cup ties alike — since both are individual
   head-to-head results; only 2v2 team matches are excluded. */
type H2HRecord={wins:Record<string,number>;draws:number;frames:Record<string,number>;total:number;last:string};
function headToHeadIndex(matches:Match[]){
  const index=new Map<string,H2HRecord>();
  for(const match of matches){
    if(match.status!=="confirmed"||isEntertainmentMode(match.mode)||matchMode(match)==="2v2")continue;
    const [first,second]=[match.a,match.b].sort();
    if(!first||!second||first===second)continue;
    const key=`${first}|${second}`;
    const record=index.get(key)??{wins:{[first]:0,[second]:0},draws:0,frames:{[first]:0,[second]:0},total:0,last:""};
    const scoreFirst=match.a===first?match.scoreA:match.scoreB;
    const scoreSecond=match.a===first?match.scoreB:match.scoreA;
    record.frames[first]+=scoreFirst;
    record.frames[second]+=scoreSecond;
    if(scoreFirst>scoreSecond)record.wins[first]++;else if(scoreSecond>scoreFirst)record.wins[second]++;else record.draws++;
    record.total++;
    if(match.playedOn>record.last)record.last=match.playedOn;
    index.set(key,record);
  }
  return index;
}
const h2hKey=(first:string,second:string)=>[first,second].sort().join("|");

/* The club kept asking "how do I stand against everyone?" and the only answer
   was to pick opponents one at a time in the filter bar. This is the index for
   that: every cell is a tap through to the existing head-to-head view, which
   stays the one place a rivalry is read in full.

   Phone-first, so the *list* is the primary shape — one focused player, one row
   per opponent, no horizontal scrolling and full-width tap targets. The grid is
   the same data for anyone with the width for it, and is reachable on a phone
   too (it scrolls sideways under a pinned name column). */
/* A full-roster grid or heatmap runs wide fast — panning with two thumbs works but nobody
   discovers it unassisted. Explicit +/- controls (with a tap-to-reset percentage) give the
   same shrink-to-fit-more/grow-to-read power without relying on a gesture the toolbar can't
   hint at. Scaling through a CSS variable — not a transform — keeps position:sticky headers
   and row names working exactly as before, just at a different rem size. */
const MATRIX_ZOOM_MIN=.7,MATRIX_ZOOM_MAX=1.8,MATRIX_ZOOM_STEP=.15;
function MatrixZoomControls({zoom,setZoom}:{zoom:number;setZoom:(value:number)=>void}){
  const clamp=(value:number)=>Math.min(MATRIX_ZOOM_MAX,Math.max(MATRIX_ZOOM_MIN,Math.round(value*100)/100));
  return <div className="h2h-matrix-zoom" role="group" aria-label="矩陣縮放">
    <IconButton label="縮小矩陣" onClick={()=>setZoom(clamp(zoom-MATRIX_ZOOM_STEP))} disabled={zoom<=MATRIX_ZOOM_MIN}>－</IconButton>
    <button type="button" className="h2h-matrix-zoom-value" onClick={()=>setZoom(1)} aria-label="重設縮放至 100%">{Math.round(zoom*100)}%</button>
    <IconButton label="放大矩陣" onClick={()=>setZoom(clamp(zoom+MATRIX_ZOOM_STEP))} disabled={zoom>=MATRIX_ZOOM_MAX}>＋</IconButton>
  </div>;
}
function HeadToHeadMatrix({data,ownPlayerId,onOpenPair}:{data:AppState;ownPlayerId?:string;onOpenPair:(first:string,second:string)=>void}){
  const index=useMemo(()=>headToHeadIndex(data.matches),[data.matches]);
  // Only players who have actually met somebody: an all-players grid is mostly
  // empty cells, and empty cells are the enemy of a readable matrix.
  const players=useMemo(()=>{
    const met=new Set<string>();
    for(const key of index.keys()){const [first,second]=key.split("|");met.add(first);met.add(second)}
    return data.players.filter(player=>met.has(player.id)).sort((left,right)=>right.rating-left.rating||left.name.localeCompare(right.name,"zh-HK"));
  },[data.players,index]);
  const [mode,setMode]=useState<"list"|"grid"|"heatmap">("list");
  const [zoom,setZoom]=useState(1);
  const [focusId,setFocusId]=useState("");
  const focus=players.find(player=>player.id===focusId)
    ??players.find(player=>player.id===ownPlayerId)
    ??players[0];
  const rows=useMemo(()=>{
    if(!focus)return [];
    return players
      .filter(player=>player.id!==focus.id)
      .map(opponent=>({opponent,record:index.get(h2hKey(focus.id,opponent.id))}))
      .filter((row):row is {opponent:Player;record:H2HRecord}=>Boolean(row.record))
      .sort((left,right)=>right.record.total-left.record.total||right.record.last.localeCompare(left.record.last));
  },[players,index,focus]);
  const totals=rows.reduce((sum,row)=>{
    sum.played+=row.record.total;
    sum.wins+=row.record.wins[focus!.id];
    sum.losses+=row.record.total-row.record.wins[focus!.id]-row.record.draws;
    return sum;
  },{played:0,wins:0,losses:0});
  if(!focus)return <Empty text="尚未有對賽記錄" sub="記錄第一場 1v1 比賽後，球員之間的對賽矩陣會顯示在這裡。"/>;
  const shareOf=(record:H2HRecord,id:string)=>Math.round((record.wins[id]+record.draws/2)/Math.max(1,record.total)*100);
  const frameShareOf=(record:H2HRecord,id:string,otherId:string)=>Math.round(record.frames[id]/Math.max(1,record.frames[id]+record.frames[otherId])*100);
  return <section className="h2h-matrix" aria-label="對賽矩陣" style={{"--matrix-zoom":mode==="list"?1:zoom} as CSSProperties}>
    <div className="h2h-matrix-toolbar">
      <div className="h2h-matrix-focus">
        <span className="match-filter-label">球員</span>
        <div className="match-player-picker">
          <PlayerCombobox players={players} value={focus.id} onChange={id=>{if(id)setFocusId(id)}} placeholder="選擇球員" ariaLabel="對賽矩陣主角球員"/>
        </div>
      </div>
      <div className="h2h-matrix-modes-row">
        <div className="h2h-matrix-modes"><SegmentedControl label="對賽矩陣顯示方式" value={mode} onChange={value=>setMode(value as typeof mode)} items={[{value:"list",label:"清單"},{value:"grid",label:"全隊網格"},{value:"heatmap",label:"勝率預測"}]}/></div>
        {mode!=="list"&&<MatrixZoomControls zoom={zoom} setZoom={setZoom}/>}
      </div>
    </div>
    {mode==="heatmap"?<WinRateHeatmap players={players} settings={data.settings} focusId={focus.id} onOpenPair={onOpenPair}/>
    :mode==="list"?<>
      <div className="h2h-matrix-summary">
        <div><small>對手</small><b>{rows.length}</b></div>
        <div><small>對賽場數</small><b>{totals.played}</b></div>
        <div><small>勝負</small><b>{totals.wins}<em>–</em>{totals.losses}</b></div>
      </div>
      {rows.length===0
        ? <Empty text="這位球員未有 1v1 對賽記錄" sub="記錄一場 1v1 比賽後，對手就會在這裡出現。"/>
        : <ul className="h2h-matrix-rows">{rows.map(({opponent,record})=>{
            const share=shareOf(record,focus.id);
            const losses=record.total-record.wins[focus.id]-record.draws;
            return <li key={opponent.id}>
              <button type="button" onClick={()=>onOpenPair(focus.id,opponent.id)} aria-label={`查看 ${focus.name} 對 ${opponent.name} 的對賽紀錄，${record.wins[focus.id]} 勝 ${losses} 負`}>
                <PlayerBadge player={opponent}/>
                <span className="h2h-matrix-row-main">
                  <b>{opponent.name}</b>
                  <small>{record.total} 場 · 局數 {record.frames[focus.id]}–{record.frames[opponent.id]} · 最近 {record.last||"—"}</small>
                  <i className="h2h-matrix-bar" aria-hidden="true"><em style={{width:`${share}%`,background:fadeHex(avatarHex(focus.colour),share<50?.38:1)}}/></i>
                </span>
                <span className={`h2h-matrix-score ${share>50?"ahead":share<50?"behind":"level"}`}>
                  <b>{record.wins[focus.id]}<em>–</em>{losses}</b>
                  {record.draws>0&&<small>{record.draws} 和</small>}
                </span>
              </button>
            </li>;
          })}</ul>}
    </>:<>
      <p className="h2h-matrix-hint">橫行為該球員的局數勝負，向右捲動可看更多對手。</p>
      <div className="h2h-matrix-scroll">
        <table className="h2h-matrix-grid">
          <caption className="sr-only">球員之間的 1v1 對賽局數勝負矩陣，橫行球員對直行球員</caption>
          <thead><tr><th scope="col"><span className="sr-only">球員</span></th>{players.map(player=><th key={player.id} scope="col" title={player.name}>{player.short||player.name.slice(0,2)}</th>)}</tr></thead>
          <tbody>{players.map(row=><tr key={row.id} className={row.id===focus.id?"focused":""}>
            <th scope="row"><span className="h2h-matrix-rowhead"><PlayerBadge player={row}/><span>{row.short||row.name}</span></span></th>
            {players.map(column=>{
              if(column.id===row.id)return <td key={column.id} className="self" aria-label="同一位球員">—</td>;
              const record=index.get(h2hKey(row.id,column.id));
              if(!record)return <td key={column.id} className="none" aria-label={`${row.name} 與 ${column.name} 未曾交手`}>·</td>;
              const share=frameShareOf(record,row.id,column.id);
              const framesWon=record.frames[row.id],framesLost=record.frames[column.id];
              return <td key={column.id} className={share>50?"ahead":share<50?"behind":"level"}>
                <button type="button" onClick={()=>onOpenPair(row.id,column.id)} aria-label={`${row.name} 對 ${column.name}：局數 ${framesWon} 勝 ${framesLost} 負，共 ${record.total} 場`}>
                  <b>{framesWon}<em>–</em>{framesLost}</b>
                </button>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="h2h-matrix-legend"><span><i className="ahead"/>領先</span><span><i className="level"/>均勢</span><span><i className="behind"/>落後</span><span><i className="none"/>未交手</span></div>
    </>}
  </section>;
}

/* "誰打得贏誰" as a straight-up ELO question, with the handicap that would actually be
   applied on the night stripped out — the same probabilityA the match form previews,
   read off every pair at once instead of one at a time. A diverging heat scale (green
   favourite, red underdog, white toss-up) turns 排名 into a shape you can scan instead of
   a column of numbers. */
function WinRateHeatmap({players,settings,focusId,onOpenPair}:{players:Player[];settings:Settings;focusId:string;onOpenPair:(first:string,second:string)=>void}){
  if(players.length<2)return <Empty text="尚未有足夠對賽記錄" sub="至少兩位球員記錄過 1v1 比賽後，勝率預測矩陣會顯示在這裡。"/>;
  return <>
    <p className="h2h-matrix-hint">假設沒有讓分，橫行球員對直行球員的預測勝率；顏色越深代表優勢越大。</p>
    <div className="h2h-matrix-scroll">
      <table className="h2h-matrix-grid h2h-heatmap">
        <caption className="sr-only">球員之間的無讓分預測勝率矩陣，橫行球員對直行球員</caption>
        <thead><tr><th scope="col"><span className="sr-only">球員</span></th>{players.map(player=><th key={player.id} scope="col" title={player.name}>{player.short||player.name.slice(0,2)}</th>)}</tr></thead>
        <tbody>{players.map(row=><tr key={row.id} className={row.id===focusId?"focused":""}>
          <th scope="row"><span className="h2h-matrix-rowhead"><PlayerBadge player={row}/><span>{row.short||row.name}</span></span></th>
          {players.map(column=>{
            if(column.id===row.id)return <td key={column.id} className="self" aria-label="同一位球員">—</td>;
            const rate=Math.round(projectedWinRate(row.rating,column.rating,settings));
            return <td key={column.id} style={winRateHeat(rate)}>
              <button type="button" onClick={()=>onOpenPair(row.id,column.id)} aria-label={`假設沒有讓分，${row.name} 對 ${column.name} 的預測勝率為 ${rate}%`}>
                <b>{rate}%</b>
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="h2h-matrix-legend h2h-heatmap-legend">
      <span><i style={winRateHeat(85)}/>大熱門</span>
      <span><i style={winRateHeat(50)}/>勢均力敵</span>
      <span><i style={winRateHeat(15)}/>大冷門</span>
    </div>
  </>;
}

function Matches({data,canManageMatch,canManageCup,onEdit,onVoid,onShare,onPlayer,view,setView,pair,setPair,highlight,isAdmin,onCreateTournament,onEditTournament,onDeleteTournament,ownPlayerId,onSignUpTournament,onSetArrivalTime,onRecordSlot,onArrange,onWalkover,onEditRoster,onShuffleRoster,onReorderRoster,onRefresh}:{data:AppState;canManageMatch:(match:Match)=>boolean;canManageCup:(tournament:Tournament)=>boolean;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void;onPlayer:(player:Player)=>void;view:"history"|"calendar"|"cup"|"matrix";setView:(view:"history"|"calendar"|"cup"|"matrix")=>void;pair:{a:string;b:string};setPair:(pair:{a:string;b:string})=>void;highlight:string|null;isAdmin:boolean;onCreateTournament:()=>void;onEditTournament:(tournament:Tournament)=>void;onDeleteTournament:(tournament:Tournament)=>void;ownPlayerId?:string;onSignUpTournament:(id:string,arrivalTime?:string)=>void;onSetArrivalTime:(tournamentId:string,arrivalTime:string)=>void;onRecordSlot:(tournament:Tournament,slot:BracketSlot<Match>)=>void;onArrange:(opponentId:string)=>void;onWalkover:(tournament:Tournament,slot:BracketSlot<Match>,winnerId:string)=>void;onEditRoster:(tournament:Tournament,outgoingId:string,incomingId:string)=>void;onShuffleRoster:(tournament:Tournament)=>void;onReorderRoster:(tournament:Tournament,draggedId:string,targetId:string)=>void;onRefresh:()=>void}) {
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
  const matches=useMemo(()=>{
    const matchesMode=(match:Match)=>modeFilter==="all"||matchMode(match)===modeFilter;
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
  const headToHeadMatches=useMemo(
    ()=>matches.filter(match=>matchMode(match)!=="2v2").sort((left,right)=>right.playedOn.localeCompare(left.playedOn)||right.createdAt.localeCompare(left.createdAt)),
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
  const openTournamentCount=data.tournaments.filter(tournament=>!signupsClosed(tournament)).length;
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
    <SlidingToggleGroup className="page-tabs match-view-toggle" role="tablist" aria-label="比賽資料檢視"><button role="tab" aria-selected={view==="history"} className={view==="history"?"active":""} onClick={()=>setView("history")}>賽事記錄</button><button role="tab" aria-selected={view==="calendar"} className={view==="calendar"?"active":""} onClick={()=>setView("calendar")}>日曆</button><button role="tab" aria-selected={view==="matrix"} className={view==="matrix"?"active":""} onClick={()=>setView("matrix")}>對賽矩陣</button><button role="tab" aria-selected={view==="cup"} aria-label={`盃賽${openTournamentCount>0?`，${openTournamentCount} 個盃賽開放報名`:""}`} className={view==="cup"?"active":""} onClick={()=>setView("cup")}>盃賽{openTournamentCount>0&&<span className="match-tab-count" aria-hidden="true">{openTournamentCount>9?"9+":openTournamentCount}</span>}</button></SlidingToggleGroup>
    {view==="matrix"?<HeadToHeadMatrix data={data} ownPlayerId={ownPlayerId} onOpenPair={(first,second)=>{setPair({a:first,b:second});setModeFilter("all");setView("history")}}/> : view==="calendar"?<CalendarView data={data} canManageMatch={canManageMatch} onPlayer={onPlayer} onEdit={onEdit} onVoid={onVoid} onShare={onShare}/> : view==="cup" ? <CupBracketView data={data} selectedTournament={selectedTournament} setSelectedTournament={setSelectedTournament} canManageMatch={canManageMatch} canManageCup={canManageCup} onEdit={onEdit} isAdmin={isAdmin} onCreateTournament={onCreateTournament} onEditTournament={onEditTournament} onDeleteTournament={onDeleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={onSignUpTournament} onSetArrivalTime={onSetArrivalTime} onRecordSlot={onRecordSlot} onArrange={onArrange} onWalkover={onWalkover} onEditRoster={onEditRoster} onShuffleRoster={onShuffleRoster} onReorderRoster={onReorderRoster} onRefresh={onRefresh}/> : <>
    <section className="match-filter-toolbar" aria-label="篩選及排序比賽記錄">
      <div className="match-filter-control player-control">
        <span className="match-filter-label">球員</span>
        <div className="match-player-picker">
          {a&&<span className="match-player-chip">{a.name}<IconButton label={`取消選擇 ${a.name}`} onClick={()=>setFocus("")}>×</IconButton></span>}
          {opponent&&<span className="match-player-chip compare">{opponent.name}<IconButton label={`取消比較 ${opponent.name}`} onClick={()=>setOpponent("")}>×</IconButton></span>}
          {!focusPlayer&&<PlayerCombobox players={roster} value="" onChange={setFocus} placeholder="全部球員" ariaLabel="球員"/>}
          {focusPlayer&&!opponent&&<PlayerCombobox players={roster.filter(p=>p.id!==focusPlayer)} value="" onChange={setOpponent} placeholder="＋ 比較球員" ariaLabel="選擇比較球員"/>}
        </div>
      </div>
      <div className="match-filter-control type-control sort-control">
        <span className="match-filter-label">類型</span>
        <select aria-label="比賽類型" value={modeFilter} onChange={event=>setModeFilter(event.target.value as "all"|MatchMode)}>
          <option value="all">全部</option>
          <option value="1v1">1v1</option>
          <option value="2v2">2v2</option>
          <option value="cup">盃賽</option>
        </select>
      </div>
      <div className="match-filter-control sort-control"><span className="match-filter-label">排序</span><div className="match-sort-compact"><select aria-label="排序依據" value={sortBy} onChange={event=>setSortBy(event.target.value as "playedOn"|"createdAt")}><option value="playedOn">比賽日期</option><option value="createdAt">加入日期</option></select><button type="button" aria-label={sortDirection==="desc"?"目前最新至最舊；按下改為最舊至最新":"目前最舊至最新；按下改為最新至最舊"} title={sortDirection==="desc"?"最新至最舊":"最舊至最新"} onClick={()=>setSortDirection(value=>value==="desc"?"asc":"desc")}>{sortDirection==="desc"?"↓":"↑"}</button></div></div>
    </section>
    {(focusPlayer||modeFilter!=="all")&&<div className="match-filter-status"><span>{matches.length} 場符合記錄</span><Button variant="quiet" onClick={clearAll}>清除篩選</Button></div>}    {comparing&&a&&opponent&&h2hStats&&<div className="h2h-summary neutral">
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
      const cards=group.matches.map(m=><MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} onShare={onShare} highlighted={m.id===highlight}/>);
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

type CupStatus="signup"|"live"|"done"|"short";
function cupStatus(tournament:Tournament,matches:Match[]):CupStatus{
  if(!signupsClosed(tournament))return "signup";
  const bracket=buildBracket<Match>(tournament,matches);
  if(!bracket.size)return "short";
  return bracket.champion?"done":"live";
}
const CUP_STATUS_LABEL:Record<CupStatus,string>={signup:"報名中",live:"進行中",done:"已完成",short:"人數不足"};

/* The trophy plate every cup card and banner wears. Pure decoration — an empty bracket used to look
   identical to a live one, and a competition should not look like a spreadsheet. */
function CupArt({tone="dark"}:{tone?:"dark"|"gold"}){
  return <div className={`cup-art ${tone}`} aria-hidden="true">
    <span className="cup-art-cup">🏆</span>
    <i className="cup-art-ball red"/><i className="cup-art-ball white"/><i className="cup-art-arc"/>
  </div>;
}

const ARRIVAL_HOURS=Array.from({length:24},(_,i)=>String(i).padStart(2,"0"));
const ARRIVAL_MINUTES=["00","05","10","15","20","25","30","35","40","45","50","55"];
/** `startAt` shifted by `minutesOffset`, wrapping across midnight — used for the "提早/準時/遲到"
    presets, which are all read relative to a cup's own start time rather than the clock. */
function shiftHHMM(base:string,minutesOffset:number):string {
  const [hour,minute]=base.split(":").map(Number);
  const total=(((hour*60+minute+minutesOffset)%1440)+1440)%1440;
  return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
}
/** A pair of native selects standing in for `<input type="time">`. Selects have no intrinsic
    minimum-width quirk the way native date/time pickers do (most visibly on iOS Safari), so this
    is the one control in the app guaranteed to stay inside its container at any width — and its
    scroll-wheel-like feel reads more native on a phone than typing into a text-ish time field. */
function TimeOfDayPicker({hour,minute,onHour,onMinute}:{hour:string;minute:string;onHour:(value:string)=>void;onMinute:(value:string)=>void}){
  return <div className="time-of-day-picker">
    <select aria-label="小時" value={hour} onChange={event=>onHour(event.target.value)}>{ARRIVAL_HOURS.map(h=><option key={h} value={h}>{h}</option>)}</select>
    <span aria-hidden="true">:</span>
    <select aria-label="分鐘" value={minute} onChange={event=>onMinute(event.target.value)}>{ARRIVAL_MINUTES.map(m=><option key={m} value={m}>{m}</option>)}</select>
  </div>;
}

/* Everything after the deadline used to be a poster: the bracket appeared, and the only way to move
   it forward was to leave, open 記錄, and retype the round and match number of the box you had just
   been looking at. The cup view now owns the whole life of a cup — your own tie, recording it from
   the box itself, and the admin levers for the ties that never get played.

   Laid out phone-first: a horizontal bracket tree cannot fit 360px without either overflowing its
   container or shrinking names to nothing, so the tree is the *desktop* representation and the
   round-by-round list below is the primary one. Both read the same bracket. */
function CupBracketView({data,selectedTournament,setSelectedTournament,canManageMatch,canManageCup,onEdit,isAdmin,onCreateTournament,onEditTournament,onDeleteTournament,ownPlayerId,onSignUpTournament,onSetArrivalTime,onRecordSlot,onArrange,onWalkover,onEditRoster,onShuffleRoster,onReorderRoster,onRefresh}:{data:AppState;selectedTournament:string;setSelectedTournament:(id:string)=>void;canManageMatch:(match:Match)=>boolean;canManageCup:(tournament:Tournament)=>boolean;onEdit:(match:Match)=>void;isAdmin:boolean;onCreateTournament:()=>void;onEditTournament:(tournament:Tournament)=>void;onDeleteTournament:(tournament:Tournament)=>void;ownPlayerId?:string;onSignUpTournament:(id:string,arrivalTime?:string)=>void;onSetArrivalTime:(tournamentId:string,arrivalTime:string)=>void;onRecordSlot:(tournament:Tournament,slot:BracketSlot<Match>)=>void;onArrange:(opponentId:string)=>void;onWalkover:(tournament:Tournament,slot:BracketSlot<Match>,winnerId:string)=>void;onEditRoster:(tournament:Tournament,outgoingId:string,incomingId:string)=>void;onShuffleRoster:(tournament:Tournament)=>void;onReorderRoster:(tournament:Tournament,draggedId:string,targetId:string)=>void;onRefresh:()=>void}){
  const tournament=data.tournaments.find(item=>item.id===selectedTournament);
  const player=useCallback((id:string)=>data.players.find(item=>item.id===id),[data.players]);
  const name=(id:string)=>player(id)?.name??"待定";
  const deadlineText=(value:string)=>formatTournamentDateTime(value);
  const deadlinePassed=Boolean(tournament&&signupsClosed(tournament));
  const drawn=Boolean(tournament?.draw?.length);
  const canManage=Boolean(tournament&&canManageCup(tournament));
  const signedUp=Boolean(ownPlayerId&&(tournament?.signups||[]).includes(ownPlayerId));
  const bracket=useMemo(()=>tournament?buildBracket<Match>(tournament,data.matches):null,[tournament,data.matches]);
  const mySlot=bracket?playerSlot(bracket,ownPlayerId):undefined;
  const eliminated=bracket?playerEliminated(bracket,ownPlayerId):false;
  const champion=bracket?.champion??"";
  /* Flattened for the shared chart, which the public share page renders from its own serialised
     data — the drawing lives in one component, and each side hands it seats. */
  const chart=useMemo<BracketChartData|null>(()=>{
    if(!bracket?.rounds)return null;
    return {
      rounds:Array.from({length:bracket.rounds},(_,index)=>({
        round:index+1,name:roundLabel(index+1,bracket.rounds),
        nodes:bracket.slots.filter(slot=>slot.round===index+1).map(slot=>({
          index:slot.index,state:slot.state,
          mine:Boolean(ownPlayerId&&(slot.a===ownPlayerId||slot.b===ownPlayerId)),
          date:slot.match?.playedOn??"",
          seats:[slot.a,slot.b].map(id=>({
            player:id?player(id)??{short:"?"}:null,
            score:slot.match&&id?Number(scoreFor(slot.match,id)):null,
            won:Boolean(slot.winner&&slot.winner===id),
          })),
        })),
      })),
      champion:bracket.champion?player(bracket.champion)??{short:"?"}:null,
    };
  },[bracket,ownPlayerId,player]);
  const [openRound,setOpenRound]=useState(1);
  /* Which roster row is mid-drag and which one it is currently poised over — purely visual state,
     reset the moment the drag ends one way or another so a stale highlight can never survive it. */
  const [dragRosterId,setDragRosterId]=useState("");
  const [dragOverRosterId,setDragOverRosterId]=useState("");
  /* HTML5 drag-and-drop has no touch backend, so it's silently inert on the PWA/mobile browsers
     the club actually reorders draws from — this reimplements the same gesture by hand from the
     handle's touch events, tracking the finger with elementFromPoint instead of native drag events. */
  const touchDragId=useRef("");
  const touchOverId=useRef("");
  const onRosterHandleTouchStart=(id:string)=>()=>{
    touchDragId.current=id;
    touchOverId.current="";
    setDragRosterId(id);
  };
  const onRosterHandleTouchMove=(event:ReactTouchEvent)=>{
    if(!touchDragId.current)return;
    event.preventDefault();
    const touch=event.touches[0];
    const el=document.elementFromPoint(touch.clientX,touch.clientY);
    const row=el?.closest<HTMLElement>("[data-roster-id],[data-drag-player-id]");
    const rowId=row?.dataset.rosterId??row?.dataset.dragPlayerId;
    const overId=rowId&&rowId!==touchDragId.current?rowId:"";
    touchOverId.current=overId;
    setDragOverRosterId(overId);
  };
  const onRosterHandleTouchEnd=(tournamentForDrop:Tournament)=>()=>{
    if(touchDragId.current&&touchOverId.current){
      onReorderRoster(tournamentForDrop,touchDragId.current,touchOverId.current);
    }
    touchDragId.current="";
    touchOverId.current="";
    setDragRosterId("");
    setDragOverRosterId("");
  };
  /* Both entering and leaving a cup are one-tap actions with real consequences — a missed 報名 window
     doesn't reopen, and a careless 取消報名 drops your seat in a bracket that may already be filling
     up — so each gets a confirmation naming the cup, not a silent toggle. */
  const [pendingSignup,setPendingSignup]=useState<{id:string;name:string;joined:boolean}|null>(null);
  const [signupArrivalOn,setSignupArrivalOn]=useState(false);
  const [signupArrivalHour,setSignupArrivalHour]=useState("18");
  const [signupArrivalMinute,setSignupArrivalMinute]=useState("00");
  const startAtTime=tournament?.startAt&&tournament.startAt.length>=16?tournament.startAt.slice(11,16):null;
  const [arrivalPanelOpen,setArrivalPanelOpen]=useState(false);
  const [arrivalCustomOpen,setArrivalCustomOpen]=useState(false);
  const [arrivalCustomHour,setArrivalCustomHour]=useState("18");
  const [arrivalCustomMinute,setArrivalCustomMinute]=useState("00");
  // Closes both panels across a tournament switch, so neither lingers open against a different
  // cup's presets/start time than the one it was opened for.
  useEffect(()=>{setArrivalPanelOpen(false);setArrivalCustomOpen(false)},[selectedTournament]);
  const confirmSignupDialog=pendingSignup&&<ConfirmDialog kicker={pendingSignup.joined?"取消報名":"確認報名"} titleId="cup-signup-confirm-title"
    title={pendingSignup.joined?`確定取消「${pendingSignup.name}」的報名？`:`確定報名參加「${pendingSignup.name}」？`}
    description={pendingSignup.joined?"取消後可重新報名，但截止後就無法再加入。":"截止前都可以隨時取消報名；報名後仍可隨時更改預計到達時間。"}
    onClose={()=>setPendingSignup(null)}
    extra={!pendingSignup.joined&&<div className="cup-arrival-toggle-block">
      {/* Optional and skippable — a member can always add or change it later from the cup page, so
          this is a convenience offered at the moment it's top of mind, never a gate on signing up. */}
      <div className="cup-arrival-toggle-row" role="switch" aria-checked={signupArrivalOn} aria-label="分享預計到達時間" tabIndex={0}
        onClick={()=>setSignupArrivalOn(value=>!value)}
        onKeyDown={event=>{if(event.key===" "||event.key==="Enter"){event.preventDefault();setSignupArrivalOn(value=>!value)}}}>
        <div className="cup-arrival-toggle-copy"><b>分享預計到達時間</b><small>可選 — 讓其他球員知道你大約幾點到場。</small></div>
        <span className={`toggle-switch${signupArrivalOn?" on":""}`} aria-hidden="true"><i/></span>
      </div>
      {signupArrivalOn&&<div className="cup-arrival-field">
        <span>預計到達時間</span>
        <TimeOfDayPicker hour={signupArrivalHour} minute={signupArrivalMinute} onHour={setSignupArrivalHour} onMinute={setSignupArrivalMinute}/>
      </div>}
    </div>}>
    <Button variant="secondary" onClick={()=>setPendingSignup(null)}>返回</Button>
    <Button variant={pendingSignup.joined?"danger":"primary"} onClick={()=>{const id=pendingSignup.id,joined=pendingSignup.joined,arrivalTime=signupArrivalOn?`${signupArrivalHour}:${signupArrivalMinute}`:"";setPendingSignup(null);setSignupArrivalOn(false);onSignUpTournament(id,joined?undefined:(arrivalTime||undefined))}}>{pendingSignup.joined?"確定取消":"確定報名"}</Button>
  </ConfirmDialog>;
  /* Tapping a node in the overview has to *land* somewhere, or the map is just decoration: it opens
     that round and scrolls its card into view, flashing it so the eye finds it after the jump. */
  const [focusTie,setFocusTie]=useState("");
  useEffect(()=>{
    if(!focusTie)return;
    const card=document.getElementById(`cup-tie-${focusTie}`);
    card?.scrollIntoView({behavior:"smooth",block:"center"});
    const timer=setTimeout(()=>setFocusTie(""),1600);
    return ()=>clearTimeout(timer);
  },[focusTie]);
  /* Follow the competition rather than reset to 八強 every visit: the round worth reading is the one
     still being played — or the member's own, if they are in it. */
  useEffect(()=>{
    if(!bracket?.rounds)return;
    const live=bracket.slots.find(slot=>slot.state==="ready"||slot.state==="waiting");
    setOpenRound(mySlot?.round??live?.round??bracket.rounds);
  },[bracket,mySlot]);

  /* The draw is frozen server-side, and whichever member opens the cup first after the deadline is
     what triggers it — no cron, no admin ceremony. The ref keeps a re-render from firing a second
     request; the route itself is idempotent, so a genuine race just gets the same draw back. */
  const drawRequested=useRef<string>("");
  useEffect(()=>{
    if(!tournament||!deadlinePassed||drawn||(tournament.signups?.length??0)<2)return;
    if(drawRequested.current===tournament.id)return;
    drawRequested.current=tournament.id;
    fetch(`/api/tournaments/${tournament.id}/draw`,{method:"POST"})
      .then(response=>{if(response.ok)onRefresh()})
      .catch(()=>{});
  },[tournament,deadlinePassed,drawn,onRefresh]);

  /* Sharing a cup is the app's best word-of-mouth moment: the link lands in the club's WhatsApp
     group, where most of the members who have never opened the app already are. The native sheet
     goes first on a phone (WhatsApp is the first row for most of them), wa.me is the desktop path. */
  const shareStateOf=(item:Tournament)=>{
    const itemBracket=buildBracket<Match>(item,data.matches);
    return cupShareState({
      signupDeadline:item.signupDeadline,entrants:item.signups?.length??0,closed:signupsClosed(item),
      drew:Boolean(itemBracket.size),
      roundName:currentRoundLabel(itemBracket),
      championName:itemBracket.champion?name(itemBracket.champion):"",
    });
  };
  const shareCup=async(item:Tournament)=>{
    const state=shareStateOf(item);
    const url=cupShareUrl(window.location.origin,item.id);
    const message=cupShareMessage(item.name,state,url);
    if(navigator.share){
      try{ await navigator.share({title:item.name,text:message}); return; }catch{ /* dismissed */ }
    }
    window.open(whatsappLink(message),"_blank","noopener");
  };
  /* Named for where the tap lands and what it is for. 「分享」 described the mechanism; while a cup is
     recruiting the button's actual job is to put another member in the draw, and a button that says
     so is pressed by people who would not have pressed the other one. */
  const shareButton=(item:Tournament,className="cup-btn ghost",compact=false)=>{
    const state=shareStateOf(item);
    const cta=cupShareCta(state);
    return <button type="button" className={`${className} wa-btn`} onClick={()=>void shareCup(item)} aria-label={cta.label}>
      <ShareGlyph kind="whatsapp"/>
      <span>{compact?(state.status==="signup"?"叫人報名":"分享"):cta.label}</span>
    </button>;
  };

  const controls=(item:Tournament)=><span className="cup-admin"><IconButton className="cup-admin-btn" label={`編輯 ${item.name}`} onClick={()=>onEditTournament(item)}>✎</IconButton>{isAdmin&&<IconButton className="cup-admin-btn danger" label={`刪除 ${item.name}`} onClick={()=>onDeleteTournament(item)}>✕</IconButton>}</span>;
  const avatarStack=(ids:string[])=><span className="cup-avatars">{ids.slice(0,5).map(id=><PlayerBadge key={id} player={player(id)??{short:"?"}}/>)}{ids.length>5&&<i>+{ids.length-5}</i>}</span>;

  if(!selectedTournament){
    const cups=[...data.tournaments].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
    const cupEntries=cups.map(item=>({item,status:cupStatus(item,data.matches)}));
    const cupSections=[
      {id:"active",label:"報名中／進行中賽事",entries:cupEntries.filter(entry=>entry.status!=="done")},
      {id:"done",label:"已完成賽事",entries:cupEntries.filter(entry=>entry.status==="done")},
    ].filter(section=>section.entries.length>0);
    return <section className="cup">
      <div className="cup-intro">
        <div><p className="sl-eyebrow">SCAA 盃賽</p><h2>盃賽</h2><p>報名、抽籤、對陣同賽果，一頁睇晒。</p></div>
        {isAdmin&&<Button onClick={onCreateTournament}>＋ 新增盃賽</Button>}
      </div>
      {cups.length===0?<div className="cup-empty"><span aria-hidden="true">🏆</span><b>尚未有盃賽</b><p>{isAdmin?"建立第一個盃賽，球員即可報名。":"管理員建立盃賽後，你就可以在這裡報名。"}</p></div>
      :<div className="cup-sections">{cupSections.map(section=><section className="cup-section" aria-labelledby={`cup-section-${section.id}`} key={section.id}>
        <div className="cup-section-divider"><h3 id={`cup-section-${section.id}`}>{section.label}</h3></div>
        <div className="cup-list">{section.entries.map(({item,status})=>{
        const itemBracket=buildBracket<Match>(item,data.matches);
        const itemSlot=playerSlot(itemBracket,ownPlayerId),itemSignedUp=Boolean(ownPlayerId&&item.signups.includes(ownPlayerId));
        const line=item.startAt?`開始 ${deadlineText(item.startAt)} · ${status==="signup"?`報名截止 ${deadlineText(item.signupDeadline)}`:status==="done"?`冠軍 ${name(itemBracket.champion)}`:status==="short"?"報名人數不足兩人":itemSlot?`輪到你：${itemSlot.state==="ready"?`對 ${name(opponentIn(itemSlot,ownPlayerId))}`:"等待對手"}`:"賽事進行中"}`
          :status==="signup"?`報名截止 ${deadlineText(item.signupDeadline)}`
          :status==="done"?`冠軍 ${name(itemBracket.champion)}`
          :status==="short"?"報名人數不足兩人"
          :itemSlot?`輪到你：${itemSlot.state==="ready"?`對 ${name(opponentIn(itemSlot,ownPlayerId))}`:"等待對手"}`
          :"賽事進行中";
        return <Surface as="article" padded={false} className={`cup-card is-${status}`} key={item.id}>
          <CupArt tone={status==="done"?"gold":"dark"}/>
          <div className="cup-card-body">
            <div className="cup-card-top"><span className={`cup-chip is-${status}`}>{CUP_STATUS_LABEL[status]}</span>{canManageCup(item)&&controls(item)}</div>
            <h3>{item.name}</h3>
            <p className="cup-card-line">{line}</p>
            <div className="cup-card-people">{item.signups.length>0&&avatarStack(item.signups)}<span>{item.signups.length} 人報名</span></div>
            <div className="cup-card-actions">
              {status==="signup"&&(ownPlayerId
                ?<Button variant={itemSignedUp?"secondary":"primary"} className="cup-btn" onClick={()=>setPendingSignup({id:item.id,name:item.name,joined:itemSignedUp})}>{itemSignedUp?"取消報名":"立即報名"}</Button>
                :<a className="cup-btn primary" href="/login">登入後報名</a>)}
              <Button variant={status==="signup"?"secondary":"primary"} className="cup-btn" onClick={()=>setSelectedTournament(item.id)}>{status==="signup"?"睇對陣預覽":"賽程"}<span className="cup-btn-mark" aria-hidden="true">›</span></Button>
              {shareButton(item,"cup-btn ghost",true)}
            </div>
          </div>
        </Surface>;
      })}</div>
      </section>)}</div>}
      {confirmSignupDialog}
    </section>;
  }
  if(!tournament)return null;

  const status=cupStatus(tournament,data.matches);
  const total=bracket?bracket.slots.filter(slot=>slot.state!=="dead").length:0;
  const settled=bracket?bracket.slots.filter(slot=>slot.settled&&slot.state!=="dead").length:0;
  const stage=bracket?.slots.find(slot=>slot.state==="ready"||slot.state==="waiting");

  /* Once drawn, the list worth showing is the frozen draw. A completed cup may additionally carry
     a presentation order, but that order never feeds the bracket or its scorecards. */
  const rosterIds=drawn?rosterOrder(tournament):tournament.signups;
  /* Signups that landed after the draw was frozen: the bracket never re-syncs with `signups` once
     drawn (see rosterOrder's comment), so these members are registered but were left out of the
     draw. Surface them rather than let them quietly vanish from 參賽名單. */
  const lateSignups=drawn?tournament.signups.filter(id=>!rosterIds.includes(id)):[];
  const spare=data.players.filter(item=>item.active&&!rosterIds.includes(item.id)).sort((left,right)=>left.name.localeCompare(right.name));
  const rosterPick=(outgoingId:string)=>(event:ChangeEvent<HTMLSelectElement>)=>{
    const value=event.target.value;
    event.target.value="";
    if(value)onEditRoster(tournament,outgoingId,value);
  };
  /* Same two numbers the shared cup page quotes — ELO and the club's suggested handicap — so a
     member deciding whether to enter can see how beatable the field is without leaving the app. */
  const rosterStanding=(id:string)=>{
    const found=player(id);
    if(!found)return {rating:null as number|null,handicap:null as number|null};
    return {rating:Math.round(found.rating),handicap:Math.round(suggestedHandicap(found,data))};
  };
  const hasCupResults=cupMatches(data.matches,tournament.id).length>0;
  /* A live bracket remains protected, while a completed cup can reorder its roster presentation.
     The bracket's own drag targets still use canShuffle, because completed scorecards must stay in
     their original seats. */
  const canShuffle=canManage&&deadlinePassed&&rosterIds.length>=2&&!hasCupResults;
  const canArrangeRoster=canManage&&rosterIds.length>=2&&(status==="done"||(deadlinePassed&&!hasCupResults));
  const rosterPanel=rosterIds.length>0||canManage?<div className="cup-roster">
    <h3>{drawn?"參賽名單":"報名名單"} <span className="cup-roster-count">{rosterIds.length}</span>{canManage&&canShuffle&&<Button variant="secondary" className="cup-btn sm cup-roster-shuffle" onClick={()=>onShuffleRoster(tournament)}>重新抽籤</Button>}</h3>
    {lateSignups.length>0&&<InlineNotice tone="warning" title="報名時間在抽籤之後">{lateSignups.map(id=>name(id)).join("、")} 已報名，但抽籤時尚未報名，故未列入對陣圖。{canManage&&"如需加入，請使用下方「換上」功能替補至名單。"}</InlineNotice>}
    <ul className="rated">{rosterIds.map(id=>{
      const standing=rosterStanding(id);
      const draggable=canArrangeRoster;
      return <li key={id} draggable={draggable} data-roster-id={id}
        className={`${dragRosterId&&dragRosterId!==id&&dragOverRosterId===id?"drag-over":""}${dragRosterId===id?" dragging":""}`.trim()||undefined}
        onDragStart={draggable?event=>{setDragRosterId(id);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id)}:undefined}
        onDragOver={draggable&&dragRosterId&&dragRosterId!==id?event=>{event.preventDefault();setDragOverRosterId(id)}:undefined}
        onDragLeave={draggable&&dragOverRosterId===id?()=>setDragOverRosterId(""):undefined}
        onDrop={draggable&&dragRosterId&&dragRosterId!==id?event=>{event.preventDefault();onReorderRoster(tournament,dragRosterId,id);setDragRosterId("");setDragOverRosterId("")}:undefined}
        onDragEnd={draggable?()=>{setDragRosterId("");setDragOverRosterId("")}:undefined}>
      <div className="cup-roster-player">
        {draggable&&<span className="cup-roster-handle" aria-hidden="true"
          onTouchStart={onRosterHandleTouchStart(id)}
          onTouchMove={onRosterHandleTouchMove}
          onTouchEnd={onRosterHandleTouchEnd(tournament)}
          onTouchCancel={onRosterHandleTouchEnd(tournament)}
          style={{touchAction:"none"}}>⠿</span>}
        <PlayerBadge player={player(id)??{short:"?"}}/>
        <div className="cup-roster-player-copy">
          <b>{name(id)}</b>
          <span className="cup-roster-stat">
            {standing.rating!=null?<span className="cup-roster-stat-item"><i>ELO</i>{standing.rating}</span>:<em>未評分</em>}
            {standing.handicap!=null&&tournament.handicapMode==="suggested"&&<span className="cup-roster-stat-item"><i>評分</i>{standing.handicap}</span>}
            {tournament.arrivalTimes?.[id]&&<span className="cup-roster-arrival"><i aria-hidden="true">🕒</i>{tournament.arrivalTimes[id]}</span>}
          </span>
        </div>
      </div>
      <span className="cup-roster-actions">
        {canManage&&<select className="cup-roster-edit" defaultValue="" onChange={rosterPick(id)} aria-label={`更換 ${name(id)}`}>
          <option value="">⋯</option>
          <optgroup label="換上">{spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
        </select>}
        {canManage&&!drawn&&<Button variant="quiet" className="cup-btn sm cup-roster-remove" onClick={()=>onEditRoster(tournament,id,"")}>移除</Button>}
      </span>
    </li>;})}</ul>
    {canManage&&canArrangeRoster&&<p className="cup-roster-note">拖曳球員名稱可調整名單順序{status!=="done"&&"，亦會更新對陣圖"}。</p>}
    {canManage&&<label className="cup-roster-add">
      <span>{drawn?"已抽籤，只可替換名單上的球員":"加入球員"}</span>
      {!drawn&&<select defaultValue="" onChange={event=>{const value=event.target.value;event.target.value="";if(value)onEditRoster(tournament,"",value)}}>
        <option value="">選擇球員…</option>
        {spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
    </label>}
  </div>:null;

  const tieRow=(slot:BracketSlot<Match>)=>{
    const mine=Boolean(ownPlayerId&&(slot.a===ownPlayerId||slot.b===ownPlayerId));
    const canRecord=slot.state==="ready"&&Boolean(isAdmin||mine);
    const note=slot.state==="bye"?`${name(slot.winner)} 輪空晉級`
      :slot.state==="walkover"?`${name(slot.winner)} 因對手棄權晉級`
      :slot.state==="waiting"?"等待上一圈賽果"
      :slot.state==="tbd"?"對陣待定"
      :slot.state==="ready"?"未開賽":"";
    const key=`${slot.round}-${slot.index}`;
    return <li id={`cup-tie-${key}`} className={`cup-tie ${slot.state}${mine?" mine":""}${focusTie===key?" focus":""}`} key={key}>
      {/* A cup runs over weeks, so "who won" without "when" leaves the bracket undated — the one
          question a member asks of a finished tie after the fact. */}
      <div className="cup-tie-head"><span className="cup-tie-no">第 {slot.index} 場</span>
        {slot.match&&<time className="cup-tie-date" dateTime={slot.match.playedOn}>{slot.match.playedOn}</time>}
        {mine&&<span className="cup-tie-mine">你的賽事</span>}
        {slot.match&&canManageMatch(slot.match)&&<IconButton className="card-tool cup-tie-edit" label={`編輯 ${name(slot.a)} 對 ${name(slot.b)} 的賽果`} onClick={()=>onEdit(slot.match!)}>✎</IconButton>}</div>
      {([slot.a,slot.b] as const).map((id,side)=>{
        const won=Boolean(slot.winner&&slot.winner===id);
        return <div className={`cup-tie-side${won?" won":""}${id?"":" tbd"}`} key={side}>
          <PlayerBadge player={player(id)??{short:"?"}}/>
          <b>{id?name(id):"待定"}</b>
          {slot.match&&id?<em>{scoreFor(slot.match,id)}</em>:won?<i aria-hidden="true">✓</i>:null}
        </div>;
      })}
      {note&&<p className="cup-tie-note">{note}</p>}
      <div className="cup-tie-actions">
        {canRecord&&<Button variant="primary" className="cup-btn sm" onClick={()=>onRecordSlot(tournament,slot)}>記錄賽果</Button>}
        {canRecord&&mine&&<Button variant="secondary" className="cup-btn sm" onClick={()=>onArrange(opponentIn(slot,ownPlayerId))}>約時間</Button>}
        {canManage&&slot.state==="ready"&&[slot.a,slot.b].map(id=><Button variant="secondary" className="cup-btn sm" key={id} onClick={()=>onWalkover(tournament,slot,id)}>判 {name(id)} 晉級</Button>)}
        {canManage&&slot.state==="walkover"&&<Button variant="secondary" className="cup-btn sm" onClick={()=>onWalkover(tournament,slot,"")}>取消判定</Button>}
      </div>
    </li>;
  };

  /* A courtesy for the other entrants, not a decision — so it never asks for confirmation the way
     joining/leaving does, and stays open to change for as long as you're entered, deadline or not.
     Presets read relative to the cup's own start time (when the host set one) so a tap needs no
     typing at all; "自訂時間" is the one path that still needs input, and even that is two selects
     rather than a native time field, so it can never be the thing overflowing its row again.

     Collapsed by default: a card showing a live row of preset buttons invited stray taps from
     members just scrolling past — "編輯" is a deliberate second step before any of them are even
     on screen, and picking one (or confirming a custom time) collapses straight back. */
  const myArrivalTime=ownPlayerId?tournament.arrivalTimes?.[ownPlayerId]??"":"";
  const arrivalPresets=startAtTime?[
    {key:"early",label:"提早15分鐘",time:shiftHHMM(startAtTime,-15)},
    {key:"onTime",label:"準時到達",time:startAtTime},
    {key:"late15",label:"遲到15分鐘",time:shiftHHMM(startAtTime,15)},
    {key:"late30",label:"遲到30分鐘",time:shiftHHMM(startAtTime,30)},
  ]:[];
  const applyArrival=(time:string)=>{onSetArrivalTime(tournament.id,time);setArrivalCustomOpen(false);setArrivalPanelOpen(false)};
  const openArrivalCustom=()=>{
    if(arrivalCustomOpen){setArrivalCustomOpen(false);return}
    const [h,m]=(myArrivalTime||startAtTime||"18:00").split(":");
    setArrivalCustomHour(h);setArrivalCustomMinute(m);setArrivalCustomOpen(true);
  };
  const arrivalEditor=signedUp&&ownPlayerId&&<div className="cup-arrival-card">
    <div className="cup-arrival-card-head">
      <div className="cup-arrival-card-copy">
        <b><span aria-hidden="true">🕒</span> 到達時間</b>
        <small>{myArrivalTime?"已告知其他球員你預計到達的時間。":"可選 — 讓其他球員知道你大約幾點到場。"}</small>
      </div>
      <div className="cup-arrival-card-actions">
        {myArrivalTime&&<span className="cup-arrival-value">{myArrivalTime}</span>}
        <Button variant="secondary" className="cup-btn sm" aria-expanded={arrivalPanelOpen} onClick={()=>{if(arrivalPanelOpen){setArrivalCustomOpen(false)}setArrivalPanelOpen(value=>!value)}}>{arrivalPanelOpen?"收起":myArrivalTime?"更改":"設定"}</Button>
      </div>
    </div>
    {arrivalPanelOpen&&<>
      <div className="cup-arrival-presets">
        {arrivalPresets.map(preset=><button type="button" key={preset.key} className={`cup-arrival-preset${myArrivalTime===preset.time?" active":""}`} onClick={()=>applyArrival(preset.time)}>
          <b>{preset.time}</b><small>{preset.label}</small>
        </button>)}
        <button type="button" className={`cup-arrival-preset is-custom${arrivalCustomOpen?" active":""}`} aria-expanded={arrivalCustomOpen} onClick={openArrivalCustom}>
          <b aria-hidden="true">⋯</b><small>自訂時間</small>
        </button>
      </div>
      {arrivalCustomOpen&&<div className="cup-arrival-custom">
        <TimeOfDayPicker hour={arrivalCustomHour} minute={arrivalCustomMinute} onHour={setArrivalCustomHour} onMinute={setArrivalCustomMinute}/>
        <div className="cup-arrival-custom-actions">
          <Button variant="primary" className="cup-btn sm" onClick={()=>applyArrival(`${arrivalCustomHour}:${arrivalCustomMinute}`)}>確定</Button>
          <Button variant="secondary" className="cup-btn sm" onClick={()=>setArrivalCustomOpen(false)}>取消</Button>
        </div>
      </div>}
      {myArrivalTime&&<button type="button" className="cup-arrival-clear" onClick={()=>applyArrival("")}>清除到達時間</button>}
    </>}
  </div>;
  const shareState=shareStateOf(tournament);
  const shareUrgency=cupUrgency(shareState);
  /* The faces on the Instagram card. A viewer recognising one person they play with is the whole
     argument for entering, so the roster travels with the story rather than just a count. */
  const storyPerson=(id:string):StoryPerson=>{
    const found=player(id);
    return {name:found?.name??"",short:found?.short??"?",colour:found?.colour??null,avatar:found?.avatar??null};
  };
  return <section className="cup">
    <button type="button" className="cup-back" onClick={()=>setSelectedTournament("")}><span aria-hidden="true">‹</span> 所有盃賽</button>
    <header className={`cup-banner is-${status}`}>
      <CupArt tone={status==="done"?"gold":"dark"}/>
      <div className="cup-banner-body">
        <div className="cup-card-top"><span className={`cup-chip is-${status}`}>{CUP_STATUS_LABEL[status]}</span>{canManage&&controls(tournament)}</div>
        <h2>{tournament.name}</h2>
        <p>{tournament.startAt&&<>開始：{deadlineText(tournament.startAt)} · </>}{deadlinePassed?`報名已於 ${deadlineText(tournament.signupDeadline)} 截止`:`報名截止 ${deadlineText(tournament.signupDeadline)}`}</p>
        <div className="cup-banner-stats">
          <div><b>{tournament.signups.length}</b><small>參賽</small></div>
          <div><b>{settled}<i>/{total||"—"}</i></b><small>已定勝負</small></div>
          <div><b>{champion?"完賽":stage&&bracket?roundLabel(stage.round,bracket.rounds):"待抽籤"}</b><small>階段</small></div>
        </div>
        {total>0&&<div className="cup-progress" role="img" aria-label={`賽程進度 ${settled} / ${total}`}><i style={{width:`${Math.round(settled/total*100)}%`}}/></div>}
      </div>
    </header>

    {/* Recruiting is the one state where sharing is not a nicety — a cup with four entrants is a
        worse cup — so the ask is loud, states the clock, and names WhatsApp rather than 「分享」. */}
    <div className={`cup-share-row${status==="signup"?" recruiting":""}`}>
      <div>
        <b>{status==="signup"?`叫多幾個會友嚟報名${shareUrgency.label?`｜${shareUrgency.label}`:""}`:"分享賽程同賽果"}</b>
        <small>{cupShareCta(shareState).hint}</small>
      </div>
      <CupShareButtons name={tournament.name} state={shareState}
        url={typeof window==="undefined"?"":cupShareUrl(window.location.origin,tournament.id)}
        entrants={rosterIds.map(storyPerson)}
        champion={champion?storyPerson(champion):null}
        bracket={chart?storyBracket(chart):[]} tone="primary"/>
    </div>

    {!deadlinePassed?<>
      {/* Entering a cup is a competition decision, so it sits with the bracket it leads to rather
          than in 約戰, where it competed for attention with arranging tonight's frame. */}
      <div className={`cup-signup${signedUp?" in":""}`}>
        <div><b>{signedUp?"你已報名":"報名參加"}</b><small>{signedUp?"截止後會自動抽籤，並通知你首圈對手。":"截止後按報名名單抽籤並建立對陣。"}</small></div>
        {ownPlayerId
          ?<Button variant={signedUp?"secondary":"primary"} className="cup-btn" onClick={()=>{setSignupArrivalOn(false);if(startAtTime){const [h,m]=startAtTime.split(":");setSignupArrivalHour(h);setSignupArrivalMinute(m)}setPendingSignup({id:selectedTournament,name:tournament.name,joined:signedUp})}}>{signedUp?"取消報名":"立即報名"}</Button>
          :<a className="cup-btn primary" href="/login">登入後報名</a>}
      </div>
      {arrivalEditor}
      {rosterPanel}
    </>:!bracket||!bracket.size?<div className="cup-empty"><span aria-hidden="true">🎱</span><b>報名人數不足兩人</b><p>{isAdmin?"可編輯盃賽並延後報名截止時間，重新開放報名。":"今屆未能開賽。"}</p></div>:<>
      {!drawn&&ownPlayerId&&<p className="cup-note">正在抽籤…</p>}
      {arrivalEditor}
      {champion?<article className="cup-champion">
        <span aria-hidden="true">🏆</span>
        <div><small>{tournament.name} 冠軍</small><b>{name(champion)}</b></div>
        <PlayerBadge player={player(champion)??{short:"?"}}/>
      </article>
      :mySlot?<article className={`cup-mytie${mySlot.state==="ready"?" ready":""}`}>
        <p className="sl-eyebrow">{roundLabel(mySlot.round,bracket.rounds)} · 第 {mySlot.index} 場</p>
        <div className="cup-mytie-vs">
          {([ownPlayerId!,opponentIn(mySlot,ownPlayerId)] as const).map((id,side)=><Fragment key={side}>
            {side===1&&<span className="cup-mytie-mark" aria-hidden="true">VS</span>}
            <div className="cup-mytie-player">
              <PlayerBadge player={player(id)??{short:"?"}}/>
              <b>{side===0?"你":id?name(id):"待定"}</b>
              <small>{id&&player(id)?`${Math.round(player(id)!.rating)} ELO`:"未定"}</small>
            </div>
          </Fragment>)}
        </div>
        {mySlot.state==="ready"
          ?<div className="cup-mytie-actions"><Button variant="primary" className="cup-btn" onClick={()=>onRecordSlot(tournament,mySlot)}>記錄賽果</Button><Button variant="secondary" className="cup-btn" onClick={()=>onArrange(opponentIn(mySlot,ownPlayerId))}>約時間</Button></div>
          :<p className="cup-mytie-wait">對手要等上一圈賽果出咗先定到。</p>}
      </article>
      :eliminated?<p className="cup-note">你在今屆已止步；可繼續睇餘下賽程。</p>
      :ownPlayerId&&!tournament.signups.includes(ownPlayerId)?<p className="cup-note">你未有報名今屆盃賽。</p>:null}

      {chart&&<CupBracketChart chart={chart} activeRound={openRound}
        onPick={(round,index)=>{setOpenRound(round);setFocusTie(`${round}-${index}`)}}/>}
      <nav className="cup-rounds" aria-label="選擇輪次">{Array.from({length:bracket.rounds},(_,index)=>{
        const round=index+1,done=bracket.slots.filter(slot=>slot.round===round&&slot.settled&&slot.state!=="dead").length;
        const count=bracket.slots.filter(slot=>slot.round===round&&slot.state!=="dead").length;
        return <button type="button" key={round} className={round===openRound?"active":""} aria-current={round===openRound?"true":undefined} onClick={()=>setOpenRound(round)}>
          <b>{roundLabel(round,bracket.rounds)}</b><small>{done}/{count}</small>
        </button>;
      })}</nav>
      <ol className="cup-ties">{bracket.slots.filter(slot=>slot.round===openRound&&slot.state!=="dead").map(tieRow)}</ol>
      {canManage&&rosterPanel}

      {/* The full tree — names, scores and controls in every box — needs width the phone does not
          have; there, CupBracketChart carries the shape and the cards carry the detail. */}
      <div className="cup-tree"><TournamentBracketChart bracket={bracket} name={name} ownPlayerId={ownPlayerId} isAdmin={isAdmin} canManage={canManage} canArrange={canShuffle} dragRosterId={dragRosterId} dragOverRosterId={dragOverRosterId} canManageMatch={canManageMatch} onEdit={onEdit} onRecordSlot={slot=>onRecordSlot(tournament,slot)} onWalkover={(slot,winnerId)=>onWalkover(tournament,slot,winnerId)} onDragStart={id=>{setDragRosterId(id);setDragOverRosterId("")}} onDragOver={id=>setDragOverRosterId(id)} onDrop={id=>{if(dragRosterId&&dragRosterId!==id){onReorderRoster(tournament,dragRosterId,id)}setDragRosterId("");setDragOverRosterId("")}} onDragEnd={()=>{setDragRosterId("");setDragOverRosterId("")}} onTouchStart={onRosterHandleTouchStart} onTouchMove={onRosterHandleTouchMove} onTouchEnd={onRosterHandleTouchEnd(tournament)}/></div>
    </>}
    {confirmSignupDialog}
  </section>;
}

/* The recorder's own name leads the form, so the match's A side is not necessarily the box's top
   line. Read each score by player id and the two can never drift apart. */
function scoreFor(match:Match,playerId:string){
  return match.a===playerId?match.scoreA:match.b===playerId?match.scoreB:"";
}

// A horizontal, left-to-right bracket tree: each round is a column of match
// boxes vertically centred against the pair feeding it, using the flex
// "stretch + space-around" trick so pairing lines up correctly without
// needing to measure pixel positions in JS.
function TournamentBracketChart({bracket,name,ownPlayerId,isAdmin,canManage,canArrange,dragRosterId,dragOverRosterId,canManageMatch,onEdit,onRecordSlot,onWalkover,onDragStart,onDragOver,onDrop,onDragEnd,onTouchStart,onTouchMove,onTouchEnd}:{
  bracket:Bracket<Match>;
  name:(id:string)=>string;
  ownPlayerId?:string;
  isAdmin:boolean;
  canManage:boolean;
  canArrange:boolean;
  dragRosterId:string;
  dragOverRosterId:string;
  canManageMatch:(match:Match)=>boolean;
  onEdit:(match:Match)=>void;
  onRecordSlot:(slot:BracketSlot<Match>)=>void;
  onWalkover:(slot:BracketSlot<Match>,winnerId:string)=>void;
  onDragStart:(id:string)=>void;
  onDragOver:(id:string)=>void;
  onDrop:(id:string)=>void;
  onDragEnd:()=>void;
  onTouchStart:(id:string)=>(event:ReactTouchEvent)=>void;
  onTouchMove:(event:ReactTouchEvent)=>void;
  onTouchEnd:()=>void;
}){
  return <div className="bracket-chart" role="group" aria-label="賽事對陣圖">
    {Array.from({length:bracket.rounds},(_,roundIndex)=>{
      const round=roundIndex+1;
      return <div className={`bracket-round${round===bracket.rounds?" final":""}`} key={round}>
        <h3 className="bracket-round-title">{roundLabel(round,bracket.rounds)}</h3>
        <div className="bracket-round-matches">
          {bracket.slots.filter(slot=>slot.round===round).map(slot=>{
            const {a:first,b:second,match,winner}=slot;
            const mine=Boolean(ownPlayerId&&(first===ownPlayerId||second===ownPlayerId));
            /* Recording is offered to the two players in the box and to an admin. Coming from the
               box means the round and match number are carried, not typed — the class of mistake
               that used to file a quarter-final result as a first-round one. */
            const canRecord=slot.state==="ready"&&Boolean(isAdmin||mine);
            return <div className={`bracket-match ${slot.state}${mine?" mine":""}`} key={`${round}-${slot.index}`}>
              {match&&canManageMatch(match)&&<IconButton className="card-tool bracket-edit" label={`編輯 ${name(first)} 對 ${name(second)} 的賽果`} onClick={()=>onEdit(match)}>✎</IconButton>}
              {[first,second].map((id,side)=>{
                const draggable=canArrange&&Boolean(id);
                return <div key={side} className={`bracket-slot${winner&&winner===id?" winner":""}${!id?" tbd":""}${dragRosterId&&dragRosterId!==id&&dragOverRosterId===id?" drag-over":""}${dragRosterId===id?" dragging":""}`} draggable={draggable} data-drag-player-id={id||undefined}
                  onDragStart={draggable?event=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id);onDragStart(id)}:undefined}
                  onDragOver={draggable?event=>{event.preventDefault();onDragOver(id)}:undefined}
                  onDrop={draggable?event=>{event.preventDefault();onDrop(id)}:undefined}
                  onDragEnd={draggable?onDragEnd:undefined}
                  onTouchStart={draggable?onTouchStart(id):undefined}
                  onTouchMove={draggable?onTouchMove:undefined}
                  onTouchEnd={draggable?onTouchEnd:undefined}
                  onTouchCancel={draggable?onTouchEnd:undefined}>
                  <span>{id?name(id):"待定"}</span>{match&&<b>{scoreFor(match,id)}</b>}
                </div>;
              })}
              {match&&<time className="bracket-date" dateTime={match.playedOn}>{match.playedOn}</time>}
              {slot.state==="bye"&&<small className="bracket-bye">輪空晉級</small>}
              {slot.state==="walkover"&&<small className="bracket-bye">{name(slot.winner)} 因對手棄權晉級</small>}
              {slot.state==="waiting"&&<small className="bracket-bye">等待上一圈賽果</small>}
              {canRecord&&<Button variant="primary" className="bracket-record" onClick={()=>onRecordSlot(slot)}>記錄賽果</Button>}
              {canManage&&slot.state==="ready"&&<div className="bracket-walkover"><small>判定晉級</small><span>{[first,second].map(id=><Button variant="quiet" key={id} onClick={()=>onWalkover(slot,id)}>{name(id)}</Button>)}</span></div>}
              {canManage&&slot.state==="walkover"&&<Button variant="quiet" className="bracket-edit" onClick={()=>onWalkover(slot,"")}>取消判定</Button>}
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
/** The competition a match belonged to, named and staged, or null for an ordinary club game.
 *
 *  One derivation for every surface: the share sheet, the story card and the match card's own badge
 *  all call it, so a tie can never be a semi-final in one place and unlabelled in another. */
function cupFor(match:Match,data:AppState){
  if(!match.tournamentId)return null;
  const tournament=data.tournaments.find(item=>item.id===match.tournamentId);
  if(!tournament)return null;
  return {name:tournament.name,round:matchRoundLabel(tournament.signups?.length??0,match.tournamentRound)};
}

function MatchCard({data,match:m,canManage,name,onPlayer,onEdit,onVoid,onShare,highlighted=false}:{data:AppState;match:Match;canManage:boolean;name:(id:string)=>string;onPlayer:(id:string)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void;highlighted?:boolean}) {
  const [open,setOpen]=useState(false);
  // Scrolling to the card beats trusting it to be at the top: a backdated
  // result, or an ascending sort, can drop it anywhere in the month groups.
  const card=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!highlighted)return;
    card.current?.scrollIntoView({behavior:"smooth",block:"center"});
  },[highlighted]);
  const breaksByPlayer=(m.highBreaks??[]).filter(item=>item.value>0).reduce((groups,item)=>{
    const group=groups.find(g=>g.playerId===item.playerId);
    if(group)group.values.push(item.value);else groups.push({playerId:item.playerId,values:[item.value]});
    return groups;
  },[] as {playerId:string;values:number[]}[]);
  const leftLabel = isEntertainmentMode(m.mode) ? teamLabel(m,data,"A") : name(m.a);
  const rightLabel = isEntertainmentMode(m.mode) ? teamLabel(m,data,"B") : name(m.b);
  const preMatchLeftElo=m.beforeA2==null?m.beforeA:(m.beforeA+m.beforeA2)/2;
  const preMatchRightElo=m.beforeB2==null?m.beforeB:(m.beforeB+m.beforeB2)/2;
  const recommendedActual=suggestedHandicapAtRating(preMatchRightElo,data)-suggestedHandicapAtRating(preMatchLeftElo,data);
  const handicapText=(actual:number)=>
    actual>0?`${leftLabel} 每局讓 ${rightLabel} ${actual} 分`
    :actual<0?`${rightLabel} 每局讓 ${leftLabel} ${Math.abs(actual)} 分`
    :"不設讓分";
  /* A cup tie used to be indistinguishable from a Tuesday night frame in this list, which is the
     one place a member scrolls looking for the game they remember. It gets a gold edge on the board
     and a chip naming the round — the edge does the finding, the chip does the telling, and neither
     costs a row. */
  const cup=cupFor(m,data);
  return <article ref={card} className={`match ${m.status}${isEntertainmentMode(m.mode)?" entertainment":""}${cup?" is-cup":""}${highlighted?" just-saved":""}`}>
    <div className="match-board"><div className="match-top"><span className="match-when"><time dateTime={m.playedOn}>{m.playedOn}</time>{cup&&<small className={`match-cup-badge${cup.round?" has-round":""}`} title={cup.round?`${cup.name} · ${cup.round}`:cup.name}><CupMark/>{cup.round&&<b>{cup.round}</b>}<span>{cup.name}</span></small>}{isEntertainmentMode(m.mode)&&<small className="match-entertainment-badge">潮拍 2v2 · 不計 ELO</small>}{highlighted&&<span className="pill just-saved-pill">剛剛記錄</span>}{m.status==="void"&&<span className="pill">已作廢</span>}{m.entryMode==="aggregate"&&<span className="pill muted">歷史匯總</span>}</span>
      {/* Sharing sits with the card's own tools rather than behind the expander: the urge to show a
          result off lasts about as long as the walk back to the table, and a share hidden one tap
          down is a share that does not happen. Offered to every reader, not only to whoever may
          edit the card — a clubmate posting your win is worth more than you posting it. A voided
          match is excluded; it is not a result any more. */}
      <span className="card-tools">
        {m.status!=="void"&&<IconButton className="card-tool share" label={`分享 ${leftLabel} 對 ${rightLabel} 的賽果`} onClick={()=>onShare(m)}><ShareGlyph kind="share" /></IconButton>}
        {canManage&&<><IconButton className="card-tool" label={`編輯 ${leftLabel} 對 ${rightLabel} 的賽事`} onClick={()=>onEdit(m)}>✎</IconButton><IconButton className="card-tool danger" label={`刪除 ${leftLabel} 對 ${rightLabel} 的賽事`} onClick={()=>onVoid(m)}>✕</IconButton></>}
      </span></div>
    <Scoreline left={leftLabel} right={rightLabel} onLeftClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.a)} onRightClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.b)} scoreLeft={m.scoreA} scoreRight={m.scoreB}
      eloLeft={isEntertainmentMode(m.mode)?undefined:{before:m.beforeA,after:m.afterA,delta:m.deltaA}} eloRight={isEntertainmentMode(m.mode)?undefined:{before:m.beforeB,after:m.afterB,delta:m.deltaB??-m.deltaA}}/>
    {isEntertainmentMode(m.mode)&&<div className="match-team-rosters">{(["A","B"] as const).map(side=><div className={`match-team-roster ${side==="B"?"right":""}`} key={side}>{teamMemberIds(m,side).map(id=>{const player=data.players.find(item=>item.id===id);return <button type="button" key={id} onClick={()=>onPlayer(id)} aria-label={`查看 ${name(id)} 的球員卡`}><PlayerBadge player={player??{short:"?"}}/><span>{name(id)}</span></button>})}</div>)}</div>}
    <button type="button" className="match-summary-row" aria-expanded={open} aria-label={open?"收起比賽詳情":"展開比賽詳情"} onClick={()=>setOpen(value=>!value)}>
      {!!breaksByPlayer.length&&<span className="match-net-breaks">★ {breaksByPlayer.map((group,index)=><Fragment key={group.playerId}>{index>0&&"；"}{name(group.playerId)} 單桿 {group.values.join("、")}</Fragment>)}</span>}
      <span className="match-expand-toggle" aria-hidden="true"><i/></span>
    </button>
    </div>
    {open&&<div className="match-body">
    {isEntertainmentMode(m.mode)?<div className="elo-impact entertainment-impact"><small>娛樂賽記錄；不影響四位球員的 ELO 或統計。</small></div>:<div className="elo-impact" aria-label="本場 ELO 影響"><small>預測 {name(m.a)} 局數比例 {Math.round(m.expectedA*100)}%</small></div>}
    {!!breaksByPlayer.length&&<div className="match-breaks"><span>單桿</span>{breaksByPlayer.map(group=><b key={group.playerId}>{name(group.playerId)} {group.values.join("、")}</b>)}</div>}
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

function CalendarView({data,canManageMatch,onPlayer,onEdit,onVoid,onShare}:{data:AppState;canManageMatch:(match:Match)=>boolean;onPlayer:(player:Player)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void}) {
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
  const monthMatchCount=useMemo(()=>[...dayMatches.values()].reduce((total,matches)=>total+matches.length,0),[dayMatches]);
  const grid=useMemo(()=>monthGrid(month),[month]);
  const goToMonth=(next:string)=>{setMonth(next);setSelectedDay(null)};
  const selectedMatches=selectedDay?dayMatches.get(selectedDay)??[]:[];
  return <section className="calendar-view">
    <div className="calendar-nav">
      <IconButton className="calendar-nav-btn" label="上一個月" disabled={month<=bounds.min} onClick={()=>goToMonth(shiftMonth(month,-1))}>‹</IconButton>
      <div className="calendar-nav-title">
        <b>{monthLabel(month)}</b>
        <span className="calendar-month-total"><strong>{monthMatchCount}</strong> 場比賽</span>
      </div>
      <IconButton className="calendar-nav-btn" label="下一個月" disabled={month>=bounds.max} onClick={()=>goToMonth(shiftMonth(month,1))}>›</IconButton>
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
        <MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} onShare={onShare}/>)}</div>
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
    <div className="confirm-actions"><Button variant="secondary" className="confirm-cancel" onClick={onCancel}>保留賽事</Button><Button variant="danger" className="confirm-delete" onClick={onConfirm}>刪除賽事</Button></div>
    <p className="confirm-hint">刪除後可在提示訊息按「復原」還原。</p></>;
}


type PlayersChip = "near"|"free"|"soon"|"hot"|"all";
const PLAYERS_SORT_CYCLE:SortKey[]=["rank","rating","form","suggested"];
const playersSortDir=(key:SortKey):"asc"|"desc"=>key==="rank"||key==="name"?"asc":"desc";

function Players({data,ownPlayerId,managementMode=false,canAdd,canManagePlayer,onAdd,onEdit,onDelete,onOpen,onCompare,onRecordAgainst,onFindOpponent}:{
  data:AppState;ownPlayerId?:string;managementMode?:boolean;canAdd:boolean;canManagePlayer:(player:Player)=>boolean;
  onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void;
  onCompare:(p:Player)=>void;onRecordAgainst:(p:Player)=>void;onFindOpponent:(playerId:string,date:string)=>void;
}) {
  const me=data.players.find(p=>p.id===ownPlayerId);
  const [query,setQuery]=useState("");
  const [chip,setChip]=useState<PlayersChip>(managementMode?"all":me?"near":"all");
  const [openId,setOpenId]=useState("");
  const [sort,setSort]=useState<SortKey>("rank");
  const [freeToday,setFreeToday]=useState<Record<string,string>>({});
  useEffect(()=>{if(managementMode)setChip("all")},[managementMode]);

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
      {canAdd&&<Button variant="primary" className="players-add-btn" onClick={onAdd}>＋ 新增球員</Button>}
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
                <span className="players-row-badge"><PlayerBadge player={p}/><i className="players-row-free-dot" style={{background:free?"var(--ds-chart-positive)":"var(--ds-border-muted)"}}/></span>
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
              {managementMode&&canManagePlayer(p)&&<Button variant="quiet" className="players-row-manage" onClick={()=>onEdit(p)}>管理</Button>}
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
                    ? <Button variant="primary" className="players-expand-open-self" onClick={()=>onOpen(p)}>查看完整球員頁 ›</Button>
                    : <>
                        <Button onClick={()=>onRecordAgainst(p)}>記錄對局</Button>
                        <Button variant="secondary" onClick={()=>onCompare(p)}>對戰紀錄</Button>
                        <Button variant="secondary" onClick={()=>onFindOpponent(p.id,today)}>約戰</Button>
                        <IconButton className="players-row-open" label={`開啟 ${p.name} 的球員卡`} onClick={()=>onOpen(p)}>›</IconButton>
                      </>}
                </div>
                {(canManagePlayer(p)||canAdd)&&<div className="players-expand-manage">
                  {canManagePlayer(p)&&<IconButton className="card-tool" label={`編輯 ${p.name}`} onClick={()=>onEdit(p)}>✎</IconButton>}
                  {canAdd&&<IconButton className="card-tool danger" label={`刪除 ${p.name}`} onClick={()=>onDelete(p)}>✕</IconButton>}
                </div>}
              </div>}
            </div>;
          })}</div>}
  </div>;
}

function SettingsView({data,onEdit,onReset,canReset}:{data:AppState;onEdit:()=>void;onReset:()=>void;canReset:boolean}) {
  const s=data.settings;
  return <><section className="hero small"><div><p className="kicker">公開設定</p><h1>ELO 設定</h1><p>所有球員由 1500 起步；每場賽果只使用 PDF Snooker Elo 公式重播。以下參數只有管理員可以修改。</p></div><Button onClick={onEdit}>編輯設定</Button></section>
    <div className="settings-grid">
      <Surface as="div" className="setting"><small>起始 ELO</small><b>{s.start}</b></Surface>
       <Surface as="div" className="setting"><small>表現敏感度（250）</small><b>{s.frameScaleCoefficient}</b></Surface>
      <Surface as="div" className="setting"><small>信心權重</small><b>局數 ÷（局數＋5）</b></Surface>
      <Surface as="div" className="setting"><small>讓分 ELO 尺度（500）</small><b>{s.handicapEloScale}</b></Surface>
      <Surface as="div" className="setting"><small>個人建議讓分換算（只供顯示）</small><b>{s.handicapPointsToElo}</b></Surface>
      <Surface as="div" className="setting"><small>讓分最低 ELO 值（7）</small><b>{s.handicapMinimumElo}</b></Surface>
      <Surface as="div" className="setting"><small>讓分敏感度範圍（16）</small><b>{s.handicapSensitivityRange}</b></Surface>
      <Surface as="div" className="setting"><small>讓分敏感度寬度（250）</small><b>{s.handicapSensitivityWidth}</b></Surface>
      <Surface as="div" className="setting"><small>重複衰減底數（2）</small><b>{s.repetitionDecayBase}</b></Surface>
      <Surface as="div" className="setting"><small>重複衰減週期（7）</small><b>{s.repetitionDecayPeriod}</b></Surface>
      <Surface as="div" className="setting"><small>讓分有效度</small><b>{Math.round(s.handicapEffectiveness*100)}%</b></Surface>
      <Surface as="div" className="setting"><small>零和更新</small><b>是</b></Surface>
    </div>
    <Surface className="audit"><h2>審計記錄</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString("zh-HK")}</small></div>)}</Surface>
    {canReset&&<section className="danger-zone"><div><h2>清除並重設資料</h2><p>永久刪除共用資料庫內所有球員、比賽及審計記錄，並恢復預設 ELO 設定。</p></div><Button variant="danger" onClick={onReset}>清除所有資料</Button></section>}</>;
}

function MatchForm({data,draft,setDraft,preview,a,b,editing,saving,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;editing:boolean;saving:boolean;onSave:()=>void}) {
  const [breakInput,setBreakInput]=useState<Record<string,string>>({});
  const [breakMessage,setBreakMessage]=useState<Record<string,string>>({});
  const [breakReminder,setBreakReminder]=useState(false);
  const eloPreviewRef=useRef<HTMLElement|null>(null);
  const hadEloPreview=useRef(false);
  const [breakOpen,setBreakOpen]=useState<Record<string,boolean>>({});
  const [customHandicap,setCustomHandicap]=useState(editing||Boolean(draft.giver));
  /* Tracks whether the current giver/points are following "ELO 建議" (as opposed to "沒有讓分" or a
     custom value), so that switching the opponent can re-derive them for the new pairing instead of
     leaving stale values from the previous one behind. */
  const [followingSuggestion,setFollowingSuggestion]=useState(false);
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  const players=[...data.players].filter(p=>p.active).sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const isTeamMode=draft.mode==="2v2";
  const isCupMode=draft.mode==="cup";
  const a2=isTeamMode?data.players.find(player=>player.id===draft.a2):undefined;
  const b2=isTeamMode?data.players.find(player=>player.id===draft.b2):undefined;
  /* Keep the visible forecast tied directly to this form's draft. In particular, changing the
     selected giver or points must not wait for the parent preview used when the result is saved. */
  const livePreview=(()=>{
    const validTeams=!isTeamMode||Boolean(a2&&b2&&new Set([a.id,b.id,a2.id,b2.id]).size===4);
    if(!validTeams)return null;
    const match={a:a.id,b:b.id,a2:a2?.id,b2:b2?.id,mode:draft.mode,teamAName:draft.teamAName?.trim()||"Team A",teamBName:draft.teamBName?.trim()||"Team B"} as Match;
    const previewA=isTeamMode?{...a,id:"teamA",name:teamLabel(match,data,"A"),short:teamLabel(match,data,"A"),handicap:teamHandicap(match,data,"A"),rating:teamRating(match,data,"A")} as Player:a;
    const previewB=isTeamMode?{...b,id:"teamB",name:teamLabel(match,data,"B"),short:teamLabel(match,data,"B"),handicap:teamHandicap(match,data,"B"),rating:teamRating(match,data,"B")} as Player:b;
    const giverSide=isTeamMode?([a.id,a2?.id].includes(draft.giver)?"A":[b.id,b2?.id].includes(draft.giver)?"B":undefined):undefined;
    return calc(previewA,previewB,+draft.scoreA,+draft.scoreB,draft.giver,+draft.points,data.settings,giverSide);
  })();
  const forecast=livePreview??preview;
  const tournament=data.tournaments.find(t=>t.id===draft.tournamentId);
  /* Locked when the form was opened from a bracket box: the pairing, round and match number came
     from the tie itself, so there is nothing here to choose and no way to file the result against
     the wrong slot. */
  const cupSlotLocked=Boolean(isCupMode&&draft.cupSlotLocked);
  const cupBracket=useMemo(()=>isCupMode&&tournament?buildBracket<Match>(tournament,data.matches):null,[isCupMode,tournament,data.matches]);
  const cupSlot=cupBracket?slotAt(cupBracket,Number(draft.tournamentRound),Number(draft.tournamentMatchIndex)):undefined;
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
  /* Picking a player is picking their outstanding tie: there is only ever one box a member is due
     to play in, so the opponent, round and index all follow from the name. */
  const pickCupPlayer=(id:string)=>{
    const slot=cupBracket?playerSlot(cupBracket,id):undefined;
    update("a",id);update("b",slot&&slot.state==="ready"?opponentIn(slot,id):"");
    if(slot){update("tournamentRound",slot.round);update("tournamentMatchIndex",slot.index);}
  };
  const chooseCupTournament=(id:string)=>{
    update("tournamentId",id);
    update("cupSlotLocked",false);
    const nextTournament=data.tournaments.find(item=>item.id===id);
    const nextSlot=nextTournament?buildBracket<Match>(nextTournament,data.matches).slots.find(slot=>slot.state==="ready"):undefined;
    update("a",nextSlot?.a??"");update("b",nextSlot?.b??"");
    if(nextSlot){update("tournamentRound",nextSlot.round);update("tournamentMatchIndex",nextSlot.index);}
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
  const fairActual=forecast?(isTeamMode&&teamAHandicap!=null&&teamBHandicap!=null?teamBHandicap-teamAHandicap:suggestedHandicap(b,data)-suggestedHandicap(a,data)):null;
  const probabilities=forecast?matchProbabilities(forecast.expectedA,+draft.scoreA+ +draft.scoreB):null;
  const previewDeltaA=forecast&&!isTeamMode?forecast.deltaA*provisionalMultiplier(games(a)):null;
  const previewDeltaB=forecast&&!isTeamMode?-forecast.deltaA*provisionalMultiplier(games(b)):null;
  const applyFair=()=>{
    if(fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.abs(fairActual)}));
    setCustomHandicap(false);
    setFollowingSuggestion(true);
  };
  const setNoHandicap=()=>{
    setDraft((d:any)=>({...d,giver:"",points:0}));
    setCustomHandicap(false);
    setFollowingSuggestion(false);
  };
  /* A cup's handicap is the cup's, not the recorder's, so the draft is reconciled to it here rather
     than left to the 讓分 controls (which are hidden in cup mode anyway). `applyCupHandicap` returns
     the very same draft once the terms already match, so this settles after one pass instead of
     feeding itself the re-render that used to take the page down — see lib/cup-handicap-draft.ts. */
  const cupHandicapMode=isCupMode&&tournament?tournament.handicapMode:undefined;
  useEffect(()=>{
    if(!cupHandicapMode)return;
    setDraft((d:any)=>applyCupHandicap(d,{handicapMode:cupHandicapMode,fairActual,aId:a.id,bId:b.id}));
    setCustomHandicap(false);
  },[cupHandicapMode,fairActual,a.id,b.id,setDraft]);
  /* Outside cup mode, "ELO 建議" is a snapshot taken at click time: it doesn't recompute on its own
     when the opponent (or team) changes afterwards. Re-derive it here so the button and the points
     shown stay in sync with whoever is currently selected, instead of showing a stale giver/points
     pair the button no longer recognises as "active". */
  useEffect(()=>{
    if(cupHandicapMode||!followingSuggestion||fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.abs(fairActual)}));
  },[cupHandicapMode,followingSuggestion,fairActual,a.id,b.id,setDraft]);
  const changeScore=(key:"scoreA"|"scoreB",amount:number)=>setDraft((d:any)=>({...d,[key]:Math.max(0,+d[key]+amount)}));
  const totalFrames=+draft.scoreA + +draft.scoreB;
  const hasEloPreview=Boolean(forecast&&totalFrames>0);
  useEffect(()=>{
    if(hasEloPreview&&!hadEloPreview.current){
      requestAnimationFrame(()=>eloPreviewRef.current?.scrollIntoView({behavior:"smooth",block:"center"}));
    }
    hadEloPreview.current=hasEloPreview;
  },[hasEloPreview]);
  const validTeamSelection=Boolean(isTeamMode&&a2&&b2&&new Set([a.id,b.id,a2.id,b2.id]).size===4);
  const teamAName=(draft.teamAName?.trim()||"Team A"),teamBName=(draft.teamBName?.trim()||"Team B");
  const valid=Boolean(a&&b&&a.id!==b.id&&totalFrames>0&&(!isTeamMode||validTeamSelection)&&(!isCupMode||Boolean(draft.tournamentId&&draft.a&&draft.b&&draft.tournamentRound&&draft.tournamentMatchIndex)));
  const resultLabel=!valid?"輸入最終比分":draft.scoreA===draft.scoreB?`${draft.scoreA}–${draft.scoreB} 和局`:draft.scoreA>draft.scoreB?`${isTeamMode?teamAName:a.name} 勝 ${draft.scoreA}–${draft.scoreB}`:`${isTeamMode?teamBName:b.name} 勝 ${draft.scoreB}–${draft.scoreA}`;
  const handicapLabel=draft.giver&&+draft.points>0?`${draft.mode==="2v2"?([a.id,a2?.id].includes(draft.giver)?teamAName:teamBName):draft.giver===a?.id?a?.name:b?.name} 每局讓 ${draft.points} 分`:"沒有讓分";
  const dateLabel=draft.date===today?"今天":draft.date;
  const fairPoints=Math.abs(fairActual??0);
  return <div className="match-form"><div className="match-form-head"><div className="match-title-row"><h2 className="accent">{editing?"編輯比賽":"記錄比賽"}</h2><div className="match-date-chip"><span aria-hidden="true">{dateLabel}<i aria-hidden="true">›</i></span><input aria-label={`比賽日期，目前為${dateLabel}`} type="date" value={draft.date} onChange={e=>update("date",e.target.value)} onClick={e=>{const input=e.currentTarget;if(typeof input.showPicker==="function")input.showPicker()}}/></div></div></div>
    {editing&&<p className="sub">{draft.mode==="2v2"?"潮拍娛樂賽只會更新這筆歷史記錄，不會重播或改變 ELO。":"儲存後會按日期重播全部賽事，重建雙方及後續 ELO。"}</p>}
    {data.players.length<2&&<p className="warning">請先新增至少兩位活躍球員。</p>}
    {isCupMode&&!cupSlotLocked && <div className="tournament-selector tournament-selector-first">
      <label>盃賽<select value={draft.tournamentId||""} onChange={e=>chooseCupTournament(e.target.value)}>
        <option value="">選擇盃賽</option>
        {data.tournaments.map(t=> <option key={t.id} value={t.id}>{t.name}{t.startAt?` · 開始 ${formatTournamentDateTime(t.startAt)}`:""}{t.signupDeadline?` · 截止 ${formatTournamentDateTime(t.signupDeadline)}`:""}</option>)}
      </select></label>
      {draft.tournamentId&&!cupBracket?.slots.length&&<p className="mm-note">此盃賽尚未抽籤（報名未截止或人數不足），暫時無法選擇對陣，請待抽籤後再記錄賽果。</p>}
    </div>}
    {cupSlotLocked&&<div className="cup-slot-banner"><small>{tournamentLabel}</small><b>{cupBracket?`${roundLabel(Number(draft.tournamentRound),cupBracket.rounds)} · 第 ${draft.tournamentMatchIndex} 場`:`第 ${draft.tournamentRound} 輪第 ${draft.tournamentMatchIndex} 場`}</b><span>對陣及場次由賽事對陣圖帶入，不可更改。</span></div>}
    <section className="match-players" aria-labelledby="match-players-title"><h3 id="match-players-title" className="visually-hidden">選擇球員</h3>
      {isTeamMode&&<div className="team-name-grid"><label><span>Team A 隊名</span><input type="text" maxLength={40} value={draft.teamAName??""} placeholder="Team A" onChange={event=>update("teamAName",event.target.value)}/></label><b aria-hidden="true">對</b><label><span>Team B 隊名</span><input type="text" maxLength={40} value={draft.teamBName??""} placeholder="Team B" onChange={event=>update("teamBName",event.target.value)}/></label></div>}
      {!isTeamMode&&!isCupMode&&<div className="matchup-card">
        <div className="matchup-slot"><PlayerCombobox players={playersForA} value={draft.a} onChange={pickA} placeholder="選擇球員" ariaLabel="球員 A" autoOpenSignal={openASignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
        <span className="matchup-vs" aria-hidden="true">對</span>
        <div className="matchup-slot"><PlayerCombobox players={playersForB} value={draft.b} onChange={pickB} placeholder="選擇球員" ariaLabel="球員 B" autoOpenSignal={openBSignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO / ${Math.round(suggestedHandicap(selected,data))} 分`:"—"}</small></span></button>}/></div>
      </div>}
      {isCupMode&&cupSlotLocked&&<div className="matchup-card cup-matchup-card locked">
        {[a,b].map((player,side)=><Fragment key={side}>
          {side===1&&<span className="matchup-vs" aria-hidden="true">對</span>}
          <div className="matchup-slot derived-opponent"><span className="matchup-trigger"><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={player??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{player?.name??"待定"}</b><small>{player?`${Math.round(player.rating)} ELO`:"—"}</small></span></span></div>
        </Fragment>)}
      </div>}
      {isCupMode&&!cupSlotLocked&&<div className="matchup-card cup-matchup-card">
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
    {/* Typing a round and a match number by hand is how a quarter-final result used to get filed as
        a first-round one. The numbers stay visible when the form was opened from a box, but they are
        the box's — only a hand-built entry (no bracket to tap) can still set them. */}
    {isCupMode&&!cupSlotLocked && <div className="tournament-stage"><label>輪次<input type="number" min={1} value={draft.tournamentRound||1} onChange={e=>update("tournamentRound",Math.max(1,Number(e.target.value)||1))}/></label>
      <label>場次<input type="number" min={1} value={draft.tournamentMatchIndex||1} onChange={e=>update("tournamentMatchIndex",Math.max(1,Number(e.target.value)||1))}/></label></div>}
    {isCupMode&&cupSlot&&cupSlot.state==="played"&&!editing&&<p className="warning">此場次已有賽果，儲存會另建一筆記錄；請改用對陣圖上的「編輯賽果」。</p>}
    <section className="quick-handicap" aria-labelledby="handicap-title"><h3 id="handicap-title">讓分 <small>{handicapLabel}</small></h3>
      {isCupMode
        ? <div className="tournament-handicap-note"><b>盃賽模式</b><span>{tournament ? (tournament.handicapMode==="suggested" ? `自動套用建議讓分：每局 ${fairPoints} 分` : "此盃賽不設讓分") : "未選擇盃賽"}</span></div>
        : <>
            {validTeamSelection&&<div className="entertainment-handicap-note recommended"><b>建議讓分</b><span>{fairPoints===0?`${teamAName} 與 ${teamBName} 毋須讓分`:`${fairActual!>0?teamAName:teamBName} 每局讓 ${fairActual!>0?teamBName:teamAName} ${fairPoints} 分`}</span><small>{teamAHandicap!=null&&teamBHandicap!=null?`${teamAName} 平均 ${Math.round(teamAHandicap)} · ${teamBName} 平均 ${Math.round(teamBHandicap)}`:`隊伍平均 ELO 相差 ${Math.abs(teamEloDifference)}`}；按球員 ELO 建議讓分計算。</small></div>}
            <SlidingToggleGroup className="handicap-segment"><button type="button" className={!draft.giver&&!customHandicap?"active":""} onClick={setNoHandicap}>沒有讓分</button><button type="button" disabled={fairActual==null} className={draft.giver&&+draft.points===fairPoints&&!customHandicap?"active":""} onClick={fairPoints===0?setNoHandicap:applyFair}>ELO 建議</button><button type="button" className={customHandicap?"active":""} onClick={()=>{setCustomHandicap(value=>!value);setFollowingSuggestion(false);}}>自訂</button></SlidingToggleGroup>
            {customHandicap&&<div className="custom-handicap"><label>{draft.mode==="2v2"?"讓分隊伍":"讓分球員"}<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">沒有讓分</option><option value={a?.id}>{draft.mode==="2v2"?`${teamAName}（${a.name} / ${a2?.name}）`:a?.name}</option><option value={b?.id}>{draft.mode==="2v2"?`${teamBName}（${b.name} / ${b2?.name}）`:b?.name}</option></select></label><label>每局分數<input type="number" inputMode="numeric" min="0" step="1" value={draft.points} onChange={e=>update("points",Math.max(0,+e.target.value))}/></label></div>}
          </>
      }
    </section>
    <section className="score-panel" aria-labelledby="score-title">{forecast&&<div className="predicted-ratio"><div><span>預測局數比例</span><b>{isTeamMode?teamAName:a.short} {Math.round(forecast.expectedA*100)}% · {Math.round((1-forecast.expectedA)*100)}% {isTeamMode?teamBName:b.short}</b></div><em aria-label={`${isTeamMode?teamAName:a.name} ${Math.round(forecast.expectedA*100)}%，${isTeamMode?teamBName:b.name} ${Math.round((1-forecast.expectedA)*100)}%`}><i style={{width:`${Math.round(forecast.expectedA*100)}%`}}/></em></div>}<h3 id="score-title">最終比分</h3>{!isTeamMode&&<div className="break-invitation"><b>今場有冇值得記低嘅單桿？</b><span>每次突破，都係進步嘅紀錄。</span></div>}<div className="scoreboard-entry">
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
    {forecast&&totalFrames>0&&(draft.mode==="2v2"?<section ref={eloPreviewRef} className="elo-preview entertainment-preview"><b>潮拍娛樂模式</b><p>本場只記錄隊伍、讓分與比分；四位球員的目前 ELO、勝負、局數及近況均不會改變。</p></section>:<section ref={eloPreviewRef} className="elo-preview"><div><span><small>{a.name}</small><b className={previewDeltaA!>=0?"positive":"negative"}>{previewDeltaA!>=0?"+":""}{Math.round(previewDeltaA!)} ELO</b></span><i aria-hidden="true">↔</i><span className="right"><small>{b.name}</small><b className={previewDeltaB!>=0?"positive":"negative"}>{previewDeltaB!>=0?"+":""}{Math.round(previewDeltaB!)} ELO</b></span></div><details><summary>查看計算詳情</summary><p>{probabilities?`A 勝 ${Math.round(probabilities.win*100)}% · 和 ${Math.round(probabilities.draw*100)}% · `:""}表現分 {forecast.performanceScore>=0?"+":""}{Math.round(forecast.performanceScore)} · 讓分 H {forecast.adjustment>=0?"+":""}{Math.round(forecast.adjustment)}</p></details></section>)}
    <div className="match-save">{breakReminder&&<div className="break-save-reminder" role="status"><b>今場有冇值得記低嘅單桿？</b><span><button type="button" onClick={()=>{setBreakReminder(false);setBreakOpen({[a.id]:true,[b.id]:true})}}>返回記錄</button><button type="button" onClick={onSave}>今場沒有，照樣儲存</button></span></div>}<Button className="full" disabled={!valid||data.players.length<2||saving} aria-busy={saving} onClick={()=>{if(!isTeamMode&&!editing&&(draft.highBreaks??[]).length===0){setBreakReminder(true);return}onSave()}}><strong>{saving?"儲存中…":editing?"儲存變更":"儲存賽果"}</strong><small>{saving?"請稍候":resultLabel}</small></Button></div>
  </div>;
}

type TunableSettingKey="frameScaleCoefficient"|"handicapEloScale"|"handicapMinimumElo"|"handicapSensitivityRange"|"handicapSensitivityWidth"|"repetitionDecayBase"|"repetitionDecayPeriod";
function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) {
  const [s,setS]=useState<Settings>(data.settings);
  const field=(key:TunableSettingKey,label:string,hint:string,step=1,min?:number,max?:number)=>
    <label className="settings-field"><span>{label}</span><input type="number" step={step} min={min} max={max} value={s[key]}
      onChange={e=>{const value=e.target.value===""?0:Number(e.target.value);setS(current=>({...current,[key]:value}))}}/><small>{hint}</small></label>;
  return <>
    <p className="kicker">公開管理</p>
    <h2>PDF Snooker Elo 公式設定</h2>
    <p className="warning">起始 ELO 可修改，儲存後會以新參數從此起始值重播全部歷史 ELO。</p>
    <div className="settings-form-grid">
      <label className="settings-field"><span>起始 ELO</span><input type="number" step="10" min={1000} max={3000} value={s.start} onChange={e=>{const value=e.target.value===""?1500:Number(e.target.value);setS(current=>({...current,start:value}))}}/><small>所有現有球員會用此起始值重建評分。</small></label>
      {field("frameScaleCoefficient","表現敏感度","ELO 變化 = 此數值 ×（實際局數百分比 − 預測百分比）× 信心權重。預設 250。",1,0)}
      {field("handicapEloScale","讓分 ELO 尺度","勝率公式分母，原值 500。數值越大，同樣 ELO 差距對勝率的影響越小。",10,1)}
      {field("handicapMinimumElo","讓分最低 ELO 值","高 ELO 區域時，每讓 1 分最少代表的 ELO，原值 7。",1,.1)}
      {field("handicapSensitivityRange","讓分敏感度範圍","低 ELO 與高 ELO 每讓 1 分的 ELO 差距範圍，原值 16。",1,0)}
      {field("handicapSensitivityWidth","讓分敏感度寬度","控制敏感度由低至高轉變的速度，原值 250。",1,1)}
      {field("repetitionDecayBase","重複衰減底數","M(t) = 底數^(-t/週期)，PDF 原值 2。",.1,1)}
      {field("repetitionDecayPeriod","重複衰減週期","M(t) 的週期，PDF 原值 7。",.5,.1)}
    </div>
    <Button className="full" onClick={()=>onSave({...s,provisionalGames:data.settings.provisionalGames,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:15})}>套用並重播歷史 ELO</Button>
  </>;
}
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
    <SlidingToggleGroup className="mini-toggle break-milestone-toggle" aria-label="高桿圖表顯示方式"><button type="button" aria-pressed={mode==="personal"} className={mode==="personal"?"active":""} onClick={()=>{setMode("personal");setActiveIndex(null)}}>個人最佳</button><button type="button" aria-pressed={mode==="monthly"} className={mode==="monthly"?"active":""} onClick={()=>{setMode("monthly");setActiveIndex(null)}}>每月最高</button></SlidingToggleGroup>
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
              {groups!.length>SLOT_PREVIEW_DAYS&&<Button variant="quiet" className={`slot-more${expanded?" expanded":""}`} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?"只顯示最近 3 天":`顯示全部 ${groups!.length} 天`}<i aria-hidden="true">▾</i></Button>}
            </>
          : <p className="profile-slots-empty">目前未有公開的可配對時段</p>}
    </div>
  </section>;
}
function PlayerDetail({player,rank,data,onCompare,onViewAllMatches,onMatch,onFindOpponent,onShare}:{player:Player;rank:number;data:AppState;onCompare:(opponent:Player)=>void;onViewAllMatches:()=>void;onMatch:(matchId:string)=>void;onFindOpponent:(playerId:string,date:string)=>void;onShare:()=>void}) { const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data),series=playerSeries(player,data),trendPoints=playerTrendPoints(player,data),high=Math.max(...series),low=Math.min(...series);const provisional=g<data.settings.provisionalGames;
  const frameTrend=recentFramesPerMatch(player,data,5);
  const highestBreak=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>(m.highBreaks??[]).filter(item=>item.playerId===player.id).map(item=>item.value)).reduce((max,value)=>Math.max(max,value),0);
  /* Memoised where the neighbouring stats are not: those are single passes over the match list,
     while this builds a bracket per cup the player entered, and the profile re-renders on every
     slot fetch and chart hover. */
  const honour=useMemo(()=>honourText(playerHonours(data.tournaments,data.matches,player.id)),[data.tournaments,data.matches,player.id]);
  /* One hero, then a single `.profile-body` grid: every section below is a `.profile-section`, so the
     gaps, surfaces and heads come from one place rather than from each section's own margins. */
  /* A plain div, not a <header>: the global `header{height:62px}` page rule would clamp this and
     clip the chip row. */
  return <><div className="profile-head">
    <PlayerBadge player={player}/>
    <div className="profile-identity">
      <h2>{player.name}</h2>
      <div className="profile-chips"><span className="profile-chip">排名 #{rank||"—"}</span><span className={`profile-chip${provisional?" provisional":""}`}>{provisional?"臨時 ELO":"正式 ELO"}</span><span className="profile-chip">{g} 場</span>
        {/* A cup finish is the one thing on this profile the leaderboard can never show, so it sits
            in the identity row with the rank rather than in a section below the fold. */}
        {honour&&<span className="profile-chip honour"><CupMark/>{honour}</span>}
        {/* A profile is the other half of the share story: on a quiet week there is no fresh result
            to post, but a rating and a rank are always worth showing — and a card carrying the
            club's name into somebody's Instagram does the same job either way. It rides in the chip
            row rather than as a fourth column of the hero grid, which has three tracks. */}
        <Button variant="quiet" className="profile-share" aria-label={`分享 ${player.name} 的球會紀錄`} onClick={onShare}><ShareGlyph kind="share" />分享紀錄</Button></div>
      <div className="profile-hero-form"><div><small>最近5場</small><span className="profile-form-dots">{player.form.slice(0,5).map((result,index)=><i key={`${result}-${index}`} className={result.toLowerCase()}>{result}</i>)}</span></div></div>
    </div>
    <div className="profile-hero-elo"><small>目前 ELO</small><b>{Math.round(player.rating)}</b></div>
  </div>
  <div className="profile-body">
    {/* Current ELO already leads the hero above, so it isn't repeated here. */}
    <div className="profile-stats profile-progress">
      <StatTile label="ELO 建議評分" value={suggested==null?"未提供":Math.round(suggested)} />
      <StatTile label="正式讓分評分" value={player.handicap??"未提供"} />
      <StatTile label="勝／負／和" value={`${player.wins}/${player.losses}/${player.draws}`} />
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
