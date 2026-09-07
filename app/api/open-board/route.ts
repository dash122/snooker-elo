import { requireMember } from "../../../db/auth";
import { createCall, freeWindowsOn, readBoard, readCall, type CreateCallInput, type Tempo } from "../../../db/open-board";
import { tickOpenBoard } from "../../../db/open-board-tick";
import { announceOpenCall } from "../../../db/matchmaking-actions.pg";
import { hkDate, validateAvailabilityInterval } from "../../../lib/availability";

/* Readable without signing in, like the board it renders: a 局 is a public notice by definition, and
   hiding it behind auth would defeat the point. Signing in only adds the viewer's own overlap —
   `fits`, the calendar's gold dot, and whether they are already in a 局. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const oneOf = <T extends string>(value:unknown,allowed:readonly T[],fallback:T):T =>
  typeof value==="string"&&(allowed as readonly string[]).includes(value)?value as T:fallback;

function parse(input:unknown):CreateCallInput {
  const value=input as Record<string,unknown>;
  const interval=validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});
  const cap=Number(value.maxPlayers);
  return {
    startAt:interval.startAt, endAt:interval.endAt,
    message:typeof value.message==="string"?value.message.trim().slice(0,300):"",
    venueId:typeof value.venueId==="string"&&value.venueId?value.venueId:null,
    venueIntent:typeof value.venueIntent==="string"?value.venueIntent.trim().slice(0,60):"",
    tempo:oneOf<Tempo>(value.tempo,["sport","casual"],"sport"),
    handicapPref:oneOf(value.handicapPref,["even","handicap"] as const,"even"),
    costSplit:oneOf(value.costSplit,["aa","host"] as const,"aa"),
    smoking:oneOf(value.smoking,["nonsmoking","any"] as const,"nonsmoking"),
    /* NULL is the default and the normal state. A cap is an unusual request — a fixed doubles
       match — not something the composer should push members towards. */
    maxPlayers:Number.isFinite(cap)&&cap>=2&&cap<=8?Math.trunc(cap):null,
  };
}

export async function GET(request:Request){
  try{
    const member=await requireMember();
    const viewerId=member?.statePlayerId??null;
    const url=new URL(request.url);
    const requested=url.searchParams.get("date");
    const date=requested&&DATE.test(requested)?requested:hkDate();
    /* No scheduler exists in this project yet, so the two time-based messages ride on whatever
       traffic the board gets. The sweep is idempotent and returns on two indexed queries when
       nothing is due, so this costs a live board nothing; adding a cron later makes it punctual
       without changing this call. Never allowed to break a read. */
    try{ await tickOpenBoard(); }catch{ /* a late reminder must not cost anyone the board */ }
    const board=await readBoard(viewerId,date);
    /* The empty state is only worth showing when it has evidence behind it: "今日未有局" alone is a
       dead end, but "這幾位曾說過今日得閒" is a reason to open one. Skipped entirely when the day
       already has 局, so the common path pays nothing for it. */
    const free=board.calls.length?[]:await freeWindowsOn(date);
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
    const input=parse(await request.json());
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
