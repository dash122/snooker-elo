import {requireMember} from "../../../../db/auth";
import {formationDashboard, publishFormationAvailability} from "../../../../db/matchmaking-formation.pg";
import {addDaysHongKong, composeAvailabilityInterval, hkDate, validateAvailabilityInterval} from "../../../../lib/availability";

function publication(body:unknown) {
  const input=body as {dates?:unknown;start?:unknown;end?:unknown;venueId?:unknown};
  if(!Array.isArray(input.dates)||input.dates.length<1||input.dates.length>7)throw new Error("請選擇一至七日。");
  const today=hkDate(),last=addDaysHongKong(today,6);
  const dates=[...new Set(input.dates.map(String))];
  if(dates.some(date=>date<today||date>last))throw new Error("只可以公開未來七日的空檔。");
  const start=String(input.start??""),end=String(input.end??"");
  const venueId=typeof input.venueId==="string"&&input.venueId.trim()?input.venueId.trim():null;
  return dates.map(date=>{
    const interval=validateAvailabilityInterval(composeAvailabilityInterval(date,start,end));
    if(Date.parse(interval.endAt)-Date.parse(interval.startAt)<60*60_000)throw new Error("空檔最少需要一小時。");
    /* Option A is a one-to-one game. Keep target_size in storage for backwards compatibility, but
       never make the member choose a group size in the MVP. */
    return {...interval,targetSize:2,venueId};
  });
}

export async function GET() {
  try{
    const member=await requireMember();
    return Response.json(await formationDashboard(member?.statePlayerId),{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"約戰資料暫時未能載入。"},{status:500});
  }
}

export async function POST(request:Request) {
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  try{
    await publishFormationAvailability(member.statePlayerId,publication(await request.json()));
    return Response.json(await formationDashboard(member.statePlayerId),{status:201,headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能公開空檔。"},{status:400});
  }
}
