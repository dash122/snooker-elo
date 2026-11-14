import { type EloTrendPoint,type SortKey } from "../UiBits";
import { isEntertainmentMode,neutralRatingSnapshot } from "../../lib/entertainment-match";
import { HANDICAP_CURVE_MODEL_VERSION,HANDICAP_ELO_PER_POINT,HANDICAP_MODEL_VERSION,matchHandicapRate,proposeHandicap,restateMatchesBetweenCurves,restateMatchesInCurve,suggestedHandicap as clubSuggestedHandicap } from "../../lib/handicap";
import { calculateSnookerElo } from "../../lib/snooker-elo";
import { matchDate,matchupKey,meetingsSince } from "../../lib/elo-replay";
import { type Walkover } from "../../lib/tournament";
import type { Translator } from "../../lib/i18n/translate";


export type Player = {
  id: string; name: string; short: string; handicap: number | null; rating: number; colour?: string; avatar?: string | null;
  initialRating: number; active: boolean; wins: number; losses: number; draws: number;
  framesWon: number; framesLost: number; lastChange: number; form: string[];
};
export type MatchMode = "1v1" | "2v2" | "cup";
export type Match = {
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
export type Tournament = {
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
export type Settings = {
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
export type StateLoadStatus = "loading" | "ready" | "failed";
export const AUDIT_LOG_LIMIT = 300;
// A hung request here (a stalled DB connection, a dropped network segment) must not be able to
// wedge `saving` on forever — that leaves the header stuck on 儲存中 and blocks every later save,
// since `saveMatch` no-ops while `saving` is true. Aborting after a bound turns a hang into an
// ordinary failed-fetch error, which `persist`'s catch/finally already knows how to recover from.
export const STATE_FETCH_TIMEOUT_MS = 15000;
export const SAVE_CONFIRMATION_TIMEOUT_MS = 5000;
export function fetchWithTimeout(input:string,init?:RequestInit,timeoutMs=STATE_FETCH_TIMEOUT_MS){
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
export function mergeStatePayload(next:AppState,baseline:AppState,latest:Record<string,unknown>|null):AppState{
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

export const seed: AppState = {
  settings: {
    start: 1500, provisionalGames:10,
    frameScaleCoefficient:250, frameScaleNumeratorOffset:15, frameScaleDenominator:10,
    handicapEloScale:1250, handicapPointsToElo:25, handicapMinimumElo:7,
    handicapSensitivityRange:16, handicapSensitivityWidth:250, compressionWidthBase:3,
    compressionWidthExponent:.1, repetitionDecayBase:2, repetitionDecayPeriod:7,
    handicapEffectiveness:1, modelVersion:HANDICAP_MODEL_VERSION,
  },
  players: [],
  matches: [],
  tournaments: [],
  audits: [{ id:"seed",text:"建立公開群組及預設 ELO 設定",at:new Date().toISOString() }]
};

export function games(p: Player) { return p.wins + p.losses + p.draws; }
export function provisionalMultiplier(matchCount: number) {
  return matchCount === 0 ? 2 : matchCount === 1 ? 1.5 : matchCount === 2 ? 1.25 : 1;
}
/* A thin wrapper over `lib/handicap`, which owns the arithmetic so the leaderboard, the cup roster
   and the shared cup page can never quote three different 建議讓分 for the same player. */
export function suggestedHandicap(p: Player,data: AppState) {
  return clubSuggestedHandicap(p,data.players,data.settings);
}
export function suggestedHandicapAtRating(rating:number,data:AppState) {
  return clubSuggestedHandicap({rating},data.players,data.settings);
}
export function winRate(p:Player){return games(p)?p.wins/games(p):0}
export function frameRate(p:Player){const total=p.framesWon+p.framesLost;return total?p.framesWon/total:0}
export function formScore(p:Player){return p.form.reduce((sum,x,i)=>sum+(x==="W"?1:x==="D"?.5:0)*(5-i),0)}
export function trailingStat(t: Translator, key:SortKey,p:Player,data:AppState,suggested:number){
  const eloText=`ELO ${Math.round(p.rating)}`;
  if(key==="change"){const swing=recentDeltaDays(p,data,10);return {big:`${swing>=0?"+":""}${Math.round(swing)}`,cls:swing>=0?"positive":"negative",sub:eloText}}
  if(key==="official")return {big:p.handicap==null?"—":p.handicap,sub:eloText};
  if(key==="suggested")return {big:suggested,sub:eloText};
  if(key==="games")return {big:games(p),sub:t("{v}% 勝率", {v: Math.round(winRate(p)*100)})};
  if(key==="winRate")return {big:`${Math.round(winRate(p)*100)}%`,sub:t("{v} 場", {v: games(p)})};
  if(key==="frameRate")return {big:`${Math.round(frameRate(p)*100)}%`,sub:eloText};
  return null;
}
export function sortPlayers(players:Player[],data:AppState,key:SortKey,dir:"asc"|"desc"){
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
export function matchMode(match: Match): MatchMode { return match.mode ?? "1v1"; }
export function isParticipant(match: Match,id:string){
  return match.a===id||match.b===id||match.a2===id||match.b2===id;
}
export function playerSide(match: Match,id:string):"A"|"B"|null{
  if(match.a===id||match.a2===id) return "A";
  if(match.b===id||match.b2===id) return "B";
  return null;
}
/* A past match can name a player who has since been permanently deleted — the delete flow keeps the
   match on purpose ("歷史賽事會保留並顯示為「已刪除球員」"). Falling back to an unrelated player's
   object (e.g. data.players[0]) for a missing id would silently misattribute the match, and falls
   apart entirely once the club has fewer than two players left. A synthetic placeholder keeps the
   editor showing the right (absent) identity instead of a wrong one. */
export function deletedPlayerPlaceholder(id:string,startRating:number):Player{
  return {id,name:"已刪除球員",short:"?",handicap:null,rating:startRating,initialRating:startRating,
    active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]};
}
/* Same shape, different reason: a cup slot with no ready tie clears the draft's player id back to
   "" rather than leaving a stale one selected. `data.players[0]`/`[1]` used to stand in for that
   gap, which crashes the moment the club has fewer than two players (see above) and, worse, silently
   showed an unrelated player as one of the two sides of a cup match nobody has actually been paired
   for yet. An empty-id placeholder keeps the form rendering with an honest "no player yet" identity. */
export function unselectedPlayerPlaceholder(startRating:number):Player{
  return {id:"",name:"未選擇球員",short:"?",handicap:null,rating:startRating,initialRating:startRating,
    active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]};
}
export function teamMemberIds(match: Match, side:"A"|"B"){ return side==="A"?[match.a,match.a2].filter(Boolean) as string[]:[match.b,match.b2].filter(Boolean) as string[]; }
export function teamLabel(match: Match,data:AppState,side:"A"|"B"){
  if(isEntertainmentMode(match.mode)){
    const custom=(side==="A"?match.teamAName:match.teamBName)?.trim();
    return custom||`Team ${side}`;
  }
  const ids=teamMemberIds(match,side).map(id=>data.players.find(p=>p.id===id)?.short||"?");
  return ids[0]??"?";
}
export function teamFullName(t: Translator, match: Match,data:AppState,side:"A"|"B"){
  if(isEntertainmentMode(match.mode)){
    const custom=(side==="A"?match.teamAName:match.teamBName)?.trim();
    return custom||`Team ${side}`;
  }
  const names=teamMemberIds(match,side).map(id=>data.players.find(p=>p.id===id)?.name||t("已移除球員"));
  return names.join(" & ")||t("已移除球員");
}
export function teamRating(match: Match,data:AppState,side:"A"|"B"){
  const ids=teamMemberIds(match,side);
  const ratings=ids.map(id=>data.players.find(p=>p.id===id)?.rating).filter((value):value is number=>typeof value==="number");
  return ratings.length?ratings.reduce((sum,value)=>sum+value,0)/ratings.length:0;
}
export function teamHandicap(match: Match,data:AppState,side:"A"|"B"){
  const players=teamMemberIds(match,side).map(id=>data.players.find(p=>p.id===id)).filter((player):player is Player=>Boolean(player));
  return players.length?Math.round(players.reduce((sum,player)=>sum+suggestedHandicap(player,data),0)/players.length):null;
}
export function playerMatchBefore(match:Match,playerId:string){
  if(match.a===playerId) return match.beforeA;
  if(match.b===playerId) return match.beforeB;
  if(match.a2===playerId) return match.beforeA2 ?? match.beforeA;
  if(match.b2===playerId) return match.beforeB2 ?? match.beforeB;
  return 0;
}
export function playerMatchAfter(match:Match,playerId:string){
  if(match.a===playerId) return match.afterA;
  if(match.b===playerId) return match.afterB;
  if(match.a2===playerId) return match.afterA2 ?? match.afterA;
  if(match.b2===playerId) return match.afterB2 ?? match.afterB;
  return 0;
}
export function playerSeries(p:Player,data:AppState){
  const related=[...data.matches].filter(m=>!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)).sort((a,b)=>(a.playedOn||a.createdAt).localeCompare(b.playedOn||b.createdAt)||a.createdAt.localeCompare(b.createdAt));
  return [p.initialRating,...related.map(m=>playerMatchAfter(m,p.id))];
}
export function playerTrendPoints(t: Translator, p:Player,data:AppState):EloTrendPoint[]{
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
export function eloTrendSeries(t: Translator, players:Player[],data:AppState){
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
export function recentDelta(p:Player,data:AppState,count:number){
  return [...data.matches].filter(m=>!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,count).reduce((sum,m)=>{
    const side=playerSide(m,p.id);
    return sum + (side==="A"?m.deltaA:-m.deltaA);
  },0);
}
export function recentDeltaDays(p:Player,data:AppState,days:number){
  const cutoff=new Date(Date.now()-days*864e5).toISOString().slice(0,10);
  const today=new Date().toISOString().slice(0,10);
  return data.matches.filter(m=>m.status==="confirmed"&&!isEntertainmentMode(m.mode)&&isParticipant(m,p.id)&&(m.playedOn||m.createdAt.slice(0,10))>=cutoff&&(m.playedOn||m.createdAt.slice(0,10))<=today).reduce((sum,m)=>{
    const side=playerSide(m,p.id);
    return sum + (side==="A"?m.deltaA:-m.deltaA);
  },0);
}
export function highestBreak(p:Player,data:AppState){
  const values=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>(m.highBreaks??[]).filter(b=>b.playerId===p.id&&b.value>0&&b.value<=147).map(b=>b.value));
  return values.length?Math.max(...values):null;
}
export type BreakChartMode="personal"|"monthly";
export type BreakChartPoint={period:string;value:number;date?:string;opponent?:string};
export function breakChartPoints(t: Translator, player:Player,data:AppState,mode:BreakChartMode):BreakChartPoint[]{
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
export function handicapVerdict(t: Translator, me:Player,p:Player,s:Settings){
  const eloDifference=me.rating-p.rating;
  const points=proposeHandicap(t, me.rating,p.rating,s).points;
  const base=points===0?t("平手"):points>0?t("建議我讓 {points} 分", {points}):t("建議他讓 {v} 分", {v: Math.abs(points)});
  return points!==0&&Math.abs(eloDifference)<30?t("{base} · 勢均力敵", {base}):base;
}
export function calc(a: Player,b: Player,scoreA:number,scoreB:number,giver:string|null,points:number,s:Settings,giverSide?:"A"|"B"|null,repetitionCount=0) {
  const actual = giverSide === "A" ? points : giverSide === "B" ? -points
    : giver === a.id ? points : giver === b.id ? -points : 0;
  const official = a.handicap == null || b.handicap == null ? null : b.handicap - a.handicap;
  const formula = calculateSnookerElo({
    ratingA:a.rating, ratingB:b.rating, handicapA:-actual, framesA:scoreA, framesB:scoreB,
    handicapEloScale:s.handicapEloScale,
    handicapEloPerPoint:matchHandicapRate(a.rating,b.rating,actual,s),
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
export function matchProbabilities(frameProbability:number,frames:number){
  if(frames<=0)return {win:0,draw:0,loss:0};
  const choose=(n:number,k:number)=>{let value=1;for(let i=1;i<=k;i++)value=value*(n-k+i)/i;return value};
  let win=0,draw=0;
  for(let k=0;k<=frames;k++){const probability=choose(frames,k)*frameProbability**k*(1-frameProbability)**(frames-k);if(k>frames/2)win+=probability;else if(k===frames/2)draw=probability;}
  return {win,draw,loss:1-win-draw};
}

export function replay(players:Player[],matches:Match[],settings:Settings) {
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
/* Each step lifts the document one rating model; run them until it is current so a club several
   models behind is never left half-way (a half-upgraded document still replays correctly, but is
   rewritten again on every visit). */
export function upgradeState(raw:AppState){
  let state={ ...raw, tournaments: raw.tournaments ?? [] } as AppState;
  let changed=false;
  for(let step=0;step<10;step+=1){
    const next=upgradeOneModel(state);
    if(!next.changed)break;
    state=next.state;
    changed=true;
  }
  return {state,changed};
}
export function upgradeOneModel(raw:AppState){
  const nextRaw = { ...raw, tournaments: raw.tournaments ?? [] };
  const modelVersion=nextRaw.settings.modelVersion??1;
  if(modelVersion>=HANDICAP_MODEL_VERSION)return {state:nextRaw,changed:false};
  if(modelVersion>=HANDICAP_CURVE_MODEL_VERSION){
    const matches=restateMatchesBetweenCurves(nextRaw.matches,nextRaw.settings.start??1500);
    const settings={...nextRaw.settings,modelVersion:HANDICAP_MODEL_VERSION};
    const rebuilt=replay(nextRaw.players,matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"收窄中段讓分曲線（1500 每分 50 ELO，至 2600 才收窄至 25 ELO），歷史讓分按 ELO 價值換算並重播評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
  if(modelVersion>=15){
    const matches=restateMatchesInCurve(nextRaw.matches,nextRaw.settings.start??1500);
    const settings={...nextRaw.settings,modelVersion:HANDICAP_MODEL_VERSION};
    const rebuilt=replay(nextRaw.players,matches,settings);
    return {state:{...nextRaw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"改用遞減讓分曲線（弱手每分 75 ELO，逐步收窄至 25 ELO），歷史讓分按 ELO 價值換算並重播評分",at:new Date().toISOString()},...nextRaw.audits]},changed:true};
  }
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

export const today = new Date().toISOString().slice(0,10);
/* Last-known club document, kept in localStorage so a return visit paints from it immediately
   instead of sitting on 正在載入球會資料 for a cold serverless function plus a database read.
   What is cached is the raw server document, not the replayed state: a deploy that changes the
   rating replay must recompute from source, and restoring goes through exactly the same
   upgrade + replay path as a network response. */
export const STATE_CACHE_KEY = "elo-state-cache";
export type CachedDocument = { version:string; document:AppState };
export function readStateCache():CachedDocument|null{
  try{
    const raw=localStorage.getItem(STATE_CACHE_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw) as CachedDocument|null;
    if(!parsed?.version||!Array.isArray(parsed.document?.players)||!Array.isArray(parsed.document?.matches))return null;
    return parsed;
  }catch{ return null }
}
export function writeStateCache(version:string,document:AppState){
  if(!version)return;
  try{ localStorage.setItem(STATE_CACHE_KEY,JSON.stringify({version,document})) }
  /* A long enough history can exceed the origin's storage quota. Drop the key rather than
     leaving a truncated or stale document behind; the next load simply goes to the network. */
  catch{ try{ localStorage.removeItem(STATE_CACHE_KEY) }catch{} }
}

export const TABS=["leaderboard","matches","play","players","settings"];
/** Links and notifications written before the rename point at ?tab=availability. */
export const LEGACY_TABS:Record<string,string>={availability:"play"};
export const normaliseTab=(wanted:string|null)=>wanted?(LEGACY_TABS[wanted]??wanted):null;
export function tabFromLocation(){
  const wanted=normaliseTab(new URLSearchParams(window.location.search).get("tab"));
  return wanted&&TABS.includes(wanted)?wanted:"leaderboard";
}
export function pushTabHistory(next:string){
  const url=new URL(window.location.href);
  if(next==="leaderboard")url.searchParams.delete("tab");else url.searchParams.set("tab",next);
  url.searchParams.delete("view");
  window.history.pushState(null,"",url);
}

// Module scope, not render: reading the clock during render is impure.
export const thirtyDaysAgo = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
export const tenDaysAgo = new Date(Date.now()-10*864e5).toISOString().slice(0,10);
export function isInPastThirtyDays(playedOn:string){
  return playedOn>=thirtyDaysAgo&&playedOn<=today;
}
export function isInPastTenDays(playedOn:string){
  return playedOn>=tenDaysAgo&&playedOn<=today;
}
