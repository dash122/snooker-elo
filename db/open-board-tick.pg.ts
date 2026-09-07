import { getSql } from "./sql";
import { notifyPlayers } from "./notifications.pg";
import { gameReminder, resultPrompt } from "../lib/notify";
import { completeEndedCalls } from "./open-board.pg";

/* --- The two time-based messages ------------------------------------------
 *
 * Everything else in 開局板 is event-driven and sends itself from the request that caused it. These
 * two are not: "three hours before" and "the morning after" are moments, not actions, so something
 * has to come looking for them.
 *
 * This sweep is idempotent -- each send stamps its own column and the queries exclude anything
 * already stamped -- so it is safe to call from a cron, from a page load, or from both at once. That
 * matters because the project has no scheduler today: called opportunistically it still works,
 * merely later than intended, and adding a cron later makes it punctual without changing anything
 * here. The board's GET calls it for exactly that reason.
 */

const REMIND_WITHIN_HOURS = 3;

type Recipient = {call_id:string;player_id:string;start_at:Date;end_at:Date;venue:string|null;players:string};

function groupByCall(rows:Recipient[]){
  const byCall=new Map<string,Recipient[]>();
  for(const row of rows){
    const list=byCall.get(row.call_id)??[];list.push(row);byCall.set(row.call_id,list);
  }
  return byCall;
}

/** Games starting within the next three hours that have reached two participants and have not been
    reminded. Deliberately silent for a 局 still on one person: there is nothing to turn up to yet,
    and telling someone their unaccompanied 局 is in three hours is a nag, not a service. */
async function sendReminders(){
  const sql=getSql();
  const due=await sql<Recipient[]>`
    WITH ready AS (
      SELECT c.id, c.start_at, c.end_at, coalesce(v.name, nullif(c.venue_intent,''), null) AS venue,
             count(ocp.player_id) AS players
      FROM open_calls c
      LEFT JOIN venues v ON v.id=c.venue_id
      JOIN open_call_players ocp ON ocp.call_id=c.id
      WHERE c.status='open' AND c.reminded_at IS NULL
        AND c.start_at > now()
        AND c.start_at <= now() + make_interval(hours => ${REMIND_WITHIN_HOURS})
      GROUP BY c.id, c.start_at, c.end_at, v.name, c.venue_intent
      HAVING count(ocp.player_id) >= 2
    )
    SELECT ready.id AS call_id, ocp.player_id, ready.start_at, ready.end_at, ready.venue,
           ready.players::text AS players
    FROM ready JOIN open_call_players ocp ON ocp.call_id=ready.id`;
  if(!due.length)return 0;

  const byCall=groupByCall(due);
  for(const [callId,rows] of byCall){
    const first=rows[0];
    await notifyPlayers(rows.map(row=>row.player_id),gameReminder(Number(first.players),
      {startAt:first.start_at.toISOString(),endAt:first.end_at.toISOString()},first.venue));
    /* Stamped after the send rather than before: a failed send that had already been marked would
       silently cost the whole 局 its only reminder. A duplicate is the cheaper failure. */
    await sql`UPDATE open_calls SET reminded_at=now() WHERE id=${callId}`;
  }
  return byCall.size;
}

/** The morning after a finished 局, once per 局. The only message in the set that asks for anything,
    and the only reason to come back -- a recorded result is what turns an evening into ELO.
    Bounded to 48 hours so a backfill or an outage never mails members about last month's games. */
async function sendResultPrompts(){
  const sql=getSql();
  const due=await sql<Recipient[]>`
    SELECT c.id AS call_id, ocp.player_id, c.start_at, c.end_at,
           coalesce(v.name, nullif(c.venue_intent,''), null) AS venue, '0' AS players
    FROM open_calls c
    LEFT JOIN venues v ON v.id=c.venue_id
    JOIN open_call_players ocp ON ocp.call_id=c.id
    WHERE c.status='completed' AND c.result_prompted_at IS NULL
      AND c.end_at <= now() AND c.end_at > now() - interval '48 hours'
      AND (SELECT count(*) FROM open_call_players WHERE call_id=c.id) >= 2`;
  if(!due.length)return 0;

  const byCall=groupByCall(due);
  for(const [callId,rows] of byCall){
    const first=rows[0];
    await notifyPlayers(rows.map(row=>row.player_id),
      resultPrompt({startAt:first.start_at.toISOString(),endAt:first.end_at.toISOString()},first.venue));
    await sql`UPDATE open_calls SET result_prompted_at=now() WHERE id=${callId}`;
  }
  return byCall.size;
}

/** Close what has ended, then send what is due. Safe to call as often as anything likes. */
export async function tickOpenBoard(){
  await completeEndedCalls();
  const [reminded,prompted]=await Promise.all([sendReminders(),sendResultPrompts()]);
  return {reminded,prompted};
}
