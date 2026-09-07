import { getSql } from "./sql";

/* A personal, one-directional shortlist -- not a friend graph. Starring someone changes nothing
   about who can see or join their 局; it only lets the client show "你哋打過" instead of a stranger
   the next time either of them posts. See supabase/migrations/20260907010000_player_regulars.sql. */

export async function listRegulars(playerId:string):Promise<string[]>{
  const sql=getSql();
  const rows=await sql<{regular_id:string}[]>`
    SELECT regular_id FROM player_regulars WHERE player_id=${playerId} ORDER BY created_at DESC`;
  return rows.map(row=>row.regular_id);
}

export async function addRegular(playerId:string,regularId:string):Promise<void>{
  if(playerId===regularId)throw new Error("唔可以將自己加為常打對手。");
  const sql=getSql();
  const [player]=await sql<{id:string}[]>`SELECT id FROM state_players WHERE id=${regularId}`;
  if(!player)throw new Error("搵唔到呢位球員。");
  await sql`INSERT INTO player_regulars (player_id,regular_id) VALUES (${playerId},${regularId})
    ON CONFLICT (player_id,regular_id) DO NOTHING`;
}

export async function removeRegular(playerId:string,regularId:string):Promise<void>{
  const sql=getSql();
  await sql`DELETE FROM player_regulars WHERE player_id=${playerId} AND regular_id=${regularId}`;
}
