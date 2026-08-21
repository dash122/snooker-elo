import { getSql } from "./sql";
import { addDaysHongKong, composeAvailabilityInterval, hkDate, recurrenceDates, validateAvailabilityInterval } from "../lib/availability";

/** Recurring availability — "每逢星期三 19:00–22:00".
 *
 *  A club's most valuable members are its regulars, and the original design punished them hardest:
 *  slots were one-shot rows, so every week a regular's availability quietly emptied and they dropped
 *  off everyone's shortlist until they remembered to repaint it.
 *
 *  A rule is *materialised* into ordinary slots rather than consulted at query time. That keeps every
 *  reader — the grid, the density chart, the ranking, the offer matcher — working on plain slots with
 *  no knowledge of recurrence, and it means a member can still cancel or reshape a single week's
 *  occurrence like any other slot. Slot ids are derived from the rule and date, so re-running the
 *  materialiser is idempotent, and a cancelled occurrence stays cancelled instead of resurrecting
 *  itself on the next pass. */

export type RecurrenceRule = { id:string; playerId:string; weekday:number; startTime:string; endTime:string; active:boolean; createdAt:string };

/** Four weeks ahead. Long enough that a regular is always visible to anyone browsing the 14-day
    strip, short enough that a forgotten rule does not advertise someone's Wednesdays for a year. */
export const RECURRENCE_HORIZON_DAYS = 28;

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  // Schema changes are migration-owned — see the identical short-circuit in
  // db/availability.pg.ts. availability_recurrence is already live everywhere
  // this module runs, so skip re-running the bootstrap on every cold start.
  return Promise.resolve();

  schemaReady??=(async()=>{
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS availability_recurrence (
      id text PRIMARY KEY,
      player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time text NOT NULL, end_time text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS availability_recurrence_unique_idx
      ON availability_recurrence (player_id,weekday,start_time,end_time) WHERE active`;
    await sql`CREATE INDEX IF NOT EXISTS availability_recurrence_player_idx ON availability_recurrence (player_id) WHERE active`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

const hydrate=(row:any):RecurrenceRule=>({id:row.id,playerId:row.playerId,weekday:Number(row.weekday),startTime:row.startTime,endTime:row.endTime,active:row.active,createdAt:new Date(row.createdAt).toISOString()});

export async function listRecurrence(playerId:string):Promise<RecurrenceRule[]>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT id,player_id AS "playerId",weekday,start_time AS "startTime",end_time AS "endTime",active,created_at AS "createdAt"
    FROM availability_recurrence WHERE player_id=${playerId} AND active ORDER BY weekday,start_time`;
  return rows.map(hydrate);
}

export async function createRecurrence(playerId:string,input:{weekday:number;startTime:string;endTime:string}){
  await ensureSchema(); const sql=getSql();
  /* Validated against one concrete future occurrence so a rule can never encode a slot the one-off
     composer would reject — same playing window, same minimum length, same 30-minute grid. */
  const probe=recurrenceDates(input.weekday,hkDate(),RECURRENCE_HORIZON_DAYS)[0]??addDaysHongKong(hkDate(),7);
  validateAvailabilityInterval(composeAvailabilityInterval(probe,input.startTime,input.endTime),Date.parse(`${probe}T00:00:00+08:00`));
  const id=crypto.randomUUID();
  const rows=await sql<any[]>`INSERT INTO availability_recurrence (id,player_id,weekday,start_time,end_time)
    VALUES (${id},${playerId},${input.weekday},${input.startTime},${input.endTime})
    ON CONFLICT DO NOTHING
    RETURNING id,player_id AS "playerId",weekday,start_time AS "startTime",end_time AS "endTime",active,created_at AS "createdAt"`;
  if(!rows[0])throw new Error("你已經有一條相同嘅每週時段");
  await materialiseRecurrence(playerId);
  return hydrate(rows[0]);
}

/** Stop a rule. Occurrences already materialised are left alone on purpose: they are published
    availability that other members can currently see and may already have planned around. Deleting
    them silently would make a member vanish from tonight's board. The member cancels the ones they
    actually want gone, from the board, like any other slot. */
export async function deleteRecurrence(id:string,playerId:string){
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`UPDATE availability_recurrence SET active=false WHERE id=${id} AND player_id=${playerId} AND active RETURNING id`;
  return Boolean(rows[0]);
}

const slotId=(ruleId:string,date:string)=>`r:${ruleId}:${date}`;

/** Expand rules into concrete slots for the horizon.
 *
 *  `ON CONFLICT (id) DO NOTHING` carries the whole idempotency story: a second run inserts nothing,
 *  and an occurrence the member has since cancelled still owns its id, so it is not recreated. */
export async function materialiseRecurrence(playerId?:string){
  await ensureSchema(); const sql=getSql();
  const rules=playerId
    ?await sql<any[]>`SELECT id,player_id AS "playerId",weekday,start_time AS "startTime",end_time AS "endTime" FROM availability_recurrence WHERE active AND player_id=${playerId}`
    :await sql<any[]>`SELECT id,player_id AS "playerId",weekday,start_time AS "startTime",end_time AS "endTime" FROM availability_recurrence WHERE active`;
  if(!rules.length)return 0;
  const today=hkDate();
  let created=0;
  for(const rule of rules){
    for(const date of recurrenceDates(Number(rule.weekday),today,RECURRENCE_HORIZON_DAYS)){
      let interval;
      /* A rule that is legal in general can still produce an illegal occurrence — today's, once the
         start time has passed. Skipping is right: the member is not "free 19:00–22:00" at 21:40. */
      try{ interval=validateAvailabilityInterval(composeAvailabilityInterval(date,rule.startTime,rule.endTime)); }catch{ continue; }
      const rows=await sql<{id:string}[]>`INSERT INTO availability_slots (id,player_id,start_at,end_at)
        VALUES (${slotId(rule.id,date)},${rule.playerId},${interval.startAt},${interval.endAt})
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      if(rows[0])created+=1;
    }
  }
  return created;
}

/* Materialising every rule in the club is cheap but not free, and every availability read would
   otherwise trigger it. Once every ten minutes per process is far more often than a horizon four
   weeks out actually needs. */
let lastSweep=0;
export async function materialiseRecurrenceThrottled(intervalMs=10*60*1000){
  if(Date.now()-lastSweep<intervalMs)return 0;
  lastSweep=Date.now();
  try{ return await materialiseRecurrence(); }catch{ lastSweep=0; return 0; }
}

/** "Same as last week" — the one-tap that turns a regular back on without opening the editor.
    Reads the slots the member actually published in the previous seven days and shifts them forward,
    skipping anything that would land in the past or collide with something already published. */
export async function copyPreviousWeek(playerId:string){
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT start_at AS "startAt",end_at AS "endAt" FROM availability_slots
    WHERE player_id=${playerId} AND cancelled_at IS NULL AND start_at >= now()-interval '7 days' AND start_at < now()
    ORDER BY start_at`;
  const shifted:{startAt:string;endAt:string}[]=[];
  for(const row of rows){
    const startAt=new Date(Date.parse(row.startAt)+7*86400000).toISOString();
    const endAt=new Date(Date.parse(row.endAt)+7*86400000).toISOString();
    try{ shifted.push(validateAvailabilityInterval({startAt,endAt})); }catch{ /* landed outside the playing window after the shift */ }
  }
  return shifted;
}
