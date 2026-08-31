import {requireMember} from "../../../../../../db/auth";
import {leaveFormationSession, respondFormationRequest} from "../../../../../../db/matchmaking-formation.pg";
import {notifyPlayers} from "../../../../../../db/notifications";
import {gameRequestAccepted, gameRequestUnavailable} from "../../../../../../lib/notify";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"請先登入並連結球員檔案。"},{status:403});
  try{
    const body=await request.json() as {action?:unknown;playerId?:unknown};
    if(body.action!=="accept"&&body.action!=="decline")throw new Error("無效的處理方式。");
    const result=await respondFormationRequest(member.statePlayerId,(await params).id,String(body.playerId??""),body.action);
    const slot={startAt:result.startAt,endAt:result.endAt};
    if(body.action==="accept")await notifyPlayers([result.requesterId],gameRequestAccepted(result.hostName,slot,result.venue));
    else await notifyPlayers([result.requesterId],gameRequestUnavailable(slot));
    return Response.json({status:result.status});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能處理申請。"},{status:400});
  }
}

export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}) {
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"請先登入並連結球員檔案。"},{status:403});
  return await leaveFormationSession(member.statePlayerId,(await params).id)
    ?Response.json({ok:true})
    :Response.json({error:"找不到可退出的場次。"},{status:404});
}
