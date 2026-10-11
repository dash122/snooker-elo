
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
  /** The rating model the club's matches are recorded in. From `HANDICAP_CURVE_MODEL_VERSION` on,
      starts are in taper-curve points; before it they are flat 25-ELO points. */
  modelVersion?:number;
};

export const HANDICAP_ELO_PER_POINT = 25;

/* --- The taper curve ---------------------------------------------------------
 *
 * A flat 25 ELO per point makes a 1000-ELO gap a 40-point start, which weaker players find both
 * unreasonable to give and, for the receiver, so large that it stops being worth concentrating for.
 * Lower-rated players' points are worth more ELO, so the rate starts wide at the bottom and narrows
 * step by step as rating rises: 75 ELO per point at 800 and below, 25 from 2200 up, linear between.
 *
 * Every player still has one fixed handicap index (the points spanned from the club's starting
 * rating), so a start is always the difference of two indexes and A→B plus B→C always equals A→C.
 *
 * The curve belongs to rating model 16. Matches recorded before it were handed out in flat 25-ELO
 * points, so the version-16 upgrade restates each of them in curve points holding its ELO value
 * constant (`legacyStartToCurve`), after which the whole history replays in one unit. */
export const HANDICAP_CURVE_MODEL_VERSION = 16;

/* Rating model 17 re-tapers the mid-range. Under model 16 the rate fell straight from 75 at 800 to
 * 25 at 2200, so 1500 → 2200 spanned 19.4 points, which members found too wide. From 17 the rate
 * still reaches 50 at 1500 (nothing below 1500 moves), then narrows more slowly to 25 at 2600:
 * 1500 → 2200 is 16.9 points and 1500 → 1800 barely moves (6.8 → 6.5). The rate never jumps, so
 * there is no cliff where the taper ends. Model-16 starts are restated holding their ELO value
 * (`restateMatchesBetweenCurves`), exactly as the flat starts were at 16. */
export const HANDICAP_MODEL_VERSION = 17;
export type TaperAnchors = ReadonlyArray<readonly [number,number]>;
export const HANDICAP_TAPER_ANCHORS_V16:TaperAnchors = [[800,75],[2200,25]];
export const HANDICAP_TAPER_ANCHORS:TaperAnchors = [[800,75],[1500,50],[2600,25]];

/** The taper curve a rating model records its starts in. */
export function taperAnchorsFor(settings:{modelVersion?:number}):TaperAnchors {
  return (settings.modelVersion??0)>=HANDICAP_MODEL_VERSION?HANDICAP_TAPER_ANCHORS:HANDICAP_TAPER_ANCHORS_V16;
}

/** ELO represented by one handicap point at `rating` on the taper curve. */
export function taperEloPerPoint(rating:number,anchors:TaperAnchors=HANDICAP_TAPER_ANCHORS){
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
function taperPointsBetween(low:number,high:number,anchors:TaperAnchors){
  if(high<=low)return 0;
  const cuts=anchors.map(([x])=>x).filter(x=>x>low&&x<high);
  const edges=[low,...cuts,high];
  let points=0;
  for(let i=1;i<edges.length;i+=1){
    const p=edges[i-1],q=edges[i];
    const r0=taperEloPerPoint(p,anchors),r1=taperEloPerPoint(q,anchors);
    points+=Math.abs(r1-r0)<1e-9?(q-p)/r0:(q-p)/(r1-r0)*Math.log(r1/r0);
  }
  return points;
}

/** The ELO distance above `base` that `points` handicap points span on the curve. */
export function taperEloForPoints(base:number,points:number,anchors:TaperAnchors=HANDICAP_TAPER_ANCHORS){
  if(points<=0)return 0;
  let low=0,high=points*anchors[0][1]+1;
  for(let i=0;i<60;i+=1){
    const mid=(low+high)/2;
    if(taperPointsBetween(base,base+mid,anchors)<points)low=mid; else high=mid;
  }
  return (low+high)/2;
}

/** Signed handicap points from `from` up to `to`: positive when `to` is the higher rating. */
export function taperPoints(from:number,to:number,anchors:TaperAnchors=HANDICAP_TAPER_ANCHORS){
  return to>=from?taperPointsBetween(from,to,anchors):-taperPointsBetween(to,from,anchors);
}

/** Is the club on the curve (rating model 16 or later)? */
export function handicapCurveActive(settings:{modelVersion?:number}){
  return (settings.modelVersion??0)>=HANDICAP_CURVE_MODEL_VERSION;
}

/** A start handed out in flat points, restated in curve points. A flat start of `points` spanned
    `points * 25` ELO above the receiver; the same ELO is worth fewer curve points. Rounded to whole
    points, as recorded starts always are. */
export function legacyStartToCurve(points:number,receiverRating:number,anchors:TaperAnchors=HANDICAP_TAPER_ANCHORS){
  if(!points)return 0;
  return Math.round(taperPoints(receiverRating,receiverRating+Math.abs(points)*HANDICAP_ELO_PER_POINT,anchors));
}

/** A start recorded on one taper curve, restated on another holding its ELO value. */
export function restateStartBetweenCurves(points:number,receiverRating:number,from:TaperAnchors,to:TaperAnchors){
  if(!points)return 0;
  const elo=taperEloForPoints(receiverRating,Math.abs(points),from);
  return Math.round(taperPoints(receiverRating,receiverRating+elo,to));
}

export type StartedMatch = {
  a:string; b:string; giver:string|null; actual:number; official:number|null; extra:number;
  beforeA:number; beforeB:number; mode?:string;
};

/** The version-16 upgrade: every recorded start restated in curve points, holding its ELO value
    constant. The receiver's rating before the match fixes how many curve points the same ELO buys.
    `official` is the club's separately maintained per-player handicap gap, not a start handed out,
    so it is left alone and `extra` (what was played beyond it) is recomputed. Team matches carry
    no start. */
export function restateMatchesInCurve<T extends StartedMatch>(matches:T[],start:number):T[] {
  return restateStarts(matches,start,(points,receiver)=>legacyStartToCurve(points,receiver,HANDICAP_TAPER_ANCHORS_V16));
}

/** The version-17 upgrade: model-16 curve starts restated on the re-tapered curve, holding their
    ELO value, the same way the version-16 upgrade restated flat starts. */
export function restateMatchesBetweenCurves<T extends StartedMatch>(matches:T[],start:number):T[] {
  return restateStarts(matches,start,(points,receiver)=>
    restateStartBetweenCurves(points,receiver,HANDICAP_TAPER_ANCHORS_V16,HANDICAP_TAPER_ANCHORS));
}

function restateStarts<T extends StartedMatch>(matches:T[],start:number,restate:(points:number,receiver:number)=>number):T[] {
  const rated=(value:number)=>Number.isFinite(value)?value:start;
  return matches.map(match=>{
    if(match.mode==="2v2"||!match.giver||!match.actual)return match;
    const receiverRating=rated(match.giver===match.a?match.beforeB:match.beforeA);
    const actual=Math.sign(match.actual)*restate(Math.abs(match.actual),receiverRating);
    return {...match,actual,extra:actual-(match.official??0)};
  });
}

/** ELO per handicap point to give `calculateSnookerElo` for one match, so the rating engine and the
    suggested start always agree. `given` is signed from side A: positive when A gives points.
    Flat 25 before rating model 16. */
export function matchHandicapRate(ratingA:number,ratingB:number,given:number,settings:{modelVersion?:number}){
  if(!handicapCurveActive(settings))return HANDICAP_ELO_PER_POINT;
  const anchors=taperAnchorsFor(settings);
  const points=Math.abs(given);
  if(points===0)return taperEloPerPoint((ratingA+ratingB)/2,anchors);
  // The giver's edge is cut by the ELO those points span, measured up from the receiver's rating.
  return taperEloForPoints(given>0?ratingB:ratingA,points,anchors)/points;
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
export function proposeHandicap(t: Translator, myRating:number,theirRating:number,settings:HandicapSettings):HandicapProposal {
  const myHandicap=displayedHandicap(myRating,settings);
  const theirHandicap=displayedHandicap(theirRating,settings);
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
  settings:HandicapSettings&{start:number}):number {
  return displayedHandicap(player.rating,settings);
}

/** One rating's displayed handicap index: the preset at the starting rating, minus the points the
    rating sits above it. Flat 25 ELO per point, or the taper curve once it is in force. */
function displayedHandicap(rating:number,settings:HandicapSettings){
  const start=settings.start??1500;
  const above=handicapCurveActive(settings)
    ?taperPoints(start,rating,taperAnchorsFor(settings))
    :(rating-start)/HANDICAP_ELO_PER_POINT;
  return roundToNearestInteger(DEFAULT_SUGGESTED_HANDICAP-above);
}
