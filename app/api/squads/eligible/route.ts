import { listSquadEligiblePlayerIds } from "../../../../db/squads.pg";
import { noStore, withSquadActor } from "../handle";

/* Which players a host can add: those linked to an active member account. */
export async function GET(){
  return withSquadActor(async()=>Response.json({playerIds:await listSquadEligiblePlayerIds()},{headers:noStore}));
}
