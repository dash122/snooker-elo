import { requireMember } from "../../../db/auth";
import { addRegular, listRegulars } from "../../../db/regulars.pg";

/* 加為常打對手 -- a one-directional star, not a follow request. GET returns the signed-in member's
   own list only; there is no way to read anyone else's, because the whole point is that nobody
   needs to consent to being starred. */

export async function GET(){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({regulars:[]},{headers:{"cache-control":"no-store"}});
  const regulars=await listRegulars(member.statePlayerId);
  return Response.json({regulars},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  try{
    const body=await request.json() as {playerId?:unknown};
    const regularId=typeof body.playerId==="string"?body.playerId.trim():"";
    if(!regularId)return Response.json({error:"缺少球員 ID。"},{status:400});
    await addRegular(member.statePlayerId,regularId);
    return Response.json({ok:true},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能加入常打對手。"},{status:400});
  }
}
