import { requireMember } from "../../../db/auth";
import { nightBoard, setAttendance, clearAttendance } from "../../../db/nights.pg";

/** 場次 — the next few evenings, each with a forecast.
 *
 *  Readable signed out. 「今晚有無人」 is the question that decides whether somebody bothers making
 *  an account at all, so answering it behind a login would hide the only thing worth signing up
 *  for. Only the viewer's own row needs a member, and it is simply absent without one. */
export async function GET(request:Request){
  const days=Number(new URL(request.url).searchParams.get("days")??7);
  const member=await requireMember();
  try{
    const board=await nightBoard(Number.isFinite(days)?days:7,member?.statePlayerId??null);
    /* `null` means the nights migration has not reached this database yet. Reported as its own state so
       the client can render nothing, rather than an error banner or a board claiming an empty
       night — see `isMissingSchema`. */
    if(board===null)return Response.json({unavailable:true},{headers:{"cache-control":"no-store"}});
    return Response.json({board,signedIn:Boolean(member?.statePlayerId)},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"場次資料暫時未能載入"},{status:500});
  }
}

/** One tap: my confidence for one night, plus an optional 夠人就去 threshold.
 *
 *  The response carries the whole board rather than an acknowledgement. The payback for tapping has
 *  to be immediate and visible — a member who taps 睇下先 and gets a spinner and a toast has been
 *  given nothing, and that is precisely the experience that trained people to stop publishing
 *  availability in the first place. */
export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案"},{status:403});
  let body:{date?:string;confidence?:unknown;upgradeAt?:unknown};
  try{body=await request.json()}catch{return Response.json({error:"請求格式唔啱"},{status:400})}
  try{
    const {promoted}=await setAttendance({
      playerId:member.statePlayerId,
      date:String(body.date??""),
      confidence:body.confidence,
      upgradeAt:body.upgradeAt,
    });
    const board=await nightBoard(7,member.statePlayerId);
    return Response.json({board:board??[],promoted,youWerePromoted:promoted.includes(member.statePlayerId)});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"暫時儲存唔到"},{status:400});
  }
}

/** Withdraw the signal entirely. Distinct from 唔得, which is an answer the forecast uses. */
export async function DELETE(request:Request){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"請先登入"},{status:401});
  const date=new URL(request.url).searchParams.get("date")??"";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"日期格式唔啱"},{status:400});
  await clearAttendance(member.statePlayerId,date);
  const board=await nightBoard(7,member.statePlayerId);
  return Response.json({board:board??[]});
}
