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
  /* Turning up is a joint fact about a fixture, so both participants are credited or debited for the
     same row — hence the UNION ALL over the two sides rather than a single column. Keep both
     aggregates in one statement: this function runs on the app-shell summary path. */
  const rows=await sql<any[]>`
    WITH answered AS (
      SELECT to_player_id AS "playerId",
        count(*)::int AS total,
        count(*) FILTER (WHERE status='accepted')::int AS accepted,
        avg(EXTRACT(EPOCH FROM (responded_at-created_at))/3600) FILTER (WHERE responded_at IS NOT NULL AND status IN ('accepted','declined')) AS "responseHours"
      FROM match_invites
      WHERE created_at > now()-interval '180 days' AND status IN ('accepted','declined','expired')
      GROUP BY to_player_id
    ), shown AS (
      SELECT "playerId", count(*)::int AS total, count(*) FILTER (WHERE status='played')::int AS played
      FROM (
        SELECT from_player_id AS "playerId",status FROM match_invites WHERE status IN ('played','missed') AND created_at > now()-interval '180 days'
        UNION ALL
        SELECT to_player_id AS "playerId",status FROM match_invites WHERE status IN ('played','missed') AND created_at > now()-interval '180 days'
      ) sides GROUP BY "playerId"
    )
    SELECT COALESCE(answered."playerId",shown."playerId") AS "playerId",
      answered.total AS "answeredTotal",answered.accepted,answered."responseHours",
      shown.total AS "shownTotal",shown.played
    FROM answered FULL OUTER JOIN shown ON shown."playerId"=answered."playerId"`;
  const stats:Record<string,PlayerReliability>={};
  const entry=(id:string)=>(stats[id]??={answered:0,shown:0});
  for(const row of rows){
    const item=entry(row.playerId);
    const total=Number(row.answeredTotal??0);
    item.answered=total;
    if(total>=MIN_SAMPLE)item.acceptRate=Number(row.accepted)/total;
    if(row.responseHours!==null&&row.responseHours!==undefined)item.responseHours=Number(row.responseHours);
    const shown=Number(row.shownTotal??0);
    item.shown=shown;
    if(shown>=MIN_SAMPLE)item.showRate=Number(row.played)/shown;
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
  const [row]=await sql<any[]>`
    WITH invite_counts AS (
      SELECT
        count(*) FILTER (WHERE status='pending' AND COALESCE(counter_start_at,start_at)>now()
          AND ((counter_by_id IS NULL AND to_player_id=${playerId}) OR (counter_by_id IS NOT NULL AND counter_by_id<>${playerId})))::int AS "needsResponse",
        count(*) FILTER (WHERE status='pending' AND COALESCE(counter_start_at,start_at)>now()
          AND ((counter_by_id IS NULL AND from_player_id=${playerId}) OR (counter_by_id=${playerId})))::int AS "awaitingReply",
        count(*) FILTER (WHERE status='accepted' AND end_at>now())::int AS "upcoming",
        count(*) FILTER (WHERE status='accepted' AND end_at<=now())::int AS "followUps"
      FROM match_invites WHERE from_player_id=${playerId} OR to_player_id=${playerId}
    ), offer_counts AS (
      SELECT count(*)::int AS "offers" FROM match_offers
      WHERE status='live' AND start_at>now()-interval '30 minutes'
        AND ((a_player_id=${playerId} AND a_response='pending') OR (b_player_id=${playerId} AND b_response='pending'))
    ), call_counts AS (
      SELECT count(*)::int AS "openCalls" FROM open_calls
      WHERE status='open' AND start_at>now()-interval '30 minutes' AND player_id<>${playerId}
    )
    SELECT invite_counts.*,offer_counts.*,call_counts.*
    FROM invite_counts CROSS JOIN offer_counts CROSS JOIN call_counts`;
  return {
    needsResponse:row?.needsResponse??0,awaitingReply:row?.awaitingReply??0,
    upcoming:row?.upcoming??0,followUps:row?.followUps??0,
    offers:row?.offers??0,openCalls:row?.openCalls??0,
  };
}
