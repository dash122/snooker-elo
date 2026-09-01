import { requireMember } from "../../../../../db/auth";
import { notifyPlayers } from "../../../../../db/notifications";
import { getState, putState } from "../../../../../db/state";
import { cupDrawn } from "../../../../../lib/notify";
import { bracketShape, firstRoundPairings, randomizeDraw, roundLabel, signupsClosed, type TournamentLike } from "../../../../../lib/tournament";

/** Freezing the draw is a server job, not a client one.
 *
 *  Left to the browser, the bracket was recomputed from the sign-up list on every render, so an
 *  admin adding a late entrant after the deadline silently re-paired everybody who had already been
 *  told who they were playing. Here it happens once, under the state lock, and the same request
 *  tells the entrants — which is the whole difference between a bracket that appears and a draw that
 *  is announced. */

type State = { players?:{id:string;name:string}[]; tournaments?:TournamentLike[]; audits?:{id:string;text:string;at:string}[] };

export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  const {id}=await params;
  const raw=await getState();
  if(!raw)return Response.json({error:"No tournament state"},{status:404});
  let state:State;
  try{ state=JSON.parse(raw) as State; }catch{ return Response.json({error:"Invalid state"},{status:500}); }
  const tournament=(state.tournaments??[]).find(item=>item.id===id);
  if(!tournament)return Response.json({error:"Tournament not found"},{status:404});
  if(!signupsClosed(tournament))return Response.json({error:"報名尚未截止"},{status:409});
  /* Idempotent on purpose: every client that notices a closed, undrawn cup calls this, so the second
     and tenth callers must get the same draw back rather than a failure or a reshuffle. */
  if(tournament.draw?.length)return Response.json({ok:true,alreadyDrawn:true,draw:tournament.draw});

  const draw=randomizeDraw(tournament);
  if(draw.length<2)return Response.json({error:"報名人數不足兩人"},{status:409});
  const drawnAt=new Date().toISOString();
  const drawn={...tournament,draw,drawnAt};
  const next={
    ...state,
    tournaments:(state.tournaments??[]).map(item=>item.id===id?drawn:item),
    audits:[{id:crypto.randomUUID(),text:`盃賽抽籤：${tournament.name}（${draw.length} 人）`,at:drawnAt},...(state.audits??[])],
  };
  await putState(JSON.stringify(next));

  const name=(playerId:string)=>(state.players??[]).find(player=>player.id===playerId)?.name??"";
  const {rounds}=bracketShape(draw.length);
  const label=roundLabel(1,rounds);
  /* Awaited, and one push per entrant rather than a broadcast: the body names their own opponent, so
     there is nothing to fan out. `notifyPlayers` swallows per-subscription failures itself, so a
     stale endpoint cannot fail the draw that has already been written. */
  await Promise.all(firstRoundPairings(drawn).map(pairing=>
    notifyPlayers([pairing.playerId],cupDrawn(tournament.name,pairing.opponentId?name(pairing.opponentId):null,label))));

  return Response.json({ok:true,draw,drawnAt});
}
