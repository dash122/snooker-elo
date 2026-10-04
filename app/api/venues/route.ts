import { requireMember } from "../../../db/auth";
import { createVenue, venueDirectory } from "../../../db/venues.pg";
import { hkDate } from "../../../lib/availability";
import { getTranslator } from "../../../lib/i18n/server";

/** 公開目錄 — every venue with tonight's overlap.
 *
 *  Readable signed out on purpose: 「今晚幾點邊度夠人」 is the thing worth signing up for, so
 *  hiding it behind a login hides the reason to sign up. */
export async function GET(request:Request){
  const { t } = await getTranslator();
  const date=new URL(request.url).searchParams.get("date")??hkDate();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:t("日期格式唔啱")},{status:400});
  try{
    const venues=await venueDirectory(date);
    if(venues===null)return Response.json({unavailable:true},{headers:{"cache-control":"no-store"}});
    const member=await requireMember();
    return Response.json({venues,date,signedIn:Boolean(member?.statePlayerId)},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?(await getTranslator()).t(error.message):t("暫時載入唔到")},{status:500});
  }
}

/** A signed-in member adds a venue; it joins the shared list for everyone. */
export async function POST(request:Request){
  const { t } = await getTranslator();
  const member=await requireMember();
  if(!member)return Response.json({error:t("請先登入")},{status:401});
  let body:{name?:unknown;district?:unknown};
  try{body=await request.json()}catch{return Response.json({error:t("請求格式唔啱")},{status:400})}
  try{
    const result=await createVenue({name:String(body.name??""),district:String(body.district??"")});
    return Response.json(result);
  }catch(error){
    return Response.json({error:error instanceof Error?(await getTranslator()).t(error.message):t("暫時儲存唔到")},{status:400});
  }
}
