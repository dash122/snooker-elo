import { getSql } from "./sql";
import { addDaysHongKong, hkDate } from "../lib/availability";
import { overlapView, isCommitment, type Commitment, type OverlapView, type SlotLike } from "../lib/overlap";

/* --- 場地 · the data side --------------------------------------------------
 *
 * There is no 場次 table. A session is a *query*: the un-cancelled slots at one venue on one date,
 * read as an overlap curve. That is the whole point of the merge — a day holds as many sessions as
 * the data says it does, and the schema stops deciding.
 *
 * The single object a member writes is `availability_slots`, which already carried start_at, end_at
 * and cancelled_at before any of this. It gains `venue_id` and `commitment`; nothing else about a
 * member's answer is stored, because nothing else is asked.
 *
 * Schema is migration-owned (supabase/migrations/20260830010000_venues_and_slot_commitment.sql).
 * Nothing here issues DDL. */

export type Venue = { id:string; name:string; district:string; tables:Record<string,number> };
export type VenuePlayer = { id:string; name:string; short:string|null; rating:number; colour:string|null; avatar:string|null };

export type MySlot = { id:string; startAt:string; endAt:string; commitment:Commitment };

export type VenueDay = {
  venue:Venue;
  date:string;
  overlap:OverlapView;
  /** Everyone with a `going` slot, with the window they published — a name without a time is not
      actionable, and the whole screen is about when people meet. */
  going:(VenuePlayer&{startAt:string;endAt:string})[];
  mine:MySlot|null;
};

/** A missing relation means the migration has not reached this database yet. The code ships ahead
    of the schema, so that window is ordinary rather than exceptional — see the null-handling in the
    board readers below, which render nothing rather than an error. */
const UNDEFINED_TABLE = "42P01";
export function isMissingSchema(error:unknown):boolean{
  return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===UNDEFINED_TABLE);
}

const hkDayStartMs=(date:string)=>Date.parse(`${date}T00:00:00+08:00`);

export async function listVenues():Promise<Venue[]|null>{
  try{
    const sql=getSql();
    return await sql<Venue[]>`
      SELECT id, name, district, tables FROM venues WHERE active ORDER BY name`;
  }catch(error){ if(isMissingSchema(error))return null; throw error }
}

async function slotsFor(venueId:string,date:string){
  const sql=getSql();
  /* Bounded by the strip's own span rather than the calendar day, so an evening running past
     midnight belongs to the night it started on rather than splitting across two screens. */
  const from=`${date}T10:00:00+08:00`;
  const to=`${addDaysHongKong(date,1)}T02:00:00+08:00`;
  return sql<{id:string;playerId:string;startAt:string;endAt:string;commitment:Commitment}[]>`
    SELECT id, player_id AS "playerId", start_at AS "startAt", end_at AS "endAt", commitment
      FROM availability_slots
     WHERE venue_id=${venueId} AND cancelled_at IS NULL
       AND start_at >= ${from}::timestamptz AND start_at < ${to}::timestamptz
     ORDER BY start_at`;
}

async function playersByIds(ids:string[]):Promise<Record<string,VenuePlayer>>{
  if(!ids.length)return {};
  const sql=getSql();
  const rows=await sql<VenuePlayer[]>`
    SELECT id, name, short, rating::float8 AS rating, colour, avatar
      FROM state_players WHERE id IN ${sql(ids)}`;
  return Object.fromEntries(rows.map(row=>[row.id,row]));
}

export async function venueDay(venueId:string,date:string,viewerId:string|null):Promise<VenueDay|null>{
  try{
    const sql=getSql();
    const [venue]=await sql<Venue[]>`SELECT id,name,district,tables FROM venues WHERE id=${venueId}`;
    if(!venue)return null;
    const rows=await slotsFor(venueId,date);
    const overlap=overlapView(rows as SlotLike[],hkDayStartMs(date));

    /* Only 我會去 is named. 有興趣 is a subscription, and attributing one would make the cheap
       answer socially expensive — which is the thing that stops people answering at all. */
    const goingRows=rows.filter(row=>row.commitment==="going");
    const players=await playersByIds([...new Set(goingRows.map(row=>row.playerId))]);
    const going=goingRows
      .map(row=>{ const player=players[row.playerId]; return player?{...player,startAt:row.startAt,endAt:row.endAt}:null })
      .filter((row):row is VenuePlayer&{startAt:string;endAt:string}=>Boolean(row));

    const mineRow=viewerId?rows.find(row=>row.playerId===viewerId):undefined;
    return {
      venue,date,overlap,going,
      mine:mineRow?{id:mineRow.id,startAt:mineRow.startAt,endAt:mineRow.endAt,commitment:mineRow.commitment}:null,
    };
  }catch(error){ if(isMissingSchema(error))return null; throw error }
}

export type VenueSummary = Venue & {
  peak:number; peakStart:string|null; peakEnd:string|null;
  goingTotal:number; interestedTotal:number;
};

/** The directory: every venue with tonight's overlap. Venues nobody has answered for are still
    listed and say so — hiding the quiet ones would make the list a lie and strand a new venue in a
    cold start it could never climb out of. */
export async function venueDirectory(date:string):Promise<VenueSummary[]|null>{
  try{
    const sql=getSql();
    const venues=await sql<Venue[]>`SELECT id,name,district,tables FROM venues WHERE active ORDER BY name`;
    const dayStart=hkDayStartMs(date);
    const from=`${date}T10:00:00+08:00`;
    const to=`${addDaysHongKong(date,1)}T02:00:00+08:00`;
    const rows=await sql<{venueId:string;playerId:string;startAt:string;endAt:string;commitment:Commitment}[]>`
      SELECT venue_id AS "venueId", player_id AS "playerId", start_at AS "startAt", end_at AS "endAt", commitment
        FROM availability_slots
       WHERE cancelled_at IS NULL AND start_at >= ${from}::timestamptz AND start_at < ${to}::timestamptz`;
    const byVenue:Record<string,SlotLike[]>={};
    for(const row of rows)(byVenue[row.venueId]??=[]).push(row);

    return venues.map(venue=>{
      const view=overlapView(byVenue[venue.id]??[],dayStart);
      return {...venue,peak:view.peak,peakStart:view.peakStart,peakEnd:view.peakEnd,
        goingTotal:view.goingTotal,interestedTotal:view.interestedTotal};
    }).sort((a,b)=>b.peak-a.peak||b.goingTotal-a.goingTotal||a.name.localeCompare(b.name));
  }catch(error){ if(isMissingSchema(error))return null; throw error }
}

/** Publish (or move) one member's window at one venue on one date.
 *
 *  One row per member per venue-day: answering again replaces the answer rather than stacking a
 *  second window beside it. A member who taps 我會去, then moves the end time, has changed their
 *  mind once — not attended twice. */
export async function setSlot(input:{
  playerId:string; venueId:string; startAt:string; endAt:string; commitment:unknown;
}):Promise<{id:string}>{
  if(!isCommitment(input.commitment))throw new Error("唔認得呢個選擇");
  /* Bound before the transaction: TypeScript's narrowing from the guard above does not follow the
     property access into the callback closure below. */
  const commitment:Commitment=input.commitment;
  const start=Date.parse(input.startAt),end=Date.parse(input.endAt);
  if(!Number.isFinite(start)||!Number.isFinite(end))throw new Error("時間格式唔啱");
  if(end<=start)throw new Error("結束時間要喺開始之後");
  if(end-start>12*3600_000)throw new Error("一次最多 12 個鐘");

  const sql=getSql();
  const date=hkDate(new Date(start));
  const from=`${date}T00:00:00+08:00`;
  const to=`${addDaysHongKong(date,1)}T10:00:00+08:00`;

  return sql.begin(async tx=>{
    await tx`
      UPDATE availability_slots SET cancelled_at=now(), updated_at=now()
       WHERE player_id=${input.playerId} AND venue_id=${input.venueId} AND cancelled_at IS NULL
         AND start_at >= ${from}::timestamptz AND start_at < ${to}::timestamptz`;
    const id=`slot-${input.playerId}-${Date.now().toString(36)}`;
    await tx`
      INSERT INTO availability_slots (id,player_id,venue_id,start_at,end_at,commitment,created_at,updated_at)
      VALUES (${id},${input.playerId},${input.venueId},${input.startAt}::timestamptz,${input.endAt}::timestamptz,
              ${commitment},now(),now())`;
    return {id};
  });
}

/** Withdraw. Soft-cancelled rather than deleted, so a member's own history stays intact and the
    overlap simply stops counting them. */
export async function clearSlot(playerId:string,venueId:string,date:string):Promise<void>{
  const sql=getSql();
  const from=`${date}T00:00:00+08:00`;
  const to=`${addDaysHongKong(date,1)}T10:00:00+08:00`;
  await sql`
    UPDATE availability_slots SET cancelled_at=now(), updated_at=now()
     WHERE player_id=${playerId} AND venue_id=${venueId} AND cancelled_at IS NULL
       AND start_at >= ${from}::timestamptz AND start_at < ${to}::timestamptz`;
}
