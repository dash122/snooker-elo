import { requireMember } from "../../../../db/auth";
import { findOrCreateVenue } from "../../../../db/open-board";

/* Any signed-in member can add a venue.
 *
 * Not admin-gated on purpose: the board is meant to work across Hong Kong, and a directory only an
 * admin can extend is a directory that never leaves the clubhouse — the member standing in a room in
 * 荃灣 is the one who knows it exists. The dedupe in `findOrCreateVenue` is what keeps that open door
 * from filling the list with near-duplicates.
 *
 * A venue is a public-facing record, so it is deliberately the only thing on this board a member can
 * create that outlives their own 局. If that turns out to need moderation, the lever is the `active`
 * flag that already exists on the table rather than a permission check here.
 *
 * Note this sits at a static path under the same segment as `[id]`; static segments win, and call
 * ids are UUIDs, so "venues" can never be mistaken for one. */
export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  try{
    const body=await request.json() as {name?:unknown;district?:unknown};
    const venue=await findOrCreateVenue(
      typeof body.name==="string"?body.name:"",
      typeof body.district==="string"?body.district:"");
    return Response.json({venue},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能新增場地。"},{status:400});
  }
}
