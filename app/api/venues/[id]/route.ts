import { requireMember } from "../../../../db/auth";
import { clearSlot, setSlot, venueDay } from "../../../../db/venues.pg";
import { hkDate } from "../../../../lib/availability";

type Ctx = { params:Promise<{id:string}> };

/** One venue, one day: the overlap curve plus who published which window. */
export async function GET(request:Request,{params}:Ctx){
  const {id}=await params;
  const date=new URL(request.url).searchParams.get("date")??hkDate();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"日期格式唔啱"},{status:400});
  try{
    const member=await requireMember();
    const day=await venueDay(id,date,member?.statePlayerId??null);
    if(day===null)return Response.json({unavailable:true},{headers:{"cache-control":"no-store"}});
    return Response.json({day,signedIn:Boolean(member?.statePlayerId)},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"暫時載入唔到"},{status:500});
  }
}

/** Publish a window. The response is the whole day, so the strip moves under the member's thumb in
    the same interaction rather than after a round trip they have to notice. */
export async function POST(request:Request,{params}:Ctx){
  const {id}=await params;
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案"},{status:403});
  let body:{startAt?:string;endAt?:string;commitment?:unknown;date?:string};
  try{body=await request.json()}catch{return Response.json({error:"請求格式唔啱"},{status:400})}
  try{
    await setSlot({
      playerId:member.statePlayerId,venueId:id,
      startAt:String(body.startAt??""),endAt:String(body.endAt??""),commitment:body.commitment,
    });
    const date=body.date&&/^\d{4}-\d{2}-\d{2}$/.test(body.date)?body.date:hkDate(new Date(String(body.startAt)));
    const day=await venueDay(id,date,member.statePlayerId);
    return Response.json({day});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"暫時儲存唔到"},{status:400});
  }
}

export async function DELETE(request:Request,{params}:Ctx){
  const {id}=await params;
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"請先登入"},{status:401});
  const date=new URL(request.url).searchParams.get("date")??hkDate();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"日期格式唔啱"},{status:400});
  await clearSlot(member.statePlayerId,id,date);
  const day=await venueDay(id,date,member.statePlayerId);
  return Response.json({day});
}
