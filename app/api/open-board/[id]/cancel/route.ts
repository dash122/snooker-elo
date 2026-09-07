import { requireMember } from "../../../../../db/auth";
import { cancelCall, readCall } from "../../../../../db/open-board";
import { notifyPlayers } from "../../../../../db/notifications";
import { callCancelled } from "../../../../../lib/notify";

/* A separate endpoint from DELETE rather than an overload of it: DELETE on this resource already
   means 我去不到 -- one member stepping out, which a solo host sending it also cancels as a side
   effect of leaving last. Cancelling on purpose, with joiners still in, is a different act with a
   different audience (everyone else gets told) and a different owner (host only), so it gets its
   own route instead of a flag smuggled onto the existing one. */
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  const {id}=await params;
  try{
    const existing=await readCall(id,member.statePlayerId);
    const result=await cancelCall(id,member.statePlayerId);
    if(!result.ok)return Response.json(
      {error:result.reason==="forbidden"?"只有開局者可以取消。":"這個局已經結束或取消了。"},
      {status:result.reason==="forbidden"?403:409});
    if(existing&&result.notify?.length)
      await notifyPlayers(result.notify,
        callCancelled({startAt:existing.startAt,endAt:existing.endAt},existing.venue?.name??existing.venueIntent));
    return Response.json({ok:true});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能取消。"},{status:400});
  }
}
