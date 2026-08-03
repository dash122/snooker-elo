import { getSql } from "./sql";
import { listAvailability } from "./availability.pg";
import { createOffers, engagedWith } from "./offers.pg";
import { notifyPlayers } from "./notifications.pg";
import { intersectIntervals, overlapMinutes, proposeMatchOffers, type Interval } from "../lib/availability";
import { offerProposed, offerMatched, openCallPosted } from "../lib/notify";

/** Multi-step matchmaking flows that span several tables.
 *
 *  Kept out of the individual data modules so each of those stays a thin, testable wrapper over its
 *  own table, and out of the route handlers so the same flow can be triggered from more than one
 *  place — publishing slots, tapping "free now", and materialising a recurrence rule all end in the
 *  same announcement. */

async function playerNames(ids:string[]){
  if(!ids.length)return new Map<string,string>();
  const sql=getSql();
  const rows=await sql<{id:string;name:string}[]>`SELECT id,name FROM state_players WHERE id IN ${sql(ids)}`;
  return new Map(rows.map(row=>[row.id,row.name]));
}

/** The horizon the offer matcher looks across. Wider than one day because a member publishing next
    Tuesday deserves the same treatment as one publishing tonight. */
const OFFER_HORIZON_DAYS = 14;

/** Announce that a member has time free, and ask the best few overlapping opponents whether they
 *  want the game.
 *
 *  Runs after any path that adds availability. Everything about it is designed to stay quiet: the
 *  proposer caps how many go out, anyone already mid-conversation with this member is excluded, and
 *  an hour of genuine overlap is the floor. A member who publishes a fortnight of evenings triggers
 *  three questions, not thirty. */
export async function announceAvailability(playerId:string,intervals:Interval[]){
  if(!intervals.length)return {offers:0};
  const now=new Date(),horizon=new Date(Date.now()+OFFER_HORIZON_DAYS*86400000);
  const members=await listAvailability(now.toISOString(),horizon.toISOString());
  const me=members.find(member=>member.id===playerId);
  const excluded=await engagedWith(playerId);
  const proposals=proposeMatchOffers({
    mine:intervals,rating:me?.rating??0,
    opponents:members.filter(member=>member.id!==playerId).map(member=>({id:member.id,rating:member.rating,slots:member.slots as Interval[]})),
    excluded:[...excluded,playerId],
  });
  if(!proposals.length)return {offers:0};
  const created=await createOffers(playerId,proposals);
  if(!created.length)return {offers:0};
  const names=await playerNames([playerId]);
  const from=names.get(playerId)??"球友";
  /* Only the opponents are pushed. The member who just published is looking at the screen that
     created these offers, so notifying them would be an interruption about their own action. */
  await Promise.all(created.map(offer=>notifyPlayers([offer.opponentId],offerProposed(from,{startAt:offer.startAt,endAt:offer.endAt}))));
  return {offers:created.length};
}

/** Tell the other side their offer turned into a real game. Only ever called when both said yes, so
    neither member can infer anything from silence. */
export async function announceOfferMatch(playerId:string,opponentId:string,slot:Interval,venue?:string|null){
  const names=await playerNames([playerId]);
  await notifyPlayers([opponentId],offerMatched(names.get(playerId)??"球友",slot,venue));
}

/** Push an open call to the members who could actually take it.
 *
 *  Targeted at members whose published availability overlaps the call rather than broadcast to the
 *  whole club: a notification about a table at a time you already said you are busy is exactly the
 *  kind of message that teaches people to switch notifications off. Members who never published
 *  still see the call in the app; they simply do not get woken for it. */
export async function announceOpenCall(playerId:string,playerName:string,call:Interval&{message?:string;venue?:string|null}){
  const members=await listAvailability(call.startAt,call.endAt);
  const audience=members
    .filter(member=>member.id!==playerId)
    .filter(member=>overlapMinutes(intersectIntervals(member.slots as Interval[],[{startAt:call.startAt,endAt:call.endAt}]))>=30)
    .map(member=>member.id);
  if(!audience.length)return {notified:0};
  await notifyPlayers(audience,openCallPosted(playerName,call,call.message??"",call.venue));
  return {notified:audience.length};
}
