import postgres from "postgres";

export type InvitePlayer = { id:string; name:string; short:string; rating:number; colour?:string|null; avatar?:string|null };
export type InviteStatus = "pending"|"accepted"|"declined"|"cancelled";
export type MatchInvite = {
  id:string; startAt:string; endAt:string; message:string; status:InviteStatus;
  createdAt:string; respondedAt:string|null;
  fromPlayer:InvitePlayer; toPlayer:InvitePlayer;
};

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (!sqlClient) {
    const url=process.env.POSTGRES_URL||process.env.DATABASE_URL||process.env.SUPABASE_DB_URL;
    if(!url)throw new Error("No Postgres connection string found. Set POSTGRES_URL.");
    sqlClient=postgres(url,{ssl:"require",prepare:false});
  }
  return sqlClient;
}

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
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
      CHECK (end_at > start_at), CHECK (from_player_id <> to_player_id),
      CHECK (status IN ('pending','accepted','declined','cancelled'))
    )`;
    /* One outstanding invite per direction at a time — the UI turns the invite button into a status
       display the instant one is pending, so a second insert here would only ever be a race. */
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS match_invites_pending_pair_idx ON match_invites (from_player_id,to_player_id) WHERE status='pending'`;
    await sql`CREATE INDEX IF NOT EXISTS match_invites_to_player_idx ON match_invites (to_player_id,status)`;
    await sql`CREATE INDEX IF NOT EXISTS match_invites_from_player_idx ON match_invites (from_player_id,status)`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

const inviteColumns=`i.id,i.start_at AS "startAt",i.end_at AS "endAt",i.message,i.status,
  i.created_at AS "createdAt",i.responded_at AS "respondedAt",
  fp.id AS "fromId",fp.name AS "fromName",fp.short AS "fromShort",fp.rating::float8 AS "fromRating",fp.colour AS "fromColour",fp.avatar AS "fromAvatar",
  tp.id AS "toId",tp.name AS "toName",tp.short AS "toShort",tp.rating::float8 AS "toRating",tp.colour AS "toColour",tp.avatar AS "toAvatar"
  FROM match_invites i JOIN state_players fp ON fp.id=i.from_player_id JOIN state_players tp ON tp.id=i.to_player_id`;

function hydrate(row:any):MatchInvite {
  return {
    id:row.id, startAt:new Date(row.startAt).toISOString(), endAt:new Date(row.endAt).toISOString(),
    message:row.message, status:row.status, createdAt:new Date(row.createdAt).toISOString(),
    respondedAt:row.respondedAt?new Date(row.respondedAt).toISOString():null,
    fromPlayer:{id:row.fromId,name:row.fromName,short:row.fromShort,rating:Number(row.fromRating),colour:row.fromColour,avatar:row.fromAvatar},
    toPlayer:{id:row.toId,name:row.toName,short:row.toShort,rating:Number(row.toRating),colour:row.toColour,avatar:row.toAvatar},
  };
}

async function getInviteById(id:string):Promise<MatchInvite|null> {
  const sql=getSql();
  const rows=await sql.unsafe(`SELECT ${inviteColumns} WHERE i.id=$1`,[id]);
  return rows[0]?hydrate(rows[0]):null;
}

/** Both directions in one call — the caller splits into sent/received, since which side a member is
    on can flip invite to invite. */
export async function listInvitesFor(playerId:string) {
  await ensureSchema(); const sql=getSql();
  const rows=await sql.unsafe(`SELECT ${inviteColumns} WHERE i.from_player_id=$1 OR i.to_player_id=$1 ORDER BY i.created_at DESC`,[playerId]);
  const all=rows.map(hydrate);
  return {
    sent: all.filter(x=>x.fromPlayer.id===playerId),
    received: all.filter(x=>x.toPlayer.id===playerId),
  };
}

export async function createInvite(fromPlayerId:string,toPlayerId:string,interval:{startAt:string;endAt:string},message:string) {
  if(fromPlayerId===toPlayerId) throw new Error("Cannot invite yourself");
  await ensureSchema(); const sql=getSql();
  const id=crypto.randomUUID();
  try {
    await sql`INSERT INTO match_invites (id,from_player_id,to_player_id,start_at,end_at,message) VALUES (${id},${fromPlayerId},${toPlayerId},${interval.startAt},${interval.endAt},${message})`;
  } catch(error) {
    if(error && typeof error==="object" && "code" in error && (error as {code?:string}).code==="23505") throw new Error("已經有一個待回覆的邀請");
    throw error;
  }
  return getInviteById(id);
}

/** Recipient-only: accept or decline a still-pending invite. */
export async function respondInvite(id:string,playerId:string,action:"accept"|"decline") {
  await ensureSchema(); const sql=getSql();
  const status:InviteStatus=action==="accept"?"accepted":"declined";
  const rows=await sql<any[]>`UPDATE match_invites SET status=${status},responded_at=now() WHERE id=${id} AND to_player_id=${playerId} AND status='pending' RETURNING id`;
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
