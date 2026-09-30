import { markSquadSeen } from "../../../../../db/squads.pg";
import { withSquadActor } from "../../handle";

/* Dismisses the "你已被加入球隊" notice for this squad. */
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return withSquadActor(async actor=>{
    await markSquadSeen(actor,id);
    return Response.json({ok:true});
  });
}
