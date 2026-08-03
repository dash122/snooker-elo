import { getCurrentMember } from "../../../../db/auth";
import { matchmakingCounts, reliabilityByPlayer } from "../../../../db/matchmaking";
import { listAvailability } from "../../../../db/availability";
import { listOpenCalls } from "../../../../db/open-calls";
import { dayRangeHongKong, hkDate, isOpenCallLive } from "../../../../lib/availability";

/** The small, cheap answer to "is there anything happening?"
 *
 *  Called from the app shell rather than the matchmaking tab, because the whole point is to reach a
 *  member who is looking at the leaderboard and has no idea three people are waiting on them. Signed
 *  out it still answers the club-wide half, which is what makes the "6 位球員今晚有空" strip work for
 *  a visitor deciding whether this club is worth joining. */
export async function GET(){
  try{
    const member=await getCurrentMember();
    const today=hkDate(),range=dayRangeHongKong(today);
    const [members,calls]=await Promise.all([
      listAvailability(range.startAt,range.endAt),
      listOpenCalls().catch(()=>[]),
    ]);
    const now=Date.now();
    const tonight={
      free:members.filter(entry=>entry.slots.length>0).length,
      openCalls:calls.filter(call=>isOpenCallLive(call,now)).length,
    };
    if(!member?.statePlayerId)return Response.json({tonight,counts:null,reliability:{}},{headers:{"cache-control":"no-store"}});
    const [counts,reliability]=await Promise.all([
      matchmakingCounts(member.statePlayerId),
      /* Sent with the summary rather than from its own endpoint so the ranking has its signals on
         first paint — a shortlist that visibly reorders a second after it appears reads as broken. */
      reliabilityByPlayer().catch(()=>({})),
    ]);
    return Response.json({tonight,counts,reliability},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Summary unavailable"},{status:400});
  }
}
