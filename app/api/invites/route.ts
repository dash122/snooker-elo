import { requireMember } from "../../../db/auth";
import { createInvite, listInvitesFor } from "../../../db/invites";
import { validateAvailabilityInterval } from "../../../lib/availability";

function body(input:unknown){
  const value=input as {toPlayerId?:unknown;startAt?:unknown;endAt?:unknown;message?:unknown};
  if(typeof value.toPlayerId!=="string"||!value.toPlayerId) throw new Error("Choose an opponent to invite");
  const interval=validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});
  const message=typeof value.message==="string"?value.message.trim().slice(0,300):"";
  return {toPlayerId:value.toPlayerId,interval,message};
}

export async function GET(){
  const member=await requireMember();if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  return Response.json(await listInvitesFor(member.statePlayerId),{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const member=await requireMember();if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{
    const {toPlayerId,interval,message}=body(await request.json());
    const invite=await createInvite(member.statePlayerId,toPlayerId,interval,message);
    return Response.json({invite},{status:201});
  }catch(error){
    const code=error&&typeof error==="object"&&"code"in error?(error as {code?:string}).code:undefined;
    if(code==="23503")return Response.json({error:"Player not found"},{status:404});
    return Response.json({error:error instanceof Error?error.message:"Invalid invite"},{status:400});
  }
}
