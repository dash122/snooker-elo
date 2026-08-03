import { requireMember } from "../../../db/auth";
import { createInvite, listInvitesFor } from "../../../db/invites";
import { notifyPlayers } from "../../../db/notifications";
import { inviteReceived } from "../../../lib/notify";
import { validateAvailabilityInterval } from "../../../lib/availability";

function body(input:unknown){
  const value=input as {toPlayerId?:unknown;startAt?:unknown;endAt?:unknown;message?:unknown;venue?:unknown};
  if(typeof value.toPlayerId!=="string"||!value.toPlayerId) throw new Error("Choose an opponent to invite");
  const interval=validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});
  const message=typeof value.message==="string"?value.message.trim().slice(0,300):"";
  const venue=typeof value.venue==="string"?value.venue.trim().slice(0,60):"";
  return {toPlayerId:value.toPlayerId,interval,message,venue};
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
    const {toPlayerId,interval,message,venue}=body(await request.json());
    const invite=await createInvite(member.statePlayerId,toPlayerId,interval,message,venue);
    /* Awaited rather than fired and forgotten: this deployment has no background worker, so a promise
       left dangling here dies the moment the serverless function returns — which is exactly the
       failure that made invites invisible in the first place. `notifyPlayers` swallows its own
       errors, so a push outage can never fail an invite that already succeeded. */
    if(invite)await notifyPlayers([toPlayerId],inviteReceived(invite.fromPlayer.name,interval,message,venue));
    return Response.json({invite},{status:201});
  }catch(error){
    const code=error&&typeof error==="object"&&"code"in error?(error as {code?:string}).code:undefined;
    if(code==="23503")return Response.json({error:"Player not found"},{status:404});
    return Response.json({error:error instanceof Error?error.message:"Invalid invite"},{status:400});
  }
}
