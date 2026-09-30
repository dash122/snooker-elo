import { deleteSquad, getSquad, updateSquad } from "../../../../db/squads.pg";
import { getTranslator } from "../../../../lib/i18n/server";
import { isVisibility, normaliseSquadName } from "../../../../lib/squads";
import { noStore, readJson, trackSquad, withSquadActor } from "../handle";

type Params={params:Promise<{id:string}>};

export async function GET(_request:Request,{params}:Params){
  const { t } = await getTranslator();
  const {id}=await params;
  return withSquadActor(async actor=>{
    const squad=await getSquad(actor,id);
    if(!squad)return Response.json({error:t("搵唔到呢個球隊。")},{status:404});
    return Response.json({squad},{headers:noStore});
  });
}

/* Hosts only: rename, switch public/private, or rotate the invite code (which kills old links). */
export async function PATCH(request:Request,{params}:Params){
  const { t } = await getTranslator();
  const {id}=await params;
  return withSquadActor(async actor=>{
    const body=await readJson(request);
    const input:{name?:string;visibility?:"public"|"private";rotateInvite?:boolean}={};
    if(body.name!==undefined){
      const name=normaliseSquadName(body.name);
      if(!name)return Response.json({error:t("球隊名稱須為 1 至 40 字。")},{status:400});
      input.name=name;
    }
    if(body.visibility!==undefined){
      if(!isVisibility(body.visibility))return Response.json({error:t("無效的公開設定。")},{status:400});
      input.visibility=body.visibility;
    }
    if(body.rotateInvite===true)input.rotateInvite=true;
    await updateSquad(actor,id,input);
    trackSquad(actor,"squad_settings_changed",{squadId:id,renamed:input.name!==undefined,visibility:input.visibility??null,rotatedInvite:Boolean(input.rotateInvite)});
    return Response.json({squad:await getSquad(actor,id)});
  });
}

export async function DELETE(_request:Request,{params}:Params){
  const {id}=await params;
  return withSquadActor(async actor=>{
    await deleteSquad(actor,id);
    trackSquad(actor,"squad_deleted",{squadId:id});
    return Response.json({ok:true});
  });
}
