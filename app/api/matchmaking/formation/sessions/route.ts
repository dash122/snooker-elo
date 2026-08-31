import {requireMember} from "../../../../../db/auth";
import {requestFormationSession} from "../../../../../db/matchmaking-formation.pg";

export async function POST(request:Request) {
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"請先登入並連結球員檔案。"},{status:403});
  try{
    const body=await request.json() as {anchorSlotId?:unknown;startAt?:unknown;endAt?:unknown};
    const sessionId=await requestFormationSession(member.statePlayerId,{anchorSlotId:String(body.anchorSlotId??""),startAt:String(body.startAt??""),endAt:String(body.endAt??"")});
    return Response.json({sessionId},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能送出加入申請。"},{status:400});
  }
}
