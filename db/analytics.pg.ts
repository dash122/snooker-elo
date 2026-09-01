import { getSql } from "./sql";
/** The club's own event store.
 *
 *  Deliberately one table with a jsonb payload rather than a schema per event: the point is to be
 *  able to answer questions about the funnel next month without a migration standing between the
 *  question and the answer. Rows are pruned on write, so this can never grow into a liability on a
 *  small deployment. */

export type AnalyticsEvent = { event:string; props:Record<string,unknown>|null; at:string };

export type EventDailyPoint = { date:string; members:number; triggers:number };
export type EventMemberDetail = {
  playerId:string;
  name:string;
  initials:string;
  colour:string|null;
  count:number;
  activeDays:number;
  firstAt:string;
  lastAt:string;
};

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
  const days=reportWindow(sinceDays);
  const sql=getSql();
  const rows=await sql<{event:string;count:number;players:number}[]>`
    WITH bounds AS (
      SELECT (((now() AT TIME ZONE 'Asia/Hong_Kong')::date - ${days-1}::int)::timestamp AT TIME ZONE 'Asia/Hong_Kong') AS start_at,now() AS end_at
    )
    SELECT event, count(*)::int AS count, count(DISTINCT player_id)::int AS players
    FROM analytics_events CROSS JOIN bounds
    WHERE occurred_at>=bounds.start_at AND occurred_at<bounds.end_at
    GROUP BY event ORDER BY count DESC,event ASC`;
  return rows;
}

function reportWindow(sinceDays:number){
  return sinceDays===7||sinceDays===30||sinceDays===90?sinceDays:30;
}

/** One row per Hong Kong calendar day, including days with no activity. */
export async function eventDailyMembers(event:string,sinceDays=30){
  const days=reportWindow(sinceDays);
  const sql=getSql();
  const rows=await sql<EventDailyPoint[]>`
    WITH bounds AS (
      SELECT
        ((now() AT TIME ZONE 'Asia/Hong_Kong')::date - ${days-1}::int) AS start_day,
        (now() AT TIME ZONE 'Asia/Hong_Kong')::date AS end_day,
        (((now() AT TIME ZONE 'Asia/Hong_Kong')::date - ${days-1}::int)::timestamp AT TIME ZONE 'Asia/Hong_Kong') AS start_at,
        now() AS end_at
    ),
    dates AS (
      SELECT generate_series(start_day,end_day,interval '1 day')::date AS day
      FROM bounds
    ),
    filtered AS (
      SELECT (e.occurred_at AT TIME ZONE 'Asia/Hong_Kong')::date AS day,e.player_id
      FROM analytics_events e CROSS JOIN bounds
      WHERE e.event=${event}
        AND e.player_id IS NOT NULL
        AND e.occurred_at>=bounds.start_at
        AND e.occurred_at<bounds.end_at
    )
    SELECT to_char(dates.day,'YYYY-MM-DD') AS date,
      count(DISTINCT filtered.player_id)::int AS members,
      count(filtered.player_id)::int AS triggers
    FROM dates LEFT JOIN filtered ON filtered.day=dates.day
    GROUP BY dates.day ORDER BY dates.day`;
  return rows;
}

/** Member-level event activity, restricted to analytics rows linked to a player. */
export async function eventMemberDetails(event:string,sinceDays=30){
  const days=reportWindow(sinceDays);
  const sql=getSql();
  const rows=await sql<EventMemberDetail[]>`
    WITH bounds AS (
      SELECT (((now() AT TIME ZONE 'Asia/Hong_Kong')::date - ${days-1}::int)::timestamp AT TIME ZONE 'Asia/Hong_Kong') AS start_at,now() AS end_at
    )
    SELECT
      e.player_id AS "playerId",
      COALESCE(NULLIF(m.display_name,''),NULLIF(p.name,''),e.player_id) AS name,
      COALESCE(NULLIF(m.initials,''),NULLIF(p.short,''),upper(left(e.player_id,2))) AS initials,
      COALESCE(m.icon_colour,p.colour) AS colour,
      count(*)::int AS count,
      count(DISTINCT (e.occurred_at AT TIME ZONE 'Asia/Hong_Kong')::date)::int AS "activeDays",
      (to_char(min(e.occurred_at) AT TIME ZONE 'Asia/Hong_Kong','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+08:00') AS "firstAt",
      (to_char(max(e.occurred_at) AT TIME ZONE 'Asia/Hong_Kong','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+08:00') AS "lastAt"
    FROM analytics_events e
      CROSS JOIN bounds
      LEFT JOIN state_players p ON p.id=e.player_id
      LEFT JOIN members m ON m.state_player_id=e.player_id
    WHERE e.event=${event}
      AND e.player_id IS NOT NULL
      AND e.occurred_at>=bounds.start_at
      AND e.occurred_at<bounds.end_at
    GROUP BY e.player_id,m.display_name,p.name,m.initials,p.short,m.icon_colour,p.colour
    ORDER BY count(*) DESC,max(e.occurred_at) DESC,name ASC`;
  return rows;
}
