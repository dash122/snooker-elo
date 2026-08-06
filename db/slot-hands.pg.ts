import { getSql } from "./sql";
import { ensureAvailabilitySchema, fillPostedSlotTx, type PostedSlot } from "./availability.pg";

/* --- Raising a hand ---------------------------------------------------------
 *
 * A hand is not an invite. It is non-exclusive — a member can hold several at once, on several
 * slots, the same evening — and it is retractable right up until the moment it wins. Neither of
 * those is a nicety: without them, raising a hand is exactly as heavy as the invite it replaced,
 * because the member is still handing a decision to somebody else and taking on responsibility for
 * an evening they cannot yet see.
 *
 * Who is filled is never read off a public list. `fill_rule='first'` fills inside the same
 * transaction as the raise, so there is no moment where a name sits waiting to be chosen from.
 * `fill_rule='review'` lets hands accumulate, but only the poster's own query ever joins them to a
 * name — see `handsForSlot`. Everyone else's view of the slot is just "open" or "gone". */

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  schemaReady??=(async()=>{
    await ensureAvailabilitySchema();
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS slot_hands (
      id text PRIMARY KEY,
      slot_id text NOT NULL REFERENCES availability_slots(id) ON DELETE CASCADE,
      player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      raised_at timestamptz NOT NULL DEFAULT now(),
      retracted_at timestamptz
    )`;
    /* One active hand per player per slot — raising twice is a no-op, not a stronger claim. */
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS slot_hands_active_idx ON slot_hands (slot_id,player_id) WHERE retracted_at IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS slot_hands_player_idx ON slot_hands (player_id) WHERE retracted_at IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS slot_hands_slot_idx ON slot_hands (slot_id) WHERE retracted_at IS NULL`;
    /* 「佢開局通知我」 — a one-way subscription, never a mutual match. The watcher is told nothing
       about who else is watching; the watched member sees only a count, per `waitingForMeCount`. */
    await sql`CREATE TABLE IF NOT EXISTS slot_watchers (
      id text PRIMARY KEY,
      watcher_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      target_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (watcher_id != target_id)
    )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS slot_watchers_pair_idx ON slot_watchers (watcher_id,target_id)`;
    await sql`CREATE INDEX IF NOT EXISTS slot_watchers_target_idx ON slot_watchers (target_id)`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

export type RaiseOutcome = {
  raised:boolean; filled:boolean; slot:PostedSlot|null;
  /** True when the slot was already gone by the time this hand tried to land — a race, not a
      rejection, and the caller should say so in exactly those words. */
  tooLate:boolean;
};

/** Overlap in Postgres terms: two half-open intervals intersect when each starts before the other
    ends. Mirrors `intersectIntervals` in `lib/availability.ts`, just run where the rows already
    are rather than pulled into JS first. */
async function retractOverlappingHandsTx(tx:any,playerId:string,startAt:string,endAt:string,exceptSlotId:string){
  await tx`UPDATE slot_hands SET retracted_at=now()
    WHERE player_id=${playerId} AND retracted_at IS NULL AND slot_id != ${exceptSlotId}
      AND slot_id IN (SELECT id FROM availability_slots WHERE start_at < ${endAt} AND end_at > ${startAt})`;
}

/** Raise a hand on a posted slot.
 *
 *  `fill_rule='first'`: this call either fills the slot right now or is already too late — there is
 *  no state in between, so the member never has to wonder whether their hand is "in". A fill also
 *  retracts this player's other hands on any slot whose time overlaps the one that just filled: the
 *  options they were holding for a conflicting evening are no longer options.
 *
 *  `fill_rule='review'`: the hand is simply recorded. Nothing is announced to anyone; the poster
 *  finds out by looking at their own slot, same as checking whether a kettle has boiled. */
export async function raiseHand(playerId:string,slotId:string):Promise<RaiseOutcome>{
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const [slotRow]=await tx<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",fill_rule AS "fillRule",filled_by AS "filledBy"
      FROM availability_slots WHERE id=${slotId} AND posted=true AND cancelled_at IS NULL AND end_at > now() FOR UPDATE`;
    if(!slotRow||slotRow.playerId===playerId||slotRow.filledBy)
      return {raised:false,filled:false,slot:null,tooLate:true};
    const existing=await tx<{id:string}[]>`SELECT id FROM slot_hands WHERE slot_id=${slotId} AND player_id=${playerId} AND retracted_at IS NULL`;
    if(!existing.length)
      await tx`INSERT INTO slot_hands (id,slot_id,player_id) VALUES (${crypto.randomUUID()},${slotId},${playerId})`;
    if(slotRow.fillRule!=="first")return {raised:true,filled:false,slot:null,tooLate:false};
    const filled=await fillPostedSlotTx(tx,slotId,playerId);
    if(!filled)return {raised:true,filled:false,slot:null,tooLate:true};
    await retractOverlappingHandsTx(tx,playerId,filled.startAt,filled.endAt,slotId);
    return {raised:true,filled:true,slot:filled,tooLate:false};
  });
}

/** Pull a hand back. Always allowed on an open slot — a hand is an option, and the whole point of
    letting a member hold several at once is that dropping one is free. Once a slot is filled there
    is nothing left to retract from; a filled slot simply stops appearing in `myHands`. */
export async function retractHand(playerId:string,slotId:string):Promise<boolean>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`UPDATE slot_hands SET retracted_at=now()
    WHERE slot_id=${slotId} AND player_id=${playerId} AND retracted_at IS NULL RETURNING id`;
  return Boolean(rows[0]);
}

/** 「今晚唔得 · 全部收返」 — every hand this member holds on a slot starting inside the given window,
    pulled back in one call so a member who suddenly cannot play does not have to visit each card and
    explain themselves. */
export async function retractHandsInWindow(playerId:string,startAt:string,endAt:string):Promise<number>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`UPDATE slot_hands SET retracted_at=now()
    WHERE player_id=${playerId} AND retracted_at IS NULL
      AND slot_id IN (SELECT id FROM availability_slots WHERE start_at < ${endAt} AND end_at > ${startAt})
    RETURNING id`;
  return rows.length;
}

export type MyHand = { slotId:string; raisedAt:string; slot:PostedSlot&{player:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null}} };

/** Every slot this member currently has an active hand on, excluding anything that has since been
    filled by somebody else — which is the entire mechanism that keeps a loss invisible: the slot
    just quietly stops being "mine to track" rather than being marked lost. */
export async function myHands(playerId:string):Promise<MyHand[]>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT h.raised_at AS "raisedAt",
      s.id,s.player_id AS "playerId",s.start_at AS "startAt",s.end_at AS "endAt",
      s.created_at AS "createdAt",s.updated_at AS "updatedAt",s.cancelled_at AS "cancelledAt",s.venue,s.note,
      s.fill_rule AS "fillRule",s.conditions,s.filled_by AS "filledBy",s.filled_at AS "filledAt",s.result,
      p.id AS "posterId",p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM slot_hands h
    JOIN availability_slots s ON s.id=h.slot_id
    JOIN state_players p ON p.id=s.player_id
    WHERE h.player_id=${playerId} AND h.retracted_at IS NULL
      AND s.cancelled_at IS NULL AND s.end_at > now() AND (s.filled_by IS NULL OR s.filled_by=${playerId})
    ORDER BY s.start_at`;
  return rows.map(row=>({slotId:row.id,raisedAt:new Date(row.raisedAt).toISOString(),slot:{
    id:row.id,playerId:row.playerId,startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),
    createdAt:new Date(row.createdAt).toISOString(),updatedAt:new Date(row.updatedAt).toISOString(),
    cancelledAt:row.cancelledAt?new Date(row.cancelledAt).toISOString():null,
    venue:row.venue??"",note:row.note??"",fillRule:row.fillRule==="review"?"review":"first",
    conditions:row.conditions??{},filledBy:row.filledBy??null,filledAt:row.filledAt?new Date(row.filledAt).toISOString():null,
    result:row.result==="played"||row.result==="missed"?row.result:"pending",
    player:{id:row.posterId,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar},
  }}));
}

export type PendingHand = { playerId:string; raisedAt:string; player:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null} };

/** Owner-only. The one place a hand's identity is ever readable — never returned to anyone but the
    poster of this exact slot. */
export async function handsForSlot(posterId:string,slotId:string):Promise<PendingHand[]>{
  await ensureSchema(); const sql=getSql();
  const [owns]=await sql<{id:string}[]>`SELECT id FROM availability_slots WHERE id=${slotId} AND player_id=${posterId}`;
  if(!owns)return [];
  const rows=await sql<any[]>`SELECT h.raised_at AS "raisedAt",p.id,p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM slot_hands h JOIN state_players p ON p.id=h.player_id
    WHERE h.slot_id=${slotId} AND h.retracted_at IS NULL ORDER BY h.raised_at`;
  return rows.map(row=>({playerId:row.id,raisedAt:new Date(row.raisedAt).toISOString(),
    player:{id:row.id,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar}}));
}

/** The poster's manual pick, for `fill_rule='review'`. Same fill primitive and the same overlap
    clean-up as the instant path — the only difference is who triggers it and when. */
export async function pickHand(posterId:string,slotId:string,chosenPlayerId:string):Promise<PostedSlot|null>{
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const [owns]=await tx<{id:string;fillRule:string}[]>`SELECT id,fill_rule AS "fillRule" FROM availability_slots
      WHERE id=${slotId} AND player_id=${posterId} AND posted=true AND cancelled_at IS NULL AND filled_by IS NULL AND end_at > now() FOR UPDATE`;
    if(!owns)return null;
    const [hand]=await tx<{id:string}[]>`SELECT id FROM slot_hands WHERE slot_id=${slotId} AND player_id=${chosenPlayerId} AND retracted_at IS NULL`;
    if(!hand)return null;
    const filled=await fillPostedSlotTx(tx,slotId,chosenPlayerId);
    if(!filled)return null;
    await retractOverlappingHandsTx(tx,chosenPlayerId,filled.startAt,filled.endAt,slotId);
    return filled;
  });
}

/* --- 「佢開局通知我」 -------------------------------------------------------- */

export async function watchPlayer(watcherId:string,targetId:string):Promise<boolean>{
  if(watcherId===targetId)return false;
  await ensureSchema(); const sql=getSql();
  await sql`INSERT INTO slot_watchers (id,watcher_id,target_id) VALUES (${crypto.randomUUID()},${watcherId},${targetId}) ON CONFLICT DO NOTHING`;
  return true;
}

export async function unwatchPlayer(watcherId:string,targetId:string):Promise<boolean>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`DELETE FROM slot_watchers WHERE watcher_id=${watcherId} AND target_id=${targetId} RETURNING id`;
  return Boolean(rows[0]);
}

export async function isWatching(watcherId:string,targetId:string):Promise<boolean>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<{id:string}[]>`SELECT id FROM slot_watchers WHERE watcher_id=${watcherId} AND target_id=${targetId}`;
  return Boolean(row);
}

/** 「有 N 個人等緊你開局」 — shown only to the watched member, on their own composer, as the reason
    to post rather than a name-by-name list. */
export async function waitingForMeCount(playerId:string):Promise<number>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<{count:string}[]>`SELECT count(*)::text AS count FROM slot_watchers WHERE target_id=${playerId}`;
  return Number(row?.count??0);
}

/** Everyone who should hear that this member just posted — every watcher, notified once per post and
    never told anything beyond "they posted", per `db/slot-actions.pg.ts`. */
export async function watchersOf(targetId:string):Promise<string[]>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{watcherId:string}[]>`SELECT watcher_id AS "watcherId" FROM slot_watchers WHERE target_id=${targetId}`;
  return rows.map(row=>row.watcherId);
}
