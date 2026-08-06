import { getSql } from "./sql";
import { watchersOf } from "./slot-hands.pg";
import { notifyPlayers } from "./notifications.pg";
import { slotWatcherPosted, slotFilled } from "../lib/notify";
import type { PostedSlot } from "./availability.pg";

/** The two notification moments a posted slot ever produces. Kept out of `db/slot-hands.pg.ts` and
    `db/availability.pg.ts` for the same reason `matchmaking-actions.pg.ts` sits apart from the
    tables it announces for: each data module stays a thin, testable wrapper, and a flow that spans
    two of them (post → tell watchers; raise → tell both sides) lives once, not once per caller. */

async function playerName(id:string):Promise<string>{
  const sql=getSql();
  const [row]=await sql<{name:string}[]>`SELECT name FROM state_players WHERE id=${id}`;
  return row?.name??"球友";
}

/** Fired after a slot is posted. Every watcher of this poster hears about it — never told who else
    is watching, never told anything beyond "they posted". */
export async function announceSlotPosted(playerId:string,slot:{startAt:string;endAt:string;venue?:string}){
  const watcherIds=await watchersOf(playerId);
  if(!watcherIds.length)return;
  const name=await playerName(playerId);
  await notifyPlayers(watcherIds,slotWatcherPosted(name,slot,slot.venue));
}

/** Fired the moment a slot fills, whichever path filled it. Both sides are told the same thing at
    the same time — there is no "winner finds out first". */
export async function announceSlotFilled(slot:PostedSlot){
  if(!slot.filledBy)return;
  const [posterName,fillerName]=await Promise.all([playerName(slot.playerId),playerName(slot.filledBy)]);
  await Promise.all([
    notifyPlayers([slot.playerId],slotFilled(fillerName,slot,slot.venue)),
    notifyPlayers([slot.filledBy],slotFilled(posterName,slot,slot.venue)),
  ]);
}
