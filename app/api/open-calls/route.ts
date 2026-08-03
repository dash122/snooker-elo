import { requireMember } from "../../../db/auth";
import { createOpenCall, listOpenCalls } from "../../../db/open-calls";
import { announceOpenCall } from "../../../db/matchmaking-actions.pg";
import { validateAvailabilityInterval } from "../../../lib/availability";

function body(input:unknown){
  const value=input as {startAt?:unknown;endAt?:unknown;message?:unknown;venue?:unknown};
  const interval=validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});
  const message=typeof value.message==="string"?value.message.trim().slice(0,300):"";
  const venue=typeof value.venue==="string"?value.venue.trim().slice(0,60):"";
  return {interval,message,venue};
}

/* Readable without signing in, like the availability grid it sits beside — an open call is a public
   notice by definition, and hiding it behind auth would defeat the point of broadcasting it. */
export async function GET(){
  try{
    return Response.json({calls:await listOpenCalls()},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Open calls unavailable"},{status:400});
  }
}

export async function POST(request:Request){
  const member=await requireMember();if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{
    const {interval,message,venue}=body(await request.json());
    const call=await createOpenCall(member.statePlayerId,interval,message,venue);
    /* An open call nobody is told about is just a row in a table. The announcement targets members
       whose own published time overlaps it, so the push reaches people who could actually walk in
       and take the table rather than the whole club. */
    if(call)await announceOpenCall(member.statePlayerId,call.player.name,{...interval,message,venue});
    return Response.json({call},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Invalid open call"},{status:400});
  }
}
