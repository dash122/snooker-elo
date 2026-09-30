import { requireMember } from "../../../db/auth";
import { createSquad, listMySquads } from "../../../db/squads.pg";
import { getTranslator } from "../../../lib/i18n/server";
import { isVisibility, normaliseSquadName } from "../../../lib/squads";
import { noStore, readJson, trackSquad, withSquadActor } from "./handle";

/* 球隊 — GET lists the signed-in member's own squads (guests and unlinked members simply have
   none); POST creates one with the creator as its first host. */
export async function GET(){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({squads:[]},{headers:noStore});
  return Response.json({squads:await listMySquads(member.statePlayerId)},{headers:noStore});
}

export async function POST(request:Request){
  const { t } = await getTranslator();
  return withSquadActor(async actor=>{
    const body=await readJson(request);
    const name=normaliseSquadName(body.name);
    if(!name)return Response.json({error:t("球隊名稱須為 1 至 40 字。")},{status:400});
    const visibility=isVisibility(body.visibility)?body.visibility:"private";
    const id=await createSquad(actor,name,visibility);
    trackSquad(actor,"squad_created",{squadId:id,visibility});
    return Response.json({id},{status:201});
  });
}
