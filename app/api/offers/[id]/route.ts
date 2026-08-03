import { requireMember } from "../../../../db/auth";
import { respondOffer } from "../../../../db/offers";
import { announceOfferMatch } from "../../../../db/matchmaking-actions.pg";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const current=await requireMember();
  if(!current?.statePlayerId)return Response.json({error:"A linked member account is required"},{status:403});
  const {id}=await params;
  const body=await request.json() as {answer?:unknown};
  if(body.answer!=="yes"&&body.answer!=="no")return Response.json({error:"Unknown answer"},{status:400});
  const outcome=await respondOffer(id,current.statePlayerId,body.answer);
  if(!outcome.opponentId)return Response.json({error:"這個配對已經完結"},{status:409});
  /* Only a mutual yes produces a notification. Saying no is silent by design — that silence is what
     makes declining free, and it is the reason a member can answer honestly instead of politely. */
  if(outcome.matched&&outcome.startAt&&outcome.endAt)
    await announceOfferMatch(current.statePlayerId,outcome.opponentId,{startAt:outcome.startAt,endAt:outcome.endAt},outcome.offer?.venue);
  return Response.json({matched:outcome.matched,offer:outcome.offer});
}
