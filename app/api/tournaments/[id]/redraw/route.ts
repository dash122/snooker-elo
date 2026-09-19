import { requireMember } from "../../../../../db/auth";
import { notifyPlayers } from "../../../../../db/notifications";
import { getState, putState } from "../../../../../db/state";
import { cupRedrawn, cupWithdrawn } from "../../../../../lib/notify";
import { addEntrant, bracketShape, buildBracket, canManageTournament, firstRoundPairings, removeEntrant, reorderDraw, roundLabel, shuffleDraw, swapPlayer, type TournamentLike } from "../../../../../lib/tournament";

/** Reshuffling, dragging one name onto another, swapping in a reserve, and adding or dropping an
 *  entrant outright are all edits to a draw that has already been announced — except for a completed
 *  cup's presentation-only roster order — so they go through a server job under the state lock
 *  rather than a client computing the new draw and PUTting it straight into `/api/state`. Any live
 *  pairing change also notifies entrants whose first tie moved. */

type State = { players?:{id:string;name:string}[]; tournaments?:TournamentLike[]; matches?:unknown[]; audits?:{id:string;text:string;at:string}[] };
type Body =
  | {action:"shuffle"}
  | {action:"reorder";draggedId:string;targetId:string}
  | {action:"swap";outgoingId:string;incomingId:string}
  | {action:"add";playerId:string}
  | {action:"remove";playerId:string};

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  const {id}=await params;
  let body:Body;
  try{ body=await request.json(); }catch{ return Response.json({error:"Invalid request"},{status:400}); }

  const raw=await getState();
  if(!raw)return Response.json({error:"No tournament state"},{status:404});
  let state:State;
  try{ state=JSON.parse(raw) as State; }catch{ return Response.json({error:"Invalid state"},{status:500}); }
  const tournament=(state.tournaments??[]).find(item=>item.id===id);
  if(!tournament)return Response.json({error:"Tournament not found"},{status:404});
  if(!canManageTournament(tournament,member.statePlayerId,member.role==="admin"))return Response.json({error:"只有盃賽主持人或協辦主持人可以更新籤表"},{status:403});
  const matches=((state.matches??[]) as Parameters<typeof shuffleDraw>[1])??[];

  const name=(playerId:string)=>(state.players??[]).find(player=>player.id===playerId)?.name??"";
  const playerName=(playerId:string)=>name(playerId)||"該球員";

  const before=firstRoundPairings(tournament);
  const result=
    body.action==="shuffle"?shuffleDraw(tournament,matches)
    :body.action==="reorder"?reorderDraw(tournament,body.draggedId,body.targetId,matches)
    :body.action==="swap"?swapPlayer(tournament,body.outgoingId,body.incomingId,matches)
    :body.action==="add"?addEntrant(tournament,body.playerId,matches)
    :body.action==="remove"?removeEntrant(tournament,body.playerId,matches)
    :{ok:false as const,error:"Unknown action"};
  if(!result.ok)return Response.json({error:result.error},{status:409});
  const updated=result.tournament;
  const rosterOnlyReorder=body.action==="reorder"&&Boolean(buildBracket(tournament,matches).champion);

  const auditText=
    body.action==="shuffle"?`重新抽籤：${tournament.name}`
    :body.action==="reorder"?`調整籤表順序：${tournament.name}`
    :body.action==="add"?`加入參賽球員：${tournament.name} — ${playerName(body.playerId)}`
    :body.action==="remove"?`移除參賽球員：${tournament.name} — ${playerName(body.playerId)}`
    :`更換參賽球員：${tournament.name}`;
  const next={
    ...state,
    tournaments:(state.tournaments??[]).map(item=>item.id===id?updated:item),
    audits:[{id:crypto.randomUUID(),text:auditText,at:new Date().toISOString()},...(state.audits??[])],
  };
  await putState(JSON.stringify(next));

  const after=firstRoundPairings(updated);
  /* Adding or dropping an entrant changes the field size, so the round-one label has to come from
     the bracket as it now stands rather than the one the members were last told about. */
  const {rounds}=bracketShape(Math.max(before.length,after.length));
  const label=roundLabel(1,rounds);
  const beforeOpponent=new Map(before.map(entry=>[entry.playerId,entry.opponentId]));
  /* Only players whose own tie actually moved get told again — the rest already know who they are
     playing and a reshuffle that happened to leave their box untouched is not news to them. */
  const changed=rosterOnlyReorder?[]:after.filter(entry=>beforeOpponent.get(entry.playerId)!==entry.opponentId);
  await Promise.all(changed.map(pairing=>
    notifyPlayers([pairing.playerId],cupRedrawn(tournament.name,pairing.opponentId?name(pairing.opponentId):null,label))));
  /* The dropped player has no tie left to quote, so the redraw message above skips them entirely —
     they still need telling that they are out. */
  if(body.action==="remove"&&before.some(entry=>entry.playerId===body.playerId))
    await notifyPlayers([body.playerId],cupWithdrawn(tournament.name));

  return Response.json({ok:true,tournament:updated});
}
