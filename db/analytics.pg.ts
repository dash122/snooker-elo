import { getSql } from "./sql";
/** The club's own event store.
 *
 *  Deliberately one table with a jsonb payload rather than a schema per event: the point is to be
 *  able to answer questions about the funnel next month without a migration standing between the
 *  question and the answer. Rows are pruned on write, so this can never grow into a liability on a
 *  small deployment. */

export type AnalyticsEvent = { event:string; props:Record<string,unknown>|null; at:string };

const RETENTION_DAYS = 180;
let lastPrune = 0;

export async function recordEvents(playerId:string|null,events:AnalyticsEvent[]){
  if(!events.length)return 0;
  const sql=getSql();
  await sql`INSERT INTO analytics_events ${sql(events.map(item=>({
    player_id:playerId,event:item.event,props:item.props?JSON.stringify(item.props):null,occurred_at:item.at,
  })),"player_id","event","props","occurred_at")}`;
  /* Pruning here rather than on a schedule, for the same reason the invite sweep does: there is no
     scheduler in this deployment, and a once-an-hour DELETE on an indexed column is cheaper than the
     table growing without bound. */
  if(Date.now()-lastPrune>60*60*1000){
    lastPrune=Date.now();
    await sql`DELETE FROM analytics_events WHERE occurred_at < now()-make_interval(days => ${RETENTION_DAYS})`.catch(()=>{});
  }
  return events.length;
}

/** Funnel counts for a window, for whoever comes to ask how the redesign is doing. */
export async function eventCounts(sinceDays=30){
  const sql=getSql();
  const rows=await sql<{event:string;count:number;players:number}[]>`
    SELECT event, count(*)::int AS count, count(DISTINCT player_id)::int AS players
    FROM analytics_events WHERE occurred_at > now()-make_interval(days => ${sinceDays})
    GROUP BY event ORDER BY count DESC`;
  return rows;
}
