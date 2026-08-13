import { getSql } from "./sql";
export type InvitePlayer = { id:string; name:string; short:string; rating:number; colour?:string|null; avatar?:string|null };
export type InviteStatus = "pending"|"accepted"|"declined"|"cancelled"|"expired"|"played"|"missed";
export type InviteCounter = { startAt:string; endAt:string; byPlayerId:string };
export type MatchInvite = {
  id:string; startAt:string; endAt:string; message:string; status:InviteStatus; venue:string;
  createdAt:string; respondedAt:string|null;
  /** A live counter-proposal: the times the *other* side suggested instead. While this is set, the
      invite is still pending but it is the original sender who owes an answer. */
  counter:InviteCounter|null;
  fromPlayer:InvitePlayer; toPlayer:InvitePlayer;
};

let schemaReady:Promise<unknown>|null=null;
/* Exported so open-calls.pg.ts can guarantee match_invites exists before writing the accepted invite
   that a claimed call turns into — the two modules hold separate pools and neither can assume the
   other's schema bootstrap has already run in this process. */
export async function ensureInviteSchema(){ return ensureSchema(); }
async function ensureSchema(){
  // Schema changes are deployment-owned; request-time DDL can block all readers.
  return Promise.resolve();

  schemaReady??=(async()=>{
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS match_invites (
      id text PRIMARY KEY,
      from_player_id text NOT NULL REFERENCES state_players(id) ON DELETE RESTRICT,
      to_player_id text NOT NULL REFERENCES state_players(id) ON DELETE RESTRICT,
      start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
      message text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      responded_at timestamptz,
      CHECK (end_at > start_at), CHECK (from_player_id <> to_player_id)
    )`;
    /* The status vocabulary grew (expired/played/missed) after the original CHECK shipped, and a
       CHECK constraint is not idempotent the way CREATE TABLE IF NOT EXISTS is — an existing
       deployment still carries the old four-value list and would reject every new terminal state.
       Dropping by the name Postgres assigned the inline constraint and re-adding it widens the
       column on old and new databases alike. */
    /* Each ALTER below needs ACCESS EXCLUSIVE on a table the app reads constantly, and this
       bootstrap runs on every cold start. Unbounded, a single slow reader holding ACCESS SHARE
       parks the ALTER indefinitely — and because a waiting DDL queues *ahead* of later readers,
       every subsequent request then piles up behind the ALTER rather than behind the original slow
       query, taking the whole feature down. A short ceiling converts that stall into a failed
       bootstrap which simply retries on the next request.

       `SET LOCAL` inside a transaction rather than a bare `SET`: the shared pool talks to Supabase's
       transaction-mode pooler, where a session-level SET would leak this timeout onto whichever
       unrelated request inherits the connection next. */
    await sql.begin(async tx=>{
      await tx`SET LOCAL lock_timeout = '4s'`;
      await tx`ALTER TABLE match_invites DROP CONSTRAINT IF EXISTS match_invites_status_check`;
      await tx`ALTER TABLE match_invites ADD CONSTRAINT match_invites_status_check
        CHECK (status IN ('pending','accepted','declined','cancelled','expired','played','missed'))`;
      await tx`ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS closed_at timestamptz`;
      /* Where the game is. A snooker club's scarce resource is the table, not the hour — "訂咗 3 號枱"
         is the difference between a confirmed fixture and two members waiting in different rooms. */
      await tx`ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT ''`;
      /* Counter-proposal. Held alongside the original rather than as a second row so an invite stays
         one negotiation with one history, and so the pending-pair uniqueness below still holds. */
      await tx`ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS counter_start_at timestamptz`;
      await tx`ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS counter_end_at timestamptz`;
      await tx`ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS counter_by_id text REFERENCES state_players(id) ON DELETE SET NULL`;
    });
    /* One outstanding invite per direction at a time — the UI turns the invite button into a status
       display the instant one is pending, so a second insert here would only ever be a race. */
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS match_invites_pending_pair_idx ON match_invites (from_player_id,to_player_id) WHERE status='pending'`;
    await sql`CREATE INDEX IF NOT EXISTS match_invites_to_player_idx ON match_invites (to_player_id,status)`;
    await sql`CREATE INDEX IF NOT EXISTS match_invites_from_player_idx ON match_invites (from_player_id,status)`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

const inviteColumns=`i.id,i.start_at AS "startAt",i.end_at AS "endAt",i.message,i.status,i.venue,
  i.created_at AS "createdAt",i.responded_at AS "respondedAt",
  i.counter_start_at AS "counterStartAt",i.counter_end_at AS "counterEndAt",i.counter_by_id AS "counterById",
  fp.id AS "fromId",fp.name AS "fromName",fp.short AS "fromShort",fp.rating::float8 AS "fromRating",fp.colour AS "fromColour",fp.avatar AS "fromAvatar",
  tp.id AS "toId",tp.name AS "toName",tp.short AS "toShort",tp.rating::float8 AS "toRating",tp.colour AS "toColour",tp.avatar AS "toAvatar"
  FROM match_invites i JOIN state_players fp ON fp.id=i.from_player_id JOIN state_players tp ON tp.id=i.to_player_id`;

function hydrate(row:any):MatchInvite {
  return {
    id:row.id, startAt:new Date(row.startAt).toISOString(), endAt:new Date(row.endAt).toISOString(),
    message:row.message, status:row.status, venue:row.venue??"", createdAt:new Date(row.createdAt).toISOString(),
    respondedAt:row.respondedAt?new Date(row.respondedAt).toISOString():null,
    counter:row.counterStartAt&&row.counterEndAt?{startAt:new Date(row.counterStartAt).toISOString(),endAt:new Date(row.counterEndAt).toISOString(),byPlayerId:row.counterById}:null,
    fromPlayer:{id:row.fromId,name:row.fromName,short:row.fromShort,rating:Number(row.fromRating),colour:row.fromColour,avatar:row.fromAvatar},
    toPlayer:{id:row.toId,name:row.toName,short:row.toShort,rating:Number(row.toRating),colour:row.toColour,avatar:row.toAvatar},
  };
}

async function getInviteById(id:string):Promise<MatchInvite|null> {
  const sql=getSql();
  const rows=await sql.unsafe(`SELECT ${inviteColumns} WHERE i.id=$1`,[id]);
  return rows[0]?hydrate(rows[0]):null;
}

/** Retire pending invites whose proposed slot has already begun.
 *
 *  This is what keeps a ghosted invite from becoming permanent: `match_invites_pending_pair_idx` is
 *  unique on (from,to) WHERE status='pending', so one unanswered invite used to block its sender
 *  from ever inviting that opponent again — `createInvite` would raise 23505 forever. Nothing ever
 *  moved a pending row out of the way, because there is no scheduler in this deployment.
 *
 *  So the sweep runs lazily on the paths that care (reading an inbox, writing a new invite) rather
 *  than on a cron. It is a single indexed UPDATE that usually matches nothing, and it means the
 *  invariant holds even if no background job ever runs. */
export async function expireStaleInvites() {
  const sql=getSql();
  /* Once a counter-proposal is on the table it is the counter's time that the two are negotiating
     over, so that is the clock the expiry has to watch — otherwise countering an invite to a later
     slot would expire it the moment the *original* time passed. */
  await sql`UPDATE match_invites SET status='expired',closed_at=now() WHERE status='pending' AND COALESCE(counter_start_at,start_at)<=now()`;
}

/** Both directions in one call — the caller splits into sent/received, since which side a member is
    on can flip invite to invite. */
export async function listInvitesFor(playerId:string) {
  await ensureSchema(); await expireStaleInvites(); const sql=getSql();
  const rows=await sql.unsafe(`SELECT ${inviteColumns} WHERE i.from_player_id=$1 OR i.to_player_id=$1 ORDER BY i.created_at DESC`,[playerId]);
  const all=rows.map(hydrate);
  return {
    sent: all.filter(x=>x.fromPlayer.id===playerId),
    received: all.filter(x=>x.toPlayer.id===playerId),
  };
}

export async function createInvite(fromPlayerId:string,toPlayerId:string,interval:{startAt:string;endAt:string},message:string,venue="") {
  if(fromPlayerId===toPlayerId) throw new Error("Cannot invite yourself");
  await ensureSchema(); await expireStaleInvites(); const sql=getSql();
  const id=crypto.randomUUID();
  try {
    await sql`INSERT INTO match_invites (id,from_player_id,to_player_id,start_at,end_at,message,venue) VALUES (${id},${fromPlayerId},${toPlayerId},${interval.startAt},${interval.endAt},${message},${venue})`;
  } catch(error) {
    if(error && typeof error==="object" && "code" in error && (error as {code?:string}).code==="23505") throw new Error("已經有一個待回覆的邀請");
    throw error;
  }
  return getInviteById(id);
}

/** Accept or decline a still-pending invite.
 *
 *  Who is entitled to answer flips once a counter-proposal exists: normally it is the recipient, but
 *  after B counters A's invite, it is A who owes the answer. Expressing that as one predicate in the
 *  WHERE clause keeps the rule atomic — there is no read-then-write window in which both sides could
 *  answer the same invite.
 *
 *  Accepting a countered invite promotes the counter's times to be the real ones, so everything
 *  downstream (the upcoming list, the follow-up prompt, the calendar) sees a single agreed slot and
 *  never has to know a negotiation happened. */
export async function respondInvite(id:string,playerId:string,action:"accept"|"decline") {
  await ensureSchema(); const sql=getSql();
  const status:InviteStatus=action==="accept"?"accepted":"declined";
  const rows=await sql<any[]>`UPDATE match_invites SET
      status=${status},responded_at=now(),
      start_at=CASE WHEN ${action==="accept"} AND counter_start_at IS NOT NULL THEN counter_start_at ELSE start_at END,
      end_at=CASE WHEN ${action==="accept"} AND counter_end_at IS NOT NULL THEN counter_end_at ELSE end_at END
    WHERE id=${id} AND status='pending'
      AND ((counter_by_id IS NULL AND to_player_id=${playerId})
        OR (counter_by_id IS NOT NULL AND counter_by_id<>${playerId} AND (from_player_id=${playerId} OR to_player_id=${playerId})))
    RETURNING id`;
  return rows[0]?getInviteById(id):null;
}

/** Suggest a different time for an invite instead of turning it down.
 *
 *  This is the step whose absence made every invite a yes/no social risk: a member who wanted to play
 *  but was busy at 19:00 had only "婉拒" available, which ends the conversation. Countering keeps the
 *  invite alive and simply moves whose turn it is.
 *
 *  Only the side that currently owes an answer may counter, and only once per turn — the guard mirrors
 *  `respondInvite` so the two can never disagree about whose move it is. Re-countering is allowed
 *  (it is just the other side's turn again), which is what makes a two- or three-step negotiation
 *  work without any extra state. */
export async function counterInvite(id:string,playerId:string,interval:{startAt:string;endAt:string},venue?:string) {
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`UPDATE match_invites SET
      counter_start_at=${interval.startAt},counter_end_at=${interval.endAt},counter_by_id=${playerId},
      venue=COALESCE(${venue??null},venue)
    WHERE id=${id} AND status='pending'
      AND ((counter_by_id IS NULL AND to_player_id=${playerId})
        OR (counter_by_id IS NOT NULL AND counter_by_id<>${playerId} AND (from_player_id=${playerId} OR to_player_id=${playerId})))
    RETURNING id`;
  return rows[0]?getInviteById(id):null;
}

/** Record what actually became of a confirmed game, once its slot has passed. Either participant may
    answer, because either one is equally placed to know. `accepted` used to be the terminal state
    the system ever saw, which left the one question worth measuring — does agreeing to play produce
    a played match — permanently unanswerable. */
export async function closeInvite(id:string,playerId:string,outcome:"played"|"missed") {
  await ensureSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`UPDATE match_invites SET status=${outcome},closed_at=now()
    WHERE id=${id} AND status='accepted' AND end_at<=now()
    AND (from_player_id=${playerId} OR to_player_id=${playerId})
    RETURNING id`;
  return rows[0]?getInviteById(id):null;
}

/** Withdraw an invite: sender may cancel while it's still pending; either participant may cancel
    once it's accepted (confirmed), before a score gets recorded. */
export async function cancelInvite(id:string,playerId:string) {
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`UPDATE match_invites SET status='cancelled',responded_at=now()
    WHERE id=${id}
    AND ((status='pending' AND from_player_id=${playerId}) OR (status='accepted' AND (from_player_id=${playerId} OR to_player_id=${playerId})))
    RETURNING id`;
  return Boolean(rows[0]);
}
