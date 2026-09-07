export const SIMILAR_ELO_RANGE=200;
export const BOARD_PAGE_SIZE=20;

export type OpponentFit="very-close"|"similar"|"handicap"|"unknown";

/** A group is similar when at least one other participant is within the same
 * ±200 ELO window used by the Players tab. Never compare the viewer to themself. */
export function hasSimilarOpponent(players:{id:string;rating:number}[],viewerId:string|null,viewerRating:number|null){
  return viewerId!==null&&viewerRating!==null&&Number.isFinite(viewerRating)
    &&players.some(player=>player.id!==viewerId&&Number.isFinite(player.rating)&&Math.abs(player.rating-viewerRating)<=SIMILAR_ELO_RANGE);
}

/** Pick the person the viewer can most meaningfully evaluate, not simply the host. In a multi-player
 * game this prevents the most suitable opponent being hidden behind the disclosure row. */
export function closestOpponent<T extends {id:string;rating:number}>(players:T[],viewerId:string|null,viewerRating:number|null){
  const opponents=players.filter(player=>player.id!==viewerId);
  if(!opponents.length)return null;
  if(viewerRating===null||!Number.isFinite(viewerRating))return opponents[0];
  return [...opponents].sort((a,b)=>Math.abs(a.rating-viewerRating)-Math.abs(b.rating-viewerRating))[0];
}

export function opponentFit(rating:number|undefined,viewerRating:number|null):{tier:OpponentFit;difference:number|null}{
  if(rating===undefined||viewerRating===null||!Number.isFinite(rating)||!Number.isFinite(viewerRating))return {tier:"unknown",difference:null};
  const difference=Math.abs(rating-viewerRating);
  return {tier:difference<=75?"very-close":difference<=SIMILAR_ELO_RANGE?"similar":"handicap",difference};
}

/** Recommendation order mirrors the decision the board explains: opponent fit first, then whether
 * the member's published time works, then chronology. Already-joined games remain available but do
 * not crowd out games the member can still choose. */
export function rankRecommendedCalls<T extends {players:{id:string;rating:number}[];joined:boolean;fits:boolean;startAt:string}>(calls:T[],viewerId:string|null,viewerRating:number|null){
  const distance=(call:T)=>{
    const opponent=closestOpponent(call.players,viewerId,viewerRating);
    return opponent&&viewerRating!==null?Math.abs(opponent.rating-viewerRating):Number.POSITIVE_INFINITY;
  };
  return [...calls].sort((a,b)=>Number(a.joined)-Number(b.joined)||distance(a)-distance(b)||Number(b.fits)-Number(a.fits)||Date.parse(a.startAt)-Date.parse(b.startAt));
}
