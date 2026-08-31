import { requireMember } from "../../../db/auth";
import { venueDirectory } from "../../../db/venues.pg";
import { hkDate } from "../../../lib/availability";

/** 公開目錄 — every venue with tonight's overlap.
 *
 *  Readable signed out on purpose: 「今晚幾點邊度夠人」 is the thing worth signing up for, so
 *  hiding it behind a login hides the reason to sign up. */
export async function GET(request:Request){
  const date=new URL(request.url).searchParams.get("date")??hkDate();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"日期格式唔啱"},{status:400});
  try{
    const venues=await venueDirectory(date);
    if(venues===null)return Response.json({unavailable:true},{headers:{"cache-control":"no-store"}});
    const member=await requireMember();
    return Response.json({venues,date,signedIn:Boolean(member?.statePlayerId)},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"暫時載入唔到"},{status:500});
  }
}
