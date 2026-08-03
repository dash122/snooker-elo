import { requireMember } from "../../../db/auth";
import { listOffersFor } from "../../../db/offers";

export async function GET(){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  return Response.json({offers:await listOffersFor(member.statePlayerId)},{headers:{"cache-control":"no-store"}});
}
