import { requireMember } from "../../../../db/auth";
import { isWatching, unwatchPlayer, watchPlayer } from "../../../../db/slot-hands";

/** 「佢開局通知我」 — a one-way subscription to hear when someone posts, never a mutual match. */

function targetId(body:unknown):string|null {
  const value=body as {targetId?:unknown};
  return typeof value.targetId==="string"&&value.targetId?value.targetId:null;
}

export async function POST(request:Request){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"Sign in required"},{status:401});
  const target=targetId(await request.json());
  if(!target)return Response.json({error:"Choose who to watch"},{status:400});
  await watchPlayer(member.statePlayerId,target);
  return Response.json({watching:true});
}

export async function DELETE(request:Request){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"Sign in required"},{status:401});
  const url=new URL(request.url);
  const target=url.searchParams.get("targetId");
  if(!target)return Response.json({error:"Choose who to stop watching"},{status:400});
  await unwatchPlayer(member.statePlayerId,target);
  return Response.json({watching:false});
}

export async function GET(request:Request){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({watching:false});
  const url=new URL(request.url);
  const target=url.searchParams.get("targetId");
  if(!target)return Response.json({error:"Missing targetId"},{status:400});
  return Response.json({watching:await isWatching(member.statePlayerId,target)});
}
