import { requireMember } from "../../../../db/auth";
import { removeSubscription, saveSubscription } from "../../../../db/notifications";

export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  const body=await request.json() as {endpoint?:unknown;p256dh?:unknown;auth?:unknown};
  if(typeof body.endpoint!=="string"||typeof body.p256dh!=="string"||typeof body.auth!=="string")
    return Response.json({error:"Invalid subscription"},{status:400});
  /* Only ever accept an https endpoint from a push service — the endpoint is a URL this server will
     later POST to, so an unvalidated one turns the notification fan-out into a request forwarder. */
  if(!/^https:\/\//.test(body.endpoint))return Response.json({error:"Invalid subscription"},{status:400});
  await saveSubscription(member.statePlayerId,{endpoint:body.endpoint,p256dh:body.p256dh,auth:body.auth},request.headers.get("user-agent")??"");
  return Response.json({ok:true},{status:201});
}

export async function DELETE(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  const body=await request.json().catch(()=>({})) as {endpoint?:unknown};
  if(typeof body.endpoint!=="string")return Response.json({error:"Invalid subscription"},{status:400});
  await removeSubscription(body.endpoint);
  return Response.json({ok:true});
}
