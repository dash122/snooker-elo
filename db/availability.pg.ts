import { getSql } from "./sql";
import { mergeAvailabilitySlots, type AvailabilitySlot, type SlotConditions } from "../lib/availability";
import { materialiseRecurrence, materialiseRecurrenceThrottled, materialiseRecurrenceThrottledForPlayer } from "./recurrence.pg";

export type AvailabilityMember = { id:string; name:string; short:string; rating:number; colour?:string|null; avatar?:string|null; slots:AvailabilitySlot[] };

/* Schema changes are migration-owned. Keeping this as a no-op is intentional: even idempotent
 * CREATE/ALTER statements acquire heavyweight relation locks, and running them on every serverless
 * cold start can block the state and matchmaking reads that share this pool. */
export async function ensureAvailabilitySchema(){ return Promise.resolve(); }

/** Preferences ride on a slot as jsonb, so anything unrecognised is dropped rather than trusted back
    out of the database. Re-exported because the API routes type their payloads with it. */
export type { SlotConditions };

function readConditions(value:unknown):SlotConditions {
  if(!value||typeof value!=="object")return {};
  const raw=value as Record<string,unknown>;
  const out:SlotConditions={};
  if(typeof raw.handicap==="boolean")out.handicap=raw.handicap;
  if(typeof raw.noSmoking==="boolean")out.noSmoking=raw.noSmoking;
  if(typeof raw.frames==="number"&&Number.isFinite(raw.frames))out.frames=raw.frames;
  if(typeof raw.levelOnly==="boolean")out.levelOnly=raw.levelOnly;
  if(typeof raw.tableBooked==="boolean")out.tableBooked=raw.tableBooked;
  return out;
}
async function ensureSchema(){ return Promise.resolve(); }

function slot(row:any):AvailabilitySlot { return {id:row.id,playerId:row.playerId,startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),createdAt:new Date(row.createdAt).toISOString(),updatedAt:new Date(row.updatedAt).toISOString(),cancelledAt:row.cancelledAt?new Date(row.cancelledAt).toISOString():null,conditions:readConditions(row.conditions)}; }

export async function listAvailability(startAt:string,endAt:string){
  await ensureSchema(); await materialiseRecurrenceThrottled(); const sql=getSql();
  const rows=await sql<any[]>`SELECT p.id AS "playerId",p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar,s.id,s.start_at AS "startAt",s.end_at AS "endAt",s.created_at AS "createdAt",s.updated_at AS "updatedAt",s.cancelled_at AS "cancelledAt",s.conditions
    FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE s.cancelled_at IS NULL AND s.end_at > now() AND s.start_at < ${endAt} AND s.end_at > ${startAt} AND p.active=true
    ORDER BY p.name,s.start_at`;
  const grouped=new Map<string,AvailabilityMember>();
  for(const row of rows){const current:AvailabilityMember=grouped.get(row.playerId)??{id:row.playerId,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar,slots:[]};current.slots.push(slot({...row,playerId:row.playerId}));grouped.set(row.playerId,current);}
  return [...grouped.values()];
}

/** Count members with a live availability window without loading player profiles or slot rows.
 *  The app shell only needs the number for its tonight strip; the full rows belong to the tab. */
export async function availabilityPlayerCount(startAt:string,endAt:string):Promise<number>{
  await ensureSchema(); await materialiseRecurrenceThrottled(); const sql=getSql();
  const [row]=await sql<{count:string}[]>`SELECT count(DISTINCT s.player_id)::text AS count
    FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE s.cancelled_at IS NULL AND s.end_at > now() AND s.start_at < ${endAt} AND s.end_at > ${startAt} AND p.active=true`;
  return Number(row?.count??0);
}

export async function listOwnAvailability(playerId:string){
  /* This member's own rules are expanded eagerly rather than on the throttled club-wide sweep: they
     are about to look at their own board, and a regular's Wednesday missing from it would read as
     the recurrence having quietly failed. */
  await ensureSchema(); await materialiseRecurrenceThrottledForPlayer(playerId); const sql=getSql();
  const rows=await sql<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt",conditions FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() ORDER BY start_at`;
  return rows.map(slot);
}

async function ownActiveSlots(tx:any,playerId:string){
  const rows=await tx<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt",conditions FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() ORDER BY start_at`;
  return rows.map(slot);
}

/** The venue a write lands at when the caller does not name one — 「我而家得閒」, the weekly rules,
    and the intent routes, none of which asks which club. Read from the table rather than hard-coded
    to SCAA, so adding a second club cannot silently pour its rows into the first one. */
async function defaultVenueId(tx:any):Promise<string>{
  const [row]=await tx`SELECT id FROM venues WHERE active ORDER BY created_at LIMIT 1`;
  if(!row)throw new Error("未設定任何球會");
  return row.id;
}

export async function publishAvailability(playerId:string,items:{startAt:string;endAt:string;conditions?:SlotConditions}[]){
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const existing=await tx<any[]>`SELECT id,start_at AS "startAt",end_at AS "endAt",conditions FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now()`;
    const candidates=existing.filter(row=>items.some(item=>Date.parse(row.startAt)<=Date.parse(item.endAt)&&Date.parse(row.endAt)>=Date.parse(item.startAt)));
    const merged=mergeAvailabilitySlots([...items,...candidates.map(row=>({startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),conditions:readConditions(row.conditions)}))]);
    if(candidates.length)await tx`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id IN ${tx(candidates.map(row=>row.id))}`;
    const venueId=await defaultVenueId(tx);
    for(const item of merged){const id=crypto.randomUUID();await tx`INSERT INTO availability_slots (id,player_id,venue_id,start_at,end_at,conditions) VALUES (${id},${playerId},${venueId},${item.startAt},${item.endAt},${JSON.stringify(readConditions(item.conditions))})`;}
    return ownActiveSlots(tx,playerId);
  });
}
export async function updateAvailability(id:string,playerId:string,item:{startAt:string;endAt:string;conditions?:SlotConditions}){
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const current=await tx<any[]>`SELECT id FROM availability_slots WHERE id=${id} AND player_id=${playerId} AND cancelled_at IS NULL AND end_at > now()`;
    if(!current[0])return null;
    const existing=await tx<any[]>`SELECT id,start_at AS "startAt",end_at AS "endAt",conditions FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() AND id != ${id}`;
    const candidates=existing.filter(row=>Date.parse(row.startAt)<=Date.parse(item.endAt)&&Date.parse(row.endAt)>=Date.parse(item.startAt));
    const merged=mergeAvailabilitySlots([item,...candidates.map(row=>({startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),conditions:readConditions(row.conditions)}))]);
    await tx`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id=${id} OR id IN ${tx(candidates.length?candidates.map(row=>row.id):[id])}`;
    const venueId=await defaultVenueId(tx);
    for(const entry of merged){const newId=crypto.randomUUID();await tx`INSERT INTO availability_slots (id,player_id,venue_id,start_at,end_at,conditions) VALUES (${newId},${playerId},${venueId},${entry.startAt},${entry.endAt},${JSON.stringify(readConditions(entry.conditions))})`;}
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
  return {...slot(row),venue:row.venueName??"",note:row.note??""};
}

/** This member's own sessions, newest window last. Finished ones are included: the card for a
    session that just ended is what asks for the score. */
export async function listSessions(playerId:string,sinceHours=12):Promise<Session[]>{
  await ensureSchema(); await materialiseRecurrence(playerId).catch(()=>0); const sql=getSql();
  /* `venue` was free text and is gone; the name now comes from the venue the slot points at. */
  const rows=await sql<any[]>`SELECT s.id,s.player_id AS "playerId",s.start_at AS "startAt",s.end_at AS "endAt",
      s.created_at AS "createdAt",s.updated_at AS "updatedAt",s.cancelled_at AS "cancelledAt",
      s.conditions,v.name AS "venueName",s.note
    FROM availability_slots s LEFT JOIN venues v ON v.id=s.venue_id
    WHERE s.player_id=${playerId} AND s.cancelled_at IS NULL AND s.end_at > now() - ${`${sinceHours} hours`}::interval
    ORDER BY s.start_at`;
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
    const venueId=await defaultVenueId(tx);
    const [row]=await tx<any[]>`INSERT INTO availability_slots (id,player_id,venue_id,start_at,end_at,note)
      VALUES (${crypto.randomUUID()},${playerId},${venueId},${input.startAt},${input.endAt},${input.note??""})
      RETURNING id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",
        created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt",conditions,note`;
    const [venue]=await tx<any[]>`SELECT name FROM venues WHERE id=${venueId}`;
    return session({...row,venueName:venue?.name??""});
  });
}

/* The 開局卡 layer that used to live here — posted slots, the board, sharing and results — read
   `posted`, `fill_rule`, `filled_by`, `filled_at`, `result` and `closed_at`, every one of which the
   場次 migration dropped. Nothing called it any more, so it goes rather than being ported. */

/** Distinct members with live availability, club-wide. No caller today, but it is the counterpart
    to `openSlotsCount` and is guarded by tests/availability-schema-alignment. */
export async function boardOpenCount():Promise<number>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<{count:string}[]>`SELECT count(DISTINCT player_id)::text AS count FROM availability_slots
    WHERE cancelled_at IS NULL AND end_at > now()`;
  return Number(row?.count??0);
}

export async function openSlotsCount():Promise<number>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<{count:string}[]>`SELECT count(*)::text AS count FROM availability_slots
    WHERE cancelled_at IS NULL AND end_at > now()`;
  return Number(row?.count??0);
}
