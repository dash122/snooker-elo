import { requireMember } from "../../../db/auth";
import { arriveAtClub, leaveClub, myPresence } from "../../../db/presence.pg";

/** 我而家喺會所 / 收工.
 *
 *  Deliberately not folded into the intent routes. Being at the club and wanting a game are separate
 *  facts with separate clocks — a member can be there watching, or want a game from home — and the
 *  moment they are stored as one flag, leaving the club silently withdraws you from matchmaking and
 *  ending a search silently claims you went home. */

export async function GET(){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({presence:null},{headers:{"cache-control":"no-store"}});
  const presence=await myPresence(member.statePlayerId);
  return Response.json({presence},{headers:{"cache-control":"no-store"}});
}

export async function POST(){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{
    const presence=await arriveAtClub(member.statePlayerId);
    return Response.json({presence},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Could not update presence"},{status:400});}
}

export async function DELETE(){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  await leaveClub(member.statePlayerId);
  return Response.json({ok:true});
}
