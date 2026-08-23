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
};

export const HANDICAP_ELO_PER_POINT = 25;

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
export function proposeHandicap(myRating:number,theirRating:number,settings:HandicapSettings):HandicapProposal {
  const start=settings.start??1500;
  const myHandicap=roundToNearestInteger(DEFAULT_SUGGESTED_HANDICAP-(myRating-start)/HANDICAP_ELO_PER_POINT);
  const theirHandicap=roundToNearestInteger(DEFAULT_SUGGESTED_HANDICAP-(theirRating-start)/HANDICAP_ELO_PER_POINT);
  const points=theirHandicap-myHandicap;
  if(points===0)return {points:0,direction:"level",label:"平手打就啱"};
  return points>0
    ?{points,direction:"give",label:`建議你讓 ${points} 分`}
    :{points,direction:"receive",label:`建議佢讓 ${Math.abs(points)} 分`};
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
export function headToHead(matches:PastMatch[],me:string,them:string):HeadToHead {
  const played=matches.filter(match=>match.status==="confirmed"
    &&((match.a===me&&match.b===them)||(match.a===them&&match.b===me)));
  let myWins=0,theirWins=0;
  for(const match of played){
    const mine=match.a===me?match.scoreA:match.scoreB;
    const theirs=match.a===me?match.scoreB:match.scoreA;
    if(mine>theirs)myWins+=1; else if(theirs>mine)theirWins+=1;
  }
  const label=played.length>=3?`你哋過往 ${played.length} 局 ${myWins} : ${theirWins}`:null;
  return {played:played.length,myWins,theirWins,label};
}

/** The full sentence for the recommendation card: the proposal, and the evidence behind it.
 *
 *  Two members who have never met get the proposal alone — which is exactly when it is worth the
 *  most, because there is no shared history to fall back on and the handicap is the only thing
 *  standing between "he is way better than me" and a game worth turning up for. */
export function handicapSentence(input:{
  myRating:number; theirRating:number; settings:HandicapSettings;
  matches:PastMatch[]; me:string; them:string;
}){
  const proposal=proposeHandicap(input.myRating,input.theirRating,input.settings);
  const record=headToHead(input.matches,input.me,input.them);
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
  return roundToNearestInteger(DEFAULT_SUGGESTED_HANDICAP
    -(player.rating-settings.start)/HANDICAP_ELO_PER_POINT);
}
