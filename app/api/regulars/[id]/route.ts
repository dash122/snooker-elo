import { requireMember } from "../../../../db/auth";
import { removeRegular } from "../../../../db/regulars.pg";

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member)return Response.json({error:"請先登入。"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"請先連結球員檔案。"},{status:403});
  const {id}=await params;
  try{
    await removeRegular(member.statePlayerId,id);
    return Response.json({ok:true});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"未能移除。"},{status:400});
  }
}
