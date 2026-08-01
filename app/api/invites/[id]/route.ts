import { requireMember } from "../../../../db/auth";
import { cancelInvite, closeInvite, respondInvite } from "../../../../db/invites";

async function member(){const current=await requireMember();return current?.statePlayerId?current:null;}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const current=await member();if(!current)return Response.json({error:"A linked member account is required"},{status:403});
  const {id}=await params;
  const body=await request.json() as {action?:unknown};
  if(body.action==="accept"||body.action==="decline"){
    const invite=await respondInvite(id,current.statePlayerId!,body.action);
    return invite?Response.json({invite}):Response.json({error:"Invite not found"},{status:404});
  }
  /* The post-slot follow-up: either participant reports whether the confirmed game actually
     happened, which is what turns "they agreed to play" into a measurable outcome. */
  if(body.action==="played"||body.action==="missed"){
    const invite=await closeInvite(id,current.statePlayerId!,body.action);
    return invite?Response.json({invite}):Response.json({error:"Invite not found"},{status:404});
  }
  if(body.action==="cancel"){
    const ok=await cancelInvite(id,current.statePlayerId!);
    return ok?Response.json({ok:true}):Response.json({error:"Invite not found"},{status:404});
  }
  return Response.json({error:"Unknown action"},{status:400});
}
