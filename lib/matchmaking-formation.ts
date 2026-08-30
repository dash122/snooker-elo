import {intersectIntervals, overlapMinutes, type Interval} from "./availability.ts";

export const MATCHMAKING_MIN_OVERLAP_MINUTES = 60;
export const MATCHMAKING_HORIZON_DAYS = 7;

export type FormationStatus = "forming"|"playable"|"full"|"cancelled"|"completed";

export function formationStatus(accepted:number,targetSize:number):FormationStatus {
  if(accepted>=targetSize)return "full";
  if(accepted>=2)return "playable";
  return "forming";
}

export function venuesCompatible(left:string|null|undefined,right:string|null|undefined) {
  return !left||!right||left===right;
}

export function viableOverlap(left:Interval[],right:Interval[],minimumMinutes=MATCHMAKING_MIN_OVERLAP_MINUTES) {
  return intersectIntervals(left,right).filter(item=>overlapMinutes([item])>=minimumMinutes);
}

export type FormationSlot = Interval & {
  id:string;
  playerId:string;
  venueId:string|null;
};

export type CommonWindow = Interval & {playerIds:string[]};

/** Find the strongest one-hour formation window around an anchor post.
 *
 * The count is based on members who cover the whole hour, not everyone who appears somewhere on
 * the same date. That is the difference between a group that can actually meet and a busy-looking
 * calendar. Ties prefer the earlier window, which keeps the feed stable between refreshes.
 */
export function bestCommonWindow(anchor:FormationSlot,viewerId:string,slots:FormationSlot[],minimumMinutes=MATCHMAKING_MIN_OVERLAP_MINUTES):CommonWindow|null {
  const step=30*60_000,minimum=minimumMinutes*60_000;
  const start=Math.ceil(Date.parse(anchor.startAt)/step)*step;
  const end=Date.parse(anchor.endAt);
  let best:CommonWindow|null=null;
  for(let at=start;at+minimum<=end;at+=step){
    const until=at+minimum;
    const players=new Set<string>();
    for(const slot of slots){
      if(!venuesCompatible(anchor.venueId,slot.venueId))continue;
      if(Date.parse(slot.startAt)<=at&&Date.parse(slot.endAt)>=until)players.add(slot.playerId);
    }
    if(!players.has(anchor.playerId)||!players.has(viewerId))continue;
    if(!best||players.size>best.playerIds.length){
      best={startAt:new Date(at).toISOString(),endAt:new Date(until).toISOString(),playerIds:[...players].sort()};
    }
  }
  return best;
}

export function opportunityScore(input:{compatiblePlayers:number;overlapMinutes:number;eloDifference:number;recentMatches:number}) {
  const group=Math.min(Math.max(input.compatiblePlayers-2,0),4)*12;
  const overlap=Math.min(input.overlapMinutes/180,1)*36;
  const elo=Math.max(1-input.eloDifference/400,0)*22;
  const variety=(1-Math.min(input.recentMatches,5)/5)*10;
  return Math.round((group+overlap+elo+variety)*10)/10;
}
