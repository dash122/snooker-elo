import { requireMember } from "../../../../db/auth";
import { joinCall, leaveCall, readCall } from "../../../../db/open-board";
import { notifyPlayers } from "../../../../db/notifications";
import { gameFormed } from "../../../../lib/notify";

/* 加入 and 我去不到 — the only two things a member does to a 局 after it exists.
 *
 * Neither needs approval from anybody. Joining is first come, first served; leaving is immediate and
 * leaves no record. The whole design rests on leaving being cheaper than ghosting. */

const failure = {
  gone:"這個局已經結束或取消了。",
  full:"這個局已經滿了。",
  already:"你已經在這個局內。",
} as const;

export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  const {id}=await params;
  try{
    const result=await joinCall(id,member.statePlayerId);
    if(!result.ok)return Response.json({error:failure[result.reason]},{status:409});
    const call=await readCall(id,member.statePlayerId);
    /* Sent on the 1→2 transition only. Every later join makes the evening more robust but is not
       news — telling four people every time a fifth appears is how a useful app becomes a muted one. */
    if(result.filled&&call){
      await notifyPlayers(call.players.map(player=>player.id),
        gameFormed(call.players.map(player=>player.name),
          {startAt:call.startAt,endAt:call.endAt},call.venue?.name??call.venueIntent));
    }
    return Response.json({call});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能加入。"},{status:400});
  }
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  const {id}=await params;
  try{
    const result=await leaveCall(id,member.statePlayerId);
    if(!result.ok)return Response.json({error:"你不在這個局內。"},{status:409});
    /* Nobody is told that a particular person left. The 局 simply reads 等多 1 人 again and goes back
       to the top of the day's list, which is the information the club actually needs. */
    return Response.json({remaining:result.remaining,dropped:result.dropped});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能退出。"},{status:400});
  }
}
