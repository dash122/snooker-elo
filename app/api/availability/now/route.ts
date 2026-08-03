import { requireMember } from "../../../../db/auth";
import { publishAvailability } from "../../../../db/availability";
import { createOpenCall } from "../../../../db/open-calls";
import { announceAvailability, announceOpenCall } from "../../../../db/matchmaking-actions.pg";
import { nowInterval, validateAvailabilityInterval } from "../../../../lib/availability";

/** One tap: "I'm free now."
 *
 *  This is the entry point for the job the app is actually asked to do most often — it is 19:40, the
 *  evening is free, and the member wants a game tonight, not a calendar. Everything the old flow made
 *  them do by hand (open the tab, paint a slot, publish, then separately post a call, then wait for
 *  someone to happen to be looking) collapses into one request: publish the time, put a table up for
 *  the club, and ask the best-matched people directly.
 *
 *  Duration is a choice rather than an assumption because "free now" means something different at
 *  19:00 than at 23:30. */
const ALLOWED_MINUTES=[60,90,120,180,240];

export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  const body=await request.json().catch(()=>({})) as {minutes?:unknown;venue?:unknown;message?:unknown;broadcast?:unknown};
  const minutes=ALLOWED_MINUTES.includes(Number(body.minutes))?Number(body.minutes):120;
  const venue=typeof body.venue==="string"?body.venue.trim().slice(0,60):"";
  const message=typeof body.message==="string"?body.message.trim().slice(0,300):"";
  let interval;
  try{ interval=validateAvailabilityInterval(nowInterval(minutes)); }
  catch{
    /* The club's playing window is 10:00–02:00, so "free now" at 04:00 is not a bug to swallow — it
       is a real answer, and it needs to say which hours it means rather than fail generically. */
    return Response.json({error:"而家唔喺開放時間內（香港時間 10:00 至翌日 02:00）。"},{status:400});
  }
  const slots=await publishAvailability(member.statePlayerId,[interval]);
  /* Three fan-outs, deliberately different in reach: an open call the whole club can see and claim,
     direct offers to the few best-matched opponents, and pushes to the members already free then. */
  const call=body.broadcast===false?null:await createOpenCall(member.statePlayerId,interval,message,venue);
  if(call)await announceOpenCall(member.statePlayerId,call.player.name,{...interval,message,venue});
  const {offers}=await announceAvailability(member.statePlayerId,[interval]);
  return Response.json({slots,call,offers,interval},{status:201});
}
