import { getSql } from "./sql";
import { intentExpiry, type IntentKind, type IntentSignal, type Interval } from "../lib/availability";
import { extendedEnd, isMatchPreference, type MatchPreference } from "../lib/room";

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
  /** What kind of game they're up for. Carried on the intent rather than the player profile because
      it is a statement about *this* evening — a member happy to coach a newcomer tonight has not
      committed to doing it every night for the rest of the season. */
  preference:MatchPreference;
};

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  // Schema changes are migration-owned — see the identical short-circuit in
  // db/availability.pg.ts. match_intents is already live everywhere this
  // module runs, so skip re-running the bootstrap on every cold start.
  return Promise.resolve();

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
    /* Added after the table shipped, so it arrives as an ALTER — bounded and scoped with SET LOCAL
       for the same pooler reason as the open-call bootstrap: DDL that cannot take its lock promptly
       must fail and retry rather than queue every subsequent reader behind itself. */
    await sql.begin(async tx=>{
      await tx`SET LOCAL lock_timeout = '4s'`;
      await tx`ALTER TABLE match_intents ADD COLUMN IF NOT EXISTS preference text NOT NULL DEFAULT 'any'`;
    });
    /* A member can only ever have one live intent — posting a new one supersedes the last rather
       than stacking, since "I want a game" is a mood, not a queue. */
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS match_intents_live_player_idx ON match_intents (player_id) WHERE status='live'`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

export async function ensureIntentSchema(){ return ensureSchema(); }

function row(r:any):Intent {
  return {id:r.id,playerId:r.playerId,kind:r.kind,startAt:r.startAt?new Date(r.startAt).toISOString():null,endAt:r.endAt?new Date(r.endAt).toISOString():null,
    note:r.note??"",createdAt:new Date(r.createdAt).toISOString(),expiresAt:new Date(r.expiresAt).toISOString(),status:r.status,
    preference:isMatchPreference(r.preference)?r.preference:"any"};
}

/** Post (or replace) a member's live intent. The previous one, if any, is withdrawn in the same
    statement — never two live intents fighting for the same shortlist slot. */
export async function postIntent(playerId:string,kind:IntentKind,window:Interval|null,note:string,preference:MatchPreference="any"):Promise<Intent>{
  await ensureSchema(); const sql=getSql();
  const expiresAt=intentExpiry(kind,window);
  const [created]=await sql<any[]>`
    WITH closed AS (UPDATE match_intents SET status='withdrawn' WHERE player_id=${playerId} AND status='live')
    INSERT INTO match_intents (id,player_id,kind,start_at,end_at,note,expires_at,preference)
    VALUES (${crypto.randomUUID()},${playerId},${kind},${window?.startAt??null},${window?.endAt??null},${note},${expiresAt},${preference})
    RETURNING id,player_id AS "playerId",kind,start_at AS "startAt",end_at AS "endAt",note,created_at AS "createdAt",expires_at AS "expiresAt",status,preference`;
  return row(created);
}

/** "+1 小時" on a live status.
 *
 *  Both the window's end and the intent's own expiry move together — they are the same fact told to
 *  two different readers, and letting them drift apart is how a member ends up visible in the room
 *  with a window that finished twenty minutes ago. Returns null when the ceiling in `extendedEnd`
 *  refuses the extension, so the caller can say so rather than reporting a success that changed
 *  nothing. */
export async function extendIntent(playerId:string,id:string):Promise<Intent|null>{
  await ensureSchema(); const sql=getSql();
  const [found]=await sql<any[]>`SELECT id,player_id AS "playerId",kind,start_at AS "startAt",end_at AS "endAt",note,created_at AS "createdAt",expires_at AS "expiresAt",status,preference FROM match_intents WHERE id=${id} AND player_id=${playerId} AND status='live'`;
  if(!found)return null;
  const current=row(found);
  if(!current.endAt)return null;
  const endAt=extendedEnd(current.endAt,current.startAt);
  if(!endAt)return null;
  const [updated]=await sql<any[]>`UPDATE match_intents SET end_at=${endAt},expires_at=${endAt}
    WHERE id=${id} AND player_id=${playerId} AND status='live' RETURNING id,player_id AS "playerId",kind,start_at AS "startAt",end_at AS "endAt",note,created_at AS "createdAt",expires_at AS "expiresAt",status,preference`;
  return updated?row(updated):null;
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
  const [found]=await sql<any[]>`SELECT id,player_id AS "playerId",kind,start_at AS "startAt",end_at AS "endAt",note,created_at AS "createdAt",expires_at AS "expiresAt",status,preference
    FROM match_intents WHERE player_id=${playerId} AND status='live' AND expires_at>now()`;
  return found?row(found):null;
}

/** Every live intent in full, joined to the player it belongs to — the one query The Room runs.
 *
 *  Separate from `liveIntentsByPlayer` on purpose: that one exists to nudge a ranking and is fetched
 *  on every page load that shows a shortlist, so it stays as narrow as possible. This one is the
 *  board itself, and needs the window, the preference and enough of the player to draw a row. */
export type LiveIntent = Intent & {
  player:{id:string;name:string;short:string;rating:number;colour:string|null;avatar:string|null};
};

export async function liveIntentsDetailed():Promise<LiveIntent[]>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT i.id,i.player_id AS "playerId",i.kind,i.start_at AS "startAt",i.end_at AS "endAt",i.note,
      i.created_at AS "createdAt",i.expires_at AS "expiresAt",i.status,i.preference,
      p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM match_intents i JOIN state_players p ON p.id=i.player_id
    WHERE i.status='live' AND i.expires_at>now() AND p.active=true
    ORDER BY i.created_at DESC`;
  return rows.map(r=>({...row(r),
    player:{id:r.playerId,name:r.name,short:r.short,rating:Number(r.rating),colour:r.colour,avatar:r.avatar}}));
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
