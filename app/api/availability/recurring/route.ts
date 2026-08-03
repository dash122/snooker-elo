import { requireMember } from "../../../../db/auth";
import { publishAvailability } from "../../../../db/availability";
import { copyPreviousWeek, createRecurrence, deleteRecurrence, listRecurrence } from "../../../../db/recurrence";
import { announceAvailability } from "../../../../db/matchmaking-actions.pg";

async function player(){const member=await requireMember();return member?.statePlayerId??null;}

export async function GET(){
  const playerId=await player();
  if(!playerId)return Response.json({error:"A linked member account is required"},{status:403});
  return Response.json({rules:await listRecurrence(playerId)},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const playerId=await player();
  if(!playerId)return Response.json({error:"A linked member account is required"},{status:403});
  const body=await request.json() as {action?:unknown;weekday?:unknown;startTime?:unknown;endTime?:unknown};
  /* "Same as last week" is not a recurrence rule — it is a one-off copy, and members reach for it in
     the same breath ("just do what I did last week"), so it lives on the same endpoint rather than
     forcing them to understand the distinction. */
  if(body.action==="copyLastWeek"){
    const slots=await copyPreviousWeek(playerId);
    if(!slots.length)return Response.json({error:"上星期未有公開過時段，冇嘢可以複製。"},{status:400});
    const published=await publishAvailability(playerId,slots);
    await announceAvailability(playerId,slots);
    return Response.json({slots:published,copied:slots.length},{status:201});
  }
  const weekday=Number(body.weekday);
  if(!Number.isInteger(weekday)||weekday<0||weekday>6)return Response.json({error:"Invalid weekday"},{status:400});
  if(typeof body.startTime!=="string"||typeof body.endTime!=="string"||!/^\d{2}:\d{2}$/.test(body.startTime)||!/^\d{2}:\d{2}$/.test(body.endTime))
    return Response.json({error:"Invalid time"},{status:400});
  try{
    const rule=await createRecurrence(playerId,{weekday,startTime:body.startTime,endTime:body.endTime});
    return Response.json({rule},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Invalid rule"},{status:400});
  }
}

export async function DELETE(request:Request){
  const playerId=await player();
  if(!playerId)return Response.json({error:"A linked member account is required"},{status:403});
  const body=await request.json().catch(()=>({})) as {id?:unknown};
  if(typeof body.id!=="string")return Response.json({error:"Invalid rule"},{status:400});
  const ok=await deleteRecurrence(body.id,playerId);
  return ok?Response.json({ok:true}):Response.json({error:"Rule not found"},{status:404});
}
