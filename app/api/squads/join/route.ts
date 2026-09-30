import { joinSquad, previewInvite } from "../../../../db/squads.pg";
import { getTranslator } from "../../../../lib/i18n/server";
import { normaliseInviteCode } from "../../../../lib/squads";
import { noStore, readJson, withSquadActor } from "../handle";

/* GET ?code= previews an invite (name and size only); POST joins by {code} or, for a public squad,
   by {squadId}. Joining is always the player's own act — see addSquadMember for the host route. */
export async function GET(request:Request){
  const { t } = await getTranslator();
  return withSquadActor(async()=>{
    const code=normaliseInviteCode(new URL(request.url).searchParams.get("code"));
    const squad=code?await previewInvite(code):null;
    if(!squad)return Response.json({error:t("邀請連結無效或已更新。")},{status:404});
    return Response.json({squad},{headers:noStore});
  });
}

export async function POST(request:Request){
  const { t } = await getTranslator();
  return withSquadActor(async actor=>{
    const body=await readJson(request);
    if(body.code!==undefined){
      const code=normaliseInviteCode(body.code);
      if(!code)return Response.json({error:t("邀請連結無效或已更新。")},{status:404});
      return Response.json({id:await joinSquad(actor,{code})});
    }
    const squadId=typeof body.squadId==="string"?body.squadId:"";
    if(!squadId)return Response.json({error:t("搵唔到呢個球隊。")},{status:404});
    return Response.json({id:await joinSquad(actor,{squadId})});
  });
}
