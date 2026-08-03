import { getCurrentMember } from "../../../db/auth";
import { recordEvents } from "../../../db/analytics";

/** Event sink for the matchmaking funnel.
 *
 *  Accepts anonymous events too — a visitor browsing open calls before signing up is part of the
 *  funnel, and dropping their events would make the join step look better than it is. Always answers
 *  204 regardless of what happened inside: a member's session must never be affected by whether
 *  analytics is healthy. */
export async function POST(request:Request){
  try{
    const body=await request.json() as {events?:unknown};
    if(!Array.isArray(body.events))return new Response(null,{status:204});
    const member=await getCurrentMember().catch(()=>null);
    const events=body.events.slice(0,50).flatMap(item=>{
      const value=item as {event?:unknown;props?:unknown;at?:unknown};
      if(typeof value.event!=="string")return [];
      return [{
        event:value.event.slice(0,64),
        props:value.props&&typeof value.props==="object"?value.props as Record<string,unknown>:null,
        at:typeof value.at==="string"?value.at:new Date().toISOString(),
      }];
    });
    if(events.length)await recordEvents(member?.statePlayerId??null,events);
  }catch{/* never surfaces to the member */}
  return new Response(null,{status:204});
}
