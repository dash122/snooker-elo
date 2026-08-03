import { requireMember } from "../../../../db/auth";
import { cancelInvite, closeInvite, counterInvite, respondInvite } from "../../../../db/invites";
import { notifyPlayers } from "../../../../db/notifications";
import { inviteAccepted, inviteCountered, inviteDeclined } from "../../../../lib/notify";
import { validateAvailabilityInterval } from "../../../../lib/availability";

async function member(){const current=await requireMember();return current?.statePlayerId?current:null;}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const current=await member();if(!current)return Response.json({error:"A linked member account is required"},{status:403});
  const {id}=await params;
  const me=current.statePlayerId!;
  const body=await request.json() as {action?:unknown;startAt?:unknown;endAt?:unknown;venue?:unknown};
  if(body.action==="accept"||body.action==="decline"){
    const invite=await respondInvite(id,me,body.action);
    if(!invite)return Response.json({error:"Invite not found"},{status:404});
    /* Whoever did not just answer is the one who needs telling. With a counter-proposal in play that
       is not always the original sender, so both sides are read off the row rather than assumed. */
    const other=invite.fromPlayer.id===me?invite.toPlayer:invite.fromPlayer;
    const mine=invite.fromPlayer.id===me?invite.fromPlayer:invite.toPlayer;
    await notifyPlayers([other.id],body.action==="accept"
      ?inviteAccepted(mine.name,invite,invite.venue)
      :inviteDeclined(mine.name,invite));
    return Response.json({invite});
  }
  /* Counter-proposing is what gives "no" a next step: the invite stays alive and the turn passes
     back, instead of the conversation ending because 19:00 happened not to suit. */
  if(body.action==="counter"){
    let interval;
    try{ interval=validateAvailabilityInterval({startAt:String(body.startAt),endAt:String(body.endAt)}); }
    catch{ return Response.json({error:"請揀一個未開始、香港時間上午 10 時至翌日凌晨 2 時之間的時段。"},{status:400}); }
    const venue=typeof body.venue==="string"?body.venue.trim().slice(0,60):undefined;
    const invite=await counterInvite(id,me,interval,venue);
    if(!invite)return Response.json({error:"Invite not found"},{status:404});
    const other=invite.fromPlayer.id===me?invite.toPlayer:invite.fromPlayer;
    const mine=invite.fromPlayer.id===me?invite.fromPlayer:invite.toPlayer;
    await notifyPlayers([other.id],inviteCountered(mine.name,interval,invite.venue));
    return Response.json({invite});
  }
  /* The post-slot follow-up: either participant reports whether the confirmed game actually
     happened, which is what turns "they agreed to play" into a measurable outcome. */
  if(body.action==="played"||body.action==="missed"){
    const invite=await closeInvite(id,me,body.action);
    return invite?Response.json({invite}):Response.json({error:"Invite not found"},{status:404});
  }
  if(body.action==="cancel"){
    const ok=await cancelInvite(id,me);
    return ok?Response.json({ok:true}):Response.json({error:"Invite not found"},{status:404});
  }
  return Response.json({error:"Unknown action"},{status:400});
}
