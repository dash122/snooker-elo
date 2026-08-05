import { getSql } from "./sql";
import { intentExpiry, type IntentKind, type IntentSignal, type Interval } from "../lib/availability";

/** "I want a game" as its own fact, separate from "I have free time."
 *
 *  Availability answers "when could I play"; this answers "do I actually want to, right now" — the
 *  mutual the deck's whole redesign turns on. A `tonight` or `window` intent always carries a real
 *  time window and always gets mirrored into `availability_slots` by the caller (see
 *  `db/matchmaking-actions.pg.ts`), so every other surface — the grid, offers, open-call targeting —
 *  keeps reading plain availability and never has to learn a second concept. `standby` has no window
 *  at all: "ask me if something fits" for the member who will never maintain a calendar. */

export type Intent = {
  id:string; playerId:string; kind:IntentKind;
  startAt:string|null; endAt:string|null; note:string;
  createdAt:string; expiresAt:string; status:"live"|"withdrawn"|"expired";
};

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  schemaReady??=(async()=>{
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS match_intents (
      id text PRIMARY KEY,
      player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      kind text NOT NULL,
      start_at timestamptz, end_at timestamptz,
      note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'live',
      CHECK (kind IN ('tonight','window','standby')),
      CHECK (status IN ('live','withdrawn','expired')),
      /* 'standby' never carries a time — it is "ask me if something fits", not a slot. 'tonight' and
         'window' usually do (mirrored into availability by the caller), but 'window' also covers the
         bare "I want a game sometime this week" mood with no slot chosen yet, so only 'standby' is
         constrained here. */
      CHECK (kind<>'standby' OR (start_at IS NULL AND end_at IS NULL))
    )`;
    /* A member can only ever have one live intent — posting a new one supersedes the last rather
       than stacking, since "I want a game" is a mood, not a queue. */
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS match_intents_live_player_idx ON match_intents (player_id) WHERE status='live'`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

export async function ensureIntentSchema(){ return ensureSchema(); }

function row(r:any):Intent {
  return {id:r.id,playerId:r.playerId,kind:r.kind,startAt:r.startAt?new Date(r.startAt).toISOString():null,endAt:r.endAt?new Date(r.endAt).toISOString():null,
    note:r.note??"",createdAt:new Date(r.createdAt).toISOString(),expiresAt:new Date(r.expiresAt).toISOString(),status:r.status};
}

/** Post (or replace) a member's live intent. The previous one, if any, is withdrawn in the same
    statement — never two live intents fighting for the same shortlist slot. */
export async function postIntent(playerId:string,kind:IntentKind,window:Interval|null,note:string):Promise<Intent>{
  await ensureSchema(); const sql=getSql();
  const expiresAt=intentExpiry(kind,window);
  const [created]=await sql<any[]>`
    WITH closed AS (UPDATE match_intents SET status='withdrawn' WHERE player_id=${playerId} AND status='live')
    INSERT INTO match_intents (id,player_id,kind,start_at,end_at,note,expires_at)
    VALUES (${crypto.randomUUID()},${playerId},${kind},${window?.startAt??null},${window?.endAt??null},${note},${expiresAt})
    RETURNING id,player_id AS "playerId",kind,start_at AS "startAt",end_at AS "endAt",note,created_at AS "createdAt",expires_at AS "expiresAt",status`;
  return row(created);
}

export async function withdrawIntent(playerId:string,id:string):Promise<boolean>{
  await ensureSchema(); const sql=getSql();
  const [updated]=await sql<any[]>`UPDATE match_intents SET status='withdrawn' WHERE id=${id} AND player_id=${playerId} AND status='live' RETURNING id`;
  return Boolean(updated);
}

/** This member's own live intent, or null once it has expired or been withdrawn — the expiry check
    happens here rather than in a sweep, the same way `isInviteExpired` is read live rather than
    relying on a background job to have already run. */
export async function myIntent(playerId:string):Promise<Intent|null>{
  await ensureSchema(); const sql=getSql();
  const [found]=await sql<any[]>`SELECT id,player_id AS "playerId",kind,start_at AS "startAt",end_at AS "endAt",note,created_at AS "createdAt",expires_at AS "expiresAt",status
    FROM match_intents WHERE player_id=${playerId} AND status='live' AND expires_at>now()`;
  return found?row(found):null;
}

/** Every member's live intent, kind only — the one input the shortlist ranking needs, and cheap
    enough to fetch alongside reliability on every page load that shows a shortlist. */
export async function liveIntentsByPlayer():Promise<Record<string,IntentSignal>>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{playerId:string;kind:IntentKind}[]>`SELECT player_id AS "playerId",kind FROM match_intents WHERE status='live' AND expires_at>now()`;
  const map:Record<string,IntentSignal>={};
  for(const r of rows)map[r.playerId]={kind:r.kind};
  return map;
}
