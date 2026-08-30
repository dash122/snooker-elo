import {requireMember} from "../../../../../../db/auth";
import {cancelFormationAvailability} from "../../../../../../db/matchmaking-formation.pg";

export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}) {
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"請先登入並連結球員檔案。"},{status:403});
  return await cancelFormationAvailability(member.statePlayerId,(await params).id)
    ?Response.json({ok:true})
    :Response.json({error:"找不到這個空檔。"},{status:404});
}
