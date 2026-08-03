import { getSql } from "./sql";
import { ensureInviteSchema } from "./invites.pg";
import { ensureOfferSchema } from "./offers.pg";
import { ensureOpenCallSchema } from "./open-calls.pg";
import type { ReliabilitySignals } from "../lib/availability";

/** Signals the client cannot compute for itself.
 *
 *  How reliably a member answers, turns up, and how fast they reply lives entirely in the invite
 *  lifecycle table, which no browser has access to. The ranking still composes in `lib/availability`
 *  where it stays shared and unit-tested; this module supplies the one input that has to come from
 *  the server. */

export type PlayerReliability = ReliabilitySignals & { answered:number; shown:number };

/** Six months of behaviour, keyed by player.
 *
 *  A rate is only reported once there is enough history to mean anything — below three data points
 *  the field stays undefined and `reliabilityFactor` scores it neutral. Two declined invites in
 *  someone's first week should not brand them unreliable for the rest of the season. */
const MIN_SAMPLE = 3;

export async function reliabilityByPlayer():Promise<Record<string,PlayerReliability>>{
  await ensureInviteSchema(); const sql=getSql();
  const answered=await sql<any[]>`
    SELECT to_player_id AS "playerId",
      count(*)::int AS "total",
      count(*) FILTER (WHERE status='accepted')::int AS "accepted",
      avg(EXTRACT(EPOCH FROM (responded_at-created_at))/3600) FILTER (WHERE responded_at IS NOT NULL AND status IN ('accepted','declined')) AS "responseHours"
    FROM match_invites
    WHERE created_at > now()-interval '180 days' AND status IN ('accepted','declined','expired')
    GROUP BY to_player_id`;
  /* Turning up is a joint fact about a fixture, so both participants are credited or debited for the
     same row — hence the UNION ALL over the two sides rather than a single column. */
  const shown=await sql<any[]>`
    SELECT "playerId", count(*)::int AS "total", count(*) FILTER (WHERE status='played')::int AS "played"
    FROM (
      SELECT from_player_id AS "playerId",status FROM match_invites WHERE status IN ('played','missed') AND created_at > now()-interval '180 days'
      UNION ALL
      SELECT to_player_id AS "playerId",status FROM match_invites WHERE status IN ('played','missed') AND created_at > now()-interval '180 days'
    ) sides GROUP BY "playerId"`;
  const stats:Record<string,PlayerReliability>={};
  const entry=(id:string)=>(stats[id]??={answered:0,shown:0});
  for(const row of answered){
    const item=entry(row.playerId);
    item.answered=row.total;
    if(row.total>=MIN_SAMPLE)item.acceptRate=row.accepted/row.total;
    if(row.responseHours!==null&&row.responseHours!==undefined)item.responseHours=Number(row.responseHours);
  }
  for(const row of shown){
    const item=entry(row.playerId);
    item.shown=row.total;
    if(row.total>=MIN_SAMPLE)item.showRate=row.played/row.total;
  }
  return stats;
}

export type MatchmakingCounts = { needsResponse:number; awaitingReply:number; upcoming:number; followUps:number; offers:number; openCalls:number };

/** The numbers behind the navigation badge.
 *
 *  Deliberately one small query set rather than the full inbox: this runs for every signed-in member
 *  on every page of the app, including the ones that have nothing to do with matchmaking. It answers
 *  "is there anything here for me" and nothing more.
 *
 *  "Needs my response" honours counter-proposals — after the other side suggests a new time, the ball
 *  is in the original sender's court, and a badge that ignored that would leave a member's own
 *  negotiation invisible to them. */
export async function matchmakingCounts(playerId:string):Promise<MatchmakingCounts>{
  await ensureInviteSchema(); await ensureOfferSchema(); await ensureOpenCallSchema(); const sql=getSql();
  const [invites]=await sql<any[]>`SELECT
    count(*) FILTER (WHERE status='pending' AND COALESCE(counter_start_at,start_at)>now()
      AND ((counter_by_id IS NULL AND to_player_id=${playerId}) OR (counter_by_id IS NOT NULL AND counter_by_id<>${playerId})))::int AS "needsResponse",
    count(*) FILTER (WHERE status='pending' AND COALESCE(counter_start_at,start_at)>now()
      AND ((counter_by_id IS NULL AND from_player_id=${playerId}) OR (counter_by_id=${playerId})))::int AS "awaitingReply",
    count(*) FILTER (WHERE status='accepted' AND end_at>now())::int AS "upcoming",
    count(*) FILTER (WHERE status='accepted' AND end_at<=now())::int AS "followUps"
    FROM match_invites WHERE from_player_id=${playerId} OR to_player_id=${playerId}`;
  const [offers]=await sql<any[]>`SELECT count(*)::int AS "offers" FROM match_offers
    WHERE status='live' AND start_at>now()-interval '30 minutes'
      AND ((a_player_id=${playerId} AND a_response='pending') OR (b_player_id=${playerId} AND b_response='pending'))`;
  const [calls]=await sql<any[]>`SELECT count(*)::int AS "openCalls" FROM open_calls
    WHERE status='open' AND start_at>now()-interval '30 minutes' AND player_id<>${playerId}`;
  return {
    needsResponse:invites?.needsResponse??0,awaitingReply:invites?.awaitingReply??0,
    upcoming:invites?.upcoming??0,followUps:invites?.followUps??0,
    offers:offers?.offers??0,openCalls:calls?.openCalls??0,
  };
}
