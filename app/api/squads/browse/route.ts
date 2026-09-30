import { browsePublicSquads } from "../../../../db/squads.pg";
import { noStore, withSquadActor } from "../handle";

/* The public directory: public squads the viewer isn't in yet, largest first. Private squads never
   appear here, whatever the query. */
export async function GET(request:Request){
  return withSquadActor(async actor=>{
    const query=(new URL(request.url).searchParams.get("q")??"").trim().slice(0,40);
    return Response.json({squads:await browsePublicSquads(actor,query)},{headers:noStore});
  });
}
