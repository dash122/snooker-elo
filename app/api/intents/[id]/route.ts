import { requireMember } from "../../../../db/auth";
import { extendIntent, withdrawIntent } from "../../../../db/intents";
import { publishAvailability } from "../../../../db/availability";

/** "+1 小時" on a live status.
 *
 *  The cheapest confirmation signal in the whole product: a member who extends has just told us,
 *  with one tap and no form, that they still mean it — which is the thing published availability can
 *  never say about itself. The extension is mirrored into `availability_slots` on the same path as
 *  every other publish, so the grid and offer targeting see the longer evening without knowing that
 *  intents exist. */
export async function PATCH(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  const {id}=await params;
  try{
    const intent=await extendIntent(member.statePlayerId,id);
    /* Null means the ceiling refused it, not that anything broke. Saying so plainly beats a 200 that
       changed nothing and leaves the member tapping a button with no effect. */
    if(!intent)return Response.json({error:"已經去到上限，唔可以再延長"},{status:409});
    if(intent.startAt&&intent.endAt)await publishAvailability(member.statePlayerId,[{startAt:intent.startAt,endAt:intent.endAt}]);
    return Response.json({intent});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Could not extend"},{status:400});}
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  const {id}=await params;
  const ok=await withdrawIntent(member.statePlayerId,id);
  return ok?Response.json({ok:true}):Response.json({error:"Intent not found"},{status:404});
}
