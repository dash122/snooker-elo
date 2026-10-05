
import type { Translator } from "./i18n/translate.ts";
/* --- The proposed handicap -------------------------------------------------
 *
 * 讓分 is the social technology that makes an uneven game worth playing, and the competing 約腳 apps
 * can only offer it as a checkbox — 「接受讓分」 says a handicap is *permitted*, leaving the two
 * players to negotiate the number themselves, out loud, before a game. That negotiation is where the
 * ask dies: nobody wants to be the one who says they need a head start, and nobody wants to be the
 * one who suggests the other player does.
 *
 * We can skip it, because we have ratings and they do not. The club has been computing a per-player
 * suggested handicap from ELO for as long as the leaderboard has existed; this is the same
 * arithmetic said about a *pair*, so it can be printed on a recommendation before either member has
 * to raise the subject. The system proposes the terms, so neither player has to.
 *
 * A proposal is the difference between the two players' displayed handicap indexes, so the terms
 * shown on a recommendation always agree with the numbers members already use on the leaderboard. */

export type HandicapSettings = {
  handicapPointsToElo:number;
  handicapMinimumElo:number;
  handicapSensitivityRange:number;
  handicapSensitivityWidth:number;
  start?:number;
  /** First day (YYYY-MM-DD) on which the taper curve below replaces the flat 25 ELO per point.
      Unset means never. Matches played before it keep their original arithmetic, so switching the
      curve on never rewrites history. */
  handicapCurveFrom?:string|null;
};

export const HANDICAP_ELO_PER_POINT = 25;

/* --- The taper curve ---------------------------------------------------------
 *
 * A flat 25 ELO per point makes a 1000-ELO gap a 40-point start, which weaker players find both
 * unreasonable to give and, for the receiver, so large that it stops being worth concentrating for.
 * Lower-rated players' points are worth more ELO, so the rate starts wide at the bottom and narrows
 * step by step as rating rises: 50 ELO per point at 800 and below, 25 from 2100 up, linear between.
 *
 * Every player still has one fixed handicap index (the points spanned from the club's starting
 * rating), so a start is always the difference of two indexes and A→B plus B→C always equals A→C. */
export const HANDICAP_TAPER_ANCHORS:ReadonlyArray<readonly [number,number]> = [[800,50],[2100,25]];

/** ELO represented by one handicap point at `rating` on the taper curve. */
export function taperEloPerPoint(rating:number){
  const anchors=HANDICAP_TAPER_ANCHORS;
  if(rating<=anchors[0][0])return anchors[0][1];
  for(let i=1;i<anchors.length;i+=1){
    const [x0,y0]=anchors[i-1];
    const [x1,y1]=anchors[i];
    if(rating<=x1)return y0+(y1-y0)*(rating-x0)/(x1-x0);
  }
  return anchors[anchors.length-1][1];
}

/** Handicap points spanned by the rating interval [low, high] (low <= high): the integral of
    1 / (ELO per point). Exact on each linear segment of the curve. */
function taperPointsBetween(low:number,high:number){
  if(high<=low)return 0;
  const cuts=HANDICAP_TAPER_ANCHORS.map(([x])=>x).filter(x=>x>low&&x<high);
  const edges=[low,...cuts,high];
  let points=0;
  for(let i=1;i<edges.length;i+=1){
    const p=edges[i-1],q=edges[i];
    const r0=taperEloPerPoint(p),r1=taperEloPerPoint(q);
    points+=Math.abs(r1-r0)<1e-9?(q-p)/r0:(q-p)/(r1-r0)*Math.log(r1/r0);
  }
  return points;
}

/** The ELO distance above `base` that `points` handicap points span on the curve. */
export function taperEloForPoints(base:number,points:number){
  if(points<=0)return 0;
  let low=0,high=points*HANDICAP_TAPER_ANCHORS[0][1]+1;
  for(let i=0;i<60;i+=1){
    const mid=(low+high)/2;
    if(taperPointsBetween(base,base+mid)<points)low=mid; else high=mid;
  }
  return (low+high)/2;
}

/** Signed handicap points from `from` up to `to`: positive when `to` is the higher rating. */
export function taperPoints(from:number,to:number){
  return to>=from?taperPointsBetween(from,to):-taperPointsBetween(to,from);
}

/** Today in Hong Kong as YYYY-MM-DD, the club's calendar. */
export function todayInClubTime(){
  return new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Hong_Kong"});
}

/** Is the taper curve in force on `on` (YYYY-MM-DD, default today)? */
export function handicapCurveActive(settings:{handicapCurveFrom?:string|null},on?:string){
  const from=settings.handicapCurveFrom;
  if(!from)return false;
  return (on||todayInClubTime()).slice(0,10)>=from;
}

/** ELO per handicap point to give `calculateSnookerElo` for one match, so the rating engine and the
    suggested start always agree. `given` is signed from side A: positive when A gives points.
    Before the curve starts this is the flat 25. */
export function matchHandicapRate(ratingA:number,ratingB:number,given:number,settings:{handicapCurveFrom?:string|null},playedOn?:string){
  if(!handicapCurveActive(settings,playedOn))return HANDICAP_ELO_PER_POINT;
  const points=Math.abs(given);
  if(points===0)return taperEloPerPoint((ratingA+ratingB)/2);
  // The giver's edge is cut by the ELO those points span, measured up from the receiver's rating.
  return taperEloForPoints(given>0?ratingB:ratingA,points)/points;
}

/** ELO points represented by one handicap point at a given rating. The sigmoid makes handicap
    sensitivity rise through the lower/middle ratings, then flatten toward a safe lower bound. */
export function handicapEloPerPoint(averageRating:number,settings:HandicapSettings){
  return settings.handicapMinimumElo
    +settings.handicapSensitivityRange
        /(1+Math.exp((averageRating-1500)/settings.handicapSensitivityWidth));
}

/** ELO difference → handicap points. Pairwise callers should pass the two players' average rating. */
export function eloToHandicap(eloDifference:number,settings:HandicapSettings,averageRating?:number){
  const eloPerPoint=averageRating==null?settings.handicapPointsToElo:handicapEloPerPoint(averageRating,settings);
  return eloDifference/eloPerPoint;
}

/** Suggestions are given in whole points. Also normalises `-0`, which would otherwise print as
    "-0 分" in one branch of every label below. */
export function roundToNearestInteger(value:number) {
  const rounded=Math.round(value);
  return Object.is(rounded,-0)?0:rounded;
}

export type HandicapProposal = {
  /** Positive: I give points away. Negative: I receive them. Zero: level. */
  points:number;
  /** Who gives, said from the reader's side. */
  direction:"give"|"receive"|"level";
  /** The one line that goes on the card. */
  label:string;
};

/** What the two of us should play off, said to me about them. The displayed integer indexes are
    authoritative: a 37 player facing a 56 player gives 19 points. */
export function proposeHandicap(t: Translator, myRating:number,theirRating:number,settings:HandicapSettings,on?:string):HandicapProposal {
  const myHandicap=displayedHandicap(myRating,settings,on);
  const theirHandicap=displayedHandicap(theirRating,settings,on);
  const points=theirHandicap-myHandicap;
  if(points===0)return {points:0,direction:"level",label:t("平手打就啱")};
  return points>0
    ?{points,direction:"give",label:t("建議你讓 {points} 分", {points})}
    :{points,direction:"receive",label:t("建議佢讓 {v} 分", {v: Math.abs(points)})};
}

/* --- Does it actually produce a close game? --------------------------------
 *
 * The proposal is a model's opinion, and a model's opinion is worth much less to a member than the
 * evidence sitting in their own match history. Two people who have played nine times know exactly
 * how those nine went, so the card quotes the record rather than asking them to trust the curve. */

export type PastMatch = {a:string;b:string;scoreA:number;scoreB:number;status:"confirmed"|"void"};

export type HeadToHead = {played:number;myWins:number;theirWins:number;label:string|null};

/** Our record, phrased as evidence for or against the proposal.
 *
 *  Deliberately silent below three games: "你哋打過 1 局，你贏咗" is not evidence of anything, and
 *  dressing it up as a reason to trust the handicap would be the app overclaiming — which costs more
 *  trust than saying nothing. */
export function headToHead(t: Translator, matches:PastMatch[],me:string,them:string):HeadToHead {
  const played=matches.filter(match=>match.status==="confirmed"
    &&((match.a===me&&match.b===them)||(match.a===them&&match.b===me)));
  let myWins=0,theirWins=0;
  for(const match of played){
    const mine=match.a===me?match.scoreA:match.scoreB;
    const theirs=match.a===me?match.scoreB:match.scoreA;
    if(mine>theirs)myWins+=1; else if(theirs>mine)theirWins+=1;
  }
  const label=played.length>=3?t("你哋過往 {played} 局 {myWins} : {theirWins}", {played: played.length, myWins, theirWins}):null;
  return {played:played.length,myWins,theirWins,label};
}

/** The full sentence for the recommendation card: the proposal, and the evidence behind it.
 *
 *  Two members who have never met get the proposal alone — which is exactly when it is worth the
 *  most, because there is no shared history to fall back on and the handicap is the only thing
 *  standing between "he is way better than me" and a game worth turning up for. */
export function handicapSentence(t: Translator, input:{
  myRating:number; theirRating:number; settings:HandicapSettings;
  matches:PastMatch[]; me:string; them:string;
}){
  const proposal=proposeHandicap(t, input.myRating,input.theirRating,input.settings);
  const record=headToHead(t, input.matches,input.me,input.them);
  return {...proposal,evidence:record.label,played:record.played};
}

/* --- One player's number, said to the whole club ----------------------------
 *
 * `proposeHandicap` above answers "what should *we two* play off". This answers the other question
 * the club asks constantly — "how much is *he* worth" — which is what the leaderboard's 建議評分
 * column has always shown and what a shared cup roster has to show, since a reader deciding whether
 * to enter is really asking whether the field is beatable.
 *
 * Moved here out of `HomeClient` when the shared cup page needed the same number: a roster that
 * quoted a different 建議讓分 from the leaderboard would be worse than a roster quoting none. */

export type RatedPlayer = { rating:number; handicap?:number|null };

/** The club's centre of gravity. Falls back to the configured starting rating for an empty club,
    where a mean of nothing would otherwise be zero and every handicap absurd. */
export function clubMeanRating(players:RatedPlayer[],start:number):number {
  return players.length?players.reduce((sum,player)=>sum+player.rating,0)/players.length:start;
}

/** The club's preset: a player at the starting ELO receives 60 handicap points. */
export const DEFAULT_SUGGESTED_HANDICAP = 60;

export function suggestedHandicap(player:RatedPlayer,_players:RatedPlayer[],
  settings:HandicapSettings&{start:number},on?:string):number {
  return displayedHandicap(player.rating,settings,on);
}

/** One rating's displayed handicap index: the preset at the starting rating, minus the points the
    rating sits above it. Flat 25 ELO per point, or the taper curve once it is in force. */
function displayedHandicap(rating:number,settings:HandicapSettings,on?:string){
  const start=settings.start??1500;
  const above=handicapCurveActive(settings,on)
    ?taperPoints(start,rating)
    :(rating-start)/HANDICAP_ELO_PER_POINT;
  return roundToNearestInteger(DEFAULT_SUGGESTED_HANDICAP-above);
}
