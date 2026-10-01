"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { CupMark, DEFAULT_AVATAR, Empty, InteractiveEloChart, NavIcon, PlayerBadge, PlayerCombobox, PlayerForm, RecentMatches, Scoreline, SortArrow, avatarHex, sortLabels, type EloTrendPoint, type SortKey } from "./UiBits";
import MatchmakingMarketplace from "./MatchmakingMarketplace";
import GuestIntro from "./GuestIntro";
import { FirstStepsChecklist, IntroTour } from "./FirstSteps";
import CupBracketChart, { storyBracket, type BracketChartData } from "./CupBracketChart";
import { TonightStrip, actionableCount, useMatchmakingSummary } from "./MatchmakingBits";
import { SQUAD_SWING_DAYS, daysSinceLastMatch, headToHead, isInactive, ratingSwing } from "../lib/squad-rivalry";
import { SquadStatsPanel } from "./SquadStats";
import { SquadAddedNotices, SquadCenter, SquadScope, defaultSquadId, usePublicSquad, useSquadViewTracking, useSquads, useUrlParam, writeUrlParam, type MySquad, type SquadSheet } from "./Squads";
import { isEntertainmentMode, neutralRatingSnapshot, roundedTeamEloDifference } from "../lib/entertainment-match";
import { addDaysHongKong, dayRangeHongKong, hkClock, hkDate, hkDayLabel, type AvailabilitySlot } from "../lib/availability";
import { cupShareCta, cupShareMessage, cupShareState, cupShareUrl, cupUrgency, whatsappLink } from "../lib/cup-share";
import { applyCupHandicap } from "../lib/cup-handicap-draft";
import { ShareGlyph, shareSheetTitle } from "./ShareSheet";
import CupShareButtons from "./CupShareButtons";
import { HANDICAP_ELO_PER_POINT, proposeHandicap, suggestedHandicap as clubSuggestedHandicap } from "../lib/handicap";
import { calculateSnookerElo } from "../lib/snooker-elo";
import { breakNudge, type BreakNudge } from "../lib/break-nudge";
import { matchDate, matchupKey, meetingsSince } from "../lib/elo-replay";
import { describeMatch, honourText, matchShareMessage, matchShareTitle, matchShareUrl, playerShareUrl, recordShareMessage, recordShareTitle, type RecordShareState } from "../lib/match-share";
import { recordStoryCard, resultStoryCard, type StoryPerson } from "../lib/story-card";
import ShareSheet from "./ShareSheet";
import { AppShell, PageFrame } from "./components/shell/AppShell";
import { LanguageMenu } from "./components/shell/LanguageMenu";
import { useT } from "./components/I18nProvider";
import { DesktopNavigation, MobileBottomNav, type Destination } from "./components/shell/Navigation";
import { BrandLogo } from "./components/BrandLogo";
import { addEntrant, buildBracket, canManageTournament, cupMatches, currentRoundLabel, formatTournamentDateTime, isTournamentHost, matchRoundLabel, opponentIn, playerHonours, playerEliminated, playerSlot, removeEntrant, reorderDraw, rosterOrder, roundLabel, shuffleDraw, signupsClosed, slotAt, swapPlayer, type Bracket, type BracketSlot, type Walkover } from "../lib/tournament";
import { Button, IconButton, InlineNotice, SegmentedControl, Skeleton, SlidingToggleGroup, StatTile, Surface } from "./components/ui/Primitives";
import { TabList, TabPanel } from "./components/ui/Tabs";
import { Sheet, ConfirmDialog } from "./components/ui/Overlay";
import { msg } from "../lib/i18n/translate";
import { Menu } from "./components/ui/Menu";
import { monthShortLabel, monthYearLabel } from "../lib/i18n/format";
import { INTL_LOCALE } from "../lib/i18n/locales";
import type { Translator } from "../lib/i18n/translate";

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
  format?: "single" | "double";
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
function trailingStat(t: Translator, key:SortKey,p:Player,data:AppState,suggested:number){
  const eloText=`ELO ${Math.round(p.rating)}`;
  if(key==="change"){const swing=recentDeltaDays(p,data,10);return {big:`${swing>=0?"+":""}${Math.round(swing)}`,cls:swing>=0?"positive":"negative",sub:eloText}}
  if(key==="official")return {big:p.handicap==null?"—":p.handicap,sub:eloText};
  if(key==="suggested")return {big:suggested,sub:eloText};
  if(key==="games")return {big:games(p),sub:t("{v}% 勝率", {v: Math.round(winRate(p)*100)})};
  if(key==="winRate")return {big:`${Math.round(winRate(p)*100)}%`,sub:t("{v} 場", {v: games(p)})};
  if(key==="frameRate")return {big:`${Math.round(frameRate(p)*100)}%`,sub:eloText};
  return null;
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
function teamFullName(t: Translator, match: Match,data:AppState,side:"A"|"B"){
  if(isEntertainmentMode(match.mode)){
    const custom=(side==="A"?match.teamAName:match.teamBName)?.trim();
    return custom||`Team ${side}`;
  }
  const names=teamMemberIds(match,side).map(id=>data.players.find(p=>p.id===id)?.name||t("已移除球員"));
  return names.join(" & ")||t("已移除球員");
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
function playerTrendPoints(t: Translator, p:Player,data:AppState):EloTrendPoint[]{
  const related=[...data.matches].filter(m=>m.status==="confirmed"&&!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)).sort((a,b)=>(a.playedOn||a.createdAt).localeCompare(b.playedOn||b.createdAt)||a.createdAt.localeCompare(b.createdAt));
  const start:EloTrendPoint={id:`${p.id}-start`,elo:p.initialRating,before:p.initialRating,delta:0,date:"",opponent:"",opponentShort:"",score:"",result:"start"};
  return [start,...related.map(match=>{
    const side=playerSide(match,p.id);
    const opponentSide=side==="A"?"B":"A";
    const opponentNames=teamFullName(t, match,data,opponentSide);
    const opponentShort=teamLabel(match,data,opponentSide);
    const ownScore=side==="A"?match.scoreA:match.scoreB;
    const opponentScore=side==="A"?match.scoreB:match.scoreA;
    const before=playerMatchBefore(match,p.id),elo=playerMatchAfter(match,p.id),delta=elo-before;
    return {id:match.id,elo,before,delta,date:match.playedOn,opponent:opponentNames,opponentShort,score:`${ownScore}–${opponentScore}`,result:ownScore===opponentScore?"D":ownScore>opponentScore?"W":"L"} satisfies EloTrendPoint;
  })];
}
function eloTrendSeries(t: Translator, players:Player[],data:AppState){
  const perPlayer=players.map(p=>({player:p,pts:playerTrendPoints(t, p,data).filter(pt=>pt.date!=="")}));
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
type BreakChartPoint={period:string;value:number;date?:string;opponent?:string};
function breakChartPoints(t: Translator, player:Player,data:AppState,mode:BreakChartMode):BreakChartPoint[]{
  const byPeriod=new Map<string,BreakChartPoint>();
  const matches=[...data.matches]
    .filter(m=>m.status==="confirmed"&&isParticipant(m,player.id))
    .sort((a,b)=>(a.playedOn||a.createdAt.slice(0,10)).localeCompare(b.playedOn||b.createdAt.slice(0,10))||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const opponentNames=(match:Match)=>{
    const ids=playerSide(match,player.id)==="A"?[match.b,match.b2]:[match.a,match.a2];
    return ids.filter((id):id is string=>!!id).map(id=>data.players.find(candidate=>candidate.id===id)?.name??t("已移除球員")).join(" / ");
  };
  for(const match of matches){
    const values=(match.highBreaks??[]).filter(item=>item.playerId===player.id&&item.value>0&&item.value<=147).map(item=>item.value);
    const date=match.playedOn||match.createdAt.slice(0,10),period=mode==="monthly"?date.slice(0,7):date;
    const value=Math.max(...values,0);
    const current=byPeriod.get(period);
    if(!current||value>current.value)byPeriod.set(period,{period,value,date:value?date:undefined,opponent:value?opponentNames(match):undefined});
  }
  const periods=[...byPeriod.keys()].sort();
  if(mode==="monthly")return periods.map(period=>byPeriod.get(period)!);
  if(!periods.length)return [];
  let best=byPeriod.get(periods[0])!;
  const points:BreakChartPoint[]=[best];
  for(const period of periods.slice(1)){
    const point=byPeriod.get(period)!;
    if(point.value>best.value){best=point;points.push(point);}
  }
  if(today>points[points.length-1].period)points.push({...best,period:today});
  return points;
}
/** "我讓他 X 分" / "他讓我 X 分" — the same displayed-handicap difference the match form uses. */
function handicapVerdict(t: Translator, me:Player,p:Player,s:Settings){
  const eloDifference=me.rating-p.rating;
  const points=proposeHandicap(t, me.rating,p.rating,s).points;
  const base=points===0?t("平手"):points>0?t("建議我讓 {points} 分", {points}):t("建議他讓 {v} 分", {v: Math.abs(points)});
  return points!==0&&Math.abs(eloDifference)<30?t("{base} · 勢均力敵", {base}):base;
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

const TABS=["leaderboard","matches","availability","players","settings"];
function tabFromLocation(){
  const wanted=new URLSearchParams(window.location.search).get("tab");
  return wanted&&TABS.includes(wanted)?wanted:"leaderboard";
}
function pushTabHistory(next:string){
  const url=new URL(window.location.href);
  if(next==="leaderboard")url.searchParams.delete("tab");else url.searchParams.set("tab",next);
  url.searchParams.delete("view");
  window.history.pushState(null,"",url);
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
  const t=useT();
  const [data,setData] = useState<AppState>(initialData ?? seed);
  const [stateLoadStatus,setStateLoadStatus] = useState<StateLoadStatus>(initialData ? "ready" : "loading");
  const [stateLoadError,setStateLoadError] = useState("");
  const [stateRetry,setStateRetry] = useState(0);
  const [,setStateLoadAttempt] = useState(0);
  const [tab,setTab] = useState("leaderboard");
  const [availabilityDirty,setAvailabilityDirty] = useState(false);
  const [tourOpen,setTourOpen] = useState(false);
  /** Set by the onboarding hand-off link (`/?start=record`); the match form needs loaded club data, so it opens once the state is ready. */
  const startRecording = useRef(false);
  const [leavingAvailability,setLeavingAvailability] = useState<string|null>(null);
  const [pendingConfirm,setPendingConfirm] = useState<{kicker:string;title:string;description:string;confirmLabel:string;onConfirm:()=>void}|null>(null);
  /** The post-match "加為常打對手" nudge -- set only when a freshly-saved 1v1 result is the first
      confirmed match between the viewer and their opponent. A personal, one-directional star, not a
      follow request: see db/regulars.pg.ts. */
  const [regularPrompt,setRegularPrompt] = useState<{id:string;name:string}|null>(null);
  const askConfirm=(opts:{kicker:string;title:string;description:string;confirmLabel:string;onConfirm:()=>void})=>setPendingConfirm(opts);
  /** Set by a player's 約戰 button; consumed once by `MatchmakingMarketplace` (see `findOpponentTarget` below) so
      the matchmaking tab opens focused on that person instead of the generic board. A fresh object on
      every tap, including a repeat tap on the same player, is what lets `MatchmakingMarketplace` re-focus even when
      the id has not changed. */
  const [jumpToAvailability,setJumpToAvailability] = useState<{playerId:string;date:string}|null>(null);
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
  /* The badge's fallback source is open 局 (calls), not open availability slots — the label already
     reads "N 個開緊局", so the number under it has to be calls-on-the-board, the same public count
     `tonight.openCalls` already gives the leaderboard's 今晚 strip, not how many people are merely
     free. Personal actionable items (invites needing a reply, live offers) still win when there are
     any, since those are more urgent than "someone else opened a 局". */
  const matchmakingBadge=actionableCount(matchmakingSummary?.counts)||matchmakingSummary?.tonight.openCalls||0;
  /* 球隊: the leaderboard filtered to one of the viewer's squads. Held in `?squad=` so a view can be
     shared and survives a reload; an id the viewer no longer belongs to falls back to the club. */
  const {squads,loaded:squadsLoaded,refresh:refreshSquads}=useSquads(Boolean(ownPlayerId));
  const squadId=useUrlParam("squad");
  const [squadSheet,setSquadSheet]=useState<SquadSheet>(null);
  const selectSquad=useCallback((id:string|null)=>writeUrlParam("squad",id),[]);
  const publicSquad=usePublicSquad(squadId,squads,ownPlayerId?squadsLoaded:true);
  const activeSquad=squads.find(squad=>squad.id===squadId)??publicSquad;
  useSquadViewTracking(tab==="leaderboard"?activeSquad:null);
  const squadAction=(id:string,action:"leave"|"seen")=>{
    const path=`/api/squads/${encodeURIComponent(id)}`;
    const request=action==="seen"?fetch(`${path}/seen`,{method:"POST"})
      :fetch(`${path}/members?playerId=${encodeURIComponent(ownPlayerId??"")}`,{method:"DELETE"}).then(async response=>{
        if(!response.ok)setToast((await response.json().catch(()=>({})) as {error?:string}).error??t("未能更新球隊，請稍後再試。"));
      });
    void request.catch(()=>{}).finally(()=>void refreshSquads());
  };
  /* Notifications deep-link to /?tab=availability, and the click handler navigates an already-open
     tab there, so the parameter has to be honoured on mount and on subsequent navigations alike. */
  useEffect(()=>{
    const search=new URLSearchParams(window.location.search);
    const wanted=search.get("tab");
    if(wanted&&TABS.includes(wanted))setTab(wanted);
    setManagementMode(search.get("manage")==="1");
    if(search.get("start")==="record"){startRecording.current=true;const url=new URL(window.location.href);url.searchParams.delete("start");window.history.replaceState(null,"",url)}
    /* The draw notification deep-links to the bracket itself, not merely to 比賽 — landing on the
       match history after being told who you drew is a dead end. */
    if(search.get("view")==="cup")setMatchesView("cup");
  },[]);
  const isAdmin=user?.role==="admin";
  // Primitive, so the state loader's dependency list can name it without the prop's identity
  // re-triggering a full club refetch on every parent render.
  const signedIn=Boolean(user);
  const [tournamentForm,setTournamentForm] = useState<{name:string;format:"single"|"double";handicapMode:"suggested"|"none";startAt:string;signupDeadline:string;coHosts:string[]}>({name:"",format:"single",handicapMode:"suggested",startAt:"",signupDeadline:`${today}T23:59`,coHosts:[]});
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
          throw new Error(typeof value?.error==="string"?value.error:t("資料格式無效"));
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
        setStateLoadError(error instanceof Error&&error.name==="AbortError"?t("資料載入逾時。"):t("資料暫時未能載入。請稍後再試。"));
      }finally{clearTimeout(timeout)}
    };
    void load(0);
    return()=>{cancelled=true;clearTimeout(retryTimer);requestController?.abort()};
  },[initialData,stateRetry,signedIn, t]);
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
  /* Tabs are client state, so without a history entry per tab the phone's back gesture left the app
     entirely instead of returning to the previous tab (and to the guest introduction). */
  const showTab=(next:string)=>{setTab(next);if(next!==tab)pushTabHistory(next)};
  const goTab=(next:string)=>{if(availabilityDirty&&tab==="availability"&&next!==tab)return setLeavingAvailability(next);setRecordMenuOpen(false);setHighlightMatch(null);if(next!=="availability")setJumpToAvailability(null);window.scrollTo(0,0);showTab(next)};
  const closeTour=useCallback(()=>setTourOpen(false),[]);
  useEffect(()=>{if(startRecording.current&&stateLoadStatus==="ready"){startRecording.current=false;if(user&&!user.needsOnboarding)newMatch()}},[stateLoadStatus]);// eslint-disable-line react-hooks/exhaustive-deps -- newMatch reads current state; run once when ready
  const tabRef=useRef(tab),dirtyRef=useRef(availabilityDirty);
  useEffect(()=>{tabRef.current=tab;dirtyRef.current=availabilityDirty});
  useEffect(()=>{
    const onPop=()=>{
      const wanted=tabFromLocation();
      if(wanted===tabRef.current)return;
      // Keep the user on unsaved availability edits: restore its entry and ask first, as a tap would.
      if(dirtyRef.current&&tabRef.current==="availability"){pushTabHistory("availability");setLeavingAvailability(wanted);return}
      setRecordMenuOpen(false);setHighlightMatch(null);setTab(wanted);window.scrollTo(0,0);
    };
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  },[]);
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
  const marketplaceOrigin=useRef<string|null>(null);
  async function persist(rawNext:AppState,message:string,undo?:AppState) {
    if(!user){setToast(t("請先登入會員帳戶，才可更改球會資料。"));return;}
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
      return true;
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
          return true;
        }
      }
      const reason=aborted?"":error instanceof Error?error.message:"";
      setToast(aborted?t("伺服器回應逾時，未能確認是否已儲存。請重新整理頁面查看最新資料。")
        :reason?t("未能儲存：{reason}", {reason})
        :t("未能連接伺服器；資料仍保留在此畫面，請稍後再試。"));
      toastTimer.current=setTimeout(()=>setToast(""),aborted?5200:3200);
    } finally { setSaving(false); }
  }
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);if(undoTimer.current)clearTimeout(undoTimer.current)},[]);

  function resetAll(){
    if(user?.role!=="admin"){setToast(t("只有管理員可以清除並重設資料。"));return;}
    const typed=prompt(t("此操作會永久刪除所有球員、比賽及審計記錄。請輸入 RESET 繼續："));
    if(typed!=="RESET")return;
    askConfirm({kicker:t("清除並重設資料"),title:t("最後確認"),description:t("清除並重設所有共用資料？此操作無法復原。"),confirmLabel:t("清除並重設"),onConfirm:doResetAll});
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
      setToast(t("所有共用資料已清除並重設。"));
    }catch{setToast(t("重設失敗，資料沒有被清除。請稍後再試。"));}
    finally{setSaving(false);setUndoSnapshot(null);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3200);}
  }

  function deleteTournament(tournament:Tournament){
    if(!isAdmin){setToast(t("只有管理員可以刪除盃賽。"));return;}
    askConfirm({kicker:t("刪除盃賽"),title:t("確定刪除「{name}」？", {name: tournament.name}),description:t("盃賽及其已記錄賽事都會永久刪除。"),confirmLabel:t("永久刪除"),onConfirm:()=>{
      const matches=data.matches.filter(match=>match.tournamentId!==tournament.id);
      const base={...data,tournaments:data.tournaments.filter(item=>item.id!==tournament.id),matches,audits:[{id:crypto.randomUUID(),text:`刪除盃賽：${tournament.name}`,at:new Date().toISOString()},...data.audits]};
      const settings=data.settings,next={...base,settings,...replay(data.players,matches,settings)};
      setData(next);persist(next,t("盃賽已刪除。"),data);
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
  /** Resolved fresh on every `jumpToAvailability` change (a new object even on a repeat tap of the
      same player -- see its declaration) so `MatchmakingMarketplace` can filter the board to this one person
      instead of the dead jump the button used to be. */
  const findOpponentTarget=useMemo(()=>{
    if(!jumpToAvailability)return null;
    const player=data.players.find(candidate=>candidate.id===jumpToAvailability.playerId);
    return player?{id:player.id,name:player.name,rating:player.rating}:null;
  },[jumpToAvailability,data.players]);

  function saveMatch(){
    if(saving)return;
    if(!isAdmin&&(!ownPlayerId||(a?.id!==ownPlayerId&&b?.id!==ownPlayerId&&a2?.id!==ownPlayerId&&b2?.id!==ownPlayerId))){setToast(t("你只能記錄或修改自己參與的比賽。"));return;}
    const valid1v1 = draft.mode==="1v1";
    const valid2v2 = draft.mode==="2v2" && a && b && a2 && b2 && new Set([a.id,b.id,a2.id,b2.id]).size===4;
    const validCup = draft.mode==="cup" && Boolean(draft.tournamentId&&draft.a&&draft.b&&a&&b) && Number(draft.tournamentRound)>=1 && Number(draft.tournamentMatchIndex)>=1;
    if(!valid1v1 && !valid2v2 && !validCup){setToast(t("請選擇有效賽事配置；盃賽賽果需選擇盃賽、輪次和場次。"));return;}
    if(draft.scoreA<0||draft.scoreB<0||(+draft.scoreA+ +draft.scoreB)===0){setToast(t("比分總局數必須大於 0。"));return;}
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
    // Checked against the *old* `data.matches`, before this match joins it, and only for a genuinely
    // new 1v1 result the viewer played themselves -- not an edit, not 2v2/cup (paired by bracket or
    // teams, not by choice), not a match an admin is logging on someone else's behalf.
    const firstPairing=valid1v1&&!editingMatch&&ownPlayerId&&(a.id===ownPlayerId||b.id===ownPlayerId)
      ?(a.id===ownPlayerId?b:a):null;
    const isNewPairing=Boolean(firstPairing)&&!data.matches.some(existing=>
      existing.status==="confirmed"&&((existing.a===a.id&&existing.b===b.id)||(existing.a===b.id&&existing.b===a.id)));
    const matches=editingMatch
      ? data.matches.map(existing=>existing.id===editingMatch.id?match:existing)
      : [match,...data.matches];
    const settings=data.settings;
    const rebuilt=replay(data.players,matches,settings);
    const action=editingMatch?t("編輯"):t("記錄");
    const matchLabel=valid2v2?`${teamLabel(match,data,"A")} ${draft.scoreA}–${draft.scoreB} ${teamLabel(match,data,"B")}`:`${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}`;
    const next={...data,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}${valid2v2?t("潮拍娛樂賽"):validCup?t("盃賽賽果"):t("賽果")}：${matchLabel}${valid2v2?t("；不影響 ELO"):validCup?t("；盃賽第 {tournamentRound} 輪第 {tournamentMatchIndex} 場", {tournamentRound: match.tournamentRound, tournamentMatchIndex: match.tournamentMatchIndex}):t("；重播歷史 ELO")}`,at:now},...data.audits]};
    localStorage.removeItem("scaa-draft"); setEditingMatch(null); setModal(null);
    // Land on the saved card rather than a toast that vanishes: focus the list
    // on the recorder (or clear it, for an admin logging someone else's game)
    // so the new row is guaranteed to be in the filtered set, and drop the
    // comparison — the date range only applies while comparing, and a stale
    // range could otherwise hide the very match we just navigated to.
    setHeadToHead({a:ownPlayerId&&(match.a===ownPlayerId||match.b===ownPlayerId)?ownPlayerId:"",b:""});
    setHighlightMatch(id); setMatchesView("history"); showTab("matches");
    const origin=marketplaceOrigin.current;marketplaceOrigin.current=null;
    void persist(next,valid2v2?(editingMatch?t("潮拍 2v2 已更新；ELO 與統計維持不變。"):t("潮拍 2v2 賽果已儲存；ELO 與統計維持不變。")):(validCup?(editingMatch?t("盃賽賽果已更新。"):t("盃賽賽果已儲存。")):(editingMatch?t("賽事已更新，所有後續 ELO 已重建。"):t("賽果已儲存，雙方 ELO 已更新。")))).then(async saved=>{if(!saved||!origin)return;try{const response=await fetch("/api/matchmaking/marketplace",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"result",id:origin,matchId:id})});if(!response.ok)setToast(t("賽果已儲存，但未能連結約戰安排。"));}catch{setToast(t("賽果已儲存，但未能連結約戰安排。"));}});
    if(isNewPairing&&firstPairing)setRegularPrompt({id:firstPairing.id,name:firstPairing.name});
  }

  const addRegularNow=()=>{
    if(!regularPrompt)return;
    void fetch("/api/regulars",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:regularPrompt.id})})
      .catch(()=>{/* best effort -- worst case the member stars them again from the board later */});
    setRegularPrompt(null);
  };

  function editMatch(m:Match){
    marketplaceOrigin.current=null;
    if(!canManageMatch(m)){setToast(t("你只能修改自己參與的比賽。"));return;}
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
    marketplaceOrigin.current=null;
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
    if(!isAdmin&&(!editingPlayer||editingPlayer.id!==ownPlayerId)){setToast(t("你只能修改自己的球員資料。"));return;}
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast(t("請輸入顯示名稱及縮寫。"));return;}
    const requestedRating=playerForm.rating.trim()===""?NaN:Number(playerForm.rating);
    const rating=editingPlayer
      ? isAdmin&&Number.isFinite(requestedRating)?requestedRating:editingPlayer.initialRating
      : isAdmin&&Number.isFinite(requestedRating)?requestedRating:data.settings.start;
    if(!Number.isFinite(rating)||rating<200||rating>3000){setToast(t("個人起始 ELO 必須介乎 200 至 3000。"));return;}
    const p:Player=editingPlayer
      ? {...editingPlayer,name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),handicap:playerForm.handicap===""?null:+playerForm.handicap,initialRating:rating,colour:playerForm.colour||DEFAULT_AVATAR}
      : {id:crypto.randomUUID(),name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),colour:playerForm.colour||DEFAULT_AVATAR,
        handicap:playerForm.handicap===""?null:+playerForm.handicap,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,
        framesWon:0,framesLost:0,lastChange:0,form:[]};
    const action=editingPlayer?t("編輯"):t("新增");
    const players=editingPlayer?data.players.map(x=>x.id===p.id?p:x):[...data.players,p];
    const rebuilt=editingPlayer?replay(players,data.matches,data.settings):{players,matches:data.matches};
    const next={...data,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}球員：${p.name}${editingPlayer?t("；重播歷史評分"):""}`,at:new Date().toISOString()},...data.audits]};
    setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal(null);persist(next,editingPlayer?t("球員資料已更新。"):t("球員已新增。"));
  }

  function editPlayer(p:Player){
    if(!isAdmin&&p.id!==ownPlayerId){setToast(t("你只能修改自己的球員資料。"));return;}
    setEditingPlayer(p);
    setPlayerForm({name:p.name,short:p.short,handicap:p.handicap==null?"":String(p.handicap),rating:String(Math.round(p.initialRating)),colour:p.colour||DEFAULT_AVATAR});
    setModal("player");
  }

  function deletePlayer(p:Player){
    if(!isAdmin){setToast(t("只有管理員可以刪除球員。"));return;}
    const hasHistory=data.matches.some(m=>m.a===p.id||m.b===p.id);
    askConfirm({kicker:t("刪除球員"),title:t("永久刪除 {name}？", {name: p.name}),description:t("{v}此操作無法復原。", {v: hasHistory?t("歷史賽事會保留並顯示為「已刪除球員」。"):""}),confirmLabel:t("永久刪除"),onConfirm:()=>{
      const next={...data,players:data.players.filter(x=>x.id!==p.id),
        audits:[{id:crypto.randomUUID(),text:`永久刪除球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
      persist(next,t("球員已永久刪除。"));
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
      const state=describeMatch(t, match,data.players,cupFor(t, match,data));
      const url=matchShareUrl(origin,match.id);
      return {card:resultStoryCard(t, state,url),message:matchShareMessage(t, state,url),url,title:matchShareTitle(state)};
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
    return {card:recordStoryCard(state,url,honourText(t, state.honours)),message:recordShareMessage(t, state,url),url,title:recordShareTitle(state)};
  },[shareTarget,data,ranked, t]);

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
      audits:[{id:crypto.randomUUID(),text:`永久刪除賽事：${m.id.slice(0,8)}${entertainment?t("；娛樂記錄，不影響評分"):t("；重建評分及近況")}`,at:new Date().toISOString()},...data.audits]};
    setDeletingMatch(null); setModal(null);
    persist(next,entertainment?t("娛樂賽事已刪除；ELO 與統計維持不變。"):t("賽事已刪除，ELO、統計及近況已重建。"),snapshot);
  }

  function undoDelete(){
    const snapshot=undoSnapshot;
    if(!snapshot)return;
    setUndoSnapshot(null);
    if(undoTimer.current)clearTimeout(undoTimer.current);
    // Restore the exact pre-delete state, but keep the rewind itself traceable.
    persist({...snapshot,audits:[{id:crypto.randomUUID(),text:"復原已刪除的賽事；還原評分及近況",at:new Date().toISOString()},...snapshot.audits]},t("已復原賽事，ELO 及統計已還原。"));
  }

  /* Recording from the bracket box rather than from a blank form. The round and match index travel
     with the tap, so they can no longer disagree with the tie the member was looking at — and the
     pairing is locked in the form, because a cup slot's two players are not a choice. */
  function recordCupSlot(tournament:Tournament,slot:BracketSlot<Match>){
    if(!user){setModal("signIn");return;}
    if(!isAdmin&&ownPlayerId!==slot.a&&ownPlayerId!==slot.b){setToast(t("你只能記錄自己參與的盃賽場次。"));return;}
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
    if(!canManageCup(tournament)){setToast(t("只有盃賽主持人或協辦主持人可以判定晉級。"));return;}
    const playerName=(id:string)=>data.players.find(player=>player.id===id)?.name??t("該球員");
    const apply=()=>{
      const others=(tournament.walkovers??[]).filter(item=>!(item.round===slot.round&&item.index===slot.index));
      const walkovers:Walkover[]=winnerId?[...others,{round:slot.round,index:slot.index,winner:winnerId}]:others;
      const tournaments=data.tournaments.map(item=>item.id===tournament.id?{...item,walkovers}:item);
      const text=winnerId?t("判定晉級：{name} 第 {round} 輪第 {index} 場 — {v}", {name: tournament.name, round: slot.round, index: slot.index, v: playerName(winnerId)}):t("取消判定晉級：{name} 第 {round} 輪第 {index} 場", {name: tournament.name, round: slot.round, index: slot.index});
      const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text,at:new Date().toISOString()},...data.audits]};
      setData(next);persist(next,winnerId?t("已判定晉級。"):t("已取消判定晉級。"),data);
    };
    if(winnerId)askConfirm({kicker:t("判定晉級"),title:t("判定「{v}」因對手棄權晉級？", {v: playerName(winnerId)}),description:t("不會產生賽果，亦不影響 ELO。"),confirmLabel:t("確定判定"),onConfirm:apply});
    else apply();
  }

  /* The roster is an admin's to edit, because the reasons it goes wrong are all off-app: a member
     signs up under the wrong account, a reserve takes a no-show's place the morning of the tie, a
     name is entered twice. Before the draw that is a plain edit of the sign-up list. After it the
     list *is* the bracket, so a replacement goes through `swapPlayer`, which moves the player inside
     the frozen draw rather than re-running it — re-running would re-pair everyone already told who
     they are playing. Adding and removing stay open after the draw too, but only until somebody plays:
     both re-lay the whole field, so past the first result the non-disruptive tools take over — a
     swap for a substitution, a walkover for a no-show. */
  /* Once the draw is frozen, a roster edit (swap, reshuffle, or a dragged reorder) goes through the
     server so the entrants whose opponent actually moved get told again — the same job the initial
     draw does. Before the freeze it is a plain edit of the sign-up list with nothing to announce, so
     that path still writes straight through `persist`. */
  async function submitRedraw(tournament:Tournament,body:{action:"shuffle"}|{action:"reorder";draggedId:string;targetId:string}|{action:"swap";outgoingId:string;incomingId:string}|{action:"add";playerId:string}|{action:"remove";playerId:string},message:string){
    if(!user){setToast(t("請先登入會員帳戶，才可更改球會資料。"));return;}
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
      setToast(error instanceof Error&&error.message?error.message:t("更新失敗，請重試。"));
    }finally{
      setSaving(false);
    }
  }

  function editCupRoster(tournament:Tournament,outgoingId:string,incomingId:string){
    if(!canManageCup(tournament)){setToast(t("只有盃賽主持人或協辦主持人可以編輯報名名單。"));return;}
    const playerName=(id:string)=>data.players.find(player=>player.id===id)?.name??t("該球員");
    const drawn=Boolean(tournament.draw?.length);
    const apply=(updated:Tournament,text:string,message:string)=>{
      const tournaments=data.tournaments.map(item=>item.id===tournament.id?updated:item);
      const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text,at:new Date().toISOString()},...data.audits]};
      setData(next);persist(next,message,data);
    };
    if(outgoingId&&incomingId){
      const message=t("已更換參賽球員。");
      if(drawn){
        const precheck=swapPlayer(t, tournament,outgoingId,incomingId,data.matches);
        if(!precheck.ok){setToast(precheck.error);return}
        /* Two entrants trading boxes and a reserve taking one are the same edit to `draw`, but they
           are not the same thing to confirm. A host rearranging who plays who is asking about the
           pairings that come out the other side, so quote them from the bracket the swap would
           actually build rather than making them picture it. */
        const nextBracket=buildBracket<Match>(precheck.tournament,data.matches);
        const opponentAfter=(id:string)=>{
          const slot=nextBracket.slots.find(item=>item.round===1&&(item.a===id||item.b===id));
          const other=slot?opponentIn(slot,id):"";
          return other?playerName(other):t("輪空");
        };
        if(precheck.kind==="swap")askConfirm({kicker:t("調整對陣"),title:t("對調「{v}」同「{v2}」喺「{name}」籤表嘅位置？", {v: playerName(outgoingId), v2: playerName(incomingId), name: tournament.name}),description:t("對調後：{v} 對 {v2}、{v3} 對 {v4}。其他對陣維持不變，受影響的球員會收到通知。", {v: playerName(outgoingId), v2: opponentAfter(outgoingId), v3: playerName(incomingId), v4: opponentAfter(incomingId)}),confirmLabel:t("確定對調"),onConfirm:()=>submitRedraw(tournament,{action:"swap",outgoingId,incomingId},t("已調整對陣。"))});
        else askConfirm({kicker:t("更換參賽球員"),title:t("在「{name}」籤表中以「{v}」代替「{v2}」？", {name: tournament.name, v: playerName(incomingId), v2: playerName(outgoingId)}),description:t("{v} 將對 {v2}。其他對陣維持不變，受影響的球員會收到通知。", {v: playerName(incomingId), v2: opponentAfter(incomingId)}),confirmLabel:t("確定更換"),onConfirm:()=>submitRedraw(tournament,{action:"swap",outgoingId,incomingId},message)});
      }else{
        if(tournament.signups.includes(incomingId)){setToast(t("該球員已在名單內。"));return}
        const text=t("更換參賽球員：{name} — {v} → {v2}", {name: tournament.name, v: playerName(outgoingId), v2: playerName(incomingId)});
        const updated:Tournament={...tournament,signups:tournament.signups.map(id=>id===outgoingId?incomingId:id)};
        askConfirm({kicker:t("更換參賽球員"),title:t("在「{name}」報名名單中以「{v}」代替「{v2}」？", {name: tournament.name, v: playerName(incomingId), v2: playerName(outgoingId)}),description:t("名單會即時更新。"),confirmLabel:t("確定更換"),onConfirm:()=>apply(updated,text,message)});
      }
    }else if(incomingId){
      if(drawn){
        const precheck=addEntrant(t, tournament,incomingId,data.matches);
        if(!precheck.ok){setToast(precheck.error);return}
        askConfirm({kicker:t("加入參賽球員"),title:t("將「{v}」加入「{name}」籤表？", {v: playerName(incomingId), name: tournament.name}),description:t("籤表會重新排列，對陣有變的球員會收到通知。"),confirmLabel:t("確定加入"),onConfirm:()=>submitRedraw(tournament,{action:"add",playerId:incomingId},t("已加入參賽球員。"))});
        return;
      }
      if(tournament.signups.includes(incomingId)){setToast(t("該球員已在名單內。"));return}
      const updated:Tournament={...tournament,signups:[...tournament.signups,incomingId]};
      apply(updated,t("加入報名：{name} — {v}", {name: tournament.name, v: playerName(incomingId)}),t("已加入報名名單。"));
    }else if(outgoingId){
      if(drawn){
        const precheck=removeEntrant(t, tournament,outgoingId,data.matches);
        if(!precheck.ok){setToast(precheck.error);return}
        askConfirm({kicker:t("移除參賽球員"),title:t("將「{v}」移出「{name}」籤表？", {v: playerName(outgoingId), name: tournament.name}),description:t("籤表會重新排列，對陣有變的球員會收到通知。"),confirmLabel:t("確定移除"),onConfirm:()=>submitRedraw(tournament,{action:"remove",playerId:outgoingId},t("已移除參賽球員。"))});
        return;
      }
      askConfirm({kicker:t("移除報名"),title:t("將「{v}」移出「{name}」報名名單？", {v: playerName(outgoingId), name: tournament.name}),description:t("移除後可重新加入。"),confirmLabel:t("確定移除"),onConfirm:()=>{
        const updated:Tournament={...tournament,signups:tournament.signups.filter(id=>id!==outgoingId)};
        apply(updated,t("移除報名：{name} — {v}", {name: tournament.name, v: playerName(outgoingId)}),t("已移除報名。"));
      }});
    }
  }

  /* A draw an admin doesn't like — a lopsided pairing, a rivalry landing in round one — has one
     remedy from the moment sign-ups close up to the moment somebody actually plays: re-roll it.
     `shuffleDraw` refuses before the deadline (freezing early would strand later sign-ups outside
     the bracket) and once any tie in the cup has a recorded result. */
  function shuffleTournamentRoster(tournament:Tournament){
    if(!canManageCup(tournament)){setToast(t("只有盃賽主持人或協辦主持人可以重新抽籤。"));return;}
    // Cheap client-side pre-check only, so an admin who has just recorded a
    // result gets an immediate "已有賽果" toast instead of a round trip — the
    // write and the notifications to affected entrants still happen server-side.
    const precheck=shuffleDraw(t, tournament,data.matches);
    if(!precheck.ok){setToast(precheck.error);return}
    askConfirm({kicker:t("重新抽籤"),title:t("重新抽籤「{name}」？", {name: tournament.name}),description:t("會產生新的對陣，受影響的球員會收到通知。"),confirmLabel:t("確定重新抽籤"),onConfirm:()=>submitRedraw(tournament,{action:"shuffle"},t("已重新抽籤。"))});
  }

  /* Dragging one name onto another is the same lever as the reshuffle button before a result, or a
     presentation-only roster edit after the cup is complete. No confirmation dialog: a drop is
     already the deliberate act a confirm would be asking about, and it is silently reversible by
     dragging again. A partially played cup stays locked until it is complete. */
  function reorderTournamentRoster(tournament:Tournament,draggedId:string,targetId:string){
    if(!canManageCup(tournament))return;
    const precheck=reorderDraw(t, tournament,draggedId,targetId,data.matches);
    if(!precheck.ok){setToast(precheck.error);return}
    const completed=Boolean(buildBracket<Match>(tournament,data.matches).champion);
    submitRedraw(tournament,{action:"reorder",draggedId,targetId},completed?t("已調整參賽名單順序。"):t("已調整籤表順序。"));
  }

  /* Signing up for a cup belongs to 比賽, not 約戰 — entering a competition and pitching a friendly
     are different jobs. Lifted out of the matchmaking tab's props so the cup bracket and the
     per-slot shortcut can both call the same thing. */
  const signUpTournament=async(tournamentId:string,arrivalTime?:string)=>{
        if(!ownPlayerId){setToast(t("請先登入會員帳戶，才可報名盃賽。"));return}
        const tournament=data.tournaments.find(item=>item.id===tournamentId),deadline=tournament?.signupDeadline?new Date(`${tournament.signupDeadline.length===10?tournament.signupDeadline+"T23:59":tournament.signupDeadline}:00+08:00`):null;
        if(deadline&&!Number.isNaN(deadline.getTime())&&deadline.getTime()<Date.now()){setToast(t("此盃賽報名已截止。"));return}
        const snapshot=data;
        const nextTournaments = data.tournaments.map(t=>{
          if(t.id!==tournamentId)return t;
          const joined=(t.signups||[]).includes(ownPlayerId);
          const arrivalTimes={...(t.arrivalTimes||{})};
          if(joined)delete arrivalTimes[ownPlayerId];
          else if(arrivalTime)arrivalTimes[ownPlayerId]=arrivalTime;
          return {...t,signups:joined?t.signups.filter(s=>s!==ownPlayerId):[...(t.signups||[]),ownPlayerId],arrivalTimes};
        });
        const next={...data,tournaments:nextTournaments,audits:[{id:crypto.randomUUID(),text:`${(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?t("報名"):t("取消報名")} 盃賽：${nextTournaments.find(t=>t.id===tournamentId)?.name}`,at:new Date().toISOString()},...data.audits]};
        setData(next);persist(next,(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?t("已報名盃賽。"):t("已取消報名盃賽。"),snapshot);
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
    setData(next);persist(next,arrivalTime?t("已更新到達時間。"):t("已清除到達時間。"),snapshot);
  };

  const navBadge=(id:string)=>id==="availability"?matchmakingBadge:id==="matches"?openTournamentCount:0;
  /** The number on 約戰's badge means one of two different things depending on which source fed it
      (see `matchmakingBadge` above) — this says which, so a screen reader hears the right claim. */
  const navBadgeLabel=(id:string)=>{
    if(id==="matches")return t("{openTournamentCount} 個盃賽開放報名", {openTournamentCount});
    if(id!=="availability")return undefined;
    const actionable=actionableCount(matchmakingSummary?.counts);
    return actionable>0?t("{actionable} 項待處理", {actionable}):t("{matchmakingBadge} 個開緊局", {matchmakingBadge});
  };

  return <><style>{`.read-only .card-tools,.read-only .hero.small > .primary{display:none}`}</style><AppShell signedIn={Boolean(user)}>
    <div className={`pull-refresh${refreshing?" spinning":""}`} style={{height:refreshing?PULL_THRESHOLD:pullDistance,opacity:refreshing||pullDistance>0?1:0}} aria-hidden="true">
      <span/>
    </div>
    <DesktopNavigation active={tab as Destination} onNavigate={goTab} badge={navBadge} badgeLabel={navBadgeLabel} signedIn={Boolean(user)} needsOnboarding={Boolean(user?.needsOnboarding)}/>
    <main>
      <header><div className="mobile-brand-wrap"><BrandLogo className="mobile-brand" compact/>{user?.needsOnboarding&&<a className="onboarding-alert-link" href="/onboarding?reminder=1" aria-label={t("完成會員問卷")} title={t("完成會員問卷")}>⚠️</a>}</div><div className="account-actions"><LanguageMenu className="language-menu--compact"/><div className="status"><i/>  {t("共用資料庫 ·")} {stateLoadStatus==="loading"?t("載入中…"):stateLoadStatus==="failed"?t("載入失敗"):saving?t("儲存中…"):t("已同步")}</div><button className={`header-settings${tab==="settings"?" active":""}`} aria-label={t("評分設定與紀錄")} aria-current={tab==="settings"?"page":undefined} onClick={()=>goTab("settings")}><NavIcon id="settings" active={tab==="settings"}/></button>{user?<a className="account-link" href="/account" title={user.email}>{user.displayName}</a>:<a className="account-link sign-in" href="/login">{t("auth.signInOrSignUp")}</a>}</div></header>
      <PageFrame className={`app-page-${tab}`}>
      {user?.needsOnboarding&&<InlineNotice tone="warning" title={t("完成新會員設定")}>
        <span>{t("設定頭像並回答問題後，即可取得初始評級；完成前無法記錄比賽。")}</span>{" "}
        <a className="onboarding-notice-link" href="/onboarding?reminder=1">{t("立即完成")}</a>
      </InlineNotice>}
      {stateLoadStatus==="loading"&&<HomeLoadingSkeleton/>}
      {stateLoadStatus==="failed"&&<InlineNotice tone="danger" title={t("未能載入球會資料")}><span>{stateLoadError}</span> <Button variant="secondary" onClick={()=>{setStateLoadStatus("loading");setStateLoadError("");setStateRetry(value=>value+1)}}>{t("重試")}</Button></InlineNotice>}
      {stateLoadStatus==="ready"&&<>
      {/* The club's pulse, on the screen members actually open. Matchmaking used to live entirely
          behind a tab, so "is anyone playing tonight?" was unanswerable without going to look. */}
      {tab==="leaderboard"&&!user&&<GuestIntro onStartTour={()=>setTourOpen(true)}/>}
      {tab==="leaderboard"&&user&&ownPlayerId&&!user.needsOnboarding&&<FirstStepsChecklist hasMatch={data.matches.some(match=>match.a===ownPlayerId||match.b===ownPlayerId)} hasAvailability={Boolean(matchmakingSummary?.mine)} onRecord={()=>newMatch()} onAvailability={()=>goTab("availability")} onTour={()=>setTourOpen(true)}/>}
      {tab==="leaderboard"&&<TonightStrip summary={matchmakingSummary?.tonight??null} signedIn={Boolean(ownPlayerId)} onOpen={()=>goTab("availability")}/>}
      {tab==="leaderboard"&&<SquadAddedNotices squads={squads} players={data.players} onView={id=>{squadAction(id,"seen");selectSquad(id)}} onLeave={id=>squadAction(id,"leave")} onDismiss={id=>squadAction(id,"seen")}/>}
      {tab==="leaderboard"&&<Leaderboard onClubScope={()=>selectSquad(null)} ranked={ranked} data={data} ownPlayerId={ownPlayerId} squad={activeSquad} scope={{squads,onSelect:selectSquad,onMore:()=>setSquadSheet("picker"),onManage:()=>setSquadSheet("manage")}} onRecord={()=>newMatch()} onPlayer={(p)=>{setDetail(p);setModal("detail")}} onMatch={(match)=>{setHeadToHead({a:"",b:""});setHighlightMatch(match.id);setMatchesView("history");showTab("matches")}} onRivalry={(first,second)=>openHeadToHead(first,second)}/>}
      {tab==="matches"&&<Matches squad={activeSquad} squadScope={<SquadScope squad={activeSquad} players={data.players} onClub={()=>selectSquad(null)} onSquad={()=>{const id=defaultSquadId(squads);if(id)selectSquad(id);else setSquadSheet("picker")}} onSwitch={()=>setSquadSheet("picker")} onManage={()=>setSquadSheet("manage")} compact/>} data={data} canManageMatch={canManageMatch} canManageCup={canManageCup} onEdit={editMatch} onVoid={requestDeleteMatch} onShare={shareMatch} onPlayer={(player)=>{setDetail(player);setModal("detail")}} view={matchesView} setView={setMatchesView} pair={headToHead} setPair={setHeadToHead} highlight={highlightMatch} isAdmin={Boolean(isAdmin)} onCreateTournament={()=>{setEditingTournament(null);setCoHostSearch("");setTournamentForm({name:"",format:"single",handicapMode:"suggested",startAt:"",signupDeadline:`${today}T23:59`,coHosts:[]});setModal("tournament")}} onEditTournament={tournament=>{setEditingTournament(tournament);setCoHostSearch("");setTournamentForm({name:tournament.name,format:tournament.format??"single",handicapMode:tournament.handicapMode,startAt:tournament.startAt??"",signupDeadline:tournament.signupDeadline.length===10?`${tournament.signupDeadline}T23:59`:tournament.signupDeadline,coHosts:tournament.coHosts??[]});setModal("tournament")}} onDeleteTournament={deleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={signUpTournament} onSetArrivalTime={setTournamentArrivalTime} onRecordSlot={recordCupSlot} onArrange={arrangeCupMatch} onWalkover={declareWalkover} onEditRoster={editCupRoster} onShuffleRoster={shuffleTournamentRoster} onReorderRoster={reorderTournamentRoster} onRefresh={refreshData}/>}
      {/* Public availability, recommendations and arrangements share one marketplace flow. */}
      {tab==="availability"&&<MatchmakingMarketplace onRecordSession={(opponentId,sessionId,date)=>{newMatch("1v1",opponentId,date);marketplaceOrigin.current=sessionId;}} key={ownPlayerId??"guest"} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player){setDetail(player);setModal("detail")}}} onRecord={opponentId=>newMatch("1v1",opponentId)} onActivity={refreshMatchmaking} target={findOpponentTarget} onTargetConsumed={()=>setJumpToAvailability(null)}/>}
      {tab==="players"&&<Players data={data} ownPlayerId={ownPlayerId} managementMode={Boolean(isAdmin&&managementMode)} canAdd={Boolean(isAdmin)} canManagePlayer={player=>Boolean(isAdmin||player.id===ownPlayerId)} onAdd={()=>{if(!isAdmin){setToast(t("只有管理員可以新增球員。"));return;}setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal("player")}} onEdit={editPlayer} onDelete={deletePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}} onCompare={(p)=>openHeadToHead(p,data.players.find(candidate=>candidate.id===ownPlayerId))} onRecordAgainst={(p)=>newMatch("1v1",p.id)} onFindOpponent={jumpToPlayerAvailability}/>}
      {tab==="settings"&&<SettingsView data={data} onEdit={()=>isAdmin?setModal("settings"):setToast(t("只有管理員可以修改 ELO 設定。"))} onReset={resetAll} canReset={user?.role==="admin"}/>}
      </>}
      </PageFrame>
    </main>
    {/* Outside <main>: the shell sizes every direct child of main to the content column. */}
    {tourOpen&&stateLoadStatus==="ready"&&<IntroTour tab={tab} signedIn={Boolean(user)} onShow={goTab} onClose={closeTour}/>}
    {/* Record sits dead centre as the one thing this app exists to do; the four content tabs split
        evenly around it. 設定 is not a peer of them — it lives with the account controls instead. */}
    {recordMenuOpen&&<button type="button" className="record-menu-scrim" aria-label={t("關閉比賽模式選單")} onClick={()=>setRecordMenuOpen(false)}/>}
    <div className={`record-speed-dial${recordMenuOpen?" open":""}`} aria-hidden={!recordMenuOpen}>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("1v1")}><i>1v1</i><span><b>{t("正式 1v1")}</b><small>{t("賽果會改變實際 ELO 與球員統計")}</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("2v2")}><i>2v2</i><span><b>{t("潮拍 2v2")}</b><small>{t("純娛樂模式，不影響目前 ELO 與統計")}</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("cup")}><i>{t("盃賽")}</i><span><b>{t("盃賽記錄")}</b><small>{t("選擇盃賽場次並儲存，不可手動設定讓分")}</small></span></button>
    </div>
    <MobileBottomNav active={tab as Destination} onNavigate={goTab} onRecord={()=>setRecordMenuOpen(open=>!open)} recordOpen={recordMenuOpen} badge={navBadge} badgeLabel={navBadgeLabel}/>
    {/* Share is the first modal kind migrated off this shared shell onto the `Sheet`
        primitive (see docs/ui-audit.md §3) — it owns its own scrim, safe-area handling,
        and close button now, so it is excluded from the block below and rendered
        separately underneath it. */}
    <Sheet open={modal==="share"} title={sharePayload?shareSheetTitle(t, sharePayload.card.kind):""} onClose={closeModal}>
      {sharePayload&&<ShareSheet card={sharePayload.card} message={sharePayload.message} url={sharePayload.url} title={sharePayload.title} heading={false}/>}
    </Sheet>
    {modal&&modal!=="share"&&<div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&closeModal()}>
      {/* `.close` is a sibling of `.sheet`, not a child: `.sheet` is the scrolling box, and a
          descendant can never sit outside it or straddle its edge without being clipped by that
          same overflow. As a sibling inside `.sheet-shell` it floats above the corner, stays put
          while the sheet content scrolls underneath it, and can cross the sheet's edge freely. */}
      <div className={`sheet-shell${modal==="detail"?" player-detail-sheet":""}${modal==="match"?" match-entry-sheet":""}`}>
        <IconButton className="close" label={t("關閉")} onClick={closeModal}>×</IconButton>
        <section className={`sheet${modal==="deleteMatch"?" confirm-sheet":""}`} role="dialog" aria-modal="true">
          {modal==="match"&&<MatchForm data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} editing={!!editingMatch} saving={saving} onSave={saveMatch}/>}
          {modal==="tournament"&&<div>
            <p className="kicker">{t("盃賽")}</p>
            <h2>{editingTournament?t("編輯盃賽"):t("建立新盃賽")}</h2>
            <p className="sub">{t("建立盃賽以便球員報名與賽事管理。")}</p>
            <form className="tournament-form" onSubmit={ev=>{ev.preventDefault();
              if(!tournamentForm.name.trim()){setToast(t("請輸入盃賽名稱。"));return}
              if(!tournamentForm.startAt){setToast(t("請輸入盃賽開始日期及時間。"));return}
              const id=editingTournament?.id??crypto.randomUUID();
              const now=new Date().toISOString();
              /* Pushing the deadline back into the future is how an admin reopens sign-ups, and a
                 draw made against the old roster cannot survive that: it would pair people who are
                 no longer the field. Clearing it here lets the freeze happen again, once, when the
                 new deadline passes. Recorded results are left alone — deleting them is the ✕. */
              const reopening=Boolean(editingTournament?.draw?.length)&&!signupsClosed({signupDeadline:tournamentForm.signupDeadline});
              const commit=()=>{
                const tournament: Tournament = {id,name:tournamentForm.name.trim(),format:tournamentForm.format,handicapMode:tournamentForm.handicapMode,startAt:tournamentForm.startAt,signupDeadline:tournamentForm.signupDeadline,createdAt:editingTournament?.createdAt??now,createdBy:editingTournament?.createdBy??ownPlayerId,coHosts:editingTournament?(canManageCupHosts(editingTournament)?tournamentForm.coHosts:editingTournament.coHosts??[]):tournamentForm.coHosts,signups:editingTournament?.signups??[],
                  draw:reopening?undefined:editingTournament?.draw,drawnAt:reopening?undefined:editingTournament?.drawnAt,rosterOrder:reopening?undefined:editingTournament?.rosterOrder,walkovers:reopening?undefined:editingTournament?.walkovers,arrivalTimes:editingTournament?.arrivalTimes};
                const tournaments = editingTournament? data.tournaments.map(t=>t.id===id?tournament:t) : [tournament,...data.tournaments];
                const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text:`${editingTournament?t("更新"):t("建立")} 盃賽：${tournament.name}`,at:now},...data.audits]};
                setEditingTournament(null);setModal(null);setToast(editingTournament?t("盃賽已更新。"):t("盃賽已建立。"));setData(next);persist(next,editingTournament?t("盃賽已更新。"):t("盃賽已建立。"),data);
              };
              if(reopening)askConfirm({kicker:t("重新開放報名"),title:t("「{v}」已經抽籤", {v: tournamentForm.name.trim()}),description:t("重新開放報名會清除現有籤表，截止後重新抽籤（已記錄的賽果會保留）。繼續？"),confirmLabel:t("重新開放"),onConfirm:commit});
              else commit();
            }}>
              <label>{t("盃賽名稱")}<input type="text" value={tournamentForm.name} onChange={e=>setTournamentForm({...tournamentForm,name:e.target.value})} required/></label>
              <label>{t("賽制")}<select value={tournamentForm.format} onChange={e=>setTournamentForm({...tournamentForm,format:e.target.value as "single"|"double"})}>
                <option value="single">{t("單敗淘汰（現有賽制）")}</option>
                <option value="double">{t("雙敗淘汰（勝者組 + 敗者組 + 總決賽）")}</option>
              </select></label>
              {tournamentForm.format==="double"&&<p className="mm-note">{t("雙敗淘汰：每位球員先進入勝者組，輸一場會轉到敗者組；敗者組再輸一場才會被淘汰，最後勝者組冠軍對敗者組冠軍決定總冠軍。")}</p>}
              <label>{t("讓分模式")}<select value={tournamentForm.handicapMode} onChange={e=>setTournamentForm({...tournamentForm,handicapMode:e.target.value as "suggested"|"none"})}><option value="suggested">{t("建議讓分（系統會自動套用建議）")}</option><option value="none">{t("不設讓分")}</option></select></label>
              <label>{t("盃賽開始日期及時間")}<input type="datetime-local" value={tournamentForm.startAt} onChange={e=>setTournamentForm({...tournamentForm,startAt:e.target.value})} required/></label>
              <label>{t("報名截止日期及時間")}<input type="datetime-local" value={tournamentForm.signupDeadline} onChange={e=>setTournamentForm({...tournamentForm,signupDeadline:e.target.value})} required/></label>
              {(()=>{
                const canEditCoHosts=editingTournament?canManageCupHosts(editingTournament):Boolean(isAdmin||ownPlayerId);
                const tournamentOwnerId=editingTournament?.createdBy??ownPlayerId;
                const selectedPlayers=tournamentForm.coHosts.map(id=>data.players.find(player=>player.id===id)).filter((player):player is Player=>Boolean(player));
                const query=coHostSearch.trim().toLocaleLowerCase();
                const candidates=data.players.filter(player=>player.active&&player.id!==tournamentOwnerId&&(!query||player.name.toLocaleLowerCase().includes(query)));
                return <div className={`tournament-cohosts${canEditCoHosts?"":" is-readonly"}`} role="group" aria-labelledby="tournament-cohosts-title">
                  <div className="tournament-cohosts-head"><div><span className="tournament-cohosts-eyebrow">{t("管理權限")}</span><h3 id="tournament-cohosts-title">{t("協辦主持人")}</h3></div><span className="tournament-cohosts-count">{t("{coHosts} 位", {coHosts: tournamentForm.coHosts.length})}</span></div>
                  <p className="tournament-cohosts-intro">{t("選擇可以協助編輯盃賽、調整籤表及管理名單的球員。")}</p>
                  {selectedPlayers.length>0&&<div className="tournament-cohosts-selected" aria-label={t("已選擇的協辦主持人")}>{selectedPlayers.map(player=><button type="button" className="tournament-cohost-chip" key={player.id} disabled={!canEditCoHosts} onClick={()=>setTournamentForm(current=>({...current,coHosts:current.coHosts.filter(id=>id!==player.id)}))}><PlayerBadge player={player}/><span>{player.name}</span><b aria-hidden="true">×</b></button>)}</div>}
                  <label className="tournament-cohosts-search"><span aria-hidden="true">⌕</span><input type="search" value={coHostSearch} disabled={!canEditCoHosts} onChange={event=>setCoHostSearch(event.target.value)} placeholder={t("搜尋球員")} aria-label={t("搜尋協辦主持人")}/></label>
                  <div className="tournament-cohosts-results" aria-label={t("可選擇的協辦主持人")}>{candidates.length>0?candidates.map(player=>{const selected=tournamentForm.coHosts.includes(player.id);return <button type="button" className={`tournament-cohost-option${selected?" is-selected":""}`} key={player.id} disabled={!canEditCoHosts} onClick={()=>setTournamentForm(current=>({...current,coHosts:selected?current.coHosts.filter(id=>id!==player.id):[...new Set([...current.coHosts,player.id])]}))}><PlayerBadge player={player}/><span>{player.name}</span><b>{selected?t("已加入"):t("加入")}</b></button>}):<p className="tournament-cohosts-empty">{t("沒有符合的球員")}</p>}</div>
                  <small>{canEditCoHosts?t("協辦主持人可以編輯此盃賽、調整籤表及管理名單。"):t("只有盃賽主持人可以更改協辦主持人。")}</small>
                </div>;
              })()}
              {Boolean(editingTournament?.draw?.length)&&<p className="mm-note">{t("此盃賽已抽籤（{draw} 人）。將截止時間改到未來即可重新開放報名，並在新截止時間後重新抽籤。", {draw: editingTournament?.draw?.length})}</p>}
              <div className="sheet-actions"><Button type="submit">{t("儲存盃賽")}</Button><Button variant="secondary" type="button" onClick={()=>{setModal(null);setEditingTournament(null)}}>{t("取消")}</Button></div>
            </form>
          </div>}
          {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} editing={!!editingPlayer} canEditRating={isAdmin} onSave={savePlayer}/>}
          {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{const start=Number(settings.start ?? data.settings.start ?? 1500); const applied={...settings,start,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:15}; const rebuilt=replay(data.players.map(player=>({...player,initialRating:start,rating:start})),data.matches,applied); setModal(null); persist({...data,settings:applied,...rebuilt,audits:[{id:crypto.randomUUID(),text:`調整 Snooker Elo 公式參數；以 ${start} 起始並重播歷史評分`,at:new Date().toISOString()},...data.audits]},t("設定已套用，歷史評分已從 {start} 重播。", {start}))}}/>}
          {modal==="deleteMatch"&&deletingMatch&&<ConfirmDeleteMatch match={deletingMatch} data={data} onCancel={closeModal} onConfirm={confirmDeleteMatch}/>}
          {modal==="signIn"&&<><p className="kicker">{t("會員功能")}</p><h2>{t("先登入或建立帳戶")}</h2><p className="sub">{t("記錄賽果前，請登入會員帳戶；新會員註冊時會同時建立球員檔案。")}</p><div className="auth-buttons"><a className="primary" href="/login">{t("登入")}</a><a className="more" href="/login?mode=signup">{t("建立帳戶")}</a></div></>}
          {modal==="detail"&&detail&&<PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data} onCompare={opponent=>{setModal(null);openHeadToHead(detail,opponent)}} onViewAllMatches={()=>{setModal(null);openPlayerMatches(detail)}} onMatch={matchId=>{setModal(null);setHeadToHead({a:detail.id,b:""});setHighlightMatch(matchId);setMatchesView("history");showTab("matches")}} onFindOpponent={jumpToPlayerAvailability} onShare={()=>sharePlayer(detail)}/>}
        </section>
      </div>
    </div>}
    {leavingAvailability&&<ConfirmDialog kicker={t("未儲存的變更")} titleId="leave-availability-title" title={t("離開後變更會消失")} description={t("你在「可配對」的時段變更尚未儲存，離開這一頁後不會保留。")} onClose={()=>setLeavingAvailability(null)}><Button variant="secondary" onClick={()=>setLeavingAvailability(null)}>{t("留在此頁")}</Button><Button variant="danger" onClick={()=>{const next=leavingAvailability;setLeavingAvailability(null);setAvailabilityDirty(false);setHighlightMatch(null);showTab(next)}}>{t("捨棄變更離開")}</Button></ConfirmDialog>}
    {pendingConfirm&&<ConfirmDialog kicker={pendingConfirm.kicker} titleId="pending-confirm-title" title={pendingConfirm.title} description={pendingConfirm.description} onClose={()=>setPendingConfirm(null)}><Button variant="secondary" onClick={()=>setPendingConfirm(null)}>{t("取消")}</Button><Button variant="danger" onClick={()=>{const run=pendingConfirm.onConfirm;setPendingConfirm(null);run()}}>{pendingConfirm.confirmLabel}</Button></ConfirmDialog>}
    <SquadCenter sheet={squadSheet} setSheet={setSquadSheet} squads={squads} loaded={squadsLoaded} refresh={refreshSquads} selectedId={squadId} onSelect={selectSquad}
      players={data.players} ownPlayerId={ownPlayerId} signedIn={Boolean(user)} notify={name=>setToast(t("已加入「{squad}」", {squad:name}))}/>
    {toast&&<div className={`toast${undoSnapshot?" toast-expiring":""}`} role="status"><span>{toast}</span>{undoSnapshot&&<Button variant="quiet" onClick={undoDelete}>{t("復原")}</Button>}</div>}
    {regularPrompt&&<div className="regular-prompt" role="status">
      <b>{t("你哋第一次對戰")}</b>
      <span>{t("加 {name} 做常打對手？之後佢開局會標「打過」，佢唔會收到通知，你隨時可以喺約戰板移除。", {name: regularPrompt.name})}</span>
      <div>
        <Button variant="primary" onClick={addRegularNow}>{t("加為常打對手")}</Button>
        <Button variant="quiet" onClick={()=>setRegularPrompt(null)}>{t("而家唔使")}</Button>
      </div>
    </div>}
  </AppShell></>;
}

/**
 * The three headline club stats used to live in their own full-width card
 * above the podium; folded in here as an inline strip so the leaderboard
 * reaches its actual content (the standings) sooner.
 */
function Overview({top,data,onPlayer}:{top:Player[];data:AppState;onPlayer:(p:Player)=>void}) {
  const t = useT();
  // DOM order is always rank order (1, 2, 3) so mobile — a vertical stack —
  // reads top to bottom correctly. The classic "winner in the middle" podium
  // look is applied with CSS `order` on the desktop 3-column layout only.
  return <section className="podium-section" aria-label={t("總覽及排名前三")}>
    {top.length>=3&&<div className="podium">
      {top.map((player,index)=>{const place=index+1;return <button key={player.id} className={`podium-card place-${place}`} onClick={()=>onPlayer(player)}>
        <span className="podium-place">{place===1?"♛":place}</span>
        <PlayerBadge player={player}/>
        <h3>{player.name}</h3>
        <b>{Math.round(player.rating)}<em>ELO</em></b>
        <span className="form">{player.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <small>{t("建議讓分 {v}", {v: Math.round(suggestedHandicap(player,data))})}</small>
      </button>})}
    </div>}
  </section>;
}

type BreakRecord={player:Player;opponent:string;value:number;date:string;createdAt:string;key:string};
type MonthlyBreak={month:string;record:BreakRecord|null;top:BreakRecord[]};
/** The highest break of every month from the first recorded break to today,
 *  newest last, plus up to the 10 highest breaks in that month. Months without
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
    months.push({month,record:top[0]??null,top:top.slice(0,10)});
  }
  return months;
}
/** Monthly high breaks as a column chart: the shape of the club's best month-to-month,
 *  with the holder and opponent for whichever month is selected. */
function MonthlyBreakChart({months,onPlayer}:{months:MonthlyBreak[];onPlayer:(p:Player)=>void}) {
  const t = useT();
  const withRecord=months.filter(month=>month.record);
  const lastIndex=months.map(month=>!!month.record).lastIndexOf(true);
  const [selected,setSelected]=useState<number|null>(lastIndex>=0?lastIndex:null);
  const active=selected!=null?months[selected]:null;
  const scroller=useRef<HTMLDivElement>(null);
  // The newest months matter most, so the track opens scrolled to its right end.
  useEffect(()=>{const node=scroller.current;if(node)node.scrollLeft=node.scrollWidth;},[months.length]);
  if(!withRecord.length)return <Empty text={t("尚未有單桿紀錄")} sub={t("記錄賽果時加入單桿度數，這裡就會顯示每月最高。")}/>;
  const peak=Math.max(...withRecord.map(month=>month.record!.value));
  const scale=Math.max(50,Math.ceil(peak/25)*25);
  return <div className="monthly-break">
    <div className="monthly-break-plot">
      <div className="monthly-break-axis" aria-hidden="true"><span>{scale}</span><span>{scale/2}</span><span>0</span></div>
      <div className="monthly-break-scroller" ref={scroller} tabIndex={0} role="group" aria-label={t("每月最高單桿，{month} 至 {month2}，可左右捲動", {month: months[0].month, month2: months[months.length-1].month})}>
      <ol className="monthly-break-columns">{months.map((month,index)=>{
        const record=month.record;
        const label=monthYearLabel(month.month.slice(0,4),month.month.slice(5),t.locale);
        return <li key={month.month}>
          <button type="button" className={`monthly-break-column${selected===index?" active":""}${record?"":" empty"}${record&&record.value>=100?" century":""}`}
            aria-pressed={selected===index} disabled={!record}
            aria-label={record?t("{label}，最高單桿 {value} 分，{name} 對 {opponent}", {label, value: record.value, name: record.player.name, opponent: record.opponent}):t("{label}，未有單桿紀錄", {label})}
            onClick={()=>setSelected(current=>current===index?null:index)}>
            {record?<><em>{record.value}</em><i style={{height:`${Math.max(6,record.value/scale*100)}%`}}/></>:<i className="monthly-break-gap"/>}
          </button>
          <small>{monthShortLabel(month.month.slice(5),t.locale)}{(index===0||month.month.endsWith("-01"))&&<span>{month.month.slice(2,4)}</span>}</small>
        </li>})}</ol>
      </div>
    </div>
    {active?.record?<div className="monthly-break-detail">
      <button type="button" onClick={()=>onPlayer(active.record!.player)}>
        <PlayerBadge player={active.record.player}/>
        <span><small>{t("{month}最高單桿", {month: monthYearLabel(active.month.slice(0,4),active.month.slice(5),t.locale)})}</small><b>{active.record.player.name}</b><em>{t("對 {opponent} · {date}", {opponent: active.record.opponent, date: active.record.date})}</em></span>
      </button>
      <strong>{active.record.value>=100&&<em className="century-badge" title={t("破百單桿")}>{t("破百")}</em>}{active.record.value}</strong>
    </div>:<p className="monthly-break-hint">{t("點擊柱狀圖查看該月的單桿紀錄保持者。")}</p>}
    {active&&active.top.length>1&&<ol className="monthly-break-top5">{active.top.map((record,index)=>
      <li key={record.key} className={index===0?"lead":""}>
        <span className="monthly-break-top5-rank">{index+1}</span>
        <button type="button" onClick={()=>onPlayer(record.player)}><PlayerBadge player={record.player}/><b>{record.player.name}</b></button>
        <em>{t("對 {opponent} · {date}", {opponent: record.opponent, date: record.date})}</em>
        <strong>{record.value>=100&&<i className="century-badge" title={t("破百單桿")}>{t("破百")}</i>}{record.value}</strong>
      </li>)}
    </ol>}
    <p className="chart-summary">{t("{month}至今，共 {months} 個月", {month: monthYearLabel(months[0].month.slice(0,4),months[0].month.slice(5),t.locale), months: months.length})}{months.length>12?t("；可左右捲動查看更早月份。"):t("。")}</p>
  </div>;
}
function breakNudgeCopy(t: Translator, nudge:BreakNudge){
  switch(nudge.kind){
    case "top":return {big:String(nudge.target),title:t("近30日單桿第 1（{current} 分）", {current: nudge.current}),sub:t("打 {target} 分刷新紀錄", {target: nudge.target}),hint:t("打 {target} 分刷新紀錄", {target: nudge.target})};
    case "climb":return {big:String(nudge.target),title:t("打 {target} 分，近30日單桿升第 {nextPosition}", {target: nudge.target, nextPosition: nudge.nextPosition}),sub:t("你現時 {current} 分 · 第 {position} 名", {current: nudge.current, position: nudge.position}),hint:t("打 {target} 分升第 {nextPosition}", {target: nudge.target, nextPosition: nudge.nextPosition})};
    case "expiring":return {big:String(nudge.target),title:nudge.daysLeft===0?t("你的 {current} 分今日後過期", {current: nudge.current}):t("你的 {current} 分 {daysLeft} 日後過期", {current: nudge.current, daysLeft: nudge.daysLeft}),sub:t("打 {target} 分保住近30日榜", {target: nudge.target}),hint:t("打 {target} 分保住位置", {target: nudge.target})};
    case "enter":return {big:String(nudge.target),title:t("打 {target} 分，登上近30日單桿榜", {target: nudge.target}),sub:t("第 10 名：{lastValue} 分", {lastValue: nudge.lastValue}),hint:t("打 {target} 分即可上榜", {target: nudge.target})};
    case "open":return {big:t("任何"),title:t("近30日單桿榜尚餘 {openSlots} 位", {openSlots: nudge.openSlots}),sub:t("任何單桿即可上榜"),hint:t("任何單桿即可上榜")};
  }
}
/* A welcome-back line inside the hero rather than an alert under it: a quiet greeting whose second
   half is the day's high-break target, and that opens the 30-day break board. */
function HeroWelcome({name,nudge,onOpen}:{name:string;nudge:BreakNudge;onOpen:()=>void}){
  const t = useT();
  const copy=breakNudgeCopy(t, nudge);
  return <button type="button" className="hero-welcome" onClick={onOpen}>
    <span className="hero-welcome-name">{t("歡迎回來，{name}", {name})}</span>
    <span className="hero-welcome-line"><b>{copy.title}</b><small>{copy.sub}</small></span>
    <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>
  </button>;
}
type BoardScope={squads:MySquad[];onSelect:(id:string|null)=>void;onMore:()=>void;onManage:()=>void};
const BREAK_VIEWS=[{value:"players",label:msg("球員最高")},{value:"overall",label:msg("歷史")},{value:"recent",label:msg("近30日")},{value:"monthly",label:msg("每月")}] as const;
type BreakView=typeof BREAK_VIEWS[number]["value"];
const SearchIcon=()=><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>;
const ChevronDown=()=><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>;
const FilterIcon=()=><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>;
const ClearIcon=()=><svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>;
/* A filter chip states a non-default choice in words and clears it in one tap, so state set inside the
   ⋯ menu is never invisible. */
function FilterChip({label,clearLabel,onClear}:{label:ReactNode;clearLabel:string;onClear:()=>void}){
  return <button type="button" className="board-chip" aria-label={clearLabel} onClick={onClear}><span>{label}</span><ClearIcon/></button>;
}
function Leaderboard({ranked,data,ownPlayerId,squad,scope,onRecord,onPlayer,onMatch,onRivalry,onClubScope}:{ranked:Player[];data:AppState;ownPlayerId?:string;squad:MySquad|null;scope:BoardScope;onClubScope:()=>void;onRecord:()=>void;onPlayer:(p:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}) {
  const homeTabsId=useId();
  const t = useT();
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[breakView,setBreakView]=useState<BreakView>("players"),[homeViewRaw,setHomeView]=useState<"ranking"|"breaks"|"recent"|"squad"|"matrix">("ranking"),[officialOnly,setOfficialOnly]=useState(false),[query,setQuery]=useState("");
  const homeView=(squad?["ranking","squad","matrix"]:["ranking","breaks","recent"]).includes(homeViewRaw)?homeViewRaw:"ranking";
  const confirmed=data.matches.filter(m=>m.status==="confirmed");
  const month=confirmed.filter(m=>m.playedOn.slice(0,7)===today.slice(0,7)).length,total=confirmed.length;
  // Toggling to 正式球手 re-sequences ranks among only the visible players,
  // rather than keeping their position in the full board with gaps.
  // A squad view is the same table filtered to its members, re-ranked among themselves.
  const squadIds=useMemo(()=>squad?new Set(squad.members.map(member=>member.playerId)):null,[squad]);
  const visibleRanked=useMemo(()=>ranked.filter(p=>(!squadIds||squadIds.has(p.id))&&(!officialOnly||games(p)>=data.settings.provisionalGames)),[ranked,squadIds,officialOnly,data.settings.provisionalGames]);
  // Search narrows the list without re-ranking it: a match keeps its real position on the board.
  const needle=query.trim().toLocaleLowerCase();
  const shown=sortPlayers(needle?visibleRanked.filter(p=>p.name.toLocaleLowerCase().includes(needle)||(p.short??"").toLocaleLowerCase().includes(needle)):visibleRanked,data,sort,dir),rankOf=new Map(visibleRanked.map((p,i)=>[p.id,i+1]));
  const defaultSort=sort==="rank"&&dir==="asc";
  /* A squad table measures movement over a month (a group of eight barely moves in ten days), shows
     each squad-mate's record against the viewer, and fades out whoever has stopped playing. */
  const swingDays=squad?SQUAD_SWING_DAYS:10;
  const viewerInSquad=Boolean(squad&&ownPlayerId&&squadIds?.has(ownPlayerId));
  const rivalry=useMemo(()=>squad?new Map(visibleRanked.map(p=>[p.id,{
    record:viewerInSquad&&ownPlayerId&&p.id!==ownPlayerId?headToHead(data.matches,ownPlayerId,p.id):null,
    idleDays:daysSinceLastMatch(data.matches,p.id),
  }])):null,[squad,visibleRanked,viewerInSquad,ownPlayerId,data.matches]);
  // Movement compares today's table against the standings 30 days ago. A single
  // Ten days balances recent momentum with enough matches for a meaningful comparison.
  const movement=useMemo(()=>{
    const recent=confirmed.filter(m=>squad?isInPastThirtyDays(m.playedOn):isInPastTenDays(m.playedOn));
    if(!recent.length)return {map:new Map<string,number>(),active:false};
    const before=visibleRanked.map(p=>{
      const swing=recent.filter(m=>m.a===p.id||m.b===p.id)
        .reduce((sum,m)=>sum+(m.a===p.id?m.deltaA:-m.deltaA),0);
      return {id:p.id,rating:p.rating-swing,name:p.name};
    }).sort((a,b)=>b.rating-a.rating||a.name.localeCompare(b.name));
    const priorRank=new Map(before.map((p,i)=>[p.id,i+1]));
    return {map:new Map(visibleRanked.map((p,i)=>[p.id,(priorRank.get(p.id)??i+1)-(i+1)])),active:true};
  },[confirmed,visibleRanked,squad]);
  const breakRecords=useMemo(()=>{
    const playerById=new Map(data.players.map(player=>[player.id,player]));
    const records=data.matches.flatMap(match=>match.status==="confirmed"?(match.highBreaks??[])
      .filter(item=>Number.isFinite(item.value)&&item.value>0&&item.value<=147&&playerById.has(item.playerId))
      .map((item,index)=>({player:playerById.get(item.playerId)!,opponent:playerById.get(match.a===item.playerId?match.b:match.a)?.name??t("已移除球員"),value:item.value,date:match.playedOn,createdAt:match.createdAt,key:`${match.id}-${index}`})):[])
      .sort((a,b)=>b.value-a.value||(b.date||b.createdAt).localeCompare(a.date||a.createdAt)||b.createdAt.localeCompare(a.createdAt));
    const seen=new Set<string>(),seenRecent=new Set<string>();
    return {
      overall:records.slice(0,10),
      players:records.filter(record=>seen.has(record.player.id)?false:(seen.add(record.player.id),true)).slice(0,10),
      recent:records.filter(record=>isInPastThirtyDays(record.date))
        .filter(record=>seenRecent.has(record.player.id)?false:(seenRecent.add(record.player.id),true)).slice(0,10),
      monthly:monthlyBreakRecords(records)
    };
  },[data.matches,data.players, t]);
  const displayedBreaks=breakView==="monthly"?breakRecords.overall:breakRecords[breakView];
  const nudge=useMemo(()=>ownPlayerId&&data.players.some(player=>player.id===ownPlayerId)
    ?breakNudge(breakRecords.recent.map(record=>({playerId:record.player.id,value:record.value,date:record.date})),ownPlayerId,today):null,[breakRecords.recent,data.players,ownPlayerId]);
  const ownPlayer=ownPlayerId?data.players.find(player=>player.id===ownPlayerId):undefined;
  const openNudge=()=>{setBreakView("recent");setHomeView("breaks");if(squad)onClubScope()};
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  /* A compact hero: one headline line, the welcome-back nudge when there is one, and the club's numbers
     as a single quiet row. The record action stays for wide screens; on phones the bottom bar's ＋ owns it. */
  return <><section className="hero home-hero"><div><h1>{t("讓每一局，")}<span>{t("都推動進步。")}</span></h1>
      {nudge&&ownPlayer&&<HeroWelcome name={ownPlayer.name} nudge={nudge} onOpen={openNudge}/>}
      <div className="podium-stats">
        <span><b>{ranked.length}</b><small>{t("活躍球員")}</small></span>
        <span><b>{month}</b><small>{t("本月比賽")}</small></span>
        <span><b>{total}</b><small>{t("歷來總場數")}</small></span>
      </div>
    </div><Button className="hero-action" onClick={onRecord}><span aria-hidden="true" className="hero-action-icon">＋</span><b>{t("記錄新賽果")}</b><small>{t("更新排名與近期狀態")}</small></Button></section>
    {/* One control per kind of choice: scope lives in the title menu, views in the segmented tabs, and
        sort/filter in the trailing menu — each choice that isn't the default shows as a clearable chip. */}
    <div className="board-head">
      <Menu className="board-scope" label={t("檢視範圍")} align="start" triggerClassName="board-scope__trigger"
        trigger={()=><><span className="board-scope__title">{squad?squad.name:t("全會排名")}</span><ChevronDown/></>}
        sections={[
          {items:[{key:"club",label:t("全會"),checked:!squad,onSelect:()=>scope.onSelect(null)},...scope.squads.map(item=>({key:item.id,label:item.name,checked:squad?.id===item.id,onSelect:()=>scope.onSelect(item.id)}))]},
          {items:[{key:"more",label:scope.squads.length?t("切換球隊"):t("瀏覽公開球隊"),onSelect:scope.onMore},...(squad?.role?[{key:"manage",label:squad.role==="host"?t("管理球隊"):t("球隊資料"),onSelect:scope.onManage}]:[])]},
        ]}/>
      {homeView==="ranking"&&<Menu className="board-filter" label={t("排序及篩選")} triggerClassName={`board-filter__trigger${defaultSort&&!officialOnly?"":" is-active"}`} trigger={()=><FilterIcon/>}
        sections={[
          {title:t("排序"),items:(Object.keys(sortLabels) as SortKey[]).map(key=>({key,label:t(sortLabels[key]),checked:sort===key,detail:sort===key?(dir==="asc"?"↑":"↓"):undefined,onSelect:()=>sortBy(key)}))},
          {title:t("顯示"),items:[{key:"all",label:t("全部球員"),checked:!officialOnly,onSelect:()=>setOfficialOnly(false)},{key:"official",label:t("只顯示正式球手"),checked:officialOnly,onSelect:()=>setOfficialOnly(true)}]},
        ]}/>}
      {homeView==="breaks"&&<Menu className="board-filter" label={t("單桿紀錄顯示方式")} triggerClassName={`board-filter__trigger${breakView==="players"?"":" is-active"}`} trigger={()=><FilterIcon/>}
        sections={[{title:t("顯示"),items:BREAK_VIEWS.map(item=>({key:item.value,label:t(item.label),checked:breakView===item.value,onSelect:()=>setBreakView(item.value)}))}]}/>}
    </div>
    {squad&&<p className="board-sub">{t("{count} 位隊員", {count: squad.memberCount})}</p>}
    <TabList id={homeTabsId} as="nav" className="page-tabs home-view-nav" label={squad?t("球隊內容"):t("首頁內容")} value={homeView} onChange={value=>setHomeView(value as typeof homeView)} items={squad?[
      {value:"ranking",label:<span>{t("排行榜")}</span>},
      {value:"squad",label:<span>{t("數據")}</span>},
      {value:"matrix",label:<span>{t("對賽矩陣")}</span>},
    ]:[
      {value:"ranking",label:<span>{t("排行榜")}</span>},
      {value:"breaks",label:<span>{t("最高單桿")}</span>},
      {value:"recent",label:<span>{t("數據")}</span>},
    ]}/>
    {homeView==="ranking"&&(!defaultSort||officialOnly)&&<div className="board-chips">
      {!defaultSort&&<FilterChip label={<>{t("排序：{v}", {v: t(sortLabels[sort])})} {dir==="asc"?"↑":"↓"}</>} clearLabel={t("清除排序")} onClear={()=>{setSort("rank");setDir("asc")}}/>}
      {officialOnly&&<FilterChip label={t("只顯示正式球手")} clearLabel={t("顯示全部球員")} onClear={()=>setOfficialOnly(false)}/>}
    </div>}
    {homeView==="breaks"&&breakView!=="players"&&<div className="board-chips"><FilterChip label={t(BREAK_VIEWS.find(item=>item.value===breakView)!.label)} clearLabel={t("顯示球員最高")} onClear={()=>setBreakView("players")}/></div>}
    <TabPanel id={homeTabsId} value="ranking" active={homeView==="ranking"}>
    <Overview top={visibleRanked.slice(0,3)} data={data} onPlayer={onPlayer}/>
    <section className="home-view-panel ranking-panel" aria-labelledby="ranking-title">
      <h2 id="ranking-title" className="ds-sr-only">{t("目前排名")}</h2>
    {visibleRanked.length>8&&<label className="board-search"><SearchIcon/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("搜尋球員")} aria-label={t("搜尋球員")}/></label>}
    <Surface as="div" className="table-card">{visibleRanked.length===0?<Empty text={officialOnly?t("尚未有正式球手"):t("尚未有球員")} sub={officialOnly?t("未有球員完成臨時門檻，暫時未有正式評分。"):squad?t("呢個球隊暫時未有球員。"):t("前往球員頁面新增第一位球員。")}/>:<><div className="table-head sortable"><button title={squad?t("箭嘴為過去 30 天的排名升跌"):t("箭嘴為過去 10 天的排名升跌")} onClick={()=>sortBy("rank")}>{t("排名")}<SortArrow active={sort==="rank"} dir={dir}/></button><button onClick={()=>sortBy("name")}>{t("球員")}<SortArrow active={sort==="name"} dir={dir}/></button><button title={t("最近五筆比賽；較近期結果權重較高")} onClick={()=>sortBy("form")}>{t("近況")}<SortArrow active={sort==="form"} dir={dir}/></button><button onClick={()=>sortBy("winRate")}>{t("場數／勝率")}<SortArrow active={sort==="winRate"} dir={dir}/></button><button onClick={()=>sortBy("suggested")}>{t("建議／正式評分")}<SortArrow active={sort==="suggested"} dir={dir}/></button><button title={squad?t("ELO 及近30天ELO變化"):t("ELO 及近10天ELO變化")} onClick={()=>sortBy("rating")}>ELO<SortArrow active={sort==="rating"} dir={dir}/></button></div>
      {shown.length===0&&<p className="board-empty">{t("沒有符合「{query}」的球員", {query: query.trim()})}</p>}
      {shown.map(p=>{const rank=rankOf.get(p.id)??0,suggested=Math.round(suggestedHandicap(p,data)),swing=squad?ratingSwing(data.matches,p.id,SQUAD_SWING_DAYS):recentDeltaDays(p,data,10),played=games(p),rival=rivalry?.get(p.id),idle=rival&&isInactive(rival.idleDays),rate=played?Math.round(p.wins/played*100):0,provisional=played<data.settings.provisionalGames,trailing=trailingStat(t, sort,p,data,suggested);
        const rivalText=rival?.record?(rival.record.wins+rival.record.losses+rival.record.draws?t("你 {wins}勝 {losses}負", {wins:rival.record.wins,losses:rival.record.losses}):t("未同你交手")):null;
        const idleText=idle?(rival.idleDays===null?t("未有賽事"):t("{days} 日未打", {days:rival.idleDays})):null;
        return <button className={`row ${rank===1?"top":""} ${rank<=3?`podium-${rank}`:""} ${provisional?"provisional":""} ${idle?"squad-inactive":""} ${p.id===ownPlayerId?"is-self":""}`} data-self={p.id===ownPlayerId||undefined} key={p.id} onClick={()=>onPlayer(p)} aria-label={[t("{name}，排名 {rank}，ELO {v}，近{days}天ELO變化 {v2}{v3}，建議讓分 {suggested}{v4}", {name: p.name, rank, v: Math.round(p.rating), days: swingDays, v2: swing>=0?"+":"", v3: Math.round(swing), suggested, v4: provisional?t("，臨時評分"):""}),rivalText,idleText].filter(Boolean).join("，")}>
        <span className="rank">{rank}{(()=>{if(!movement.active)return null;const move=movement.map.get(p.id)??0;
          // Only real movement earns a mark; a dash on every unchanged row is noise at 100+ players.
          return move===0?null
          :<em className={`move ${move>0?"up":"down"}`} aria-label={t("較 {days} 天前{v} {v2} 位", {days:swingDays, v: move>0?t("上升"):t("下跌"), v2: Math.abs(move)})}>{move>0?"▲":"▼"}{Math.abs(move)}</em>})()}</span><span className="person"><PlayerBadge player={p}/><b>{p.name}<small>{played<data.settings.provisionalGames?t("臨時"):<span className="official-only">{t("正式")}</span>}<span className="rating-kind-suffix">{t("評分")}</span><em className="person-meta">  {t("· {played} 場", {played})}</em></small>{(rivalText||idleText)&&<span className="squad-rival" aria-hidden="true">{rivalText&&<em>{rivalText}</em>}{idleText&&<em className="squad-idle">{idleText}</em>}</span>}</b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{t("{played} 場", {played})}<small>{t("{rate}% 勝率", {rate})}</small></span><span className="dual-rating"><b>{suggested}</b><small>{t("正式")} {p.handicap==null?"—":p.handicap}</small></span>
        {trailing?<span className="elo"><b className={trailing.cls}>{trailing.big}</b><small>{trailing.sub}</small></span>
        :<span className="elo"><b>{Math.round(p.rating)}</b><small className={swing>=0?"positive":"negative"}>{swing>=0?"+":""}{Math.round(swing)}</small><em className="elo-suggested">{t("建議 {suggested}", {suggested})}</em></span>}</button>})}
      {!needle&&<PinnedSelf player={ownPlayerId?shown.find(p=>p.id===ownPlayerId):undefined} rank={ownPlayerId?rankOf.get(ownPlayerId):undefined}/>}</>}</Surface>
    </section></TabPanel>
    {!squad&&<TabPanel id={homeTabsId} value="breaks" active={homeView==="breaks"} as="section" className="home-view-panel break-records-panel">
      <h2 id="break-records-title" className="ds-sr-only">{t("最高單桿紀錄")}</h2>
      {breakView==="monthly"?<MonthlyBreakChart months={breakRecords.monthly} onPlayer={onPlayer}/>:<>{breakView==="recent"&&nudge&&<p className="break-nudge-hint">{breakNudgeCopy(t, nudge).hint}</p>}<ol className="break-ranking">{Array.from({length:10},(_,index)=>{const record=displayedBreaks[index];const medal=["gold","silver","bronze"][index];return <li key={record?.key??`empty-${index}`} className={`${record?"":"empty-rank"}${medal?` medal medal-${medal}`:""}`}><span className="break-position">{medal?<i className="medal-icon" aria-hidden="true">{["🥇","🥈","🥉"][index]}</i>:index+1}</span>{record?<><PlayerBadge player={record.player}/><b><span>{record.player.name}</span><small>{t("對 {opponent}", {opponent: record.opponent})}<span className="break-date-inline"> · {record.date}</span></small></b><time dateTime={record.date}>{record.date}</time><strong>{record.value>=100&&<em className="century-badge" title={t("破百單桿")}>{t("破百")}</em>}{record.value}</strong></>:<b>N/A</b>}</li>})}</ol>
      <p className="chart-summary">{breakView==="players"?t("每位球員只顯示其最高單桿。"):breakView==="overall"?t("按所有已確認賽事的單桿記錄排名，同一球員可重複上榜。"):t("{thirtyDaysAgo} 至 {today} 的最高單桿，每位球員只顯示其最高單桿。", {thirtyDaysAgo, today})}</p></>}
    </TabPanel>}
    {squad&&<>
    <TabPanel id={homeTabsId} value="squad" active={homeView==="squad"}><TrendSection players={ranked.filter(p=>squadIds?.has(p.id))} data={data}/><SquadStatsPanel squad={squad} players={data.players} matches={data.matches} onMatrix={()=>setHomeView("matrix")} onPlayer={id=>{const player=data.players.find(p=>p.id===id);if(player)onPlayer(player)}}/></TabPanel>
    <TabPanel id={homeTabsId} value="matrix" active={homeView==="matrix"}><HeadToHeadMatrix squad={squad} squadScope={null} data={data} ownPlayerId={ownPlayerId} onOpenPair={(first,second)=>{const one=data.players.find(p=>p.id===first),two=data.players.find(p=>p.id===second);if(one&&two)onRivalry(one,two)}}/></TabPanel></>}
    {!squad&&<TabPanel id={homeTabsId} value="recent" active={homeView==="recent"}><TrendSection players={ranked} data={data}/><ThirtyDayStats data={data} onPlayer={onPlayer} onMatch={onMatch} onRivalry={onRivalry}/></TabPanel>}</>;
}

/** The Elo trend chart, which used to hide behind a ranking toggle, now heads the Stats tab. */
function TrendSection({players,data}:{players:Player[];data:AppState}){
  const t = useT();
  return <section className="home-view-panel trend-panel" aria-labelledby="trend-title">
    <div className="home-panel-head"><div><h2 id="trend-title">{t("ELO走勢")}</h2><p>{t("各球員 ELO 評分隨日期的走勢，取每日最後一場賽事後的評分。")}</p></div></div>
    <EloTrendChart players={players} data={data}/>
  </section>;
}

/** While the viewer's own row is off-screen, a copy of it rides along the bottom of the list; tapping it
    scrolls the real row into view. At 100+ players, "where am I?" is the board's most common question. */
function PinnedSelf({player,rank}:{player?:Player;rank?:number}){
  const t = useT();
  const [offscreen,setOffscreen]=useState(false);
  const id=player?.id;
  useEffect(()=>{
    if(!id)return;
    const row=document.querySelector<HTMLElement>(".table-card .row[data-self]");
    if(!row)return;
    const observer=new IntersectionObserver(([entry])=>setOffscreen(!entry.isIntersecting),{rootMargin:"0px 0px -96px 0px"});
    observer.observe(row);
    return ()=>observer.disconnect();
  },[id,rank]);
  if(!player||!rank||!offscreen)return null;
  const jump=()=>{const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;document.querySelector<HTMLElement>(".table-card .row[data-self]")?.scrollIntoView({block:"center",behavior:reduce?"auto":"smooth"})};
  return <button type="button" className="pinned-self" onClick={jump} aria-label={t("跳到你的排名：第 {rank} 名", {rank})}>
    <span className="pinned-self__rank">{rank}</span><PlayerBadge player={player}/><b>{t("你")}</b><span className="pinned-self__elo">{Math.round(player.rating)}</span>
  </button>;
}

function HomeLoadingSkeleton() {
  const t = useT();
  return <section className="home-loading-skeleton" aria-busy="true" aria-label={t("正在載入球會資料")}>
    <span className="sr-only">{t("正在載入球會資料")}</span>
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
  const t = useT();
  const narrow=useMediaQuery("(max-width:599px)");
  const ranked=useMemo(()=>players.filter(p=>games(p)>0).sort((a,b)=>b.rating-a.rating),[players]);
  const [hiddenIds,setHiddenIds]=useState<Set<string>>(()=>new Set(ranked.slice(5).map(p=>p.id)));
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const plotRef=useRef<HTMLDivElement>(null);
  const shownPlayers=ranked.filter(p=>!hiddenIds.has(p.id));
  const {dates,series}=useMemo(()=>eloTrendSeries(t, shownPlayers,data),[shownPlayers,data, t]);
  const toggle=(id:string)=>{setActiveIndex(null);setHiddenIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})};
  const deselectAll=()=>{setActiveIndex(null);setHiddenIds(new Set(ranked.map(p=>p.id)))};
  if(ranked.length===0) return players.length===0
    ? <Empty text={t("尚未有球員")} sub={t("前往球員頁面新增第一位球員。")}/>
    : <Empty text={t("尚未有賽事紀錄")} sub={t("累積賽事後即可查看 ELO 走勢。")}/>;
  const legend=<>
    <div className="trend-legend-actions"><button type="button" className="trend-clear-btn" onClick={deselectAll} disabled={shownPlayers.length===0}><span>{t("取消全選")}</span></button></div>
    <ul className="trend-legend">{ranked.map(p=>{const hidden=hiddenIds.has(p.id);
      return <li key={p.id}><button type="button" className={`trend-legend-item${hidden?" hidden":""}`} aria-pressed={!hidden} onClick={()=>toggle(p.id)}><i style={{background:avatarHex(p.colour)}}/><span>{p.name}</span><b>{Math.round(p.rating)}</b></button></li>})}
    </ul>
  </>;
  if(shownPlayers.length===0) return <>
    <Empty text={t("尚未選擇球員")} sub={t("請於下方選擇至少一位球員以顯示 ELO 走勢。")}/>
    {legend}
  </>;
  if(dates.length===0) return <>
    <Empty text={t("尚未有賽事紀錄")} sub={t("所選球員累積賽事後即可查看 ELO 走勢。")}/>
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
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={t("各球員 ELO 走勢圖")}>
          {yTicks.map((v,i)=><line key={i} x1="0" y1={y(v)} x2="100" y2={y(v)} className="trend-grid"/>)}
          {activeIndex!=null&&<line x1={x(activeIndex)} y1="2" x2={x(activeIndex)} y2="58" className="trend-guide"/>}
          {series.map(s=><polyline key={s.player.id} points={s.values.map((v,i)=>v==null?null:`${x(i)},${y(v)}`).filter((p):p is string=>p!=null).join(" ")} className="multi-trend-line" style={{stroke:avatarHex(s.player.colour)}}/>)}
          {endLabels.map(({player,anchor,top})=>Math.abs(top-anchor)>0.6&&<line key={player.id} x1={x(lastIndex)} y1={anchor/100*60} x2={x(lastIndex)} y2={top/100*60} className="multi-trend-leader" style={{stroke:avatarHex(player.colour)}}/>)}
        </svg>
        {activeIndex!=null&&series.map(s=>s.values[activeIndex]!=null&&<span key={s.player.id} className="multi-trend-dot" style={{left:`${x(activeIndex)}%`,top:`${y(s.values[activeIndex]!)/60*100}%`,background:avatarHex(s.player.colour)}} aria-hidden="true"/>)}
        {endLabels.map(({player,anchor})=><span key={player.id} className="multi-trend-endpoint" style={{left:`${x(lastIndex)}%`,top:`${anchor}%`,background:avatarHex(player.colour)}} aria-hidden="true"/>)}
        {activeIndex!=null&&<div className={`multi-trend-tooltip${activeAbove?" align-right":""}`} style={{left:`${x(activeIndex)}%`}} role="status">
          <small>{trendDateLabel(dates[activeIndex])}</small>
          <ul>{[...series].filter(s=>s.values[activeIndex!]!=null).sort((a,b)=>b.values[activeIndex!]!-a.values[activeIndex!]!).map(s=><li key={s.player.id}><i style={{background:avatarHex(s.player.colour)}}/><span>{s.player.name}</span><em>{t("{v} 場", {v: s.counts[activeIndex!]})}</em><b>{Math.round(s.values[activeIndex!]!)}</b></li>)}</ul>
        </div>}
        <div className="multi-trend-endlabels" aria-hidden="true">{endLabels.map(({player,value,top})=><div key={player.id} className="multi-trend-endlabel" style={{left:`${x(lastIndex)}%`,top:`${top}%`,color:avatarHex(player.colour)}}><b>{narrow?player.short:player.name}</b><span>{Math.round(value)}</span></div>)}</div>
      </div>
      <div className="multi-trend-xaxis">{xTickIndexes.map(i=><span key={i} style={{left:`${x(i)}%`}}>{trendAxisDateLabel(dates[i])}</span>)}</div>
    </div>
    {legend}
    <p className="chart-summary">{t("點按下方球員名稱可切換顯示；移至圖表可查看該日各球員的 ELO 及累積場數。目前顯示 {shownPlayers} 位球員，共 {dates} 個有賽事的日期。", {shownPlayers: shownPlayers.length, dates: dates.length})}</p>
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
  const t = useT();
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
    return typeof player?.name==="string"?player.name:t("已移除球員");
  };
  if(!stats.matches.length)return <section className="home-view-panel recent-stats-panel"><div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2>{t("近三十日統計")}</h2><p>{t("最近三十日暫時未有已確認賽事。")}</p></div></div><Empty text={t("未有近期賽事")} sub={t("記錄新賽果後，活躍度與近期焦點會顯示在這裡。")}/></section>;
  const maxWeek=Math.max(1,...stats.weekCounts);
  return <section className="home-view-panel recent-stats-panel" aria-labelledby="recent-stats-title">
    <div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2 id="recent-stats-title">{t("近三十日統計")}</h2><p>{t("{thirtyDaysAgo} 至 {today} 的已確認賽事。", {thirtyDaysAgo, today})}</p></div></div>
    <div className="recent-stat-metrics">
      <div><RecentStatIcon kind="matches"/><span><small>{t("比賽場數")}</small><b>{stats.matches.length}</b></span></div>
      <div><RecentStatIcon kind="frames"/><span><small>{t("總局數")}</small><b>{stats.totalFrames}</b></span></div>
      <div><RecentStatIcon kind="players"/><span><small>{t("活躍球員")}</small><b>{stats.active}</b></span></div>
      <div><RecentStatIcon kind="average"/><span><small>{t("平均每場")}</small><b>{stats.average.toFixed(1)}<em>{t("局")}</em></b></span></div>
    </div>
    <div className="recent-focus-grid">
      {stats.busiest&&<button onClick={()=>onPlayer(stats.busiest!.player)}><span className="recent-focus-label"><RecentStatIcon kind="active"/>{t("最活躍球員")}</span><PlayerBadge className="recent-player-badge" player={stats.busiest.player}/><span className="recent-focus-person"><b>{stats.busiest.player.name}</b><em>{t("{matches} 場 · {frames} 局", {matches: stats.busiest.matches, frames: stats.busiest.frames})}</em></span></button>}
      {stats.mover&&<button onClick={()=>onPlayer(stats.mover!.player)}><span className="recent-focus-label"><RecentStatIcon kind="elo"/>{t("ELO 升幅最高")}</span><PlayerBadge className="recent-player-badge" player={stats.mover.player}/><span className="recent-focus-person"><b>{stats.mover.player.name}</b><em className={stats.mover.delta>=0?"positive":"negative"}>{stats.mover.delta>=0?"+":""}{Math.round(stats.mover.delta)} ELO</em></span></button>}
      {stats.winRate&&<button onClick={()=>onPlayer(stats.winRate!.player)}><span className="recent-focus-label"><RecentStatIcon kind="win"/>{t("最高勝率 · 至少 3 場")}</span><PlayerBadge className="recent-player-badge" player={stats.winRate.player}/><span className="recent-focus-person"><b>{stats.winRate.player.name}</b><em>{t("{v}% · {wins}/{matches} 勝", {v: Math.round(stats.winRate.wins/stats.winRate.matches*100), wins: stats.winRate.wins, matches: stats.winRate.matches})}</em></span></button>}
      {stats.topBreak&&<button onClick={()=>onPlayer(stats.topBreak!.player!)}><span className="recent-focus-label"><RecentStatIcon kind="break"/>{t("近三十日最高單桿")}</span><PlayerBadge className="recent-player-badge" player={stats.topBreak.player!}/><span className="recent-focus-person"><b>{stats.topBreak.player!.name}</b><em>{t("{value} 分 · {date}", {value: stats.topBreak.value, date: stats.topBreak.date})}</em></span></button>}
    </div>
    <div className="recent-chart-grid">
      <Surface as="article" className="recent-chart-card recent-activity-chart"><header><div><small>ACTIVITY</small><h3>{t("每週比賽走勢")}</h3></div><strong>{stats.matches.length}<small>{t("場")}</small></strong></header><div className="recent-week-chart" aria-label={t("過去四週比賽場數：{v}", {v: stats.weekCounts.join(t("、"))})}>{stats.weekCounts.map((value,index)=><div key={`week-${index}`}><span><i style={{height:`${Math.max(8,value/maxWeek*100)}%`}}/></span><b>{value}</b><small>{t("第 {v} 週", {v: index+1})}</small></div>)}</div></Surface>
      <Surface as="article" className="recent-chart-card recent-outcome-chart"><header><div><small>OUTCOMES</small><h3>{t("賽事結果分布")}</h3></div></header><div className="recent-donut-wrap"><div className="recent-donut" style={{"--decisive":`${stats.decisive/stats.matches.length*360}deg`} as Record<string,string>}><span><b>{Math.round(stats.decisive/stats.matches.length*100)}%</b><small>{t("分勝負")}</small></span></div><div className="recent-chart-legend"><span><i className="decisive"/><b>{t("分勝負")}</b><em>{t("{decisive} 場", {decisive: stats.decisive})}</em></span><span><i className="draw"/><b>{t("和局")}</b><em>{t("{draws} 場", {draws: stats.draws})}</em></span></div></div></Surface>
      <Surface as="article" className="recent-chart-card recent-balance-chart"><header><div><small>COMPETITION</small><h3>{t("對賽緊湊度")}</h3></div></header><div className="recent-balance-hero"><b>{Math.round(stats.closeMatches/stats.matches.length*100)}<small>%</small></b><span>{t("賽事僅相差一局或以下")}</span></div><footer><span>{t("緊湊賽事")} <b>{stats.closeMatches}</b></span><span>{t("平均差距")} <b>{t("{v} 局", {v: stats.averageMargin.toFixed(1)})}</b></span></footer></Surface>
    </div>
    <div className="recent-detail-grid">
      {stats.rivalry&&<Surface as="button" className="recent-detail-card" onClick={()=>onRivalry(stats.rivalry!.aPlayer,stats.rivalry!.bPlayer)} aria-label={t("查看 {name} 對 {name2} 的對賽紀錄", {name: stats.rivalry.aPlayer.name, name2: stats.rivalry.bPlayer.name})}><small>{t("熱門對賽")}</small><b>{stats.rivalry.aPlayer.name} × {stats.rivalry.bPlayer.name}</b><p>{t("{matches} 場 · 局數 {framesA}–{framesB}", {matches: stats.rivalry.matches, framesA: stats.rivalry.framesA, framesB: stats.rivalry.framesB})}</p><span>{t("查看對賽紀錄 →")}</span></Surface>}
      {stats.closest&&<Surface as="button" className="recent-detail-card recent-close-card" onClick={()=>onMatch(stats.closest!)} aria-label={t("查看 {v} 對 {v2} 的賽事", {v: playerName(stats.closest.a), v2: playerName(stats.closest.b)})}><small>{t("最接近賽事")}</small><b>{playerName(stats.closest.a)} {stats.closest.scoreA}–{stats.closest.scoreB} {playerName(stats.closest.b)}</b><p>{t("{playedOn} · 相差 {v} 局", {playedOn: stats.closest.playedOn, v: Math.abs(stats.closest.scoreA-stats.closest.scoreB)})}</p><span>{t("查看賽事 →")}</span></Surface>}
    </div>  </section>;
}
function fadeHex(hex:string,alpha:number){
  const value=hex.replace("#","");
  const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
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

const monthGroupLabel=(t: Translator, month:string)=>{
  const [y,m]=month.split("-").map(Number);
  const now=new Date(),thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  if(month===thisMonth)return t("本月");
  const last=shiftMonth(thisMonth,-1);
  if(month===last)return t("上月");
  return monthYearLabel(y,m,t.locale);
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
function actualFrameWinRate(record:H2HRecord,id:string,otherId:string){
  return Math.round(record.frames[id]/Math.max(1,record.frames[id]+record.frames[otherId])*100);
}
type H2HPlayerStats={opponents:number;framesWon:number;framesPlayed:number};
function headToHeadPlayerStats(index:Map<string,H2HRecord>){
  const stats=new Map<string,H2HPlayerStats>();
  const add=(playerId:string,framesWon:number,framesPlayed:number)=>{
    const current=stats.get(playerId)??{opponents:0,framesWon:0,framesPlayed:0};
    current.opponents++;
    current.framesWon+=framesWon;
    current.framesPlayed+=framesPlayed;
    stats.set(playerId,current);
  };
  for(const [key,record] of index){
    const [first,second]=key.split("|");
    const framesFirst=record.frames[first]??0;
    const framesSecond=record.frames[second]??0;
    add(first,framesFirst,framesFirst+framesSecond);
    add(second,framesSecond,framesFirst+framesSecond);
  }
  return stats;
}

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
  const t = useT();
  const clamp=(value:number)=>Math.min(MATRIX_ZOOM_MAX,Math.max(MATRIX_ZOOM_MIN,Math.round(value*100)/100));
  return <div className="h2h-matrix-zoom" role="group" aria-label={t("矩陣縮放")}>
    <IconButton label={t("縮小矩陣")} onClick={()=>setZoom(clamp(zoom-MATRIX_ZOOM_STEP))} disabled={zoom<=MATRIX_ZOOM_MIN}>－</IconButton>
    <button type="button" className="h2h-matrix-zoom-value" onClick={()=>setZoom(1)} aria-label={t("重設縮放至 100%")}>{Math.round(zoom*100)}%</button>
    <IconButton label={t("放大矩陣")} onClick={()=>setZoom(clamp(zoom+MATRIX_ZOOM_STEP))} disabled={zoom>=MATRIX_ZOOM_MAX}>＋</IconButton>
  </div>;
}
function HeadToHeadMatrix({squad,squadScope,data,ownPlayerId,onOpenPair}:{squad:MySquad|null;squadScope:ReactNode;data:AppState;ownPlayerId?:string;onOpenPair:(first:string,second:string)=>void}){
  const t = useT();
  const index=useMemo(()=>headToHeadIndex(data.matches),[data.matches]);
  const playerStats=useMemo(()=>headToHeadPlayerStats(index),[index]);
  // Only players who have actually met somebody: an all-players grid is mostly
  // empty cells, and empty cells are the enemy of a readable matrix.
  const players=useMemo(()=>{
    const met=new Set<string>();
    for(const key of index.keys()){const [first,second]=key.split("|");met.add(first);met.add(second)}
    const members=squad?new Set(squad.members.map(member=>member.playerId)):null;
    return data.players.filter(player=>met.has(player.id)&&(!members||members.has(player.id))).sort((left,right)=>right.rating-left.rating||left.name.localeCompare(right.name,"zh-HK"));
  },[data.players,index,squad]);
  const [mode,setMode]=useState<"list"|"grid"|"heatmap">(squad?"heatmap":"list");
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
  const scopeNote=squadScope;
  if(!focus)return <>{scopeNote}<Empty text={t("尚未有對賽記錄")} sub={t("記錄第一場 1v1 比賽後，球員之間的對賽矩陣會顯示在這裡。")}/></>;
  const shareOf=(record:H2HRecord,id:string)=>Math.round((record.wins[id]+record.draws/2)/Math.max(1,record.total)*100);

  return <section className="h2h-matrix" aria-label={t("對賽矩陣")} style={{"--matrix-zoom":mode==="list"?1:zoom} as CSSProperties}>
    {scopeNote}
    <div className="h2h-matrix-toolbar">
      <div className="h2h-matrix-modes-row">
        <div className="h2h-matrix-modes"><SegmentedControl label={t("對賽矩陣顯示方式")} value={mode} onChange={value=>setMode(value as typeof mode)} items={[{value:"list",label:t("清單")},{value:"grid",label:t("全隊")},{value:"heatmap",label:t("勝率")}]}/></div>
        {mode!=="list"&&<MatrixZoomControls zoom={zoom} setZoom={setZoom}/>}
      </div>
      {mode==="list"&&<div className="h2h-matrix-focus">
        <span className="match-filter-label">{t("球員")}</span>
        <div className="match-player-picker">
          <PlayerCombobox players={players} value={focus.id} onChange={id=>{if(id)setFocusId(id)}} placeholder={t("選擇球員")} ariaLabel={t("對賽矩陣主角球員")}/>
        </div>
      </div>}
    </div>
    {mode==="heatmap"?<WinRateHeatmap players={players} index={index} focusId={focus.id} onOpenPair={onOpenPair}/>
    :mode==="list"?<>
      <div className="h2h-matrix-summary">
        <div><small>{t("對手")}</small><b>{rows.length}</b></div>
        <div><small>{t("對賽場數")}</small><b>{totals.played}</b></div>
        <div><small>{t("勝負")}</small><b>{totals.wins}<em>–</em>{totals.losses}</b></div>
      </div>
      {rows.length===0
        ? <Empty text={t("這位球員未有 1v1 對賽記錄")} sub={t("記錄一場 1v1 比賽後，對手就會在這裡出現。")}/>
        : <ul className="h2h-matrix-rows">{rows.map(({opponent,record})=>{
            const share=shareOf(record,focus.id);
            const losses=record.total-record.wins[focus.id]-record.draws;
            return <li key={opponent.id}>
              <button type="button" onClick={()=>onOpenPair(focus.id,opponent.id)} aria-label={t("查看 {name} 對 {name2} 的對賽紀錄，{v} 勝 {losses} 負", {name: focus.name, name2: opponent.name, v: record.wins[focus.id], losses})}>
                <PlayerBadge player={opponent}/>
                <span className="h2h-matrix-row-main">
                  <b>{opponent.name}</b>
                  <small>{t("{total} 場 · 局數 {v}–{v2} · 最近", {total: record.total, v: record.frames[focus.id], v2: record.frames[opponent.id]})} {record.last||"—"}</small>
                  <i className="h2h-matrix-bar" aria-hidden="true"><em style={{width:`${share}%`,background:fadeHex(avatarHex(focus.colour),share<50?.38:1)}}/></i>
                </span>
                <span className={`h2h-matrix-score ${share>50?"ahead":share<50?"behind":"level"}`}>
                  <b>{record.wins[focus.id]}<em>–</em>{losses}</b>
                  {record.draws>0&&<small>{t("{draws} 和", {draws: record.draws})}</small>}
                </span>
              </button>
            </li>;
          })}</ul>}
    </>:<>
      <p className="h2h-matrix-hint">{t("橫行為該球員的局數勝負，向右捲動可看更多對手。")}</p>
      <div className="h2h-matrix-scroll">
        <table className="h2h-matrix-grid">
          <caption className="sr-only">{t("球員之間的 1v1 對賽局數勝負矩陣，橫行球員對直行球員")}</caption>
          <thead><tr><th scope="col"><span className="sr-only">{t("球員")}</span></th>{players.map(player=><th key={player.id} scope="col" title={player.name}>{player.short||player.name.slice(0,2)}</th>)}</tr></thead>
          <tbody>{players.map(row=>{
            const stats=playerStats.get(row.id)??{opponents:0,framesWon:0,framesPlayed:0};
            const rate=stats.framesPlayed?Math.round(stats.framesWon/stats.framesPlayed*100):0;
            const statsLabel=t("對手 {opponents} 位 · 勝局 {framesWon} 局 · 局數勝率 {rate}%", {opponents: stats.opponents, framesWon: stats.framesWon, rate});
            return <tr key={row.id} className={row.id===focus.id?"focused":""}>
            <th scope="row"><span className="h2h-matrix-rowhead"><span className="h2h-matrix-player-trigger" tabIndex={0} title={t("{name}：{statsLabel}", {name: row.name, statsLabel})} aria-describedby={`h2h-player-stats-${row.id}`}><PlayerBadge player={row}/><span className="h2h-matrix-player-name-text">{row.short||row.name}</span><span className="h2h-matrix-player-stats" id={`h2h-player-stats-${row.id}`} role="tooltip"><b>{row.name}</b><span>{statsLabel}</span></span></span></span></th>
            {players.map(column=>{
              if(column.id===row.id)return <td key={column.id} className="self" aria-label={t("同一位球員")}>—</td>;
              const record=index.get(h2hKey(row.id,column.id));
              if(!record)return <td key={column.id} className="none" aria-label={t("{name} 與 {name2} 未曾交手", {name: row.name, name2: column.name})}>·</td>;
              const share=actualFrameWinRate(record,row.id,column.id);
              const framesWon=record.frames[row.id],framesLost=record.frames[column.id];
              return <td key={column.id} className={share>50?"ahead":share<50?"behind":"level"}>
                <button type="button" onClick={()=>onOpenPair(row.id,column.id)} aria-label={t("{name} 對 {name2}：局數 {framesWon} 勝 {framesLost} 負，共 {total} 場", {name: row.name, name2: column.name, framesWon, framesLost, total: record.total})}>
                  <b>{framesWon}<em>–</em>{framesLost}</b>
                </button>
              </td>;
            })}
          </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="h2h-matrix-legend"><span><i className="ahead"/>{t("領先")}</span><span><i className="level"/>{t("均勢")}</span><span><i className="behind"/>{t("落後")}</span><span><i className="none"/>{t("未交手")}</span></div>
    </>}
  </section>;
}

/* "誰打得贏誰" now reflects recorded frames, not an ELO forecast. A diverging heat scale
   keeps the same scan-friendly shape while blanking pairings with no actual meeting. */
function WinRateHeatmap({players,index,focusId,onOpenPair}:{players:Player[];index:Map<string,H2HRecord>;focusId:string;onOpenPair:(first:string,second:string)=>void}){
  const t = useT();
  if(players.length<2)return <Empty text={t("尚未有足夠對賽記錄")} sub={t("至少兩位球員記錄過 1v1 比賽後，實際局數勝率矩陣會顯示在這裡。")}/>;
  return <>
    <p className="h2h-matrix-hint">{t("有交手記錄時，顯示橫行球員對直行球員的實際局數勝率；顏色越深代表局數優勢越大。")}</p>
    <div className="h2h-matrix-scroll">
      <table className="h2h-matrix-grid h2h-heatmap">
        <caption className="sr-only">{t("球員之間的實際局數勝率矩陣，橫行球員對直行球員")}</caption>
        <thead><tr><th scope="col"><span className="sr-only">{t("球員")}</span></th>{players.map(player=><th key={player.id} scope="col" title={player.name}>{player.short||player.name.slice(0,2)}</th>)}</tr></thead>
        <tbody>{players.map(row=><tr key={row.id} className={row.id===focusId?"focused":""}>
          <th scope="row"><span className="h2h-matrix-rowhead"><PlayerBadge player={row}/><span>{row.short||row.name}</span></span></th>
          {players.map(column=>{
            if(column.id===row.id)return <td key={column.id} className="self" aria-label={t("同一位球員")}>—</td>;
            const record=index.get(h2hKey(row.id,column.id));
            if(!record)return <td key={column.id} className="none" aria-label={t("{name} 與 {name2} 未曾交手，沒有實際局數勝率", {name: row.name, name2: column.name})}>·</td>;
            const framesWon=record.frames[row.id]??0;
            const framesLost=record.frames[column.id]??0;
            const rate=actualFrameWinRate(record,row.id,column.id);
            return <td key={column.id} style={winRateHeat(rate)}>
              <button type="button" onClick={()=>onOpenPair(row.id,column.id)} aria-label={t("{name} 對 {name2} 的實際局數勝率為 {rate}%，局數 {framesWon}–{framesLost}，共 {total} 場", {name: row.name, name2: column.name, rate, framesWon, framesLost, total: record.total})}>
                <b>{rate}%</b>
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="h2h-matrix-legend h2h-heatmap-legend">
      <span><i style={winRateHeat(85)}/>{t("較高局數勝率")}</span>
      <span><i style={winRateHeat(50)}/>{t("局數均勢")}</span>
      <span><i style={winRateHeat(15)}/>{t("較低局數勝率")}</span>
      <span><i className="none"/>{t("未曾交手")}</span>
    </div>
  </>;
}

function Matches({squad,squadScope,data,canManageMatch,canManageCup,onEdit,onVoid,onShare,onPlayer,view,setView,pair,setPair,highlight,isAdmin,onCreateTournament,onEditTournament,onDeleteTournament,ownPlayerId,onSignUpTournament,onSetArrivalTime,onRecordSlot,onArrange,onWalkover,onEditRoster,onShuffleRoster,onReorderRoster,onRefresh}:{squad:MySquad|null;squadScope:ReactNode;data:AppState;canManageMatch:(match:Match)=>boolean;canManageCup:(tournament:Tournament)=>boolean;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void;onPlayer:(player:Player)=>void;view:"history"|"calendar"|"cup"|"matrix";setView:(view:"history"|"calendar"|"cup"|"matrix")=>void;pair:{a:string;b:string};setPair:(pair:{a:string;b:string})=>void;highlight:string|null;isAdmin:boolean;onCreateTournament:()=>void;onEditTournament:(tournament:Tournament)=>void;onDeleteTournament:(tournament:Tournament)=>void;ownPlayerId?:string;onSignUpTournament:(id:string,arrivalTime?:string)=>void;onSetArrivalTime:(tournamentId:string,arrivalTime:string)=>void;onRecordSlot:(tournament:Tournament,slot:BracketSlot<Match>)=>void;onArrange:(opponentId:string)=>void;onWalkover:(tournament:Tournament,slot:BracketSlot<Match>,winnerId:string)=>void;onEditRoster:(tournament:Tournament,outgoingId:string,incomingId:string)=>void;onShuffleRoster:(tournament:Tournament)=>void;onReorderRoster:(tournament:Tournament,draggedId:string,targetId:string)=>void;onRefresh:()=>void}) {
  const matchTabsId=useId();
  const t = useT();
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
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??t("已刪除球員");
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
  return <><section className="hero small"><div><p className="kicker">{t("完整可追溯")}</p><h1>{t("比賽記錄")}</h1><p>{t("查看比分、讓分與每場 ELO 變化。")}</p></div></section>
    <TabList id={matchTabsId} className="page-tabs match-view-toggle" label={t("比賽資料檢視")} value={view} onChange={value=>setView(value as typeof view)} items={[
      {value:"history",label:t("賽事記錄")},
      {value:"calendar",label:t("日曆")},
      {value:"matrix",label:t("對賽矩陣")},
      {value:"cup",accessibleLabel:t("盃賽{v}", {v: openTournamentCount>0?t("，{openTournamentCount} 個盃賽開放報名", {openTournamentCount}):""}),label:<>{t("盃賽")}{openTournamentCount>0&&<span className="match-tab-count" aria-hidden="true">{openTournamentCount>9?"9+":openTournamentCount}</span>}</>},
    ]}/>
    {["history","calendar","matrix","cup"].filter(item=>item!==view).map(item=><TabPanel key={item} id={matchTabsId} value={item} active={false}>{null}</TabPanel>)}
    <TabPanel id={matchTabsId} value={view} active>
    {view==="matrix"?<HeadToHeadMatrix squad={squad} squadScope={squadScope} data={data} ownPlayerId={ownPlayerId} onOpenPair={(first,second)=>{setPair({a:first,b:second});setModeFilter("all");setView("history")}}/> : view==="calendar"?<CalendarView data={data} canManageMatch={canManageMatch} onPlayer={onPlayer} onEdit={onEdit} onVoid={onVoid} onShare={onShare}/> : view==="cup" ? <CupBracketView data={data} selectedTournament={selectedTournament} setSelectedTournament={setSelectedTournament} canManageMatch={canManageMatch} canManageCup={canManageCup} onEdit={onEdit} isAdmin={isAdmin} onCreateTournament={onCreateTournament} onEditTournament={onEditTournament} onDeleteTournament={onDeleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={onSignUpTournament} onSetArrivalTime={onSetArrivalTime} onRecordSlot={onRecordSlot} onArrange={onArrange} onWalkover={onWalkover} onEditRoster={onEditRoster} onShuffleRoster={onShuffleRoster} onReorderRoster={onReorderRoster} onRefresh={onRefresh}/> : <>
    <section className="match-filter-toolbar" aria-label={t("篩選及排序比賽記錄")}>
      <div className="match-filter-control player-control">
        <span className="match-filter-label">{t("球員")}</span>
        <div className="match-player-picker">
          {a&&<span className="match-player-chip">{a.name}<IconButton label={t("取消選擇 {name}", {name: a.name})} onClick={()=>setFocus("")}>×</IconButton></span>}
          {opponent&&<span className="match-player-chip compare">{opponent.name}<IconButton label={t("取消比較 {name}", {name: opponent.name})} onClick={()=>setOpponent("")}>×</IconButton></span>}
          {!focusPlayer&&<PlayerCombobox players={roster} value="" onChange={setFocus} placeholder={t("全部球員")} ariaLabel={t("球員")}/>}
          {focusPlayer&&!opponent&&<PlayerCombobox players={roster.filter(p=>p.id!==focusPlayer)} value="" onChange={setOpponent} placeholder={t("＋ 比較球員")} ariaLabel={t("選擇比較球員")}/>}
        </div>
      </div>
      <div className="match-filter-control type-control sort-control">
        <span className="match-filter-label">{t("類型")}</span>
        <select aria-label={t("比賽類型")} value={modeFilter} onChange={event=>setModeFilter(event.target.value as "all"|MatchMode)}>
          <option value="all">{t("全部")}</option>
          <option value="1v1">1v1</option>
          <option value="2v2">2v2</option>
          <option value="cup">{t("盃賽")}</option>
        </select>
      </div>
      <div className="match-filter-control sort-control"><span className="match-filter-label">{t("排序")}</span><div className="match-sort-compact"><select aria-label={t("排序依據")} value={sortBy} onChange={event=>setSortBy(event.target.value as "playedOn"|"createdAt")}><option value="playedOn">{t("比賽日期")}</option><option value="createdAt">{t("加入日期")}</option></select><button type="button" aria-label={sortDirection==="desc"?t("目前最新至最舊；按下改為最舊至最新"):t("目前最舊至最新；按下改為最新至最舊")} title={sortDirection==="desc"?t("最新至最舊"):t("最舊至最新")} onClick={()=>setSortDirection(value=>value==="desc"?"asc":"desc")}>{sortDirection==="desc"?"↓":"↑"}</button></div></div>
    </section>
    {(focusPlayer||modeFilter!=="all")&&<div className="match-filter-status"><span>{t("{matches} 場符合記錄", {matches: matches.length})}</span><Button variant="quiet" onClick={clearAll}>{t("清除篩選")}</Button></div>}    {comparing&&a&&opponent&&h2hStats&&<div className="h2h-summary neutral">
      <div className="h2h-hero-players">
        <div className="h2h-hero-player"><PlayerBadge player={a}/><b>{a.name}</b><small>{Math.round(a.rating)} ELO</small></div>
        <div className="h2h-hero-score"><span><b>{h2hStats.winsA}</b><em>–</em><b>{h2hStats.winsB}</b></span>{h2hStats.draws>0&&<small>{t("{draws} 和", {draws: h2hStats.draws})}</small>}</div>
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
      {recentForm.length>0&&<div className="h2h-hero-form"><small>{t("近{recentForm}場", {recentForm: recentForm.length})}</small><div className="h2h-form-dots">{recentForm.map((result,index)=><i key={index} className={`form-dot ${result.toLowerCase()}`} aria-label={result==="W"?t("勝"):result==="L"?t("負"):t("和")}>{result}</i>)}</div></div>}
      <div className="h2h-hero-stats">
        <div><small>{t("局數比例")}</small><b>{h2hStats.framesA}<em>–</em>{h2hStats.framesB}</b></div>
        <div><small>{t("總場數")}</small><b>{headToHeadMatches.length}</b></div>
        <div><small>{t("最近交手")}</small><b>{headToHeadMatches[0]?.playedOn??"—"}</b></div>
      </div>
    </div>}
    <div className="match-list">{groups.length===0?<Empty text={comparing?t("沒有符合的對賽記錄"):filteringShared2v2?t("沒有兩人共同參與的 2v2 記錄"):focusPlayer?t("沒有符合的比賽記錄"):t("尚未有比賽記錄")} sub={comparing?t("記錄兩人的第一場比賽後，對賽記錄會顯示在這裡。"):filteringShared2v2?t("兩位球員可以是隊友或對手；目前沒有同時包含兩人的賽事。"):focusPlayer?t("這位球員暫時沒有已記錄的賽事。"):t("記錄第一場比賽後，詳情會顯示在這裡。")}/>:groups.map(group=>{
      const cards=group.matches.map(m=><MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} onShare={onShare} highlighted={m.id===highlight}/>);
      if(comparing)return <Fragment key={group.key}>{cards}</Fragment>;
      const open=monthOpen[group.key]??(group.key===newestMonth||group.matches.some(m=>m.id===highlight));
      const panelId=`match-month-${group.key}`;
      return <section className="match-month-group" key={group.key}>
        <button type="button" className="match-month-header" aria-expanded={open} aria-controls={panelId} onClick={()=>setMonthOpen(value=>({...value,[group.key]:!open}))}>
          <span>{monthGroupLabel(t, group.key)}</span><small>{t("{matches} 場", {matches: group.matches.length})}</small><i aria-hidden="true"/>
        </button>
        {open&&<div className="match-month-cards" id={panelId}>{cards}</div>}
      </section>;
    })}</div></>}</TabPanel></>;
}

type CupStatus="signup"|"live"|"done"|"short";
function cupStatus(tournament:Tournament,matches:Match[]):CupStatus{
  if(!signupsClosed(tournament))return "signup";
  const bracket=buildBracket<Match>(tournament,matches);
  if(!bracket.size)return "short";
  return bracket.champion?"done":"live";
}
const CUP_STATUS_LABEL:Record<CupStatus,string>={signup:msg("報名中"),live:msg("進行中"),done:msg("已完成"),short:msg("人數不足")};

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
  const t = useT();
  return <div className="time-of-day-picker">
    <select aria-label={t("小時")} value={hour} onChange={event=>onHour(event.target.value)}>{ARRIVAL_HOURS.map(h=><option key={h} value={h}>{h}</option>)}</select>
    <span aria-hidden="true">:</span>
    <select aria-label={t("分鐘")} value={minute} onChange={event=>onMinute(event.target.value)}>{ARRIVAL_MINUTES.map(m=><option key={m} value={m}>{m}</option>)}</select>
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
  const t = useT();
  const tournament=data.tournaments.find(item=>item.id===selectedTournament);
  const player=useCallback((id:string)=>data.players.find(item=>item.id===id),[data.players]);
  const name=(id:string)=>player(id)?.name??t("待定");
  const deadlineText=(value:string)=>formatTournamentDateTime(t, value);
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
        round:index+1,name:roundLabel(t, index+1,bracket.rounds),
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
  },[bracket,ownPlayerId,player, t]);
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
  /* The same gesture means two different edits depending on where it started: dragging a row in the
     roster list moves it up or down that list, while dragging a name in the bracket trades it with
     whoever it lands on. Recording the origin at touch-start is what keeps them apart, since by
     touch-end both look like "this id onto that id". */
  const touchDragOrigin=useRef<"roster"|"bracket">("roster");
  const onRosterHandleTouchStart=(id:string,origin:"roster"|"bracket"="roster")=>()=>{
    touchDragId.current=id;
    touchOverId.current="";
    touchDragOrigin.current=origin;
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
      if(touchDragOrigin.current==="bracket")onEditRoster(tournamentForDrop,touchDragId.current,touchOverId.current);
      else onReorderRoster(tournamentForDrop,touchDragId.current,touchOverId.current);
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
  const confirmSignupDialog=pendingSignup&&<ConfirmDialog kicker={pendingSignup.joined?t("取消報名"):t("確認報名")} titleId="cup-signup-confirm-title"
    title={pendingSignup.joined?t("確定取消「{name}」的報名？", {name: pendingSignup.name}):t("確定報名參加「{name}」？", {name: pendingSignup.name})}
    description={pendingSignup.joined?t("取消後可重新報名，但截止後就無法再加入。"):t("截止前都可以隨時取消報名；報名後仍可隨時更改預計到達時間。")}
    onClose={()=>setPendingSignup(null)}
    extra={!pendingSignup.joined&&<div className="cup-arrival-toggle-block">
      {/* Optional and skippable — a member can always add or change it later from the cup page, so
          this is a convenience offered at the moment it's top of mind, never a gate on signing up. */}
      <div className="cup-arrival-toggle-row" role="switch" aria-checked={signupArrivalOn} aria-label={t("分享預計到達時間")} tabIndex={0}
        onClick={()=>setSignupArrivalOn(value=>!value)}
        onKeyDown={event=>{if(event.key===" "||event.key==="Enter"){event.preventDefault();setSignupArrivalOn(value=>!value)}}}>
        <div className="cup-arrival-toggle-copy"><b>{t("分享預計到達時間")}</b><small>{t("可選 — 讓其他球員知道你大約幾點到場。")}</small></div>
        <span className={`toggle-switch${signupArrivalOn?" on":""}`} aria-hidden="true"><i/></span>
      </div>
      {signupArrivalOn&&<div className="cup-arrival-field">
        <span>{t("預計到達時間")}</span>
        <TimeOfDayPicker hour={signupArrivalHour} minute={signupArrivalMinute} onHour={setSignupArrivalHour} onMinute={setSignupArrivalMinute}/>
      </div>}
    </div>}>
    <Button variant="secondary" onClick={()=>setPendingSignup(null)}>{t("返回")}</Button>
    <Button variant={pendingSignup.joined?"danger":"primary"} onClick={()=>{const id=pendingSignup.id,joined=pendingSignup.joined,arrivalTime=signupArrivalOn?`${signupArrivalHour}:${signupArrivalMinute}`:"";setPendingSignup(null);setSignupArrivalOn(false);onSignUpTournament(id,joined?undefined:(arrivalTime||undefined))}}>{pendingSignup.joined?t("確定取消"):t("確定報名")}</Button>
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
    return cupShareState(t, {
      signupDeadline:item.signupDeadline,entrants:item.signups?.length??0,closed:signupsClosed(item),
      drew:Boolean(itemBracket.size),
      roundName:currentRoundLabel(t, itemBracket),
      championName:itemBracket.champion?name(itemBracket.champion):"",
    });
  };
  const shareCup=async(item:Tournament)=>{
    const state=shareStateOf(item);
    const url=cupShareUrl(window.location.origin,item.id);
    const message=cupShareMessage(t, item.name,state,url);
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
    const cta=cupShareCta(t, state);
    return <button type="button" className={`${className} wa-btn`} onClick={()=>void shareCup(item)} aria-label={cta.label}>
      <ShareGlyph kind="whatsapp"/>
      <span>{compact?(state.status==="signup"?t("叫人報名"):t("分享")):cta.label}</span>
    </button>;
  };

  const controls=(item:Tournament)=><span className="cup-admin"><IconButton className="cup-admin-btn" label={t("編輯 {name}", {name: item.name})} onClick={()=>onEditTournament(item)}>✎</IconButton>{isAdmin&&<IconButton className="cup-admin-btn danger" label={t("刪除 {name}", {name: item.name})} onClick={()=>onDeleteTournament(item)}>✕</IconButton>}</span>;
  const avatarStack=(ids:string[])=><span className="cup-avatars">{ids.slice(0,5).map(id=><PlayerBadge key={id} player={player(id)??{short:"?"}}/>)}{ids.length>5&&<i>+{ids.length-5}</i>}</span>;

  if(!selectedTournament){
    const cups=[...data.tournaments].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
    const cupEntries=cups.map(item=>({item,status:cupStatus(item,data.matches)}));
    const championTable=Array.from(cupEntries.reduce((table,{item,status})=>{
      if(status!=="done")return table;
      const championId=buildBracket<Match>(item,data.matches).champion;
      if(!championId)return table;
      const previous=table.get(championId);
      table.set(championId,{playerId:championId,titles:(previous?.titles??0)+1,lastTitle:item.name,lastWonAt:item.startAt??item.createdAt});
      return table;
    },new Map<string,{playerId:string;titles:number;lastTitle:string;lastWonAt:string}>()).values()).sort((left,right)=>right.titles-left.titles||right.lastWonAt.localeCompare(left.lastWonAt)||name(left.playerId).localeCompare(name(right.playerId),"zh-HK"));
    const cupSections=[
      {id:"active",label:t("報名中／進行中賽事"),entries:cupEntries.filter(entry=>entry.status!=="done")},
      {id:"done",label:t("已完成賽事"),entries:cupEntries.filter(entry=>entry.status==="done")},
    ].filter(section=>section.entries.length>0);
    return <section className="cup">
      <div className="cup-intro">
        <div><p className="sl-eyebrow">{t("SCAA 盃賽")}</p><h2>{t("盃賽")}</h2><p>{t("報名、抽籤、對陣同賽果，一頁睇晒。")}</p></div>
        {isAdmin&&<Button onClick={onCreateTournament}>{t("＋ 新增盃賽")}</Button>}
      </div>
      {championTable.length>0&&<section className="cup-honours" aria-labelledby="cup-honours-title">
        <div className="cup-honours-head">
          <div><p className="sl-eyebrow">Hall of champions</p><h3 id="cup-honours-title">{t("歷屆冠軍榜")}</h3></div>
          <span>{cupEntries.filter(entry=>entry.status==="done").length}  {t("屆賽事")}</span>
        </div>
        <ol className="cup-honours-list">
          {championTable.map((champion,index)=>{
            const championPlayer=player(champion.playerId)??{short:"?"};
            return <li className={index===0?"is-leader":""} key={champion.playerId}>
              <span className="cup-honours-rank" aria-label={t("第 {v} 名", {v: index+1})}>{index===0?"♛":String(index+1).padStart(2,"0")}</span>
              <PlayerBadge player={championPlayer}/>
              <span className="cup-honours-player"><b>{name(champion.playerId)}</b><small>{t("最近勝出 · {lastTitle}", {lastTitle: champion.lastTitle})}</small></span>
              <span className="cup-honours-count"><b>{champion.titles}</b><small>{t("次冠軍")}</small></span>
            </li>;
          })}
        </ol>
      </section>}
      {cups.length===0?<div className="cup-empty"><span aria-hidden="true">🏆</span><b>{t("尚未有盃賽")}</b><p>{isAdmin?t("建立第一個盃賽，球員即可報名。"):t("管理員建立盃賽後，你就可以在這裡報名。")}</p></div>
      :<div className="cup-sections">{cupSections.map(section=><section className="cup-section" aria-labelledby={`cup-section-${section.id}`} key={section.id}>
        <div className="cup-section-divider"><h3 id={`cup-section-${section.id}`}>{section.label}</h3></div>
        <div className="cup-list">{section.entries.map(({item,status})=>{
        const itemBracket=buildBracket<Match>(item,data.matches);
        const itemSlot=playerSlot(itemBracket,ownPlayerId),itemSignedUp=Boolean(ownPlayerId&&item.signups.includes(ownPlayerId));
        const line=item.startAt?t("開始 {v} · {v2}", {v: deadlineText(item.startAt), v2: status==="signup"?t("報名截止 {v}", {v: deadlineText(item.signupDeadline)}):status==="done"?t("冠軍 {v}", {v: name(itemBracket.champion)}):status==="short"?t("報名人數不足兩人"):itemSlot?t("輪到你：{v}", {v: itemSlot.state==="ready"?t("對 {v}", {v: name(opponentIn(itemSlot,ownPlayerId))}):t("等待對手")}):t("賽事進行中")})
          :status==="signup"?t("報名截止 {v}", {v: deadlineText(item.signupDeadline)})
          :status==="done"?t("冠軍 {v}", {v: name(itemBracket.champion)})
          :status==="short"?t("報名人數不足兩人")
          :itemSlot?t("輪到你：{v}", {v: itemSlot.state==="ready"?t("對 {v}", {v: name(opponentIn(itemSlot,ownPlayerId))}):t("等待對手")})
          :t("賽事進行中");
        return <Surface as="article" padded={false} className={`cup-card is-${status}`} key={item.id}>
          <CupArt tone={status==="done"?"gold":"dark"}/>
          <div className="cup-card-body">
            <div className="cup-card-top"><span className={`cup-chip is-${status}`}>{t(CUP_STATUS_LABEL[status])}</span>{canManageCup(item)&&controls(item)}</div>
            <h3>{item.name}</h3>
            <p className="cup-card-line">{line}</p>
            <div className="cup-card-people">{item.signups.length>0&&avatarStack(item.signups)}<span>{t("{signups} 人報名", {signups: item.signups.length})}</span></div>
            <div className="cup-card-actions">
              {status==="signup"&&(ownPlayerId
                ?<Button variant={itemSignedUp?"secondary":"primary"} className="cup-btn" onClick={()=>setPendingSignup({id:item.id,name:item.name,joined:itemSignedUp})}>{itemSignedUp?t("取消報名"):t("立即報名")}</Button>
                :<a className="cup-btn primary" href="/login">{t("登入後報名")}</a>)}
              <Button variant={status==="signup"?"secondary":"primary"} className="cup-btn" onClick={()=>setSelectedTournament(item.id)}>{status==="signup"?t("睇對陣預覽"):t("賽程")}<span className="cup-btn-mark" aria-hidden="true">›</span></Button>
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
  /* Who plays who is a round-one property: every later box is filled by whoever wins the boxes
     feeding it, so the only seats a host can set by hand are the ones the draw dealt. A seat stays
     editable for as long as its player has no recorded result — `swapPlayer` enforces the same rule
     server-side, and trading two seats leaves every other pairing in the bracket exactly as it was,
     which is what makes this safe to offer mid-cup when a reshuffle is not. */
  const playedIds=new Set(cupMatches(data.matches,tournament.id).flatMap(match=>[match.a,match.b]));
  const canMoveSeat=(id:string)=>canManage&&deadlinePassed&&drawn&&Boolean(id)&&!playedIds.has(id);
  const seatOpponents=(id:string)=>rosterIds.filter(other=>other!==id&&!playedIds.has(other));
  /* The picker is the keyboard and touch route to the same edit as the drag — a bracket you can only
     rearrange by dragging is a bracket a host on a phone, or on a keyboard, cannot rearrange. */
  const seatTool=(id:string,round:number)=>{
    if(round!==1||!canMoveSeat(id))return null;
    const opponents=seatOpponents(id);
    if(!opponents.length&&!spare.length)return null;
    return <select className="cup-seat-edit" defaultValue="" aria-label={t("調整 {v} 的對陣", {v: name(id)})}
      onChange={event=>{const value=event.target.value;event.target.value="";if(value)onEditRoster(tournament,id,value)}}>
      <option value="">⋯</option>
      {opponents.length>0&&<optgroup label={t("對調位置")}>{opponents.map(other=><option key={other} value={other}>{name(other)}</option>)}</optgroup>}
      {spare.length>0&&<optgroup label={t("換上")}>{spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
    </select>;
  };
  /* Adding or dropping a name re-lays the whole field, so it stays open exactly as long as the
     reshuffle does — before the draw it is a plain sign-up edit, after the first result the swap
     picker and the walkover button are the tools that do not disturb settled boxes. */
  const canEditEntrants=canManage&&(!drawn||(deadlinePassed&&!hasCupResults));
  const canArrangeRoster=canManage&&rosterIds.length>=2&&(status==="done"||(deadlinePassed&&!hasCupResults));
  const rosterPanel=rosterIds.length>0||canManage?<div className="cup-roster">
    <h3>{drawn?t("參賽名單"):t("報名名單")} <span className="cup-roster-count">{rosterIds.length}</span>{canManage&&canShuffle&&<Button variant="secondary" className="cup-btn sm cup-roster-shuffle" onClick={()=>onShuffleRoster(tournament)}>{t("重新抽籤")}</Button>}</h3>
    {lateSignups.length>0&&<InlineNotice tone="warning" title={t("報名時間在抽籤之後")}>{lateSignups.map(id=>name(id)).join(t("、"))}  {t("已報名，但抽籤時尚未報名，故未列入對陣圖。")}{canManage&&(canEditEntrants?t("如需加入，請於下方「加入球員」把他們加入籤表。"):t("已有賽果，如需加入請使用「換上」替補名單上的球員。"))}</InlineNotice>}
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
          onTouchStart={onRosterHandleTouchStart(id,"roster")}
          onTouchMove={onRosterHandleTouchMove}
          onTouchEnd={onRosterHandleTouchEnd(tournament)}
          onTouchCancel={onRosterHandleTouchEnd(tournament)}
          style={{touchAction:"none"}}>⠿</span>}
        <PlayerBadge player={player(id)??{short:"?"}}/>
        <div className="cup-roster-player-copy">
          <b>{name(id)}</b>
          <span className="cup-roster-stat">
            {standing.rating!=null?<span className="cup-roster-stat-item"><i>ELO</i>{standing.rating}</span>:<em>{t("未評分")}</em>}
            {standing.handicap!=null&&tournament.handicapMode==="suggested"&&<span className="cup-roster-stat-item"><i>{t("評分")}</i>{standing.handicap}</span>}
            {tournament.arrivalTimes?.[id]&&<span className="cup-roster-arrival"><i aria-hidden="true">🕒</i>{tournament.arrivalTimes[id]}</span>}
          </span>
        </div>
      </div>
      <span className="cup-roster-actions">
        {canManage&&<select className="cup-roster-edit" defaultValue="" onChange={rosterPick(id)} aria-label={t("更換 {v}", {v: name(id)})}>
          <option value="">⋯</option>
          <optgroup label={t("換上")}>{spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
        </select>}
        {canEditEntrants&&<Button variant="quiet" className="cup-btn sm cup-roster-remove" onClick={()=>onEditRoster(tournament,id,"")}>{t("移除")}</Button>}
      </span>
    </li>;})}</ul>
    {canManage&&canArrangeRoster&&<p className="cup-roster-note">{t("拖曳球員名稱可調整名單順序")}{status!=="done"&&t("，亦會更新對陣圖")}{t("。")}</p>}
    {/* The list reorders; the bracket trades seats. Two different edits, so say where the other one
        lives rather than letting a host hunt for it. */}
    {canManage&&drawn&&deadlinePassed&&<p className="cup-roster-note">{t("如要指定邊個打邊個，可在下方對陣圖／賽程用每位球員旁的「⋯」對調位置，或直接拖曳對陣圖上的名字。")}</p>}
    {canManage&&<label className="cup-roster-add">
      <span>{!canEditEntrants?t("已有賽果，只可替換名單上的球員"):drawn?t("加入球員（會重新排列籤表）"):t("加入球員")}</span>
      {canEditEntrants&&<select defaultValue="" onChange={event=>{const value=event.target.value;event.target.value="";if(value)onEditRoster(tournament,"",value)}}>
        <option value="">{t("選擇球員…")}</option>
        {spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
    </label>}
  </div>:null;

  const tieRow=(slot:BracketSlot<Match>)=>{
    const mine=Boolean(ownPlayerId&&(slot.a===ownPlayerId||slot.b===ownPlayerId));
    const canRecord=slot.state==="ready"&&Boolean(isAdmin||mine);
    const note=slot.state==="bye"?t("{v} 輪空晉級", {v: name(slot.winner)})
      :slot.state==="walkover"?t("{v} 因對手棄權晉級", {v: name(slot.winner)})
      :slot.state==="waiting"?t("等待上一圈賽果")
      :slot.state==="tbd"?t("對陣待定")
      :slot.state==="ready"?t("未開賽"):"";
    const key=`${slot.round}-${slot.index}`;
    return <li id={`cup-tie-${key}`} className={`cup-tie ${slot.state}${mine?" mine":""}${focusTie===key?" focus":""}`} key={key}>
      {/* A cup runs over weeks, so "who won" without "when" leaves the bracket undated — the one
          question a member asks of a finished tie after the fact. */}
      <div className="cup-tie-head"><span className="cup-tie-no">{t("第 {index} 場", {index: slot.index})}</span>
        {slot.match&&<time className="cup-tie-date" dateTime={slot.match.playedOn}>{slot.match.playedOn}</time>}
        {mine&&<span className="cup-tie-mine">{t("你的賽事")}</span>}
        {slot.match&&canManageMatch(slot.match)&&<IconButton className="card-tool cup-tie-edit" label={t("編輯 {v} 對 {v2} 的賽果", {v: name(slot.a), v2: name(slot.b)})} onClick={()=>onEdit(slot.match!)}>✎</IconButton>}</div>
      {([slot.a,slot.b] as const).map((id,side)=>{
        const won=Boolean(slot.winner&&slot.winner===id);
        return <div className={`cup-tie-side${won?" won":""}${id?"":" tbd"}`} key={side}>
          <PlayerBadge player={player(id)??{short:"?"}}/>
          <b>{id?name(id):t("待定")}</b>
          {slot.match&&id?<em>{scoreFor(slot.match,id)}</em>:won?<i aria-hidden="true">✓</i>:null}
          {seatTool(id,slot.round)}
        </div>;
      })}
      {note&&<p className="cup-tie-note">{note}</p>}
      <div className="cup-tie-actions">
        {canRecord&&<Button variant="primary" className="cup-btn sm" onClick={()=>onRecordSlot(tournament,slot)}>{t("記錄賽果")}</Button>}
        {canRecord&&mine&&<Button variant="secondary" className="cup-btn sm" onClick={()=>onArrange(opponentIn(slot,ownPlayerId))}>{t("約時間")}</Button>}
        {canManage&&slot.state==="ready"&&[slot.a,slot.b].map(id=><Button variant="secondary" className="cup-btn sm" key={id} onClick={()=>onWalkover(tournament,slot,id)}>{t("判 {v} 晉級", {v: name(id)})}</Button>)}
        {canManage&&slot.state==="walkover"&&<Button variant="secondary" className="cup-btn sm" onClick={()=>onWalkover(tournament,slot,"")}>{t("取消判定")}</Button>}
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
    {key:"early",label:t("提早15分鐘"),time:shiftHHMM(startAtTime,-15)},
    {key:"onTime",label:t("準時到達"),time:startAtTime},
    {key:"late15",label:t("遲到15分鐘"),time:shiftHHMM(startAtTime,15)},
    {key:"late30",label:t("遲到30分鐘"),time:shiftHHMM(startAtTime,30)},
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
        <b><span aria-hidden="true">🕒</span>  {t("到達時間")}</b>
        <small>{myArrivalTime?t("已告知其他球員你預計到達的時間。"):t("可選 — 讓其他球員知道你大約幾點到場。")}</small>
      </div>
      <div className="cup-arrival-card-actions">
        {myArrivalTime&&<span className="cup-arrival-value">{myArrivalTime}</span>}
        <Button variant="secondary" className="cup-btn sm" aria-expanded={arrivalPanelOpen} onClick={()=>{if(arrivalPanelOpen){setArrivalCustomOpen(false)}setArrivalPanelOpen(value=>!value)}}>{arrivalPanelOpen?t("收起"):myArrivalTime?t("更改"):t("設定")}</Button>
      </div>
    </div>
    {arrivalPanelOpen&&<>
      <div className="cup-arrival-presets">
        {arrivalPresets.map(preset=><button type="button" key={preset.key} className={`cup-arrival-preset${myArrivalTime===preset.time?" active":""}`} onClick={()=>applyArrival(preset.time)}>
          <b>{preset.time}</b><small>{preset.label}</small>
        </button>)}
        <button type="button" className={`cup-arrival-preset is-custom${arrivalCustomOpen?" active":""}`} aria-expanded={arrivalCustomOpen} onClick={openArrivalCustom}>
          <b aria-hidden="true">⋯</b><small>{t("自訂時間")}</small>
        </button>
      </div>
      {arrivalCustomOpen&&<div className="cup-arrival-custom">
        <TimeOfDayPicker hour={arrivalCustomHour} minute={arrivalCustomMinute} onHour={setArrivalCustomHour} onMinute={setArrivalCustomMinute}/>
        <div className="cup-arrival-custom-actions">
          <Button variant="primary" className="cup-btn sm" onClick={()=>applyArrival(`${arrivalCustomHour}:${arrivalCustomMinute}`)}>{t("確定")}</Button>
          <Button variant="secondary" className="cup-btn sm" onClick={()=>setArrivalCustomOpen(false)}>{t("取消")}</Button>
        </div>
      </div>}
      {myArrivalTime&&<button type="button" className="cup-arrival-clear" onClick={()=>applyArrival("")}>{t("清除到達時間")}</button>}
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
    <button type="button" className="cup-back" onClick={()=>setSelectedTournament("")}><span aria-hidden="true">‹</span>  {t("所有盃賽")}</button>
    <header className={`cup-banner is-${status}`}>
      <CupArt tone={status==="done"?"gold":"dark"}/>
      <div className="cup-banner-body">
        <div className="cup-card-top"><span className={`cup-chip is-${status}`}>{t(CUP_STATUS_LABEL[status])}</span>{canManage&&controls(tournament)}</div>
        <h2>{tournament.name}</h2>
        <p>{tournament.startAt&&<>{t("開始：{v} ·", {v: deadlineText(tournament.startAt)})} </>}{deadlinePassed?t("報名已於 {v} 截止", {v: deadlineText(tournament.signupDeadline)}):t("報名截止 {v}", {v: deadlineText(tournament.signupDeadline)})}</p>
        <div className="cup-banner-stats">
          <div><b>{tournament.signups.length}</b><small>{t("參賽")}</small></div>
          <div><b>{settled}<i>/{total||"—"}</i></b><small>{t("已定勝負")}</small></div>
          <div><b>{champion?t("完賽"):stage&&bracket?roundLabel(t, stage.round,bracket.rounds):t("待抽籤")}</b><small>{t("階段")}</small></div>
        </div>
        {total>0&&<div className="cup-progress" role="img" aria-label={t("賽程進度 {settled} / {total}", {settled, total})}><i style={{width:`${Math.round(settled/total*100)}%`}}/></div>}
      </div>
    </header>

    {/* Recruiting is the one state where sharing is not a nicety — a cup with four entrants is a
        worse cup — so the ask is loud, states the clock, and names WhatsApp rather than 「分享」. */}
    <div className={`cup-share-row${status==="signup"?" recruiting":""}`}>
      <div>
        <b>{status==="signup"?t("叫多幾個會友嚟報名{v}", {v: shareUrgency.label?t("｜{label}", {label: shareUrgency.label}):""}):t("分享賽程同賽果")}</b>
        <small>{cupShareCta(t, shareState).hint}</small>
      </div>
      <CupShareButtons name={tournament.name} state={shareState}
        url={typeof window==="undefined"?"":cupShareUrl(window.location.origin,tournament.id)}
        entrants={rosterIds.map(storyPerson)}
        champion={champion?storyPerson(champion):null}
        bracket={chart?storyBracket(t, chart):[]} tone="primary"/>
    </div>

    {!deadlinePassed?<>
      {/* Entering a cup is a competition decision, so it sits with the bracket it leads to rather
          than in 約戰, where it competed for attention with arranging tonight's frame. */}
      <div className={`cup-signup${signedUp?" in":""}`}>
        <div><b>{signedUp?t("你已報名"):t("報名參加")}</b><small>{signedUp?t("截止後會自動抽籤，並通知你首圈對手。"):t("截止後按報名名單抽籤並建立對陣。")}</small></div>
        {ownPlayerId
          ?<Button variant={signedUp?"secondary":"primary"} className="cup-btn" onClick={()=>{setSignupArrivalOn(false);if(startAtTime){const [h,m]=startAtTime.split(":");setSignupArrivalHour(h);setSignupArrivalMinute(m)}setPendingSignup({id:selectedTournament,name:tournament.name,joined:signedUp})}}>{signedUp?t("取消報名"):t("立即報名")}</Button>
          :<a className="cup-btn primary" href="/login">{t("登入後報名")}</a>}
      </div>
      {arrivalEditor}
      {rosterPanel}
    </>:!bracket||!bracket.size?<div className="cup-empty"><span aria-hidden="true">🎱</span><b>{t("報名人數不足兩人")}</b><p>{isAdmin?t("可編輯盃賽並延後報名截止時間，重新開放報名。"):t("今屆未能開賽。")}</p></div>:<>
      {!drawn&&ownPlayerId&&<p className="cup-note">{t("正在抽籤…")}</p>}
      {arrivalEditor}
      {champion?<article className="cup-champion">
        <span aria-hidden="true">🏆</span>
        <div><small>{t("{name} 冠軍", {name: tournament.name})}</small><b>{name(champion)}</b></div>
        <PlayerBadge player={player(champion)??{short:"?"}}/>
      </article>
      :mySlot?<article className={`cup-mytie${mySlot.state==="ready"?" ready":""}`}>
        <p className="sl-eyebrow">{t("{v} · 第 {index} 場", {v: roundLabel(t, mySlot.round,bracket.rounds), index: mySlot.index})}</p>
        <div className="cup-mytie-vs">
          {([ownPlayerId!,opponentIn(mySlot,ownPlayerId)] as const).map((id,side)=><Fragment key={side}>
            {side===1&&<span className="cup-mytie-mark" aria-hidden="true">VS</span>}
            <div className="cup-mytie-player">
              <PlayerBadge player={player(id)??{short:"?"}}/>
              <b>{side===0?t("你"):id?name(id):t("待定")}</b>
              <small>{id&&player(id)?`${Math.round(player(id)!.rating)} ELO`:t("未定")}</small>
            </div>
          </Fragment>)}
        </div>
        {mySlot.state==="ready"
          ?<div className="cup-mytie-actions"><Button variant="primary" className="cup-btn" onClick={()=>onRecordSlot(tournament,mySlot)}>{t("記錄賽果")}</Button><Button variant="secondary" className="cup-btn" onClick={()=>onArrange(opponentIn(mySlot,ownPlayerId))}>{t("約時間")}</Button></div>
          :<p className="cup-mytie-wait">{t("對手要等上一圈賽果出咗先定到。")}</p>}
      </article>
      :eliminated?<p className="cup-note">{t("你在今屆已止步；可繼續睇餘下賽程。")}</p>
      :ownPlayerId&&!tournament.signups.includes(ownPlayerId)?<p className="cup-note">{t("你未有報名今屆盃賽。")}</p>:null}

      {chart&&<CupBracketChart chart={chart} activeRound={openRound}
        onPick={(round,index)=>{setOpenRound(round);setFocusTie(`${round}-${index}`)}}/>}
      <nav className="cup-rounds" aria-label={t("選擇輪次")}>{Array.from({length:bracket.rounds},(_,index)=>{
        const round=index+1,done=bracket.slots.filter(slot=>slot.round===round&&slot.settled&&slot.state!=="dead").length;
        const count=bracket.slots.filter(slot=>slot.round===round&&slot.state!=="dead").length;
        return <button type="button" key={round} className={round===openRound?"active":""} aria-current={round===openRound?"true":undefined} onClick={()=>setOpenRound(round)}>
          <b>{roundLabel(t, round,bracket.rounds)}</b><small>{done}/{count}</small>
        </button>;
      })}</nav>
      <ol className="cup-ties">{bracket.slots.filter(slot=>slot.round===openRound&&slot.state!=="dead").map(tieRow)}</ol>
      {canManage&&rosterPanel}

      {/* The full tree — names, scores and controls in every box — needs width the phone does not
          have; there, CupBracketChart carries the shape and the cards carry the detail. */}
      <div className="cup-tree"><TournamentBracketChart bracket={bracket} name={name} ownPlayerId={ownPlayerId} isAdmin={isAdmin} canManage={canManage} canMoveSeat={canMoveSeat} seatTool={seatTool} dragRosterId={dragRosterId} dragOverRosterId={dragOverRosterId} canManageMatch={canManageMatch} onEdit={onEdit} onRecordSlot={slot=>onRecordSlot(tournament,slot)} onWalkover={(slot,winnerId)=>onWalkover(tournament,slot,winnerId)} onDragStart={id=>{setDragRosterId(id);setDragOverRosterId("")}} onDragOver={id=>setDragOverRosterId(id)} onDrop={id=>{if(dragRosterId&&dragRosterId!==id){onEditRoster(tournament,dragRosterId,id)}setDragRosterId("");setDragOverRosterId("")}} onDragEnd={()=>{setDragRosterId("");setDragOverRosterId("")}} onTouchStart={id=>onRosterHandleTouchStart(id,"bracket")} onTouchMove={onRosterHandleTouchMove} onTouchEnd={onRosterHandleTouchEnd(tournament)}/></div>
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
function TournamentBracketChart({bracket,name,ownPlayerId,isAdmin,canManage,canMoveSeat,seatTool,dragRosterId,dragOverRosterId,canManageMatch,onEdit,onRecordSlot,onWalkover,onDragStart,onDragOver,onDrop,onDragEnd,onTouchStart,onTouchMove,onTouchEnd}:{
  bracket:Bracket<Match>;
  name:(id:string)=>string;
  ownPlayerId?:string;
  isAdmin:boolean;
  canManage:boolean;
  canMoveSeat:(id:string)=>boolean;
  seatTool:(id:string,round:number)=>ReactNode;
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
  const t = useT();
  return <div className="bracket-chart" role="group" aria-label={t("賽事對陣圖")}>
    {Array.from({length:bracket.rounds},(_,roundIndex)=>{
      const round=roundIndex+1;
      return <div className={`bracket-round${round===bracket.rounds?" final":""}`} key={round}>
        <h3 className="bracket-round-title">{roundLabel(t, round,bracket.rounds)}</h3>
        <div className="bracket-round-matches">
          {bracket.slots.filter(slot=>slot.round===round).map(slot=>{
            const {a:first,b:second,match,winner}=slot;
            const mine=Boolean(ownPlayerId&&(first===ownPlayerId||second===ownPlayerId));
            /* Recording is offered to the two players in the box and to an admin. Coming from the
               box means the round and match number are carried, not typed — the class of mistake
               that used to file a quarter-final result as a first-round one. */
            const canRecord=slot.state==="ready"&&Boolean(isAdmin||mine);
            return <div className={`bracket-match ${slot.state}${mine?" mine":""}`} key={`${round}-${slot.index}`}>
              {match&&canManageMatch(match)&&<IconButton className="card-tool bracket-edit" label={t("編輯 {v} 對 {v2} 的賽果", {v: name(first), v2: name(second)})} onClick={()=>onEdit(match)}>✎</IconButton>}
              {[first,second].map((id,side)=>{
                /* Only round one, and only a player who has not played: dragging a name out of a
                   box that already has a scorecard would leave the two disagreeing. */
                const draggable=round===1&&canMoveSeat(id);
                return <div key={side} className={`bracket-slot${winner&&winner===id?" winner":""}${!id?" tbd":""}${dragRosterId&&dragRosterId!==id&&dragOverRosterId===id?" drag-over":""}${dragRosterId===id?" dragging":""}`} draggable={draggable} data-drag-player-id={id||undefined}
                  onDragStart={draggable?event=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id);onDragStart(id)}:undefined}
                  onDragOver={draggable?event=>{event.preventDefault();onDragOver(id)}:undefined}
                  onDrop={draggable?event=>{event.preventDefault();onDrop(id)}:undefined}
                  onDragEnd={draggable?onDragEnd:undefined}
                  onTouchStart={draggable?onTouchStart(id):undefined}
                  onTouchMove={draggable?onTouchMove:undefined}
                  onTouchEnd={draggable?onTouchEnd:undefined}
                  onTouchCancel={draggable?onTouchEnd:undefined}>
                  <span>{id?name(id):t("待定")}</span>{match&&<b>{scoreFor(match,id)}</b>}{seatTool(id,round)}
                </div>;
              })}
              {match&&<time className="bracket-date" dateTime={match.playedOn}>{match.playedOn}</time>}
              {slot.state==="bye"&&<small className="bracket-bye">{t("輪空晉級")}</small>}
              {slot.state==="walkover"&&<small className="bracket-bye">{t("{v} 因對手棄權晉級", {v: name(slot.winner)})}</small>}
              {slot.state==="waiting"&&<small className="bracket-bye">{t("等待上一圈賽果")}</small>}
              {canRecord&&<Button variant="primary" className="bracket-record" onClick={()=>onRecordSlot(slot)}>{t("記錄賽果")}</Button>}
              {canManage&&slot.state==="ready"&&<div className="bracket-walkover"><small>{t("判定晉級")}</small><span>{[first,second].map(id=><Button variant="quiet" key={id} onClick={()=>onWalkover(slot,id)}>{name(id)}</Button>)}</span></div>}
              {canManage&&slot.state==="walkover"&&<Button variant="quiet" className="bracket-edit" onClick={()=>onWalkover(slot,"")}>{t("取消判定")}</Button>}
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
function cupFor(t: Translator, match:Match,data:AppState){
  if(!match.tournamentId)return null;
  const tournament=data.tournaments.find(item=>item.id===match.tournamentId);
  if(!tournament)return null;
  return {name:tournament.name,round:matchRoundLabel(t, tournament.signups?.length??0,match.tournamentRound)};
}

function MatchCard({data,match:m,canManage,name,onPlayer,onEdit,onVoid,onShare,highlighted=false}:{data:AppState;match:Match;canManage:boolean;name:(id:string)=>string;onPlayer:(id:string)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void;highlighted?:boolean}) {
  const t = useT();
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
    actual>0?t("{leftLabel} 每局讓 {rightLabel} {actual} 分", {leftLabel, rightLabel, actual})
    :actual<0?t("{rightLabel} 每局讓 {leftLabel} {v} 分", {rightLabel, leftLabel, v: Math.abs(actual)})
    :t("不設讓分");
  /* A cup tie used to be indistinguishable from a Tuesday night frame in this list, which is the
     one place a member scrolls looking for the game they remember. It gets a gold edge on the board
     and a chip naming the round — the edge does the finding, the chip does the telling, and neither
     costs a row. */
  const cup=cupFor(t, m,data);
  return <article ref={card} className={`match ${m.status}${isEntertainmentMode(m.mode)?" entertainment":""}${cup?" is-cup":""}${highlighted?" just-saved":""}`}>
    <div className="match-board"><div className="match-top"><span className="match-when"><time dateTime={m.playedOn}>{m.playedOn}</time>{cup&&<small className={`match-cup-badge${cup.round?" has-round":""}`} title={cup.round?`${cup.name} · ${cup.round}`:cup.name}><CupMark/>{cup.round&&<b>{cup.round}</b>}<span>{cup.name}</span></small>}{isEntertainmentMode(m.mode)&&<small className="match-entertainment-badge">{t("潮拍 2v2 · 不計 ELO")}</small>}{highlighted&&<span className="pill just-saved-pill">{t("剛剛記錄")}</span>}{m.status==="void"&&<span className="pill">{t("已作廢")}</span>}{m.entryMode==="aggregate"&&<span className="pill muted">{t("歷史匯總")}</span>}</span>
      {/* Sharing sits with the card's own tools rather than behind the expander: the urge to show a
          result off lasts about as long as the walk back to the table, and a share hidden one tap
          down is a share that does not happen. Offered to every reader, not only to whoever may
          edit the card — a clubmate posting your win is worth more than you posting it. A voided
          match is excluded; it is not a result any more. */}
      <span className="card-tools">
        {m.status!=="void"&&<IconButton className="card-tool share" label={t("分享 {leftLabel} 對 {rightLabel} 的賽果", {leftLabel, rightLabel})} onClick={()=>onShare(m)}><ShareGlyph kind="share" /></IconButton>}
        {canManage&&<><IconButton className="card-tool" label={t("編輯 {leftLabel} 對 {rightLabel} 的賽事", {leftLabel, rightLabel})} onClick={()=>onEdit(m)}>✎</IconButton><IconButton className="card-tool danger" label={t("刪除 {leftLabel} 對 {rightLabel} 的賽事", {leftLabel, rightLabel})} onClick={()=>onVoid(m)}>✕</IconButton></>}
      </span></div>
    <Scoreline left={leftLabel} right={rightLabel} onLeftClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.a)} onRightClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.b)} scoreLeft={m.scoreA} scoreRight={m.scoreB}
      eloLeft={isEntertainmentMode(m.mode)?undefined:{before:m.beforeA,after:m.afterA,delta:m.deltaA}} eloRight={isEntertainmentMode(m.mode)?undefined:{before:m.beforeB,after:m.afterB,delta:m.deltaB??-m.deltaA}}/>
    {isEntertainmentMode(m.mode)&&<div className="match-team-rosters">{(["A","B"] as const).map(side=><div className={`match-team-roster ${side==="B"?"right":""}`} key={side}>{teamMemberIds(m,side).map(id=>{const player=data.players.find(item=>item.id===id);return <button type="button" key={id} onClick={()=>onPlayer(id)} aria-label={t("查看 {v} 的球員卡", {v: name(id)})}><PlayerBadge player={player??{short:"?"}}/><span>{name(id)}</span></button>})}</div>)}</div>}
    <button type="button" className="match-summary-row" aria-expanded={open} aria-label={open?t("收起比賽詳情"):t("展開比賽詳情")} onClick={()=>setOpen(value=>!value)}>
      {!!breaksByPlayer.length&&<span className="match-net-breaks">★ {breaksByPlayer.map((group,index)=><Fragment key={group.playerId}>{index>0&&t("；")}{t("{v} 單桿 {v2}", {v: name(group.playerId), v2: group.values.join(t("、"))})}</Fragment>)}</span>}
      <span className="match-expand-toggle" aria-hidden="true"><i/></span>
    </button>
    </div>
    {open&&<div className="match-body">
    {isEntertainmentMode(m.mode)?<div className="elo-impact entertainment-impact"><small>{t("娛樂賽記錄；不影響四位球員的 ELO 或統計。")}</small></div>:<div className="elo-impact" aria-label={t("本場 ELO 影響")}><small>{t("預測 {v} 局數比例 {v2}%", {v: name(m.a), v2: Math.round(m.expectedA*100)})}</small></div>}
    {!!breaksByPlayer.length&&<div className="match-breaks"><span>{t("單桿")}</span>{breaksByPlayer.map(group=><b key={group.playerId}>{name(group.playerId)} {group.values.join(t("、"))}</b>)}</div>}
    <div className="match-handicap-summary">
      <small>{t("本場讓分")}</small>
      <b>{handicapText(m.actual)}</b>
      <span>{t("賽前建議：{v}", {v: handicapText(recommendedActual)})}</span>
    </div>
    <small className="match-added">{t("加入於 {v}", {v: new Date(m.createdAt).toLocaleString(INTL_LOCALE[t.locale])})}</small></div>}
  </article>;
}

const weekdayLabels=[msg("一"),msg("二"),msg("三"),msg("四"),msg("五"),msg("六"),msg("日")];
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
function monthLabel(t: Translator, month:string){
  const [y,m]=month.split("-").map(Number);
  return monthYearLabel(y,m,t.locale);
}

function CalendarView({data,canManageMatch,onPlayer,onEdit,onVoid,onShare}:{data:AppState;canManageMatch:(match:Match)=>boolean;onPlayer:(player:Player)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void}) {
  const t = useT();
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??t("已刪除球員");
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
      <IconButton className="calendar-nav-btn" label={t("上一個月")} disabled={month<=bounds.min} onClick={()=>goToMonth(shiftMonth(month,-1))}>‹</IconButton>
      <div className="calendar-nav-title">
        <b>{monthLabel(t, month)}</b>
        <span className="calendar-month-total"><strong>{monthMatchCount}</strong>  {t("場比賽")}</span>
      </div>
      <IconButton className="calendar-nav-btn" label={t("下一個月")} disabled={month>=bounds.max} onClick={()=>goToMonth(shiftMonth(month,1))}>›</IconButton>
    </div>
    <div className="calendar-body">
      <div className="calendar-weekdays">{weekdayLabels.map(w=><span key={w}>{t(w)}</span>)}</div>
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
          aria-pressed={isSelected} aria-label={`${date}${count?t("，{count} 場比賽", {count}):t("，沒有比賽")}`}
          onClick={()=>setSelectedDay(isSelected?null:date)}>
          <span className="calendar-date">{Number(date.slice(8))}</span>
          {count>0&&<span className="calendar-count">{count}</span>}
          {hasCentury&&<i className="calendar-century" aria-hidden="true" title={t("破百單桿")}>★</i>}
        </button>;
      })}</div>
      {dayMatches.size===0&&<div className="calendar-empty-overlay"><Empty text={t("本月沒有比賽記錄")} sub={t("使用上方箭嘴切換到有記錄的月份。")}/></div>}
    </div>
    {selectedDay&&<div className="calendar-day-detail">
      <div className="calendar-day-head"><h3><time dateTime={selectedDay}>{selectedDay}</time></h3><span>{t("{selectedMatches} 場", {selectedMatches: selectedMatches.length})}</span></div>
      <div className="calendar-day-list">{selectedMatches.map(m=>
        <MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} onShare={onShare}/>)}</div>
    </div>}
  </section>;
}

function ConfirmDeleteMatch({match,data,onCancel,onConfirm}:{match:Match;data:AppState;onCancel:()=>void;onConfirm:()=>void}) {
  const t = useT();
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??t("已刪除球員");
  const later=data.matches.filter(m=>m.status==="confirmed"&&m.id!==match.id&&(m.playedOn||m.createdAt)>=(match.playedOn||match.createdAt)).length;
  const leftLabel=isEntertainmentMode(match.mode)?teamLabel(match,data,"A"):name(match.a);
  const rightLabel=isEntertainmentMode(match.mode)?teamLabel(match,data,"B"):name(match.b);
  return <><p className="kicker">{t("需要確認")}</p><h2>{t("刪除這場比賽？")}</h2>
    <p className="sub">{isEntertainmentMode(match.mode)?t("這是潮拍娛樂賽；刪除只會移除歷史記錄，不會改變任何 ELO 或球員統計。"):t("確認後會由這場比賽起重新計算，其後所有 ELO、勝負、局數及近況都會重建。")}</p>
    <div className="confirm-target">
      <small>{t("比賽日期 {playedOn}", {playedOn: match.playedOn})}</small>
      <div className="confirm-scoreline"><span>{leftLabel}</span><b>{match.scoreA}</b><em>–</em><b>{match.scoreB}</b><span>{rightLabel}</span></div>
      <p>{match.actual>0?t("{leftLabel} 讓 {actual} 分", {leftLabel, actual: match.actual}):match.actual<0?t("{rightLabel} 讓 {v} 分", {rightLabel, v: Math.abs(match.actual)}):t("沒有讓分")} · ELO {match.deltaA>=0?"+":""}{Math.round(match.deltaA)} / {-match.deltaA>=0?"+":""}{Math.round(-match.deltaA)}</p>
      {!!match.highBreaks?.length&&<div className="match-breaks"><span>{t("單桿")}</span>{match.highBreaks.map((item,index)=><b key={`${item.playerId}-${index}`}>{name(item.playerId)} {item.value}</b>)}</div>}
    </div>
    {later>1&&<p className="confirm-impact">{t("此賽事之後還有")} <b>{later-1}</b>  {t("場比賽會一併重新計算。")}</p>}
    <div className="confirm-actions"><Button variant="secondary" className="confirm-cancel" onClick={onCancel}>{t("保留賽事")}</Button><Button variant="danger" className="confirm-delete" onClick={onConfirm}>{t("刪除賽事")}</Button></div>
    <p className="confirm-hint">{t("刪除後可在提示訊息按「復原」還原。")}</p></>;
}


type PlayersChip = "near"|"free"|"soon"|"hot"|"all";
const PLAYERS_SORT_CYCLE:SortKey[]=["rank","rating","form","suggested"];
const playersSortDir=(key:SortKey):"asc"|"desc"=>key==="rank"||key==="name"?"asc":"desc";

function Players({data,ownPlayerId,managementMode=false,canAdd,canManagePlayer,onAdd,onEdit,onDelete,onOpen,onCompare,onRecordAgainst,onFindOpponent}:{
  data:AppState;ownPlayerId?:string;managementMode?:boolean;canAdd:boolean;canManagePlayer:(player:Player)=>boolean;
  onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void;
  onCompare:(p:Player)=>void;onRecordAgainst:(p:Player)=>void;onFindOpponent:(playerId:string,date:string)=>void;
}) {
  const t = useT();
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
    if(freeDate===hkDate())return t("今日 {v} 有空", {v: hkClock(free)});
    const[,m,d]=freeDate.split("-");
    return t("{v}/{v2} {v3} 有空", {v: Number(d), v2: Number(m), v3: hkClock(free)});
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
  const chipDefs:[PlayersChip,string][]=[["all",t("全部")],["near",t("水平相約")],["free",t("今日有空")],["soon",t("近期有空")],["hot",t("狀態 🔥")]];

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
      <div className="players-self-top"><span>{t("球員 · {players} 位", {players: data.players.length})}</span><span>{t("今日 {freeCount} 位有空", {freeCount})}</span></div>
      {me&&<div className="players-self-main">
        <b className="players-self-rank">#{myRank}</b>
        <div className="players-self-id">
          <div className="players-self-name">{t("我 · {v} ELO", {v: Math.round(me.rating)})}{myDelta!==0&&<span className={myDelta>0?"positive":"negative"}>{myDelta>0?"+":""}{Math.round(myDelta)}</span>}</div>
          <div className="players-self-gap">{superior?t("距離 #{v} 只差 {v2} 分", {v: myRank!-1, v2: Math.max(0,Math.ceil(superior.rating-me.rating))}):t("暫列榜首")}  {t("· 建議讓分 {v} 分", {v: suggestedHandicap(me,data)})}</div>
        </div>
        <span className="players-self-form">{me.form.map((x,i)=><i className={x.toLowerCase()} key={i}>{x}</i>)}</span>
      </div>}
    </div>
    <div className="players-toolbar">
      <div className="players-search"><input type="text" value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("搜尋姓名或縮寫")} aria-label={t("搜尋球員")}/></div>
      <button type="button" className="players-sort-btn" onClick={cycleSort}>{t("排序 · {v}", {v: t(sortLabels[sort])})}</button>
    </div>
    <div className="players-chips" role="group" aria-label={t("球員篩選")}>
      {chipDefs.map(([id,label])=>{
        const n=counts[id],isEmpty=n===0&&id!=="all",isActive=activeChip===id&&!isEmpty;
        return <button key={id} type="button" aria-pressed={isActive} disabled={isEmpty} className={`players-chip${isActive?" active":""}${isEmpty?" is-empty":""}`} onClick={()=>setChip(id)}>{label} {n}</button>;
      })}
    </div>
    <div className="players-list-head">
      <span>{t("{filtered} 位球員", {filtered: filtered.length})}</span>
      {canAdd&&<Button variant="primary" className="players-add-btn" onClick={onAdd}>{t("＋ 新增球員")}</Button>}
      <span className="players-list-hint">{activeChip==="hot"?t("ELO · 近30日ELO變化"):t("ELO · 建議評分")}</span>
    </div>
    {data.players.length===0
      ? <Empty text={t("尚未有球員")} sub={t("新增球員後便可開始記錄比賽。")}/>
      : empty
        ? <div className="players-empty"><b>{q?t("找不到「{query}」", {query}):t("這個篩選暫時沒有人")}</b><span>{t("試試其他篩選，或按「全部」查看整個名單。")}</span></div>
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
                  <span className="players-row-name-line"><b>{p.name}</b><em className={`players-tag${provisional?" provisional":""}`}>{provisional?t("臨時"):`#${rank}`}</em></span>
                  <span className="players-row-meta">
                    <span className="players-row-form">{p.form.map((x,i)=><i className={x.toLowerCase()} key={i}/>)}</span>
                    {t("{v} 場", {v: games(p)})}{free?` · ${freeLabel(free)}`:""}
                  </span>
                </span>
                <span className="players-row-elo"><b>{Math.round(p.rating)}</b>{activeChip==="hot"
                  ? <em className={delta>=0?"positive":"negative"}>{delta>=0?"+":"−"}{Math.abs(Math.round(delta))}</em>
                  : <em className="neutral">{suggested}</em>}</span>
              </button>
              {managementMode&&canManagePlayer(p)&&<Button variant="quiet" className="players-row-manage" onClick={()=>onEdit(p)}>{t("管理")}</Button>}
              {open&&<div className="players-row-expand">
                {me&&!isSelf&&<div className="players-verdict">
                  <div className="players-verdict-main">{handicapVerdict(t, me,p,data.settings)}</div>
                  <div className="players-verdict-sub">{t("建議評分 {v} 分 · 相差 {v2} ELO", {v: suggestedHandicap(p,data), v2: Math.abs(Math.round(me.rating-p.rating))})}</div>
                </div>}
                <div className="players-expand-stats">
                  <span>{t("勝率／局率")} <b>{Math.round(winRate(p)*100)}／{Math.round(frameRate(p)*100)}%</b></span>
                  <span>{t("最高單桿")} <b>{high??"—"}</b></span>
                  {free&&<span className="players-expand-free">{freeLabel(free)}</span>}
                </div>
                <div className="players-expand-actions">
                  {isSelf
                    ? <Button variant="primary" className="players-expand-open-self" onClick={()=>onOpen(p)}>{t("查看完整球員頁 ›")}</Button>
                    : <>
                        <Button onClick={()=>onRecordAgainst(p)}>{t("記錄對局")}</Button>
                        <Button variant="secondary" onClick={()=>onCompare(p)}>{t("對戰紀錄")}</Button>
                        <Button variant="secondary" onClick={()=>onFindOpponent(p.id,today)}>{t("約戰")}</Button>
                        <IconButton className="players-row-open" label={t("開啟 {name} 的球員卡", {name: p.name})} onClick={()=>onOpen(p)}>›</IconButton>
                      </>}
                </div>
                {(canManagePlayer(p)||canAdd)&&<div className="players-expand-manage">
                  {canManagePlayer(p)&&<IconButton className="card-tool" label={t("編輯 {name}", {name: p.name})} onClick={()=>onEdit(p)}>✎</IconButton>}
                  {canAdd&&<IconButton className="card-tool danger" label={t("刪除 {name}", {name: p.name})} onClick={()=>onDelete(p)}>✕</IconButton>}
                </div>}
              </div>}
            </div>;
          })}</div>}
  </div>;
}

function SettingsView({data,onEdit,onReset,canReset}:{data:AppState;onEdit:()=>void;onReset:()=>void;canReset:boolean}) {
  const t = useT();
  const s=data.settings;
  return <><section className="hero small"><div><p className="kicker">{t("公開設定")}</p><h1>{t("ELO 設定")}</h1><p>{t("所有球員由 1500 起步；每場賽果只使用 PDF Snooker Elo 公式重播。以下參數只有管理員可以修改。")}</p></div><Button onClick={onEdit}>{t("編輯設定")}</Button></section>
    <div className="settings-grid">
      <Surface as="div" className="setting"><small>{t("起始 ELO")}</small><b>{s.start}</b></Surface>
       <Surface as="div" className="setting"><small>{t("表現敏感度（250）")}</small><b>{s.frameScaleCoefficient}</b></Surface>
      <Surface as="div" className="setting"><small>{t("信心權重")}</small><b>{t("局數 ÷（局數＋5）")}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分 ELO 尺度（500）")}</small><b>{s.handicapEloScale}</b></Surface>
      <Surface as="div" className="setting"><small>{t("個人建議讓分換算（只供顯示）")}</small><b>{s.handicapPointsToElo}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分最低 ELO 值（7）")}</small><b>{s.handicapMinimumElo}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分敏感度範圍（16）")}</small><b>{s.handicapSensitivityRange}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分敏感度寬度（250）")}</small><b>{s.handicapSensitivityWidth}</b></Surface>
      <Surface as="div" className="setting"><small>{t("重複衰減底數（2）")}</small><b>{s.repetitionDecayBase}</b></Surface>
      <Surface as="div" className="setting"><small>{t("重複衰減週期（7）")}</small><b>{s.repetitionDecayPeriod}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分有效度")}</small><b>{Math.round(s.handicapEffectiveness*100)}%</b></Surface>
      <Surface as="div" className="setting"><small>{t("零和更新")}</small><b>{t("是")}</b></Surface>
    </div>
    <Surface className="audit"><h2>{t("審計記錄")}</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString(INTL_LOCALE[t.locale])}</small></div>)}</Surface>
    {canReset&&<section className="danger-zone"><div><h2>{t("清除並重設資料")}</h2><p>{t("永久刪除共用資料庫內所有球員、比賽及審計記錄，並恢復預設 ELO 設定。")}</p></div><Button variant="danger" onClick={onReset}>{t("清除所有資料")}</Button></section>}</>;
}

function MatchForm({data,draft,setDraft,preview,a,b,editing,saving,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;editing:boolean;saving:boolean;onSave:()=>void}) {
  const t = useT();
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
  const tournamentLabel=tournament?.name||t("未選擇盃賽");
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
    setBreakMessage(current=>({...current,[playerId]:value>previousBest&&previousBest>0?t("新個人最佳！比之前高 {v} 分 🎉", {v: value-previousBest}):value>previousBest?t("第一個單桿紀錄，繼續突破！"):previousBest-value<=5?t("距離個人最佳 {previousBest} 只差 {v} 分", {previousBest, v: previousBest-value}):t("已記低，下一桿再挑戰更高！")}));
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
  const resultLabel=!valid?t("輸入最終比分"):draft.scoreA===draft.scoreB?t("{scoreA}–{scoreB} 和局", {scoreA: draft.scoreA, scoreB: draft.scoreB}):draft.scoreA>draft.scoreB?t("{v} 勝 {scoreA}–{scoreB}", {v: isTeamMode?teamAName:a.name, scoreA: draft.scoreA, scoreB: draft.scoreB}):t("{v} 勝 {scoreB}–{scoreA}", {v: isTeamMode?teamBName:b.name, scoreB: draft.scoreB, scoreA: draft.scoreA});
  const handicapLabel=draft.giver&&+draft.points>0?t("{v} 每局讓 {points} 分", {v: draft.mode==="2v2"?([a.id,a2?.id].includes(draft.giver)?teamAName:teamBName):draft.giver===a?.id?a?.name:b?.name, points: draft.points}):t("沒有讓分");
  const dateLabel=draft.date===today?t("今天"):draft.date;
  const fairPoints=Math.abs(fairActual??0);
  return <div className="match-form"><div className="match-form-head"><div className="match-title-row"><h2 className="accent">{editing?t("編輯比賽"):t("記錄比賽")}</h2><div className="match-date-chip"><span aria-hidden="true">{dateLabel}<i aria-hidden="true">›</i></span><input aria-label={t("比賽日期，目前為{dateLabel}", {dateLabel})} type="date" value={draft.date} onChange={e=>update("date",e.target.value)} onClick={e=>{const input=e.currentTarget;if(typeof input.showPicker==="function")input.showPicker()}}/></div></div></div>
    {editing&&<p className="sub">{draft.mode==="2v2"?t("潮拍娛樂賽只會更新這筆歷史記錄，不會重播或改變 ELO。"):t("儲存後會按日期重播全部賽事，重建雙方及後續 ELO。")}</p>}
    {data.players.length<2&&<p className="warning">{t("請先新增至少兩位活躍球員。")}</p>}
    {isCupMode&&!cupSlotLocked && <div className="tournament-selector tournament-selector-first">
      <label>{t("盃賽")}<select value={draft.tournamentId||""} onChange={e=>chooseCupTournament(e.target.value)}>
        <option value="">{t("選擇盃賽")}</option>
        {data.tournaments.map(tour=> <option key={tour.id} value={tour.id}>{tour.name}{tour.startAt?t(" · 開始 {v}", {v: formatTournamentDateTime(t, tour.startAt)}):""}{tour.signupDeadline?t(" · 截止 {v}", {v: formatTournamentDateTime(t, tour.signupDeadline)}):""}</option>)}
      </select></label>
      {draft.tournamentId&&!cupBracket?.slots.length&&<p className="mm-note">{t("此盃賽尚未抽籤（報名未截止或人數不足），暫時無法選擇對陣，請待抽籤後再記錄賽果。")}</p>}
    </div>}
    {cupSlotLocked&&<div className="cup-slot-banner"><small>{tournamentLabel}</small><b>{cupBracket?t("{v} · 第 {tournamentMatchIndex} 場", {v: roundLabel(t, Number(draft.tournamentRound),cupBracket.rounds), tournamentMatchIndex: draft.tournamentMatchIndex}):t("第 {tournamentRound} 輪第 {tournamentMatchIndex} 場", {tournamentRound: draft.tournamentRound, tournamentMatchIndex: draft.tournamentMatchIndex})}</b><span>{t("對陣及場次由賽事對陣圖帶入，不可更改。")}</span></div>}
    <section className="match-players" aria-labelledby="match-players-title"><h3 id="match-players-title" className="visually-hidden">{t("選擇球員")}</h3>
      {isTeamMode&&<div className="team-name-grid"><label><span>{t("Team A 隊名")}</span><input type="text" maxLength={40} value={draft.teamAName??""} placeholder="Team A" onChange={event=>update("teamAName",event.target.value)}/></label><b aria-hidden="true">{t("對")}</b><label><span>{t("Team B 隊名")}</span><input type="text" maxLength={40} value={draft.teamBName??""} placeholder="Team B" onChange={event=>update("teamBName",event.target.value)}/></label></div>}
      {!isTeamMode&&!isCupMode&&<div className="matchup-card">
        <div className="matchup-slot"><PlayerCombobox players={playersForA} value={draft.a} onChange={pickA} placeholder={t("選擇球員")} ariaLabel={t("球員 A")} autoOpenSignal={openASignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
        <span className="matchup-vs" aria-hidden="true">{t("對")}</span>
        <div className="matchup-slot"><PlayerCombobox players={playersForB} value={draft.b} onChange={pickB} placeholder={t("選擇球員")} ariaLabel={t("球員 B")} autoOpenSignal={openBSignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
      </div>}
      {isCupMode&&cupSlotLocked&&<div className="matchup-card cup-matchup-card locked">
        {[a,b].map((player,side)=><Fragment key={side}>
          {side===1&&<span className="matchup-vs" aria-hidden="true">{t("對")}</span>}
          <div className="matchup-slot derived-opponent"><span className="matchup-trigger"><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={player??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{player?.name??t("待定")}</b><small>{player?`${Math.round(player.rating)} ELO`:"—"}</small></span></span></div>
        </Fragment>)}
      </div>}
      {isCupMode&&!cupSlotLocked&&<div className="matchup-card cup-matchup-card">
        <div className="matchup-slot"><PlayerCombobox players={players} value={draft.a} onChange={pickCupPlayer} placeholder={t("選擇球員")} ariaLabel={t("選擇球員")} autoOpenSignal={openASignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?`${Math.round(selected.rating)} ELO` : t("未完成盃賽場次")}</small></span></button>}/></div>
        <span className="matchup-vs" aria-hidden="true">{t("對")}</span>
        <div className="matchup-slot derived-opponent"><span className="matchup-trigger"><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={b??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{draft.b?b.name:t("對手會由賽事名單帶出")}</b><small>{draft.b?t("已按未完成場次配對"):t("先選擇一位球員")}</small></span></span></div>
      </div>}
      {isTeamMode&&<div className="matchup-card team-2v2">
        <div className="matchup-team">
          <div className="matchup-slot"><PlayerCombobox players={playersForA} value={draft.a} onChange={pickA} placeholder={t("選擇球員")} ariaLabel={t("球員 A")} autoOpenSignal={openASignal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
          <div className="matchup-slot"><PlayerCombobox players={playersForA2} value={draft.a2} onChange={pickA2} placeholder={t("選擇隊友")} ariaLabel={t("球員 A2")} autoOpenSignal={openA2Signal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇隊友")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
        </div>
        <span className="matchup-vs" aria-hidden="true">{t("對")}</span>
        <div className="matchup-team">
          <div className="matchup-slot"><PlayerCombobox players={playersForB} value={draft.b} onChange={pickB} placeholder={t("選擇球員")} ariaLabel={t("球員 B")} autoOpenSignal={openBSignal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
          <div className="matchup-slot"><PlayerCombobox players={playersForB2} value={draft.b2} onChange={pickB2} placeholder={t("選擇隊友")} ariaLabel={t("球員 B2")} autoOpenSignal={openB2Signal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇隊友")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
        </div>
      </div>}
    </section>
    {/* Typing a round and a match number by hand is how a quarter-final result used to get filed as
        a first-round one. The numbers stay visible when the form was opened from a box, but they are
        the box's — only a hand-built entry (no bracket to tap) can still set them. */}
    {isCupMode&&!cupSlotLocked && <div className="tournament-stage"><label>{t("輪次")}<input type="number" min={1} value={draft.tournamentRound||1} onChange={e=>update("tournamentRound",Math.max(1,Number(e.target.value)||1))}/></label>
      <label>{t("場次")}<input type="number" min={1} value={draft.tournamentMatchIndex||1} onChange={e=>update("tournamentMatchIndex",Math.max(1,Number(e.target.value)||1))}/></label></div>}
    {isCupMode&&cupSlot&&cupSlot.state==="played"&&!editing&&<p className="warning">{t("此場次已有賽果，儲存會另建一筆記錄；請改用對陣圖上的「編輯賽果」。")}</p>}
    <section className="quick-handicap" aria-labelledby="handicap-title"><h3 id="handicap-title">{t("讓分")} <small>{handicapLabel}</small></h3>
      {isCupMode
        ? <div className="tournament-handicap-note"><b>{t("盃賽模式")}</b><span>{tournament ? (tournament.handicapMode==="suggested" ? t("自動套用建議讓分：每局 {fairPoints} 分", {fairPoints}) : t("此盃賽不設讓分")) : t("未選擇盃賽")}</span></div>
        : <>
            {validTeamSelection&&<div className="entertainment-handicap-note recommended"><b>{t("建議讓分")}</b><span>{fairPoints===0?t("{teamAName} 與 {teamBName} 毋須讓分", {teamAName, teamBName}):t("{v} 每局讓 {v2} {fairPoints} 分", {v: fairActual!>0?teamAName:teamBName, v2: fairActual!>0?teamBName:teamAName, fairPoints})}</span><small>{teamAHandicap!=null&&teamBHandicap!=null?t("{teamAName} 平均 {v} · {teamBName} 平均 {v2}", {teamAName, v: Math.round(teamAHandicap), teamBName, v2: Math.round(teamBHandicap)}):t("隊伍平均 ELO 相差 {v}", {v: Math.abs(teamEloDifference)})}{t("；按球員 ELO 建議讓分計算。")}</small></div>}
            <SlidingToggleGroup className="handicap-segment"><button type="button" className={!draft.giver&&!customHandicap?"active":""} onClick={setNoHandicap}>{t("沒有讓分")}</button><button type="button" disabled={fairActual==null} className={draft.giver&&+draft.points===fairPoints&&!customHandicap?"active":""} onClick={fairPoints===0?setNoHandicap:applyFair}>{t("ELO 建議")}</button><button type="button" className={customHandicap?"active":""} onClick={()=>{setCustomHandicap(value=>!value);setFollowingSuggestion(false);}}>{t("自訂")}</button></SlidingToggleGroup>
            {customHandicap&&<div className="custom-handicap"><label>{draft.mode==="2v2"?t("讓分隊伍"):t("讓分球員")}<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">{t("沒有讓分")}</option><option value={a?.id}>{draft.mode==="2v2"?t("{teamAName}（{name} / {name2}）", {teamAName, name: a.name, name2: a2?.name}):a?.name}</option><option value={b?.id}>{draft.mode==="2v2"?t("{teamBName}（{name} / {name2}）", {teamBName, name: b.name, name2: b2?.name}):b?.name}</option></select></label><label>{t("每局分數")}<input type="number" inputMode="numeric" min="0" step="1" value={draft.points} onChange={e=>update("points",Math.max(0,+e.target.value))}/></label></div>}
          </>
      }
    </section>
    <section className="score-panel" aria-labelledby="score-title">{forecast&&<div className="predicted-ratio"><div><span>{t("預測局數比例")}</span><b>{isTeamMode?teamAName:a.short} {Math.round(forecast.expectedA*100)}% · {Math.round((1-forecast.expectedA)*100)}% {isTeamMode?teamBName:b.short}</b></div><em aria-label={t("{v} {v2}%，{v3} {v4}%", {v: isTeamMode?teamAName:a.name, v2: Math.round(forecast.expectedA*100), v3: isTeamMode?teamBName:b.name, v4: Math.round((1-forecast.expectedA)*100)})}><i style={{width:`${Math.round(forecast.expectedA*100)}%`}}/></em></div>}<h3 id="score-title">{t("最終比分")}</h3>{!isTeamMode&&<div className="break-invitation"><b>{t("今場有冇值得記低嘅單桿？")}</b><span>{t("每次突破，都係進步嘅紀錄。")}</span></div>}<div className="scoreboard-entry">
      <div><b>{isTeamMode?teamAName:(a?.name??t("球員 A"))}</b><div className="score-row"><button type="button" aria-label={t("{v}減一局", {v: isTeamMode?teamAName:(a?.name??t("球員 A"))})} onClick={()=>changeScore("scoreA",-1)}>−</button><input className="score-value" aria-label={t("{v}局數", {v: isTeamMode?teamAName:(a?.name??t("球員 A"))})} type="number" inputMode="numeric" min="0" value={draft.scoreA} onChange={e=>update("scoreA",Math.max(0,+e.target.value))}/><button type="button" aria-label={t("{v}加一局", {v: isTeamMode?teamAName:(a?.name??t("球員 A"))})} onClick={()=>changeScore("scoreA",1)}>＋</button></div>
        {!isTeamMode&&a&&<div className="break-inline">{(breakOpen[a.id]||(draft.highBreaks??[]).some((item:{playerId:string})=>item.playerId===a.id))&&<p className="break-heading">{t("已記錄嘅單桿")}</p>}<div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===a.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={t("移除 {name} 的 {value} 分單桿度數", {name: a.name, value: item.value})}>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[a.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(a.id)}}><input autoFocus className="break-value" aria-label={t("{name} 單桿度數", {name: a.name})} type="number" inputMode="numeric" min="1" max="147" placeholder={t("輸入度數")} enterKeyHint="done" value={breakInput[a.id]??""} onChange={event=>setBreakInput(current=>({...current,[a.id]:event.target.value}))}/><button type="submit">{t("記低")}</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[a.id]:true}))}>{t("＋ 記錄單桿")}</button>}
        {breakMessage[a.id]&&<p className="break-encouragement" role="status">{breakMessage[a.id]}</p>}</div>}
      </div>
      <strong aria-hidden="true">–</strong>
      <div><b>{isTeamMode?teamBName:(b?.name??t("球員 B"))}</b><div className="score-row"><button type="button" aria-label={t("{v}減一局", {v: isTeamMode?teamBName:(b?.name??t("球員 B"))})} onClick={()=>changeScore("scoreB",-1)}>−</button><input className="score-value" aria-label={t("{v}局數", {v: isTeamMode?teamBName:(b?.name??t("球員 B"))})} type="number" inputMode="numeric" min="0" value={draft.scoreB} onChange={e=>update("scoreB",Math.max(0,+e.target.value))}/><button type="button" aria-label={t("{v}加一局", {v: isTeamMode?teamBName:(b?.name??t("球員 B"))})} onClick={()=>changeScore("scoreB",1)}>＋</button></div>
        {!isTeamMode&&b&&<div className="break-inline">{(breakOpen[b.id]||(draft.highBreaks??[]).some((item:{playerId:string})=>item.playerId===b.id))&&<p className="break-heading">{t("已記錄嘅單桿")}</p>}<div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===b.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={t("移除 {name} 的 {value} 分單桿度數", {name: b.name, value: item.value})}>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[b.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(b.id)}}><input autoFocus className="break-value" aria-label={t("{name} 單桿度數", {name: b.name})} type="number" inputMode="numeric" min="1" max="147" placeholder={t("輸入度數")} enterKeyHint="done" value={breakInput[b.id]??""} onChange={event=>setBreakInput(current=>({...current,[b.id]:event.target.value}))}/><button type="submit">{t("記低")}</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[b.id]:true}))}>{t("＋ 記錄單桿")}</button>}
        {breakMessage[b.id]&&<p className="break-encouragement" role="status">{breakMessage[b.id]}</p>}</div>}
      </div>
    </div></section>
    {forecast&&totalFrames>0&&(draft.mode==="2v2"?<section ref={eloPreviewRef} className="elo-preview entertainment-preview"><b>{t("潮拍娛樂模式")}</b><p>{t("本場只記錄隊伍、讓分與比分；四位球員的目前 ELO、勝負、局數及近況均不會改變。")}</p></section>:<section ref={eloPreviewRef} className="elo-preview"><div><span><small>{a.name}</small><b className={previewDeltaA!>=0?"positive":"negative"}>{previewDeltaA!>=0?"+":""}{Math.round(previewDeltaA!)} ELO</b></span><i aria-hidden="true">↔</i><span className="right"><small>{b.name}</small><b className={previewDeltaB!>=0?"positive":"negative"}>{previewDeltaB!>=0?"+":""}{Math.round(previewDeltaB!)} ELO</b></span></div><details><summary>{t("查看計算詳情")}</summary><p>{probabilities?t("A 勝 {v}% · 和 {v2}% · ", {v: Math.round(probabilities.win*100), v2: Math.round(probabilities.draw*100)}):""}{t("表現分")} {forecast.performanceScore>=0?"+":""}{t("{v} · 讓分 H", {v: Math.round(forecast.performanceScore)})} {forecast.adjustment>=0?"+":""}{Math.round(forecast.adjustment)}</p></details></section>)}
    <div className="match-save">{breakReminder&&<div className="break-save-reminder" role="status"><b>{t("今場有冇值得記低嘅單桿？")}</b><span><button type="button" onClick={()=>{setBreakReminder(false);setBreakOpen({[a.id]:true,[b.id]:true})}}>{t("返回記錄")}</button><button type="button" onClick={onSave}>{t("今場沒有，照樣儲存")}</button></span></div>}<Button className="full" disabled={!valid||data.players.length<2||saving} aria-busy={saving} onClick={()=>{if(!isTeamMode&&!editing&&(draft.highBreaks??[]).length===0){setBreakReminder(true);return}onSave()}}><strong>{saving?t("儲存中…"):editing?t("儲存變更"):t("儲存賽果")}</strong><small>{saving?t("請稍候"):resultLabel}</small></Button></div>
  </div>;
}

type TunableSettingKey="frameScaleCoefficient"|"handicapEloScale"|"handicapMinimumElo"|"handicapSensitivityRange"|"handicapSensitivityWidth"|"repetitionDecayBase"|"repetitionDecayPeriod";
function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) {
  const t = useT();
  const [s,setS]=useState<Settings>(data.settings);
  const field=(key:TunableSettingKey,label:string,hint:string,step=1,min?:number,max?:number)=>
    <label className="settings-field"><span>{label}</span><input type="number" step={step} min={min} max={max} value={s[key]}
      onChange={e=>{const value=e.target.value===""?0:Number(e.target.value);setS(current=>({...current,[key]:value}))}}/><small>{hint}</small></label>;
  return <>
    <p className="kicker">{t("公開管理")}</p>
    <h2>{t("PDF Snooker Elo 公式設定")}</h2>
    <p className="warning">{t("起始 ELO 可修改，儲存後會以新參數從此起始值重播全部歷史 ELO。")}</p>
    <div className="settings-form-grid">
      <label className="settings-field"><span>{t("起始 ELO")}</span><input type="number" step="10" min={1000} max={3000} value={s.start} onChange={e=>{const value=e.target.value===""?1500:Number(e.target.value);setS(current=>({...current,start:value}))}}/><small>{t("所有現有球員會用此起始值重建評分。")}</small></label>
      {field("frameScaleCoefficient",t("表現敏感度"),t("ELO 變化 = 此數值 ×（實際局數百分比 − 預測百分比）× 信心權重。預設 250。"),1,0)}
      {field("handicapEloScale",t("讓分 ELO 尺度"),t("勝率公式分母，原值 500。數值越大，同樣 ELO 差距對勝率的影響越小。"),10,1)}
      {field("handicapMinimumElo",t("讓分最低 ELO 值"),t("高 ELO 區域時，每讓 1 分最少代表的 ELO，原值 7。"),1,.1)}
      {field("handicapSensitivityRange",t("讓分敏感度範圍"),t("低 ELO 與高 ELO 每讓 1 分的 ELO 差距範圍，原值 16。"),1,0)}
      {field("handicapSensitivityWidth",t("讓分敏感度寬度"),t("控制敏感度由低至高轉變的速度，原值 250。"),1,1)}
      {field("repetitionDecayBase",t("重複衰減底數"),t("M(t) = 底數^(-t/週期)，PDF 原值 2。"),.1,1)}
      {field("repetitionDecayPeriod",t("重複衰減週期"),t("M(t) 的週期，PDF 原值 7。"),.5,.1)}
    </div>
    <Button className="full" onClick={()=>onSave({...s,provisionalGames:data.settings.provisionalGames,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:15})}>{t("套用並重播歷史 ELO")}</Button>
  </>;
}
type RivalSnapshot = {
  opponent:Player; wins:number; losses:number; draws:number; matches:number;
  framesWon:number; framesLost:number; frameRate:number;
  latest:string; hasAggregate:boolean; label?:string;
};

function rivalSnapshots(t: Translator, player:Player,data:AppState):RivalSnapshot[] {
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
    {label:t("最多交手"),sort:(a,b)=>b.matches-a.matches||(b.framesWon+b.framesLost)-(a.framesWon+a.framesLost)},
    {label:t("最難應付"),sort:(a,b)=>a.frameRate-b.frameRate||b.matches-a.matches},
    {label:t("最佳對賽"),sort:(a,b)=>b.frameRate-a.frameRate||b.matches-a.matches},
    {label:t("勢均力敵"),sort:(a,b)=>Math.abs(a.frameRate-.5)-Math.abs(b.frameRate-.5)||b.matches-a.matches},
    {label:t("最近交手"),sort:(a,b)=>b.latest.localeCompare(a.latest)}
  ];
  const selected:RivalSnapshot[]=[];
  for(const pick of picks){
    const rival=[...rivals].filter(item=>!selected.some(chosen=>chosen.opponent.id===item.opponent.id)).sort(pick.sort)[0];
    if(rival)selected.push({...rival,label:pick.label});
  }
  return selected;
}

function RivalrySnapshot({player,data,onCompare}:{player:Player;data:AppState;onCompare:(opponent:Player)=>void}) {
  const t = useT();
  const rivals=rivalSnapshots(t, player,data);
  return <section className="profile-section rivalry-snapshot"><div className="profile-section-head"><div><p className="kicker">{t("對賽概覽")}</p><h3>{t("主要對手")}</h3></div></div>
    {rivals.length===0?<div className="rivalry-empty"><b>{t("尚未有對賽記錄")}</b><span>{t("記錄第一場比賽後，主要對手會顯示在這裡。")}</span></div>:<div className="rivalry-list">{rivals.map(rival=>{
      const percent=Math.round(rival.frameRate*100);
      const confidence=Math.min(1,.28+Math.max(rival.matches,(rival.framesWon+rival.framesLost)/12)*.18);
      return <button key={rival.opponent.id} className="rivalry-row" onClick={()=>onCompare(rival.opponent)} aria-label={t("查看 {name} 對 {name2} 的詳細對賽", {name: player.name, name2: rival.opponent.name})}>
        <PlayerBadge player={rival.opponent}/><span className="rivalry-person"><small>{rival.label}</small><b>{rival.opponent.name}</b><em>{rival.matches?t("{wins} 勝 · {losses} 負 · {draws} 和", {wins: rival.wins, losses: rival.losses, draws: rival.draws}):t("歷史局數匯總")}{rival.hasAggregate&&rival.matches?t(" · 另有匯總"):""}</em></span>
        <span className="rivalry-heat"><b>{percent}%</b><small>{t("局數勝率")}</small><em aria-hidden="true"><i style={{width:`${percent}%`,opacity:confidence}}/></em></span><strong>›</strong>
      </button>;
    })}</div>}
  </section>;
}

/** Buckets a break value into its ten-point band, e.g. 47→"40-49", 100+→"100+". */
function breakBand(value:number){ return value>=100?"100+":`${Math.floor(value/10)*10}-${Math.floor(value/10)*10+9}`; }
/** Groups the player's recorded breaks into ten-point bands (20-29 up to 100+) so the shape of their form shows at a glance, rather than a flat list of individual scores. */
function BreakMilestoneChart({player,data}:{player:Player;data:AppState}){
  const t = useT();
  const [mode,setMode]=useState<BreakChartMode>("monthly");
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const points=useMemo(()=>breakChartPoints(t, player,data,mode),[player,data,mode, t]);
  if(!points.length)return null;
  const max=Math.max(...points.map(point=>point.value));
  const yMax=Math.max(10,Math.ceil(max/10)*10);
  const x=(index:number)=>points.length===1?50:5+index/(points.length-1)*90;
  const y=(value:number)=>53-(value/yMax)*43;
  const linePath=points.reduce((path,point,index)=>index===0?`M ${x(index)} ${y(point.value)}`:`${path} L ${x(index)} ${y(point.value)}`,"");
  const areaPath=points.length>1?`${linePath} V 53 H ${x(0)} Z`:"";
  const tickIndexes=[...new Set([0,Math.floor((points.length-1)/2),points.length-1])];
  const periodLabel=mode==="monthly"?t("月份"):t("日期");
  const active=activeIndex==null?null:points[activeIndex]??null;
  return <div className="break-milestone-chart">
    <div className="break-milestone-plot">
      <div className="break-chart-y-axis" aria-hidden="true"><span>{yMax}</span><span>{Math.round(yMax/2)}</span><span>0</span></div>
      <div className="break-chart-canvas" onPointerLeave={()=>setActiveIndex(null)}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={t("{name} {v}單桿圖表", {name: player.name, v: mode==="personal"?t("個人最佳"):t("每月最高")})}>
          {[10,31,53].map(line=><line key={line} x1="5" y1={line} x2="95" y2={line} className="break-chart-grid"/>)}
           {active&&<line x1={x(activeIndex!)} y1="6" x2={x(activeIndex!)} y2="56" className="trend-guide"/>}
          {areaPath&&<path d={areaPath} className="break-chart-area"/>}
          <path d={linePath} className="break-chart-line"/>
        </svg>
               {active&&<div className={`trend-tooltip ${x(activeIndex!)>70?"align-right":x(activeIndex!)<30?"align-left":""}`} style={{left:`${x(activeIndex!)}%`,top:`${Math.max(3,y(active.value)/60*100-7)}%`}} role="status"><small>{active.period}</small><b>{active.value?t("{value} 分", {value: active.value}):"N/A"}</b><span>{active.value?(mode==="personal"?t("個人最佳"):t("該月最高")):t("未記錄單桿")}</span>{active.value>0&&active.date&&<span>{active.date}{active.opponent?t(" · 對 {opponent}", {opponent: active.opponent}):""}</span>}</div>}        {points.map((point,index)=><button key={`${point.period}-${point.value}`} type="button" className={`break-chart-point${activeIndex===index?" active":""}`} style={{left:`${x(index)}%`,top:`${y(point.value)/60*100}%`}} onPointerEnter={()=>setActiveIndex(index)} onFocus={()=>setActiveIndex(index)} onBlur={()=>setActiveIndex(null)} onClick={()=>setActiveIndex(current=>current===index?null:index)} title={t("{periodLabel} {period}：{v}", {periodLabel, period: point.period, v: point.value?t("{v} {value} 分", {v: mode==="personal"?t("個人最佳"):t("該月最高"), value: point.value}):"N/A"})} aria-label={t("{periodLabel} {period}，{v}", {periodLabel, period: point.period, v: point.value?t("{v} {value} 分", {v: mode==="personal"?t("個人最佳"):t("該月最高"), value: point.value}):t("未記錄單桿")})}/>) }
      </div>
    </div>
    <div className="break-chart-x-axis" aria-hidden="true">{tickIndexes.map(index=><span key={index} style={{left:`${x(index)}%`}}>{points[index].period}</span>)}</div>
    <p className="chart-summary">{mode==="personal"?t("共 {points} 次個人最佳里程碑。", {points: points.length}):t("共 {points} 個有賽事記錄月份；N/A 代表該月未記錄單桿。", {points: points.length})}</p>
    <SlidingToggleGroup className="ds-toggle-control break-milestone-toggle" aria-label={t("高桿圖表顯示方式")}><button type="button" aria-pressed={mode==="monthly"} className={mode==="monthly"?"active":""} onClick={()=>{setMode("monthly");setActiveIndex(null)}}>{t("每月最高")}</button><button type="button" aria-pressed={mode==="personal"} className={mode==="personal"?"active":""} onClick={()=>{setMode("personal");setActiveIndex(null)}}>{t("個人最佳")}</button></SlidingToggleGroup>
  </div>;
}

function BreakStats({player,data}:{player:Player;data:AppState}) {
  const t = useT();
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
    <div className="profile-section-head break-milestone-head"><div><p className="kicker">{t("高桿里程碑")}</p><h3>{t("突破軌跡")}</h3></div><div className="break-stats-record"><small>{t("最高單桿")}</small><b>{highest}</b></div></div>
    <BreakMilestoneChart player={player} data={data}/>
    <div className="break-stats-subhead"><span>{t("單桿表現")}</span><b>{highest}</b></div>
    <div className="break-bar-chart">{allBands.map(band=>{const count=counts.get(band)??0;return <div className="break-bar-row" key={band}>
      <span className="break-bar-label">{band}</span>
      <span className="break-bar-track"><i style={{width:count?`${8+count/maxCount*92}%`:"0%"}}/></span>
      <span className="break-bar-count">{count||""}</span>
    </div>})}</div>
    <p className="chart-summary">{t("共 {breaks} 桿記錄。", {breaks: breaks.length})}</p>
  </section>;
}

/** A player's public, upcoming availability — one glance at whether they're worth approaching for a
    game, without leaving their profile. Fetched per player id rather than folded into `data`, since
    most profile views never open this section and the rest of `AppState` has no concept of slots. */
const SLOT_PREVIEW_DAYS=3; // days shown before the section needs expanding
const hoursFromDayStart=(day:string,iso:string)=>(Date.parse(iso)-Date.parse(dayRangeHongKong(day).startAt))/3600000;
function PlayerUpcomingSlots({player,onFindOpponent}:{player:Player;onFindOpponent:(playerId:string,date:string)=>void}) {
  const t = useT();
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
  const relativeLabel = (day:string) => day===today ? t("今天") : day===tomorrow ? t("明天") : null;
  const total=slots?.length??0;
  /* Open by default and capped at three days: the section is the reason most people open a profile,
     but a fortnight of published slots would push the ELO history off the screen. */
  const shown=groups&&(expanded?groups:groups.slice(0,SLOT_PREVIEW_DAYS));
  return <section className="profile-section profile-slots">
    <div className="profile-section-head">
      <div><p className="kicker">{t("約戰時間")}</p><h3>{t("即將可約的時段")}</h3></div>
      <span className="profile-slots-count">{slots===null?t("載入中…"):total?t("{n} 天 · {total} 個時段", {n: groups!.length, total}):t("未有時段")}</span>
      <Button variant="secondary" onClick={()=>onFindOpponent(player.id,today)}>{t("約戰")}</Button>
    </div>
    <div className="profile-slots-body">
      {slots===null
        ? <p className="profile-slots-empty">{t("載入時段中…")}</p>
        : shown && shown.length>0
          ? <>
              {/* Day, then the times. No timeline track and no 10:00–02:00 axis: the visualisation
                  cost three rows per day and asked the reader to decode a scale, when the only
                  questions here are "which day" and "what times". */}
              {/* Every row shares one date treatment — small grey weekday/date text — with today and
                  tomorrow additionally called out by a pill above it, rather than getting their own
                  larger bold line that the rest of the week didn't have. */}
              <ul className="slot-viz-list">{shown.map(([day,bars])=>{const relative=relativeLabel(day);return <li className="slot-day" key={day}>
                <div className="slot-day-name">{relative&&<b className="slot-day-badge">{relative}</b>}<small>{hkDayLabel(day,t.locale)}</small></div>
                <div className="slot-chips">{bars.map(bar=><span key={bar.label}>{bar.label}</span>)}</div>
              </li>})}</ul>
              {groups!.length>SLOT_PREVIEW_DAYS&&<Button variant="quiet" className={`slot-more${expanded?" expanded":""}`} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?t("只顯示最近 3 天"):t("顯示全部 {n} 天", {n: groups!.length})}<i aria-hidden="true">▾</i></Button>}
            </>
          : <p className="profile-slots-empty">{t("目前未有公開的可配對時段")}</p>}
    </div>
  </section>;
}
function PlayerDetail({player,rank,data,onCompare,onViewAllMatches,onMatch,onFindOpponent,onShare}:{player:Player;rank:number;data:AppState;onCompare:(opponent:Player)=>void;onViewAllMatches:()=>void;onMatch:(matchId:string)=>void;onFindOpponent:(playerId:string,date:string)=>void;onShare:()=>void}) {
  const t = useT(); const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data),series=playerSeries(player,data),trendPoints=playerTrendPoints(t, player,data),high=Math.max(...series),low=Math.min(...series);const provisional=g<data.settings.provisionalGames;
  const frameTrend=recentFramesPerMatch(player,data,5);
  const highestBreak=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>(m.highBreaks??[]).filter(item=>item.playerId===player.id).map(item=>item.value)).reduce((max,value)=>Math.max(max,value),0);
  /* Memoised where the neighbouring stats are not: those are single passes over the match list,
     while this builds a bracket per cup the player entered, and the profile re-renders on every
     slot fetch and chart hover. */
  const honour=useMemo(()=>honourText(t, playerHonours(data.tournaments,data.matches,player.id)),[data.tournaments,data.matches,player.id, t]);
  /* One hero, then a single `.profile-body` grid: every section below is a `.profile-section`, so the
     gaps, surfaces and heads come from one place rather than from each section's own margins. */
  /* A plain div, not a <header>: the global `header{height:62px}` page rule would clamp this and
     clip the chip row. */
  return <><div className="profile-head">
    <PlayerBadge player={player}/>
    <div className="profile-identity">
      <h2>{player.name}</h2>
      <div className="profile-chips"><span className="profile-chip">{t("排名 #")}{rank||"—"}</span><span className={`profile-chip${provisional?" provisional":""}`}>{provisional?t("臨時 ELO"):t("正式 ELO")}</span><span className="profile-chip">{t("{g} 場", {g})}</span>
        {/* A cup finish is the one thing on this profile the leaderboard can never show, so it sits
            in the identity row with the rank rather than in a section below the fold. */}
        {honour&&<span className="profile-chip honour"><CupMark/>{honour}</span>}
        {/* A profile is the other half of the share story: on a quiet week there is no fresh result
            to post, but a rating and a rank are always worth showing — and a card carrying the
            club's name into somebody's Instagram does the same job either way. It rides in the chip
            row rather than as a fourth column of the hero grid, which has three tracks. */}
        <Button variant="quiet" className="profile-share" aria-label={t("分享 {name} 的球會紀錄", {name: player.name})} onClick={onShare}><ShareGlyph kind="share" />{t("分享紀錄")}</Button></div>
      <div className="profile-hero-form"><div><small>{t("最近5場")}</small><span className="profile-form-dots">{player.form.slice(0,5).map((result,index)=><i key={`${result}-${index}`} className={result.toLowerCase()}>{result}</i>)}</span></div></div>
    </div>
    <div className="profile-hero-elo"><small>{t("目前 ELO")}</small><b>{Math.round(player.rating)}</b></div>
  </div>
  <div className="profile-body">
    {/* Current ELO already leads the hero above, so it isn't repeated here. */}
    <div className="profile-stats profile-progress">
      <StatTile label={t("ELO 建議評分")} value={suggested==null?t("未提供"):Math.round(suggested)} />
      <StatTile label={t("正式讓分評分")} value={player.handicap??t("未提供")} />
      <StatTile label={t("勝／負／和")} value={`${player.wins}/${player.losses}/${player.draws}`} />
      <div>
        <small>{t("近 5 場局均得分")}</small>
        <b className={frameTrend.prior!=null&&frameTrend.recent!=null&&frameTrend.recent>frameTrend.prior?"positive":undefined}>{frameTrend.recent!=null?t("{v} 局", {v: frameTrend.recent.toFixed(1)}):"—"}</b>
        {frameTrend.prior!=null&&<span className="profile-progress-sub">{t("前 5 場 {v} 局", {v: frameTrend.prior.toFixed(1)})}</span>}
      </div>
      <div>
        <small>{t("局數勝率")}</small>
        <b>{Math.round(frameRate(player)*100)}%</b>
        <span className="profile-progress-sub">{t("{framesWon} 局獲勝", {framesWon: player.framesWon})}</span>
      </div>
      <div><small>{t("最高單桿")}</small><b>{highestBreak||"—"}</b><span className="profile-progress-sub">{highestBreak?t("歷史記錄"):t("尚未有單桿記錄")}</span></div>
    </div>
    <PlayerUpcomingSlots player={player} onFindOpponent={onFindOpponent}/>
    <BreakStats player={player} data={data}/>
    <RecentMatches points={trendPoints} onViewAll={onViewAllMatches} onMatch={onMatch}/>
    <section className="profile-section interactive-detail">
      <div className="profile-section-head"><div><p className="kicker">{t("評分軌跡")}</p><h3>{t("ELO 走勢")}</h3></div><span>{t("最高 {v} · 最低 {v2}", {v: Math.round(high), v2: Math.round(low)})}</span></div>
      <InteractiveEloChart points={trendPoints} label={t("{name} 從起始評分至目前的互動 ELO 走勢", {name: player.name})}/>
      <div className="chart-axis"><span>{t("起始 {v}", {v: Math.round(series[0])})}</span><span>{t("目前 {v}", {v: Math.round(player.rating)})}</span></div>
    </section>
    <RivalrySnapshot player={player} data={data} onCompare={onCompare}/>
    <section className="profile-section">
      <div className="profile-section-head"><div><p className="kicker">{t("綜合分析")}</p><h3>{t("表現摘要")}</h3></div></div>
      <p className="summary">{t("{name} 目前為 {v} ELO，最近五場錄得", {name: player.name, v: Math.round(player.rating)})} {player.form.filter(x=>x==="W").length}  {t("勝、")}{player.form.filter(x=>x==="L").length}  {t("負、")}{player.form.filter(x=>x==="D").length}  {t("和；局數勝率為 {v}%。ELO 曾介乎 {v2} 至 {v3}，共有 {related} 筆可追溯賽事記錄。", {v: Math.round(frameRate(player)*100), v2: Math.round(low), v3: Math.round(high), related: related.length})}</p>
    </section>
  </div></>}
