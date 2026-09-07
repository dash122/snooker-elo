import { getSql } from "./sql";
import { addDaysHongKong, hkDate } from "../lib/availability";

/* --- 開局板 · the data side -------------------------------------------------
 *
 * One object: a 局. A 局 with one participant is what used to be called the pool, so nothing here
 * distinguishes the two -- the board reads the same rows for both, and the only thing that changes
 * between 等多 1 人 and 成局 is `players.length`.
 *
 * This module deliberately sits beside `open-calls.pg.ts` rather than replacing it. That file still
 * serves the app-shell summary, the room view and the legacy claim flow; those callers read a
 * different shape and are not part of this redesign. Both read the same two tables.
 */

export type BoardPlayer = { id:string; name:string; short:string|null; rating:number; colour:string|null; avatar:string|null };
export type BoardVenue = { id:string; name:string; district:string };
export type Tempo = "sport"|"casual";

export type BoardCall = {
  id:string; startAt:string; endAt:string; message:string;
  venue:BoardVenue|null; venueIntent:string;
  tempo:Tempo; handicapPref:"even"|"handicap"; costSplit:"aa"|"host"; smoking:"nonsmoking"|"any";
  maxPlayers:number|null;
  /** Poster first, then join order. The product ranks nobody; this is only so the card stops
      reshuffling between loads. */
  players:BoardPlayer[];
  hostId:string;
  /** Set for the viewer's own row so the card can offer 我去不到 instead of 加入. */
  joined:boolean;
  /** The viewer has published time that overlaps this 局 by at least an hour. Drives both the
      「配合我的時間」 filter and the gold dot on the calendar. */
  fits:boolean;
};

export type BoardDay = { date:string; calls:number; fits:boolean };

export type Board = {
  days:BoardDay[];
  calls:BoardCall[];
  venues:BoardVenue[];
};

/** A member who said they were free that day but is in no 局 -- the "今日未有局" state's evidence
    that opening one is worth doing. Windows come back raw so the client can draw the overlap. */
export type FreeWindow = { player:BoardPlayer; startAt:string; endAt:string };

const OVERLAP_MINUTES = 60;

/* A 局 is over when its *end* passes, not its start: members join a game already under way, and a
   table booked until 21:30 is still a table at 20:00. Swept lazily on read for the same reason the
   rest of this codebase does -- there is no scheduler guaranteed to be running. The notification
   sweep in `tickOpenBoard` calls this too, so a cron makes it prompt rather than making it work. */
export async function completeEndedCalls(){
  const sql=getSql();
  await sql`UPDATE open_calls SET status='completed' WHERE status='open' AND end_at<=now()`;
}

const playerJson = `coalesce(
  (SELECT json_agg(json_build_object(
      'id',sp.id,'name',sp.name,'short',sp.short,'rating',sp.rating::float8,
      'colour',sp.colour,'avatar',sp.avatar)
    ORDER BY (sp.id=c.player_id) DESC, ocp.joined_at)
   FROM open_call_players ocp JOIN state_players sp ON sp.id=ocp.player_id
   WHERE ocp.call_id=c.id),
  '[]'::json) AS players`;

const callColumns = `c.id,c.start_at AS "startAt",c.end_at AS "endAt",c.message,c.player_id AS "hostId",
  c.venue_intent AS "venueIntent",c.tempo,c.handicap_pref AS "handicapPref",c.cost_split AS "costSplit",
  c.smoking,c.max_players AS "maxPlayers",
  v.id AS "venueId",v.name AS "venueName",v.district AS "venueDistrict",
  ${playerJson}
  FROM open_calls c LEFT JOIN venues v ON v.id=c.venue_id`;

function hydrate(row:Record<string,unknown>,viewerId:string|null,fit:(startAt:string,endAt:string)=>boolean):BoardCall {
  const players=(row.players as BoardPlayer[]).map(player=>({...player,rating:Number(player.rating)}));
  const startAt=new Date(row.startAt as string).toISOString();
  const endAt=new Date(row.endAt as string).toISOString();
  return {
    id:row.id as string, startAt, endAt, message:(row.message as string)??"",
    venue:row.venueId?{id:row.venueId as string,name:row.venueName as string,district:(row.venueDistrict as string)??""}:null,
    venueIntent:(row.venueIntent as string)??"",
    tempo:row.tempo as Tempo, handicapPref:row.handicapPref as "even"|"handicap",
    costSplit:row.costSplit as "aa"|"host", smoking:row.smoking as "nonsmoking"|"any",
    maxPlayers:row.maxPlayers===null||row.maxPlayers===undefined?null:Number(row.maxPlayers),
    players, hostId:row.hostId as string,
    joined:Boolean(viewerId&&players.some(player=>player.id===viewerId)),
    fits:fit(startAt,endAt),
  };
}

/** The viewer's own published windows, used only to decide `fits`. Availability is no longer a
    screen -- it survives purely as this ranking signal and the calendar's gold dot. */
async function viewerWindows(viewerId:string|null){
  if(!viewerId)return [] as {startAt:number;endAt:number}[];
  const sql=getSql();
  const rows=await sql<{start_at:Date;end_at:Date}[]>`
    SELECT start_at,end_at FROM availability_slots
    WHERE player_id=${viewerId} AND cancelled_at IS NULL AND end_at>now()`;
  return rows.map(row=>({startAt:row.start_at.getTime(),endAt:row.end_at.getTime()}));
}

function overlapTester(windows:{startAt:number;endAt:number}[]){
  const needed=OVERLAP_MINUTES*60*1000;
  return (startAt:string,endAt:string)=>{
    const start=Date.parse(startAt),end=Date.parse(endAt);
    return windows.some(window=>Math.min(end,window.endAt)-Math.max(start,window.startAt)>=needed);
  };
}

/** Load the bounded fortnight once. Counts and overlap markers come from the same
 * rows, avoiding separate count/fit queries and per-date network round trips. */
export async function readBoard(viewerId:string|null,date:string,days=14):Promise<Board>{
  const sql=getSql();
  const from=hkDate(),to=addDaysHongKong(from,days);
  const [windows,rows,venues]=await Promise.all([
    viewerWindows(viewerId),
    sql.unsafe(`SELECT ${callColumns}
      WHERE c.status='open' AND c.end_at>now()
        AND c.start_at >= ($1::date AT TIME ZONE 'Asia/Hong_Kong')
        AND c.start_at < ($2::date AT TIME ZONE 'Asia/Hong_Kong')
      ORDER BY c.start_at ASC`,[from,to]),
    sql<BoardVenue[]>`SELECT id,name,district FROM venues WHERE active ORDER BY name`,
  ]);
  const calls=rows.map(row=>hydrate(row,viewerId,overlapTester(windows)));
  const list=Array.from({length:days},(_,index)=>{
    const day=addDaysHongKong(from,index);
    const items=calls.filter(call=>hkDate(new Date(call.startAt))===day);
    return {date:day,calls:items.length,fits:items.some(call=>call.fits)};
  });
  return {days:list,calls:date==="all"?calls:calls.filter(call=>hkDate(new Date(call.startAt))===date),venues};
}

/** Members who published time on a day that holds no 局 -- the only reason the empty state is worth
    showing. Excludes anyone already in a 局 that day, because they are not who you are looking for. */
export async function freeWindowsOn(date:string):Promise<FreeWindow[]>{
  const sql=getSql();
  const from=date==="all"?hkDate():date,to=addDaysHongKong(from,date==="all"?14:1);
  const rows=await sql<{startAt:Date;endAt:Date;id:string;name:string;short:string|null;rating:number;colour:string|null;avatar:string|null}[]>`
    SELECT s.start_at AS "startAt", s.end_at AS "endAt",
           p.id,p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE s.cancelled_at IS NULL AND s.end_at>now()
      AND s.start_at >= (${from}::date AT TIME ZONE 'Asia/Hong_Kong')
      AND s.start_at < (${to}::date AT TIME ZONE 'Asia/Hong_Kong')
      AND NOT EXISTS (
        SELECT 1 FROM open_call_players ocp JOIN open_calls c ON c.id=ocp.call_id
        WHERE ocp.player_id=s.player_id AND c.status='open'
          AND c.end_at>now()
          AND c.start_at >= (date_trunc('day',s.start_at AT TIME ZONE 'Asia/Hong_Kong') AT TIME ZONE 'Asia/Hong_Kong')
          AND c.start_at < ((date_trunc('day',s.start_at AT TIME ZONE 'Asia/Hong_Kong') + interval '1 day') AT TIME ZONE 'Asia/Hong_Kong'))
    ORDER BY s.start_at ASC`;
  return rows.map(row=>({
    player:{id:row.id,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar},
    startAt:new Date(row.startAt).toISOString(), endAt:new Date(row.endAt).toISOString(),
  }));
}

export type CreateCallInput = {
  startAt:string; endAt:string; message:string;
  venueId:string|null; venueIntent:string;
  tempo:Tempo; handicapPref:"even"|"handicap"; costSplit:"aa"|"host"; smoking:"nonsmoking"|"any";
  maxPlayers:number|null;
};

/** Post a 局. The poster is its first participant in the same transaction -- a 局 with nobody in it
    is not a state this product has, and writing it in two steps would let a failure create one. */
export async function createCall(playerId:string,input:CreateCallInput){
  const sql=getSql();
  const id=crypto.randomUUID();
  await sql.begin(async tx=>{
    await tx`INSERT INTO open_calls
      (id,player_id,start_at,end_at,message,venue,venue_id,venue_intent,tempo,handicap_pref,cost_split,smoking,max_players)
      VALUES (${id},${playerId},${input.startAt},${input.endAt},${input.message},'',
        ${input.venueId},${input.venueIntent},${input.tempo},${input.handicapPref},
        ${input.costSplit},${input.smoking},${input.maxPlayers})`;
    await tx`INSERT INTO open_call_players (call_id,player_id) VALUES (${id},${playerId})`;
  });
  return id;
}

export type JoinResult = {ok:true;filled:boolean;players:number}|{ok:false;reason:"gone"|"full"|"already"};

/** Join, first come first served, no approval step.
 *
 *  The insert is guarded by a row lock taken in the same transaction so two members tapping 加入 at
 *  the same moment cannot both take the last capped seat. `filled` reports the 1->2 transition only,
 *  so the caller knows to send 成局 once rather than on every subsequent join. */
export async function joinCall(id:string,playerId:string):Promise<JoinResult>{
  const sql=getSql();
  return sql.begin(async tx=>{
    const [call]=await tx<{max_players:number|null}[]>`
      SELECT max_players FROM open_calls
      WHERE id=${id} AND status='open' AND end_at>now() FOR UPDATE`;
    if(!call)return {ok:false,reason:"gone"} as const;
    const [{count}]=await tx<{count:string}[]>`
      SELECT count(*)::text AS count FROM open_call_players WHERE call_id=${id}`;
    const before=Number(count);
    const [mine]=await tx<{player_id:string}[]>`
      SELECT player_id FROM open_call_players WHERE call_id=${id} AND player_id=${playerId}`;
    if(mine)return {ok:false,reason:"already"} as const;
    if(call.max_players!==null&&before>=call.max_players)return {ok:false,reason:"full"} as const;
    await tx`INSERT INTO open_call_players (call_id,player_id) VALUES (${id},${playerId})`;
    return {ok:true,filled:before===1,players:before+1} as const;
  });
}

/** 我去不到 -- leave without a trace.
 *
 *  The row is DELETEd rather than tombstoned. A card that renders "已退出 陳嘉朗" is a small public
 *  shaming, and the cost of it is that the next member quietly no-shows instead of pressing the
 *  button. Leaving must be cheaper than ghosting or the button does not work.
 *
 *  A 局 the last participant leaves is cancelled: an empty 局 would sit on the board advertising a
 *  game nobody is going to. `dropped` says the 局 fell back to 等多 1 人 so the caller can put it
 *  back in front of the members whose time overlaps it. */
export async function leaveCall(id:string,playerId:string){
  const sql=getSql();
  return sql.begin(async tx=>{
    const gone=await tx<{player_id:string}[]>`
      DELETE FROM open_call_players WHERE call_id=${id} AND player_id=${playerId} RETURNING player_id`;
    if(!gone.length)return {ok:false as const};
    const [{count}]=await tx<{count:string}[]>`
      SELECT count(*)::text AS count FROM open_call_players WHERE call_id=${id}`;
    const left=Number(count);
    if(left===0)await tx`UPDATE open_calls SET status='cancelled' WHERE id=${id}`;
    return {ok:true as const,remaining:left,dropped:left===1};
  });
}

/** One 局 with its participants, for the notification sweep and the API's post-write response. */
export async function readCall(id:string,viewerId:string|null=null){
  const sql=getSql();
  const rows=await sql.unsafe(`SELECT ${callColumns} WHERE c.id=$1`,[id]);
  return rows[0]?hydrate(rows[0],viewerId,()=>false):null;
}

/** Add a venue to the public directory.
 *
 *  Member-created rather than admin-only, because the board is meant to work across Hong Kong and a
 *  club that can only name its own room is a club-only board. Deduplicated case-insensitively on
 *  name so the directory does not silently accumulate 「南華會」/「南華會 」 as two venues -- an
 *  existing match is returned instead of a second row, which is also what a member who typed a name
 *  that already exists actually wants.
 *
 *  `tables` is left empty: the count matters to the venue board's overlap maths, not to a 局, and
 *  guessing it here would put an invented number in front of everyone. */
export async function findOrCreateVenue(name:string,district:string):Promise<BoardVenue>{
  const sql=getSql();
  const trimmed=name.trim().slice(0,60),area=district.trim().slice(0,30);
  if(!trimmed)throw new Error("請輸入場地名稱。");
  const [existing]=await sql<BoardVenue[]>`
    SELECT id,name,district FROM venues WHERE lower(btrim(name))=lower(${trimmed}) LIMIT 1`;
  if(existing)return existing;
  const id=crypto.randomUUID();
  const [created]=await sql<BoardVenue[]>`
    INSERT INTO venues (id,name,district,tables,active)
    VALUES (${id},${trimmed},${area},'{}'::jsonb,true)
    RETURNING id,name,district`;
  return created;
}
