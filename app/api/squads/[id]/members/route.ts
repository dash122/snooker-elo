import { addSquadMember, getSquad, removeSquadMember, setSquadRole } from "../../../../../db/squads.pg";
import { getTranslator } from "../../../../../lib/i18n/server";
import { isRole } from "../../../../../lib/squads";
import { readJson, trackSquad, withSquadActor } from "../../handle";

type Params={params:Promise<{id:string}>};
const playerIdOf=(value:unknown)=>typeof value==="string"?value.trim():"";

/* POST {playerId}: a host adds a member directly. */
export async function POST(request:Request,{params}:Params){
  const { t } = await getTranslator();
  const {id}=await params;
  return withSquadActor(async actor=>{
    const playerId=playerIdOf((await readJson(request)).playerId);
    if(!playerId)return Response.json({error:t("缺少球員 ID。")},{status:400});
    /* Attributed to the player who was added, so "joined" counts people, whichever way they came in. */
    if(await addSquadMember(actor,id,playerId))trackSquad(playerId,"squad_joined",{squadId:id,source:"host_add",addedBy:actor});
    return Response.json({squad:await getSquad(actor,id)},{status:201});
  });
}

/* PATCH {playerId, role}: a host promotes or demotes anyone, other hosts included. */
export async function PATCH(request:Request,{params}:Params){
  const { t } = await getTranslator();
  const {id}=await params;
  return withSquadActor(async actor=>{
    const body=await readJson(request);
    const playerId=playerIdOf(body.playerId);
    if(!playerId||!isRole(body.role))return Response.json({error:t("缺少球員 ID。")},{status:400});
    await setSquadRole(actor,id,playerId,body.role);
    return Response.json({squad:await getSquad(actor,id)});
  });
}

/* DELETE ?playerId=: your own id leaves; anyone else's is a host removing them. */
export async function DELETE(request:Request,{params}:Params){
  const { t } = await getTranslator();
  const {id}=await params;
  return withSquadActor(async actor=>{
    const playerId=playerIdOf(new URL(request.url).searchParams.get("playerId"));
    if(!playerId)return Response.json({error:t("缺少球員 ID。")},{status:400});
    const outcome=await removeSquadMember(actor,id,playerId);
    if(outcome==="removed")trackSquad(actor,"squad_member_removed",{squadId:id,playerId});
    else trackSquad(actor,"squad_left",{squadId:id,dissolved:outcome==="dissolved"});
    return Response.json({outcome,squad:outcome==="removed"?await getSquad(actor,id):null});
  });
}
