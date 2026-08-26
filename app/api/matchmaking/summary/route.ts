import { getCurrentMember } from "../../../../db/auth";
import { matchmakingCounts, reliabilityByPlayer } from "../../../../db/matchmaking";
import { availabilityPlayerCount, openSlotsCount } from "../../../../db/availability";
import { openCallCount } from "../../../../db/open-calls";
import { liveIntentsByPlayer, myIntent } from "../../../../db/intents";
import { dayRangeHongKong, hkDate } from "../../../../lib/availability";

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
    const [free,openCalls,openSlots]=await Promise.all([
      availabilityPlayerCount(range.startAt,range.endAt),
      openCallCount().catch(()=>0),
      /* Public like the rest of `tonight`: a visitor deciding whether to sign up should see the
         same "N 個開緊局" the nav badge shows a member, not a blank until they log in. */
      openSlotsCount().catch(()=>0),
    ]);
    const tonight={
      free,
      openCalls,
      openSlots,
    };
    if(!member?.statePlayerId)return Response.json({tonight,counts:null,reliability:{},intents:{},mine:null},{headers:{"cache-control":"no-store"}});
    const [counts,reliability,intents,mine]=await Promise.all([
      matchmakingCounts(member.statePlayerId),
      /* Sent with the summary rather than from its own endpoint so the ranking has its signals on
         first paint — a shortlist that visibly reorders a second after it appears reads as broken. */
      reliabilityByPlayer().catch(()=>({})),
      liveIntentsByPlayer().catch(()=>({})),
      myIntent(member.statePlayerId).catch(()=>null),
    ]);
    return Response.json({tonight,counts,reliability,intents,mine:mine?{id:mine.id,kind:mine.kind,expiresAt:mine.expiresAt}:null},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Summary unavailable"},{status:400});
  }
}
