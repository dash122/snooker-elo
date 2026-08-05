import { requireMember } from "../../../../db/auth";
import { withdrawIntent } from "../../../../db/intents";

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  const {id}=await params;
  const ok=await withdrawIntent(member.statePlayerId,id);
  return ok?Response.json({ok:true}):Response.json({error:"Intent not found"},{status:404});
}
