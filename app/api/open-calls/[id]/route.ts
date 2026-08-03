import { requireMember } from "../../../../db/auth";
import { cancelOpenCall, claimOpenCall } from "../../../../db/open-calls";
import { notifyPlayers } from "../../../../db/notifications";
import { inviteAccepted } from "../../../../lib/notify";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const current=await requireMember();
  if(!current?.statePlayerId)return Response.json({error:"A linked member account is required"},{status:403});
  const {id}=await params;
  const body=await request.json() as {action?:unknown};
  if(body.action==="claim"){
    const call=await claimOpenCall(id,current.statePlayerId);
    /* A claim that matches no row means somebody else got there first (or the slot has since
       started) — not a missing record, so say so in the words the member needs to hear. */
    if(!call)return Response.json({error:"這個開放邀請已經被人接受或已過期"},{status:409});
    /* The member who put the table up is the one who has been waiting to hear. Reusing the
       invite-accepted wording is accurate rather than lazy: claiming a call *is* accepting an
       offer to play, and it produces the same confirmed fixture. */
    await notifyPlayers([call.player.id],inviteAccepted(call.claimedBy?.name??"有人",call,call.venue));
    return Response.json({call});
  }
  if(body.action==="cancel"){
    const ok=await cancelOpenCall(id,current.statePlayerId);
    return ok?Response.json({ok:true}):Response.json({error:"Open call not found"},{status:404});
  }
  return Response.json({error:"Unknown action"},{status:400});
}
