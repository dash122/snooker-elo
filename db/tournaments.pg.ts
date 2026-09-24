import { getSql } from "./sql";
import { randomizeDraw, type TournamentLike } from "../lib/tournament";

type LockedTournament = TournamentLike & { closed:boolean };

export type FreezeTournamentDrawResult =
  | { ok:true; created:boolean; tournament:TournamentLike; playerNames:Record<string,string> }
  | { ok:false; error:"not-found"|"still-open"|"too-few-players" };

/** Freeze a cup's first draw exactly once.
 *
 *  The old route read the complete state document, generated a draw, then entered putState's
 *  serialized write transaction. Two requests could therefore both observe an empty draw and send
 *  different pairings. Locking the tournament row before checking `draw` makes the check, random
 *  shuffle, update and audit one database event. A waiter sees the winner's stored draw and never
 *  announces its own discarded shuffle. */
export async function freezeTournamentDraw(id:string):Promise<FreezeTournamentDrawResult> {
  const sql=getSql();
  return sql.begin(async tx=>{
    await tx`SET LOCAL lock_timeout = 0`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    const [locked]=await tx<LockedTournament[]>`
      SELECT id,name,handicap_mode AS "handicapMode",
             to_char(signup_deadline AT TIME ZONE 'Asia/Hong_Kong','YYYY-MM-DD"T"HH24:MI') AS "signupDeadline",
             signups,draw,
             to_char(drawn_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "drawnAt",
             signup_deadline<=now() AS closed
      FROM state_tournaments
      WHERE id=${id}
      FOR UPDATE`;
    if(!locked)return {ok:false as const,error:"not-found" as const};
    if(!locked.closed)return {ok:false as const,error:"still-open" as const};

    const existing=locked.draw?.filter(Boolean)??[];
    const created=existing.length===0;
    const draw=created?randomizeDraw(locked):existing;
    if(draw.length<2)return {ok:false as const,error:"too-few-players" as const};

    const drawnAt=created?new Date().toISOString():locked.drawnAt;
    if(created){
      await tx`
        UPDATE state_tournaments
        SET draw=${tx.json(draw)},drawn_at=${drawnAt},updated_at=now()
        WHERE id=${id}`;
      await tx`
        INSERT INTO state_audits (id,text,occurred_at)
        VALUES (${crypto.randomUUID()},${`盃賽抽籤：${locked.name}（${draw.length} 人）`},${drawnAt})`;
    }

    const players=await tx<{id:string;name:string}[]>`
      SELECT id,name FROM state_players WHERE id=ANY(${draw}::text[])`;
    return {
      ok:true as const,
      created,
      tournament:{...locked,draw,drawnAt},
      playerNames:Object.fromEntries(players.map(player=>[player.id,player.name])),
    };
  });
}
