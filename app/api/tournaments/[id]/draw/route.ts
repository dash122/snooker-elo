import { requireMember } from "../../../../../db/auth";
import { notifyPlayers } from "../../../../../db/notifications";
import { freezeTournamentDraw } from "../../../../../db/tournaments.pg";
import { cupDrawn } from "../../../../../lib/notify";
import { bracketShape, firstRoundPairings, roundLabel } from "../../../../../lib/tournament";

/** Freezing the draw is a server job, not a client one.
 *
 *  Left to the browser, the bracket was recomputed from the sign-up list on every render, so an
 *  admin adding a late entrant after the deadline silently re-paired everybody who had already been
 *  told who they were playing. Here it happens once, under a tournament-row lock, and the same request
 *  tells the entrants — which is the whole difference between a bracket that appears and a draw that
 *  is announced. */

export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  const {id}=await params;
  const result=await freezeTournamentDraw(id);
  if(!result.ok){
    if(result.error==="not-found")return Response.json({error:"Tournament not found"},{status:404});
    if(result.error==="still-open")return Response.json({error:"報名尚未截止"},{status:409});
    return Response.json({error:"報名人數不足兩人"},{status:409});
  }
  const {tournament:drawn}=result;
  if(!result.created)return Response.json({ok:true,alreadyDrawn:true,draw:drawn.draw});

  const name=(playerId:string)=>result.playerNames[playerId]??"";
  const {rounds}=bracketShape(drawn.draw?.length??0);
  const label=roundLabel(1,rounds);
  /* Awaited, and one push per entrant rather than a broadcast: the body names their own opponent, so
     there is nothing to fan out. `notifyPlayers` swallows per-subscription failures itself, so a
     stale endpoint cannot fail the draw that has already been written. */
  await Promise.all(firstRoundPairings(drawn).map(pairing=>
    notifyPlayers([pairing.playerId],cupDrawn(drawn.name,pairing.opponentId?name(pairing.opponentId):null,label))));

  return Response.json({ok:true,draw:drawn.draw,drawnAt:drawn.drawnAt});
}
