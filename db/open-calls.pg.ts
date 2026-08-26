import { getSql } from "./sql";
import { ensureInviteSchema } from "./invites.pg";

export type OpenCallPlayer = { id:string; name:string; short:string; rating:number; colour?:string|null; avatar?:string|null };
export type OpenCallStatus = "open"|"claimed"|"cancelled"|"expired";
export type OpenCall = {
  id:string; startAt:string; endAt:string; message:string; status:OpenCallStatus; venue:string;
  createdAt:string; claimedAt:string|null;
  player:OpenCallPlayer; claimedBy:OpenCallPlayer|null;
};

let schemaReady:Promise<unknown>|null=null;
/* Exported for the same reason invites exports its own: the summary query counts open calls without
   ever having gone through a read or write path that would have bootstrapped the table. */
export async function ensureOpenCallSchema(){ return ensureSchema(); }
async function ensureSchema(){
  // Schema changes are migration-owned — see the identical short-circuit in
  // db/availability.pg.ts. open_calls is already live everywhere this module
  // runs, so skip re-running the bootstrap on every cold start.
  return Promise.resolve();

  schemaReady??=(async()=>{
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS open_calls (
      id text PRIMARY KEY,
      player_id text NOT NULL REFERENCES state_players(id) ON DELETE RESTRICT,
      claimed_by_id text REFERENCES state_players(id) ON DELETE RESTRICT,
      start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
      message text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now(),
      claimed_at timestamptz,
      CHECK (end_at > start_at), CHECK (player_id <> claimed_by_id),
      CHECK (status IN ('open','claimed','cancelled','expired'))
    )`;
    /* Bounded for the same reason as the invite bootstrap, and scoped with SET LOCAL for the same
       pooler reason: DDL that cannot take its lock promptly must fail and retry rather than queue
       every subsequent reader behind itself. */
    await sql.begin(async tx=>{
      await tx`SET LOCAL lock_timeout = '4s'`;
      await tx`ALTER TABLE open_calls ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT ''`;
    });
    await sql`CREATE INDEX IF NOT EXISTS open_calls_live_idx ON open_calls (start_at) WHERE status='open'`;
    await sql`CREATE INDEX IF NOT EXISTS open_calls_player_idx ON open_calls (player_id,status)`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

const callColumns=`c.id,c.start_at AS "startAt",c.end_at AS "endAt",c.message,c.status,c.venue,
  c.created_at AS "createdAt",c.claimed_at AS "claimedAt",
  p.id AS "playerId",p.name AS "playerName",p.short AS "playerShort",p.rating::float8 AS "playerRating",p.colour AS "playerColour",p.avatar AS "playerAvatar",
  q.id AS "claimId",q.name AS "claimName",q.short AS "claimShort",q.rating::float8 AS "claimRating",q.colour AS "claimColour",q.avatar AS "claimAvatar"
  FROM open_calls c JOIN state_players p ON p.id=c.player_id LEFT JOIN state_players q ON q.id=c.claimed_by_id`;

function hydrate(row:any):OpenCall {
  return {
    id:row.id, startAt:new Date(row.startAt).toISOString(), endAt:new Date(row.endAt).toISOString(),
    message:row.message, status:row.status, venue:row.venue??"", createdAt:new Date(row.createdAt).toISOString(),
    claimedAt:row.claimedAt?new Date(row.claimedAt).toISOString():null,
    player:{id:row.playerId,name:row.playerName,short:row.playerShort,rating:Number(row.playerRating),colour:row.playerColour,avatar:row.playerAvatar},
    claimedBy:row.claimId?{id:row.claimId,name:row.claimName,short:row.claimShort,rating:Number(row.claimRating),colour:row.claimColour,avatar:row.claimAvatar}:null,
  };
}

/** Same lazy-sweep reasoning as the invite expiry: an open call nobody took is dead once its slot
    has been under way past the shared 30-minute grace window, and there is no scheduler here to say
    so. The interval is kept in step with AVAILABILITY_GRACE_MINUTES in lib/availability.ts. */
export async function expireStaleOpenCalls() {
  const sql=getSql();
  await sql`UPDATE open_calls SET status='expired' WHERE status='open' AND start_at<=now()-interval '30 minutes'`;
}

/** Every still-claimable call, plus the caller's own recent ones so they can see and withdraw what
    they posted. Deliberately club-wide rather than filtered to overlapping availability: the whole
    point of an open call is to reach the member who never got round to publishing a slot. */
export async function listOpenCalls() {
  await ensureSchema(); await expireStaleOpenCalls(); const sql=getSql();
  const rows=await sql.unsafe(`SELECT ${callColumns} WHERE c.status IN ('open','claimed') AND c.end_at>now() ORDER BY c.start_at ASC`);
  return rows.map(hydrate);
}

/** Count currently live calls for the app-shell summary without hydrating every call and player. */
export async function openCallCount():Promise<number>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<{count:string}[]>`SELECT count(*)::text AS count FROM open_calls
    WHERE status='open' AND start_at>now()-interval '30 minutes' AND end_at>now()`;
  return Number(row?.count??0);
}

export async function createOpenCall(playerId:string,interval:{startAt:string;endAt:string},message:string,venue="") {
  await ensureSchema(); await expireStaleOpenCalls(); const sql=getSql();
  const id=crypto.randomUUID();
  await sql`INSERT INTO open_calls (id,player_id,start_at,end_at,message,venue) VALUES (${id},${playerId},${interval.startAt},${interval.endAt},${message},${venue})`;
  const rows=await sql.unsafe(`SELECT ${callColumns} WHERE c.id=$1`,[id]);
  return rows[0]?hydrate(rows[0]):null;
}

/** Take an open call, first come first served.
 *
 *  The UPDATE guards on `status='open'` so two members tapping "claim" at the same moment cannot
 *  both win — the loser's UPDATE matches zero rows and gets told the table is taken, rather than
 *  both of them turning up expecting a game.
 *
 *  A claimed call is then written through as an *accepted* invite. That keeps one single notion of
 *  "a confirmed game" in the system: the status card, the upcoming list and the post-slot follow-up
 *  all already understand accepted invites, and none of them need to learn about open calls. */
export async function claimOpenCall(id:string,playerId:string) {
  await ensureSchema(); await ensureInviteSchema(); const sql=getSql();
  /* Both writes or neither: a call marked claimed without the confirmed game to match would leave
     the taker with a table nobody else can claim and no fixture to show for it. */
  const claimed=await sql.begin(async tx=>{
    const rows=await tx<{id:string;player_id:string;start_at:Date;end_at:Date;message:string;venue:string}[]>`
      UPDATE open_calls SET status='claimed',claimed_by_id=${playerId},claimed_at=now()
      WHERE id=${id} AND status='open' AND start_at>now()-interval '30 minutes' AND player_id<>${playerId}
      RETURNING id,player_id,start_at,end_at,message,venue`;
    const row=rows[0];
    if(!row)return null;
    await tx`INSERT INTO match_invites (id,from_player_id,to_player_id,start_at,end_at,message,venue,status,responded_at)
      VALUES (${crypto.randomUUID()},${row.player_id},${playerId},${row.start_at},${row.end_at},${row.message},${row.venue??""},'accepted',now())`;
    return row;
  });
  if(!claimed)return null;
  const rows=await sql.unsafe(`SELECT ${callColumns} WHERE c.id=$1`,[id]);
  return rows[0]?hydrate(rows[0]):null;
}

/** Withdraw a call while it is still open. Once claimed it is a real fixture with another member
    counting on it, so it gets cancelled through the invite it created, not from here. */
export async function cancelOpenCall(id:string,playerId:string) {
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`UPDATE open_calls SET status='cancelled'
    WHERE id=${id} AND status='open' AND player_id=${playerId} RETURNING id`;
  return Boolean(rows[0]);
}
