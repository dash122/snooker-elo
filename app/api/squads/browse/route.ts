import { requireMember } from "../../../../db/auth";
import { browsePublicSquads } from "../../../../db/squads.pg";
import { noStore, withOptionalSquadActor } from "../handle";

/* The squad directory: public squads the viewer isn't in yet, most relevant first. Private squads
   never appear here, whatever the query — except to admins, who get every squad (read-only). */
export async function GET(request:Request){
  return withOptionalSquadActor(async actor=>{
    const query=(new URL(request.url).searchParams.get("q")??"").trim().slice(0,40);
    const asAdmin=(await requireMember("admin"))!==null;
    return Response.json({squads:await browsePublicSquads(actor,query,asAdmin)},{headers:noStore});
  });
}
