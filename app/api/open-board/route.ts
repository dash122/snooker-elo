import { after } from "next/server";
import { requireMember } from "../../../db/auth";
import { createCall, freeWindowsOn, readBoard, readCall } from "../../../db/open-board";
import { tickOpenBoard } from "../../../db/open-board-tick";
import { announceOpenCall } from "../../../db/matchmaking-actions.pg";
import { hkDate } from "../../../lib/availability";
import { parseCallInput } from "../../../lib/open-board-input";

/* Readable without signing in, like the board it renders: a 局 is a public notice by definition, and
   hiding it behind auth would defeat the point. Signing in only adds the viewer's own overlap —
   `fits`, the calendar's gold dot, and whether they are already in a 局. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request:Request){
  try{
    const member=await requireMember();
    const viewerId=member?.statePlayerId??null;
    const url=new URL(request.url);
    const requested=url.searchParams.get("date");
    const date=requested==="all"?"all":requested&&DATE.test(requested)?requested:hkDate();
    const [board,free]=await Promise.all([readBoard(viewerId,date),freeWindowsOn(date)]);
    // Start only after the read: Vinext starts after() callbacks immediately, so
    // registering earlier would compete with the board for database connections.
    after(async()=>{try{await tickOpenBoard()}catch{/* best effort reminders */}});
    return Response.json({date,signedIn:Boolean(viewerId),viewerId,...board,free},
      {headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"開局板暫時未能載入。"},{status:400});
  }
}

export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  try{
    const input=parseCallInput(await request.json());
    const id=await createCall(member.statePlayerId,input);
    const call=await readCall(id,member.statePlayerId);
    /* A 局 nobody is told about is a row in a table. The announcement targets members whose own
       published time overlaps it — the people who could actually turn up — rather than the club. */
    if(call)await announceOpenCall(member.statePlayerId,call.players[0]?.name??"球友",{
      startAt:call.startAt,endAt:call.endAt,message:call.message,
      venue:call.venue?.name??call.venueIntent,
    });
    return Response.json({call},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能開局。"},{status:400});
  }
}
