import { requireMember } from "../../../db/auth";
import { listAvailability, listOwnAvailability, publishAvailability } from "../../../db/availability";
import { dayRangeHongKong, mergeIntervals } from "../../../lib/availability";

function slots(body:unknown){
  const raw=(body as {slots?:unknown})?.slots;
  if(!Array.isArray(raw)||!raw.length||raw.length>24)throw new Error("Provide 1 to 24 slots");
  const now=Date.now();
  const parsed=raw.map(item=>{const value=item as {startAt?:unknown;endAt?:unknown};const startAt=new Date(String(value.startAt));const endAt=new Date(String(value.endAt));if(!Number.isFinite(startAt.getTime())||!Number.isFinite(endAt.getTime())||endAt<=startAt||endAt.getTime()<=now)throw new Error("Slots must have a future end time");return {startAt:startAt.toISOString(),endAt:endAt.toISOString()};});
  return mergeIntervals(parsed);
}
export async function GET(request:Request){
  try{const url=new URL(request.url);if(url.searchParams.get("me")!==null){const member=await requireMember();if(!member)return Response.json({error:"Sign in required"},{status:401});if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});return Response.json({slots:await listOwnAvailability(member.statePlayerId)},{headers:{"cache-control":"no-store"}});}
    const date=url.searchParams.get("date")??new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Hong_Kong"});const range=dayRangeHongKong(date);return Response.json({date,members:await listAvailability(range.startAt,range.endAt)},{headers:{"cache-control":"no-store"}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Availability unavailable"},{status:400});}}
export async function POST(request:Request){
  const member=await requireMember();if(!member)return Response.json({error:"Sign in required"},{status:401});if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{return Response.json({slots:await publishAvailability(member.statePlayerId,slots(await request.json()))},{status:201});}catch(error){return Response.json({error:error instanceof Error?error.message:"Invalid slot"},{status:400});}
}
