import {requireMember} from "../../../../../db/auth";
import {requestFormationSession} from "../../../../../db/matchmaking-formation.pg";
import {notifyPlayers} from "../../../../../db/notifications";
import {gameRequestReceived} from "../../../../../lib/notify";

export async function POST(request:Request) {
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"請先登入並連結球員檔案。"},{status:403});
  try{
    const body=await request.json() as {anchorSlotId?:unknown;startAt?:unknown;endAt?:unknown};
    const result=await requestFormationSession(member.statePlayerId,{anchorSlotId:String(body.anchorSlotId??""),startAt:String(body.startAt??""),endAt:String(body.endAt??"")});
    await notifyPlayers([result.hostPlayerId],gameRequestReceived(member.displayName??"球友",{startAt:result.startAt,endAt:result.endAt},result.venue));
    return Response.json({sessionId:result.sessionId},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能送出加入申請。"},{status:400});
  }
}
