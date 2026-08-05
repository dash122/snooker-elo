import { getSql } from "./sql";
import { mergeIntervals, type AvailabilitySlot } from "../lib/availability";
import { materialiseRecurrence, materialiseRecurrenceThrottled } from "./recurrence.pg";

export type AvailabilityMember = { id:string; name:string; short:string; rating:number; colour?:string|null; avatar?:string|null; slots:AvailabilitySlot[] };

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  schemaReady??=(async()=>{
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS availability_slots (
      id text PRIMARY KEY, player_id text NOT NULL REFERENCES state_players(id) ON DELETE RESTRICT,
      start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz,
      CHECK (end_at > start_at)
    )`;
    /* A slot is a session: the block of time a member set aside to play. `venue` and `note` are what
       they would otherwise have had to type into an open call, which is now the same object. Added
       after the table shipped, so bounded DDL for the same pooler reason as everywhere else. */
    await sql.begin(async tx=>{
      await tx`SET LOCAL lock_timeout = '4s'`;
      await tx`ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT ''`;
      await tx`ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT ''`;
    });
    await sql`CREATE INDEX IF NOT EXISTS availability_slots_active_range_idx ON availability_slots (start_at, end_at) WHERE cancelled_at IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS availability_slots_player_active_idx ON availability_slots (player_id, start_at) WHERE cancelled_at IS NULL`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

function slot(row:any):AvailabilitySlot { return {id:row.id,playerId:row.playerId,startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),createdAt:new Date(row.createdAt).toISOString(),updatedAt:new Date(row.updatedAt).toISOString(),cancelledAt:row.cancelledAt?new Date(row.cancelledAt).toISOString():null}; }

export async function listAvailability(startAt:string,endAt:string){
  await ensureSchema(); await materialiseRecurrenceThrottled(); const sql=getSql();
  const rows=await sql<any[]>`SELECT p.id AS "playerId",p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar,s.id,s.start_at AS "startAt",s.end_at AS "endAt",s.created_at AS "createdAt",s.updated_at AS "updatedAt",s.cancelled_at AS "cancelledAt"
    FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE s.cancelled_at IS NULL AND s.end_at > now() AND s.start_at < ${endAt} AND s.end_at > ${startAt} AND p.active=true
    ORDER BY p.name,s.start_at`;
  const grouped=new Map<string,AvailabilityMember>();
  for(const row of rows){const current:AvailabilityMember=grouped.get(row.playerId)??{id:row.playerId,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar,slots:[]};current.slots.push(slot({...row,playerId:row.playerId}));grouped.set(row.playerId,current);}
  return [...grouped.values()];
}

export async function listOwnAvailability(playerId:string){
  /* This member's own rules are expanded eagerly rather than on the throttled club-wide sweep: they
     are about to look at their own board, and a regular's Wednesday missing from it would read as
     the recurrence having quietly failed. */
  await ensureSchema(); await materialiseRecurrence(playerId).catch(()=>0); const sql=getSql();
  const rows=await sql<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt" FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() ORDER BY start_at`;
  return rows.map(slot);
}

async function ownActiveSlots(tx:any,playerId:string){
  const rows=await tx<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt" FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() ORDER BY start_at`;
  return rows.map(slot);
}

export async function publishAvailability(playerId:string,items:{startAt:string;endAt:string}[]){
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const existing=await tx<any[]>`SELECT id,start_at AS "startAt",end_at AS "endAt" FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now()`;
    const candidates=existing.filter(row=>items.some(item=>Date.parse(row.startAt)<=Date.parse(item.endAt)&&Date.parse(row.endAt)>=Date.parse(item.startAt)));
    const merged=mergeIntervals([...items,...candidates.map(row=>({startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString()}))]);
    if(candidates.length)await tx`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id IN ${tx(candidates.map(row=>row.id))}`;
    for(const item of merged){const id=crypto.randomUUID();await tx`INSERT INTO availability_slots (id,player_id,start_at,end_at) VALUES (${id},${playerId},${item.startAt},${item.endAt})`;}
    return ownActiveSlots(tx,playerId);
  });
}
export async function updateAvailability(id:string,playerId:string,item:{startAt:string;endAt:string}){
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const current=await tx<any[]>`SELECT id FROM availability_slots WHERE id=${id} AND player_id=${playerId} AND cancelled_at IS NULL AND end_at > now()`;
    if(!current[0])return null;
    const existing=await tx<any[]>`SELECT id,start_at AS "startAt",end_at AS "endAt" FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() AND id != ${id}`;
    const candidates=existing.filter(row=>Date.parse(row.startAt)<=Date.parse(item.endAt)&&Date.parse(row.endAt)>=Date.parse(item.startAt));
    const merged=mergeIntervals([item,...candidates.map(row=>({startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString()}))]);
    await tx`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id=${id} OR id IN ${tx(candidates.length?candidates.map(row=>row.id):[id])}`;
    for(const entry of merged){const newId=crypto.randomUUID();await tx`INSERT INTO availability_slots (id,player_id,start_at,end_at) VALUES (${newId},${playerId},${entry.startAt},${entry.endAt})`;}
    return ownActiveSlots(tx,playerId);
  });
}

export async function listAvailabilityCounts(days:{date:string;startAt:string;endAt:string}[]){
  await ensureSchema(); await materialiseRecurrenceThrottled(); const sql=getSql();
  if(!days.length)return {};
  const rangeStart=days[0].startAt,rangeEnd=days[days.length-1].endAt;
  const rows=await sql<any[]>`SELECT DISTINCT player_id AS "playerId",start_at AS "startAt",end_at AS "endAt" FROM availability_slots
    WHERE cancelled_at IS NULL AND end_at > now() AND start_at < ${rangeEnd} AND end_at > ${rangeStart}`;
  const counts:Record<string,number>={};
  for(const day of days){
    const players=new Set<string>();
    for(const row of rows) if(Date.parse(row.startAt)<Date.parse(day.endAt)&&Date.parse(row.endAt)>Date.parse(day.startAt)) players.add(row.playerId);
    counts[day.date]=players.size;
  }
  return counts;
}

export async function cancelAvailability(id:string,playerId:string){
  await ensureSchema();const sql=getSql();
  const rows=await sql<any[]>`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id=${id} AND player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() RETURNING id`;
  return Boolean(rows[0]);
}


/* --- Sessions --------------------------------------------------------------
 *
 * One slot is one session. These read and write the same table every other surface already uses, so
 * the grid, the offer matcher and open-call targeting keep working untouched — but they never merge
 * adjacent rows the way `publishAvailability` does, because a session has an identity a member can
 * see on a card and cancel by name. Silently folding 今晚 into 聽日 would make a card the member is
 * looking at disappear into another one. */

export type Session = AvailabilitySlot & { venue:string; note:string };

function session(row:any):Session {
  return {...slot(row),venue:row.venue??"",note:row.note??""};
}

/** This member's own sessions, newest window last. Finished ones are included: the card for a
    session that just ended is what asks for the score. */
export async function listSessions(playerId:string,sinceHours=12):Promise<Session[]>{
  await ensureSchema(); await materialiseRecurrence(playerId).catch(()=>0); const sql=getSql();
  const rows=await sql<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",
      created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt",venue,note
    FROM availability_slots
    WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() - ${`${sinceHours} hours`}::interval
    ORDER BY start_at`;
  return rows.map(session);
}

/** Create one. Overlap is refused rather than merged — two sessions covering the same evening are
    one evening entered twice, and they would produce two cards racing to fill the same table. */
export async function createSession(playerId:string,input:{startAt:string;endAt:string;venue?:string;note?:string}):Promise<Session|null>{
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const clash=await tx<any[]>`SELECT id FROM availability_slots
      WHERE player_id=${playerId} AND cancelled_at IS NULL
        AND start_at < ${input.endAt} AND end_at > ${input.startAt} LIMIT 1`;
    if(clash.length)return null;
    const [row]=await tx<any[]>`INSERT INTO availability_slots (id,player_id,start_at,end_at,venue,note)
      VALUES (${crypto.randomUUID()},${playerId},${input.startAt},${input.endAt},${input.venue??""},${input.note??""})
      RETURNING id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",
        created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt",venue,note`;
    return session(row);
  });
}
