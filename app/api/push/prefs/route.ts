import { requireMember } from "../../../../db/auth";
import { getPrefs, savePrefs } from "../../../../db/notifications";

const flag=(value:unknown)=>typeof value==="boolean"?value:undefined;
/* Quiet hours are whole Hong Kong hours, and `null` clears the window. Anything else is dropped
   rather than clamped — a bad value here would silently mute a member's notifications. */
const hour=(value:unknown)=>value===null?null:typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=23?value:undefined;

export async function GET(){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"A linked member account is required"},{status:403});
  return Response.json({prefs:await getPrefs(member.statePlayerId)},{headers:{"cache-control":"no-store"}});
}

export async function PATCH(request:Request){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"A linked member account is required"},{status:403});
  const body=await request.json() as Record<string,unknown>;
  const input={
    invites:flag(body.invites),openCalls:flag(body.openCalls),offers:flag(body.offers),results:flag(body.results),
    emailFallback:flag(body.emailFallback),quietFrom:hour(body.quietFrom),quietTo:hour(body.quietTo),
  };
  const clean=Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined));
  return Response.json({prefs:await savePrefs(member.statePlayerId,clean)});
}
