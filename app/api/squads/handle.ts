import { requireMember } from "../../../db/auth";
import { getTranslator } from "../../../lib/i18n/server";
import { SquadError } from "../../../lib/squads";
import { recordEvents } from "../../../db/analytics";

/* Shared by every /api/squads route: a signed-in member with a linked player, and SquadError's
   translatable message + status passed straight through. Anything else is a generic 500. */
export async function withSquadActor(run:(actor:string)=>Promise<Response>):Promise<Response>{
  const { t } = await getTranslator();
  const member=await requireMember();
  if(!member)return Response.json({error:t("請先登入。")},{status:401});
  if(!member.statePlayerId)return Response.json({error:t("請先連結球員檔案。")},{status:403});
  try{
    return await run(member.statePlayerId);
  }catch(error){
    if(error instanceof SquadError)return Response.json({error:t(error.message)},{status:error.status});
    console.error("squads:",error);
    return Response.json({error:t("未能更新球隊，請稍後再試。")},{status:500});
  }
}

/* For read-only routes that expose public squads: signed-in viewers get their own player id (so
   private squads they belong to still resolve), everyone else gets null. */
export async function withOptionalSquadActor(run:(actor:string|null)=>Promise<Response>):Promise<Response>{
  const { t } = await getTranslator();
  const member=await requireMember();
  try{
    return await run(member?.statePlayerId??null);
  }catch(error){
    if(error instanceof SquadError)return Response.json({error:t(error.message)},{status:error.status});
    console.error("squads:",error);
    return Response.json({error:t("未能更新球隊，請稍後再試。")},{status:500});
  }
}

export async function readJson(request:Request):Promise<Record<string,unknown>>{
  try{
    const body=await request.json();
    return body&&typeof body==="object"?body as Record<string,unknown>:{};
  }catch{ return {}; }
}

export const noStore={"cache-control":"no-store"};

/* Squad events are recorded here, after the write has succeeded, rather than from the client: a
   join or leave is a fact the server already knows, and the funnel should not depend on a beacon
   surviving the page. Best-effort — analytics never fails a member's request. */
export function trackSquad(playerId:string,event:"squad_created"|"squad_joined"|"squad_left"|"squad_member_removed"|"squad_settings_changed"|"squad_deleted",props:Record<string,unknown>){
  void recordEvents(playerId,[{event,props,at:new Date().toISOString()}]).catch(()=>{});
}
