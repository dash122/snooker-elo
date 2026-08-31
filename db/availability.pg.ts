import { getSql } from "./sql";
import { mergeAvailabilitySlots, type AvailabilitySlot } from "../lib/availability";
import { materialiseRecurrence, materialiseRecurrenceThrottled, materialiseRecurrenceThrottledForPlayer } from "./recurrence.pg";

export type AvailabilityMember = { id:string; name:string; short:string; rating:number; colour?:string|null; avatar?:string|null; slots:AvailabilitySlot[] };

/* Schema changes are migration-owned. Keeping this as a no-op is intentional: even idempotent
 * CREATE/ALTER statements acquire heavyweight relation locks, and running them on every serverless
 * cold start can block the state and matchmaking reads that share this pool. */
export async function ensureAvailabilitySchema(){ return Promise.resolve(); }
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

export async function publishAvailability(playerId:string,items:{startAt:string;endAt:string;conditions?:SlotConditions}[]){
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const existing=await tx<any[]>`SELECT id,start_at AS "startAt",end_at AS "endAt",conditions FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now()`;
    const candidates=existing.filter(row=>items.some(item=>Date.parse(row.startAt)<=Date.parse(item.endAt)&&Date.parse(row.endAt)>=Date.parse(item.startAt)));
    const merged=mergeAvailabilitySlots([...items,...candidates.map(row=>({startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),conditions:readConditions(row.conditions)}))]);
    if(candidates.length)await tx`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id IN ${tx(candidates.map(row=>row.id))}`;
    for(const item of merged){const id=crypto.randomUUID();await tx`INSERT INTO availability_slots (id,player_id,start_at,end_at,conditions) VALUES (${id},${playerId},${item.startAt},${item.endAt},${JSON.stringify(readConditions(item.conditions))})`;}
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
    for(const entry of merged){const newId=crypto.randomUUID();await tx`INSERT INTO availability_slots (id,player_id,start_at,end_at,conditions) VALUES (${newId},${playerId},${entry.startAt},${entry.endAt},${JSON.stringify(readConditions(entry.conditions))})`;}
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

/* --- Posted slots · 開局卡 ---------------------------------------------------
 *
 * The same rows as above, `posted=true`. What a session adds to plain availability, a posted slot
 * adds to a session: a fill rule the poster chose before anyone read a name, and the conditions that
 * make raising a hand safe to do without asking first.
 *
 * A slot is never filled by the poster choosing among visible names — see `db/slot-hands.pg.ts`. It
 * is filled either the instant a hand lands (`fill_rule='first'`) or by the poster picking from a
 * list nobody else ever sees (`fill_rule='review'`). Either way the losing hands are never told they
 * lost; they simply stop seeing the slot as theirs to raise on. */

export type SlotConditions = { handicap?:boolean; noSmoking?:boolean; frames?:number|null; levelOnly?:boolean; tableBooked?:boolean };
export type FillRule = "first"|"review";
export type PostedSlot = Session & {
  fillRule:FillRule; conditions:SlotConditions;
  filledBy:string|null; filledAt:string|null; result:"pending"|"played"|"missed";
  /** 夠喇 · 唔再收 — the only thing besides cancelling or the clock that stops a slot taking hands.
      Being filled does not: see `boardSlots`. */
  closedAt:string|null;
};

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

function postedSlot(row:any):PostedSlot {
  return {...session(row),fillRule:row.fillRule==="review"?"review":"first",conditions:readConditions(row.conditions),
    filledBy:row.filledBy??null,filledAt:row.filledAt?new Date(row.filledAt).toISOString():null,
    closedAt:row.closedAt?new Date(row.closedAt).toISOString():null,
    result:row.result==="played"||row.result==="missed"?row.result:"pending"};
}

const POSTED_COLUMNS=`id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",
  created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt",venue,note,
  fill_rule AS "fillRule",conditions,filled_by AS "filledBy",filled_at AS "filledAt",result,
  closed_at AS "closedAt"`;

/** Post one: a session with a fill rule and conditions attached from the moment it exists, not
    bolted on after. Overlap is refused for the same reason `createSession` refuses it — two open
    posts covering the same evening would race for the same table. */
export async function createPostedSlot(playerId:string,input:{startAt:string;endAt:string;venue?:string;note?:string;fillRule:FillRule;conditions:SlotConditions}):Promise<PostedSlot|null>{
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const clash=await tx<any[]>`SELECT id FROM availability_slots
      WHERE player_id=${playerId} AND cancelled_at IS NULL
        AND start_at < ${input.endAt} AND end_at > ${input.startAt} LIMIT 1`;
    if(clash.length)return null;
    const [row]=await tx<any[]>`INSERT INTO availability_slots (id,player_id,start_at,end_at,venue,note,posted,fill_rule,conditions)
      VALUES (${crypto.randomUUID()},${playerId},${input.startAt},${input.endAt},${input.venue??""},${input.note??""},true,${input.fillRule},${JSON.stringify(input.conditions)})
      RETURNING ${tx.unsafe(POSTED_COLUMNS)}`;
    return postedSlot(row);
  });
}

/** Edit one — only while it is still open and nobody has been accepted yet. Once somebody is
    accepted the time and place are a promise made to them, not a draft; the poster's only lever
    from that point on is 取消 (cancel), same as before this existed. Overlap is refused the same
    way `createPostedSlot` refuses it, checked against the poster's other active windows excluding
    this one. */
export async function editPostedSlot(playerId:string,id:string,input:{startAt:string;endAt:string;venue?:string;note?:string;fillRule:FillRule;conditions:SlotConditions}):Promise<PostedSlot|null>{
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const [current]=await tx<any[]>`SELECT id FROM availability_slots
      WHERE id=${id} AND player_id=${playerId} AND posted=true AND cancelled_at IS NULL AND filled_by IS NULL AND end_at > now()`;
    if(!current)return null;
    const clash=await tx<any[]>`SELECT id FROM availability_slots
      WHERE player_id=${playerId} AND cancelled_at IS NULL AND id != ${id}
        AND start_at < ${input.endAt} AND end_at > ${input.startAt} LIMIT 1`;
    if(clash.length)return null;
    const [row]=await tx<any[]>`UPDATE availability_slots SET
        start_at=${input.startAt},end_at=${input.endAt},venue=${input.venue??""},note=${input.note??""},
        fill_rule=${input.fillRule},conditions=${JSON.stringify(input.conditions)},updated_at=now()
      WHERE id=${id} RETURNING ${tx.unsafe(POSTED_COLUMNS)}`;
    return row?postedSlot(row):null;
  });
}

/** This member's own posted slots — open, filled, or finished — newest window last. Includes hand
    counts privately: nobody but the poster ever learns how many raised, or who, per `handsForSlot`
    in `db/slot-hands.pg.ts`; this function only returns the slot itself. */
export async function myPostedSlots(playerId:string,sinceHours=12):Promise<PostedSlot[]>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT ${sql.unsafe(POSTED_COLUMNS)} FROM availability_slots
    WHERE player_id=${playerId} AND posted=true AND cancelled_at IS NULL AND end_at > now() - ${`${sinceHours} hours`}::interval
    ORDER BY start_at`;
  return rows.map(postedSlot);
}

/** The board: every post still taking hands, soonest first.
 *
 *  Two changes from the first version of this query, and they are the same change twice. It used to
 *  exclude filled slots, so taking one person emptied the table; and it deliberately carried no hand
 *  count, on the reasoning that what others had done should not sway anyone.
 *
 *  Both proved too strong. A slot that took somebody is often *more* worth joining, not less — three
 *  round one table is a normal club night. And a card showing 「3 人舉咗手」 and a card showing
 *  nothing are not the same object to somebody deciding whether to bother: withholding the number
 *  does not make the board neutral, it makes it look dead, which is the exact problem the club has.
 *  So counts travel with every row (attached by the caller via `handSummaries`); *names* of people
 *  still waiting never do.
 *
 *  `excludePlayerId` is empty for a signed-out reader, who gets the whole board — see the API. */
export type BoardSlot = PostedSlot & {player:{id:string;name:string;short:string;rating:number;colour:string|null;avatar:string|null}};

export async function boardSlots(excludePlayerId:string,limit=40):Promise<BoardSlot[]>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT s.id,s.player_id AS "playerId",s.start_at AS "startAt",s.end_at AS "endAt",
      s.created_at AS "createdAt",s.updated_at AS "updatedAt",s.cancelled_at AS "cancelledAt",s.venue,s.note,
      s.fill_rule AS "fillRule",s.conditions,s.filled_by AS "filledBy",s.filled_at AS "filledAt",s.result,
      s.closed_at AS "closedAt",
      p.id AS "posterId",p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE s.posted=true AND s.cancelled_at IS NULL AND s.closed_at IS NULL AND s.end_at > now() AND p.active=true
      AND s.player_id != ${excludePlayerId}
    ORDER BY s.start_at LIMIT ${limit}`;
  return rows.map(row=>({...postedSlot(row),
    player:{id:row.posterId,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar}}));
}

/** Count of distinct members with a live availability window.
 *
 * `posted` was part of the retired 開局卡 model. Availability rows are now the source of truth for
 * matchmaking, so this count intentionally uses only columns that still exist in the unified schema.
 */
export async function boardOpenCount():Promise<number>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<{count:string}[]>`SELECT count(DISTINCT player_id)::text AS count FROM availability_slots
    WHERE cancelled_at IS NULL AND end_at > now()`;
  return Number(row?.count??0);
}

/** How many live availability windows the club has right now.
 *
 * The old implementation counted `posted` 開局卡 rows. That lifecycle was removed when availability
 * and sessions were unified (see `20260830010000_venues_and_slot_commitment.sql`), so querying that
 * column now takes down the shell's summary request on every page load. The summary only needs a
 * liveliness signal; an active availability window is the canonical signal in the current schema.
 */
export async function openSlotsCount():Promise<number>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<{count:string}[]>`SELECT count(*)::text AS count FROM availability_slots
    WHERE cancelled_at IS NULL AND end_at > now()`;
  return Number(row?.count??0);
}

/** The public preview behind a shared link — readable without signing in, like an open call always
    was. Only ever a post that is still open: once filled or cancelled, the link should read as gone
    rather than show a stranger who is now playing. */
export async function sharedSlot(id:string):Promise<(PostedSlot&{player:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null}})|null>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<any[]>`SELECT ${sql.unsafe(POSTED_COLUMNS)} FROM availability_slots
    WHERE id=${id} AND posted=true AND cancelled_at IS NULL AND closed_at IS NULL AND end_at > now()`;
  if(!row)return null;
  const [player]=await sql<any[]>`SELECT id,name,short,rating::float8 AS rating,colour,avatar FROM state_players WHERE id=${row.playerId} AND active=true`;
  if(!player)return null;
  return {...postedSlot(row),player:{id:player.id,name:player.name,short:player.short,rating:Number(player.rating),colour:player.colour,avatar:player.avatar}};
}

/** One row, for the two people who need to see conditions and each other's contact path once a slot
    is filled. Used for the hand-off card and for validating who may record a result. */
export async function postedSlotById(id:string):Promise<PostedSlot|null>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<any[]>`SELECT ${sql.unsafe(POSTED_COLUMNS)} FROM availability_slots WHERE id=${id} AND posted=true`;
  return row?postedSlot(row):null;
}

/** Fill a slot with a specific player, inside the caller's transaction — used by both the instant
    first-hand-wins path and the poster's manual pick, so the two never disagree about what "filled"
    means. Refuses anything already filled: the caller is responsible for deciding what that means
    for the hand that just lost the race. */
export async function fillPostedSlotTx(tx:any,id:string,byPlayerId:string):Promise<PostedSlot|null>{
  const rows=await tx<any[]>`UPDATE availability_slots SET filled_by=${byPlayerId},filled_at=now(),updated_at=now()
    WHERE id=${id} AND posted=true AND cancelled_at IS NULL AND filled_by IS NULL AND end_at > now()
    RETURNING ${tx.unsafe(POSTED_COLUMNS)}`;
  return rows[0]?postedSlot(rows[0]):null;
}

/** Full player profiles for a batch of ids, keyed for a `Map` lookup — the join a route composes for
    itself once it needs more than a name, same shape `/api/sessions` already builds from `state`. */
export async function playerProfiles(ids:string[]):Promise<Map<string,{id:string;name:string;short:string;rating:number;colour:string|null;avatar:string|null}>>{
  if(!ids.length)return new Map();
  const sql=getSql();
  const rows=await sql<any[]>`SELECT id,name,short,rating::float8 AS rating,colour,avatar FROM state_players WHERE id IN ${sql(ids)}`;
  return new Map(rows.map(row=>[row.id,{id:row.id,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar}]));
}

export async function recordSlotResult(playerId:string,id:string,result:"played"|"missed"):Promise<PostedSlot|null>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`UPDATE availability_slots SET result=${result},updated_at=now()
    WHERE id=${id} AND posted=true AND filled_by IS NOT NULL AND (player_id=${playerId} OR filled_by=${playerId})
    RETURNING ${sql.unsafe(POSTED_COLUMNS)}`;
  return rows[0]?postedSlot(rows[0]):null;
}
