import type { TransactionSql } from "postgres";
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
 * Hands are also unlimited, and a slot does not close when somebody is taken. The old rule — first
 * hand fills it, everyone else finds it gone — encoded "one game, two people" as a property of the
 * product, but a club night here is often three or four players round one table taking turns, and
 * there is no honest number to ask a poster for before anyone has shown up. So there is no capacity
 * column to check against anywhere, and taking people is a loop: see `acceptHands`. A slot stops
 * taking hands only when its poster says 夠喇 (`closed_at`), cancels, or the evening passes.
 *
 * What stays hidden is who is *waiting*, never how many. The count travels with every board row
 * because it is the difference between a card that reads as a live evening and one that reads as a
 * question; identity is what would let somebody work out they were passed over, so only the poster's
 * own query joins a waiting hand to a name — see `handsForSlot`. Accepted hands are public, because
 * an accepted player is the reason the next member joins. Nobody not taken is named, counted apart,
 * or told a decision happened. */

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
    /* Accepting is a state on the hand rather than a column on the slot, which is what lets a slot
       hold several accepted people at once. `availability_slots.filled_by` is kept in step with the
       *first* one so every surface that already understands a filled slot — status, hand-off card,
       result prompt — keeps working untouched. */
    await sql.begin(async tx=>{
      await tx`SET LOCAL lock_timeout = '4s'`;
      await tx`ALTER TABLE slot_hands ADD COLUMN IF NOT EXISTS accepted_at timestamptz`;
      await tx`ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS closed_at timestamptz`;
    });
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
/* The transaction handle `postgres` hands to a `begin` callback. Taken from the driver rather than
   hand-written: the tagged-template signature has overloads a local alias cannot reproduce. */
type Tx = TransactionSql;

/** One row of the hand/player join, shared by the owner-only list and the public counts. */
type HandRow = {
  id:string; name:string; short:string; rating:number; colour:string|null; avatar:string|null;
  raisedAt:Date; acceptedAt:Date|null;
};

async function retractOverlappingHandsTx(tx:Tx,playerId:string,startAt:string,endAt:string,exceptSlotId:string){
  await tx`UPDATE slot_hands SET retracted_at=now()
    WHERE player_id=${playerId} AND retracted_at IS NULL AND slot_id != ${exceptSlotId}
      AND slot_id IN (SELECT id FROM availability_slots WHERE start_at < ${endAt} AND end_at > ${startAt})`;
}

/** Take one hand: mark it accepted, keep `filled_by` pointing at the first person taken, and drop
 *  this player's hands on any slot whose time clashes with the one they just got.
 *
 *  Only the first acceptance touches `filled_by`. Everything downstream — slot status, the hand-off
 *  card, the result prompt — reads that column and needs exactly one answer to "who is this evening
 *  with"; the second and third people taken are additions to the table, not replacements for it. */
async function acceptHandTx(tx:Tx,slotId:string,playerId:string):Promise<PostedSlot|null>{
  const rows=await tx<{id:string}[]>`UPDATE slot_hands SET accepted_at=now()
    WHERE slot_id=${slotId} AND player_id=${playerId} AND retracted_at IS NULL AND accepted_at IS NULL
    RETURNING id`;
  if(!rows[0])return null;
  const [slot]=await tx<{startAt:Date;endAt:Date;filledBy:string|null}[]>`SELECT start_at AS "startAt",end_at AS "endAt",filled_by AS "filledBy"
    FROM availability_slots WHERE id=${slotId}`;
  const filled=slot?.filledBy?null:await fillPostedSlotTx(tx,slotId,playerId);
  const startAt=filled?filled.startAt:new Date(slot.startAt).toISOString();
  const endAt=filled?filled.endAt:new Date(slot.endAt).toISOString();
  await retractOverlappingHandsTx(tx,playerId,startAt,endAt,slotId);
  return filled;
}

/** Raise a hand on a posted slot.
 *
 *  `fill_rule='first'`: the hand is accepted in the same transaction, so the member never has to
 *  wonder whether it is "in". Accepting also retracts their other hands on any slot whose time
 *  clashes — the options they were holding for a conflicting evening are no longer options.
 *
 *  `fill_rule='review'`: the hand is simply recorded. Nothing is announced to anyone; the poster
 *  finds out by looking at their own slot, same as checking whether a kettle has boiled.
 *
 *  Neither path can fail because somebody else got there first. That failure mode came from the
 *  slot having one seat, and it no longer has any. */
export async function raiseHand(playerId:string,slotId:string):Promise<RaiseOutcome>{
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    /* Being filled is deliberately not a reason to refuse a hand. Only the poster closing it, the
       poster cancelling it, or the evening passing can do that. */
    const [slotRow]=await tx<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",fill_rule AS "fillRule",filled_by AS "filledBy"
      FROM availability_slots WHERE id=${slotId} AND posted=true AND cancelled_at IS NULL
        AND closed_at IS NULL AND end_at > now() FOR UPDATE`;
    if(!slotRow||slotRow.playerId===playerId)
      return {raised:false,filled:false,slot:null,tooLate:true};
    const [existing]=await tx<{id:string;acceptedAt:Date|null}[]>`SELECT id,accepted_at AS "acceptedAt" FROM slot_hands
      WHERE slot_id=${slotId} AND player_id=${playerId} AND retracted_at IS NULL`;
    if(existing?.acceptedAt)return {raised:true,filled:true,slot:null,tooLate:false};
    if(!existing)
      await tx`INSERT INTO slot_hands (id,slot_id,player_id) VALUES (${crypto.randomUUID()},${slotId},${playerId})`;
    /* 「第一個舉手就算」 accepts this hand on the spot — the poster exercised the decision when they
       posted, against nobody, so there is no moment where one name is weighed against another. It no
       longer shuts the slot: the poster can still take more, or tap 夠喇 when they have enough. */
    if(slotRow.fillRule!=="first"||slotRow.filledBy)return {raised:true,filled:false,slot:null,tooLate:false};
    const filled=await acceptHandTx(tx,slotId,playerId);
    if(!filled)return {raised:true,filled:false,slot:null,tooLate:false};
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

export type MyHand = { slotId:string; raisedAt:string; accepted:boolean; slot:PostedSlot&{player:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null}} };

/** Every slot this member currently has an active hand on.
 *
 *  `accepted` is the only thing that turns a raised hand into a game. Somebody *else* being taken no
 *  longer removes the slot from this list, because it no longer removes the member's chance of being
 *  taken too — but it must not be mistaken for their own acceptance either, which is what this flag
 *  exists to keep straight. A slot that closes without them is simply gone from here next poll: no
 *  marker, no notification, nothing that reads as having lost. */
export async function myHands(playerId:string):Promise<MyHand[]>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT h.raised_at AS "raisedAt",h.accepted_at AS "acceptedAt",
      s.id,s.player_id AS "playerId",s.start_at AS "startAt",s.end_at AS "endAt",
      s.created_at AS "createdAt",s.updated_at AS "updatedAt",s.cancelled_at AS "cancelledAt",s.venue,s.note,
      s.fill_rule AS "fillRule",s.conditions,s.filled_by AS "filledBy",s.filled_at AS "filledAt",s.result,
      s.closed_at AS "closedAt",
      p.id AS "posterId",p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM slot_hands h
    JOIN availability_slots s ON s.id=h.slot_id
    JOIN state_players p ON p.id=s.player_id
    WHERE h.player_id=${playerId} AND h.retracted_at IS NULL
      AND s.cancelled_at IS NULL AND s.end_at > now()
      AND (s.closed_at IS NULL OR h.accepted_at IS NOT NULL)
    ORDER BY s.start_at`;
  return rows.map(row=>({slotId:row.id,raisedAt:new Date(row.raisedAt).toISOString(),
    accepted:Boolean(row.acceptedAt),slot:{
    id:row.id,playerId:row.playerId,startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),
    createdAt:new Date(row.createdAt).toISOString(),updatedAt:new Date(row.updatedAt).toISOString(),
    cancelledAt:row.cancelledAt?new Date(row.cancelledAt).toISOString():null,
    venue:row.venue??"",note:row.note??"",fillRule:row.fillRule==="review"?"review":"first",
    conditions:row.conditions??{},filledBy:row.filledBy??null,filledAt:row.filledAt?new Date(row.filledAt).toISOString():null,
    closedAt:row.closedAt?new Date(row.closedAt).toISOString():null,
    result:row.result==="played"||row.result==="missed"?row.result:"pending",
    player:{id:row.posterId,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar},
  }}));
}

export type PendingHand = { playerId:string; raisedAt:string; state:"raised"|"accepted"; player:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null} };

/** Owner-only. The one place a hand's identity is ever readable — never returned to anyone but the
    poster of this exact slot. */
export async function handsForSlot(posterId:string,slotId:string):Promise<PendingHand[]>{
  await ensureSchema(); const sql=getSql();
  const [owns]=await sql<{id:string}[]>`SELECT id FROM availability_slots WHERE id=${slotId} AND player_id=${posterId}`;
  if(!owns)return [];
  const rows=await sql<HandRow[]>`SELECT h.raised_at AS "raisedAt",h.accepted_at AS "acceptedAt",
      p.id,p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM slot_hands h JOIN state_players p ON p.id=h.player_id
    WHERE h.slot_id=${slotId} AND h.retracted_at IS NULL ORDER BY h.raised_at`;
  return rows.map(row=>({playerId:row.id,raisedAt:new Date(row.raisedAt).toISOString(),
    state:row.acceptedAt?"accepted" as const:"raised" as const,
    player:{id:row.id,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar}}));
}

/** Take one hand, several, or every hand up.
 *
 *  This is the entire "more than one person" feature. There is no capacity to check and no mode to
 *  be in — accepting is a loop, and 全部收 is this same call with every waiting id in it.
 *
 *  What it deletes is the moment where a poster reads three names and confirms one, knowing the
 *  other two can tell. That moment is why people stop posting, and it only exists when the slot has
 *  a single seat. Members not taken are left exactly as they were: still raised, still unnamed to
 *  anyone but the poster, never told. Nothing here writes a rejection, which is why none can leak. */
export async function acceptHands(posterId:string,slotId:string,chosen:string[]|"all"):Promise<{
  accepted:string[]; filled:PostedSlot|null;
}|null>{
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const [owns]=await tx<{id:string}[]>`SELECT id FROM availability_slots
      WHERE id=${slotId} AND player_id=${posterId} AND posted=true AND cancelled_at IS NULL AND end_at > now() FOR UPDATE`;
    if(!owns)return null;
    const waiting=await tx<{playerId:string}[]>`SELECT player_id AS "playerId" FROM slot_hands
      WHERE slot_id=${slotId} AND retracted_at IS NULL AND accepted_at IS NULL ORDER BY raised_at`;
    const wanted=chosen==="all"?waiting.map(hand=>hand.playerId)
      :waiting.filter(hand=>chosen.includes(hand.playerId)).map(hand=>hand.playerId);
    const accepted:string[]=[];
    let filled:PostedSlot|null=null;
    for(const playerId of wanted){
      const result=await acceptHandTx(tx,slotId,playerId);
      accepted.push(playerId);
      filled??=result;
    }
    return {accepted,filled};
  });
}

/** 夠喇 · 唔再收. Stops new hands without settling the ones already up: whoever is still waiting sees
    a slot that filled, which is exactly what they would have seen had the poster never looked. */
export async function closeSlot(posterId:string,slotId:string):Promise<boolean>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`UPDATE availability_slots SET closed_at=now()
    WHERE id=${slotId} AND player_id=${posterId} AND posted=true AND cancelled_at IS NULL AND closed_at IS NULL
    RETURNING id`;
  return Boolean(rows[0]);
}

/** Hand counts for a set of slots, and the names of everyone accepted.
 *
 *  Counts are public and travel with every board row; waiting names never leave this module except
 *  through `handsForSlot`, which checks ownership first. */
export type SlotHandSummary = {
  total:number; accepted:number; waiting:number;
  acceptedPlayers:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null}[];
  raisers:string[];
};

export async function handSummaries(slotIds:string[]):Promise<Map<string,SlotHandSummary>>{
  const summaries=new Map<string,SlotHandSummary>();
  if(!slotIds.length)return summaries;
  await ensureSchema(); const sql=getSql();
  const rows=await sql<(HandRow&{slotId:string;playerId:string})[]>`SELECT h.slot_id AS "slotId",h.player_id AS "playerId",h.accepted_at AS "acceptedAt",
      p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM slot_hands h JOIN state_players p ON p.id=h.player_id
    WHERE h.slot_id = ANY(${slotIds}) AND h.retracted_at IS NULL ORDER BY h.raised_at`;
  for(const row of rows){
    const current=summaries.get(row.slotId)??{total:0,accepted:0,waiting:0,acceptedPlayers:[],raisers:[]};
    current.total+=1;
    current.raisers.push(row.playerId);
    if(row.acceptedAt){
      current.accepted+=1;
      current.acceptedPlayers.push({id:row.playerId,name:row.name,short:row.short,rating:Number(row.rating),
        colour:row.colour,avatar:row.avatar});
    }else current.waiting+=1;
    summaries.set(row.slotId,current);
  }
  return summaries;
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
