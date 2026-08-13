import { getSql } from "./sql";

/** "我而家喺會所" — the signal nothing else in the app models, and the one that converts best.
 *
 *  Every other fact matchmaking holds is about the future: a slot, a window, an intent. Presence is
 *  about right now, and a member standing at the table with a cue in their hand is a different
 *  proposition from one who wrote down that Thursday might work. It gets its own table rather than a
 *  column on the intent because the two decay on completely different clocks and for different
 *  reasons — leaving the club is not withdrawing from matchmaking, and vice versa.
 *
 *  Self-reported for now. A Wi-Fi check or a QR code at the counter would be more accurate and needs
 *  the club's cooperation to set up; this ships today and tells us whether the accuracy is worth
 *  buying. */

/** How long a member stays "at the club" without saying anything more.
 *
 *  Short on purpose. The failure that matters here is the ghost: a board showing four people at the
 *  club when three of them went home an hour ago is worse than an empty board, because somebody
 *  travels for it. Ninety minutes is roughly a session; a member who is still there taps again, and
 *  that tap is a fresher signal than any inference we could make on their behalf. */
export const PRESENCE_MINUTES = 90;

export type Presence = { playerId:string; arrivedAt:string; expiresAt:string };

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  // Schema changes are deployment-owned; request-time DDL can block all readers.
  return Promise.resolve();

  schemaReady??=(async()=>{
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS club_presence (
      player_id text PRIMARY KEY REFERENCES state_players(id) ON DELETE CASCADE,
      arrived_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS club_presence_live_idx ON club_presence (expires_at)`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

export async function ensurePresenceSchema(){ return ensureSchema(); }

/** Arrive, or push out an existing stay. Re-tapping keeps `arrived_at` so the room can honestly say
    how long somebody has been there, while the expiry always moves forward. */
export async function arriveAtClub(playerId:string):Promise<Presence>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<any[]>`
    INSERT INTO club_presence (player_id,expires_at)
    VALUES (${playerId},now()+${`${PRESENCE_MINUTES} minutes`}::interval)
    ON CONFLICT (player_id) DO UPDATE SET expires_at=now()+${`${PRESENCE_MINUTES} minutes`}::interval
    RETURNING player_id AS "playerId",arrived_at AS "arrivedAt",expires_at AS "expiresAt"`;
  return {playerId:row.playerId,arrivedAt:new Date(row.arrivedAt).toISOString(),expiresAt:new Date(row.expiresAt).toISOString()};
}

export async function leaveClub(playerId:string):Promise<boolean>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`DELETE FROM club_presence WHERE player_id=${playerId} RETURNING player_id`;
  return Boolean(rows[0]);
}

/** Read live rather than swept, the same way invite and offer expiry are read: a background job that
    has not run yet must never be the reason somebody appears to still be at the club. */
export async function livePresence():Promise<Record<string,Presence>>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT player_id AS "playerId",arrived_at AS "arrivedAt",expires_at AS "expiresAt"
    FROM club_presence WHERE expires_at>now()`;
  const map:Record<string,Presence>={};
  for(const row of rows)map[row.playerId]={playerId:row.playerId,arrivedAt:new Date(row.arrivedAt).toISOString(),expiresAt:new Date(row.expiresAt).toISOString()};
  return map;
}

/** One player's current rating.
 *
 *  Lives here rather than in a new module because The Room is its only caller and it needs it for a
 *  presentational reason, not a matchmaking one: every level on the board is phrased as a distance
 *  from the reader, so without the reader's own number there is nothing to measure against. Reading
 *  it off the member's live intent would have been free, but then a member who has not gone live yet
 *  would see everybody's level reported against zero. */
export async function playerRating(playerId:string):Promise<number>{
  const sql=getSql();
  const [row]=await sql<any[]>`SELECT rating::float8 AS rating FROM state_players WHERE id=${playerId}`;
  return row?Number(row.rating):0;
}

export async function myPresence(playerId:string):Promise<Presence|null>{
  await ensureSchema(); const sql=getSql();
  const [row]=await sql<any[]>`SELECT player_id AS "playerId",arrived_at AS "arrivedAt",expires_at AS "expiresAt"
    FROM club_presence WHERE player_id=${playerId} AND expires_at>now()`;
  return row?{playerId:row.playerId,arrivedAt:new Date(row.arrivedAt).toISOString(),expiresAt:new Date(row.expiresAt).toISOString()}:null;
}
