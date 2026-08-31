import {intersectIntervals, overlapMinutes, type Interval} from "./availability.ts";

export const MATCHMAKING_MIN_OVERLAP_MINUTES = 60;
export const MATCHMAKING_HORIZON_DAYS = 7;

/**
 * The storage model still carries the old group-formation states for backwards compatibility, but
 * the MVP has one job: get two people to a confirmed game. `forming` is therefore the only pending
 * state and `full` is the member-facing confirmed state. `playable` remains understood so existing
 * rows can be read safely during the migration window.
 */
export type FormationStatus = "forming"|"playable"|"full"|"cancelled"|"completed";

export function formationStatus(accepted:number,targetSize:number):FormationStatus {
  /* Option A is deliberately one-to-one. Keep the parameter for callers reading legacy rows, but
     never let a client-selected group size change the confirmation rule. */
  if(accepted>=2&&targetSize>=2)return "full";
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

/** Find the strongest one-hour common window for one requester and one anchor post.
 *
 * The earlier formation prototype searched for the hour covered by the largest possible group. The
 * MVP has one-to-one matchmaking, so the only relevant people are the anchor and viewer. We prefer
 * the longest overlap and then the earliest start to keep the recommendation stable between refreshes.
 */
export function bestCommonWindow(anchor:FormationSlot,viewerId:string,slots:FormationSlot[],minimumMinutes=MATCHMAKING_MIN_OVERLAP_MINUTES):CommonWindow|null {
  const viewerSlots=slots.filter(slot=>slot.playerId===viewerId&&venuesCompatible(anchor.venueId,slot.venueId));
  const overlaps=intersectIntervals([{startAt:anchor.startAt,endAt:anchor.endAt}],viewerSlots)
    .filter(item=>overlapMinutes([item])>=minimumMinutes)
    .sort((left,right)=>overlapMinutes([right])-overlapMinutes([left])||left.startAt.localeCompare(right.startAt));
  const overlap=overlaps[0];
  return overlap?{startAt:overlap.startAt,endAt:overlap.endAt,playerIds:[anchor.playerId,viewerId].sort()}:null;
}

export function opportunityScore(input:{compatiblePlayers?:number;overlapMinutes:number;eloDifference:number;recentMatches:number}) {
  /* Ranking answers the one-to-one job, so group size is not a user-facing signal anymore. The
     optional field keeps this helper source-compatible with callers/tests from the formation
     prototype while ensuring it cannot outweigh a viable overlap. */
  const overlap=Math.min(input.overlapMinutes/180,1)*50;
  const elo=Math.max(1-input.eloDifference/400,0)*30;
  const variety=(1-Math.min(input.recentMatches,5)/5)*20;
  return Math.round((overlap+elo+variety)*10)/10;
}
