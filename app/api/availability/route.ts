import { requireMember } from "../../../db/auth";
import { listAvailability, listAvailabilityCounts, listOwnAvailability, publishAvailability } from "../../../db/availability";
import { announceAvailability } from "../../../db/matchmaking-actions.pg";
import { addDaysHongKong, dayRangeHongKong, mergeIntervals, validateAvailabilityInterval } from "../../../lib/availability";

function slots(body:unknown){
  const raw=(body as {slots?:unknown})?.slots;
  if(!Array.isArray(raw)||!raw.length||raw.length>24)throw new Error("Provide 1 to 24 slots");
  const parsed=raw.map(item=>{const value=item as {startAt?:unknown;endAt?:unknown};return validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});});
  return mergeIntervals(parsed);
}
/* Anchoring on Hong Kong midnight and reading the date back off the ISO string shifted the whole
   window a day earlier, so the last day of the strip never received a count. */
function weekDates(start:string,count:number){return Array.from({length:count},(_,i)=>addDaysHongKong(start,i));}
export async function GET(request:Request){
  try{const url=new URL(request.url);if(url.searchParams.get("me")!==null){const member=await requireMember();if(!member)return Response.json({error:"Sign in required"},{status:401});if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});return Response.json({slots:await listOwnAvailability(member.statePlayerId)},{headers:{"cache-control":"no-store"}});}
    /* Any player's upcoming slots are already public information — visible to anyone browsing the
       matchmaking grid for a given day — so this needs no auth, just an id to filter by. */
    const player=url.searchParams.get("player");if(player!==null)return Response.json({slots:await listOwnAvailability(player)},{headers:{"cache-control":"no-store"}});
    const week=url.searchParams.get("week");if(week!==null){const count=Math.min(31,Math.max(1,Number(url.searchParams.get("days"))||7));const days=weekDates(week,count).map(date=>({date,...dayRangeHongKong(date)}));return Response.json({counts:await listAvailabilityCounts(days)},{headers:{"cache-control":"no-store"}});}
    /* The roster's free-tonight indicator needs each member's next upcoming slot, not just
       today's — a same-day-only window silently drops anyone whose earliest slot is a future day. */
    if(url.searchParams.get("upcoming")!==null){const now=new Date().toISOString(),horizon=new Date(Date.now()+30*24*60*60*1000).toISOString();return Response.json({members:await listAvailability(now,horizon)},{headers:{"cache-control":"no-store"}});}
    const date=url.searchParams.get("date")??new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Hong_Kong"});const range=dayRangeHongKong(date);return Response.json({date,members:await listAvailability(range.startAt,range.endAt)},{headers:{"cache-control":"no-store"}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Availability unavailable"},{status:400});}}
export async function POST(request:Request){
  const member=await requireMember();if(!member)return Response.json({error:"Sign in required"},{status:401});if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{
    const intervals=slots(await request.json());
    const published=await publishAvailability(member.statePlayerId,intervals);
    /* Publishing time is now an event, not just a write: the matcher asks the best few overlapping
       opponents whether they want the game. Without this a member's slots sit on a board waiting to
       be noticed, which is the passivity the whole redesign is aimed at. */
    const {offers}=await announceAvailability(member.statePlayerId,intervals);
    return Response.json({slots:published,offers},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Invalid slot"},{status:400});}
}
