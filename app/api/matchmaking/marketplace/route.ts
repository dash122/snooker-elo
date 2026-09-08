import {after} from "next/server";
import {requireMember} from "../../../../db/auth";
import {marketplaceDatabase,isMarketplaceReady,deliverMarketplaceNotifications} from "../../../../db/matchmaking-marketplace.pg";
import {marketplaceDashboard,MarketplaceError,marketplaceWrite,type MarketAction} from "../../../../db/matchmaking-marketplace-store";
import {recordEvents} from "../../../../db/analytics";
import {hkDate} from "../../../../lib/availability";

const headers={"cache-control":"no-store"};
function failure(error:unknown){
  if(error instanceof MarketplaceError)return Response.json({error:error.message},{status:error.status,headers});
  console.error("Marketplace request failed",error instanceof Error?error.name:"unknown");
  return Response.json({error:"約戰暫時未能更新，請重新載入後再試。"},{status:500,headers});
}
export async function GET(request:Request){
  try{
    if(!await isMarketplaceReady())return Response.json({ready:false},{headers});
    const member=await requireMember();
    const dashboard=await marketplaceDashboard(marketplaceDatabase(),member?.statePlayerId??null,Boolean(member),new URL(request.url).searchParams.get("date")??hkDate());
    after(async()=>{try{await deliverMarketplaceNotifications();}catch{/* Later traffic retries queued work. */}});
    return Response.json(dashboard,{headers});
  }catch(error){return failure(error);}
}
const actions:MarketAction[]=["publish","edit","activate","withdraw","create","join","leave","invite","accept","decline","avoid","unavoid","result"];
export async function POST(request:Request){
  try{
    const member=await requireMember();
    if(!member)return Response.json({error:"請先登入。"},{status:401,headers});
    if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403,headers});
    if(!await isMarketplaceReady())return Response.json({error:"新版約戰尚未啟用。"},{status:503,headers});
    let body:Record<string,unknown>;
    try{const raw=await request.json();if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error();body=raw;}
    catch{return Response.json({error:"請提交有效約戰資料。"},{status:400,headers});}
    if(!actions.includes(body.action as MarketAction))return Response.json({error:"無效操作。"},{status:400,headers});
    const action=body.action as MarketAction;
    let result;
    try{result=await marketplaceWrite(marketplaceDatabase(),member.statePlayerId,action,body);}
    catch(error){if(error instanceof MarketplaceError)throw error;if(error instanceof Error&&!("code" in error))return Response.json({error:error.message},{status:400,headers});throw error;}
    after(async()=>{
      try{await recordEvents(member.statePlayerId!,[{event:`matchmaking_marketplace_${action}`,props:{id:"id" in result?result.id:null},at:new Date().toISOString()},...result.events.map(event=>({...event,at:new Date().toISOString()}))]);}catch{/* Best effort analytics. */}
      try{await deliverMarketplaceNotifications();}catch{/* Consent was already committed. */}
    });
    return Response.json({id:"id" in result?result.id:undefined,ok:true},{headers});
  }catch(error){return failure(error);}
}
