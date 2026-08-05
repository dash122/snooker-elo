import { requireMember } from "../../../db/auth";
import { liveIntentsByPlayer, myIntent, postIntent } from "../../../db/intents";
import { publishAvailability } from "../../../db/availability";
import { announceAvailability } from "../../../db/matchmaking-actions.pg";
import { validateAvailabilityInterval, type IntentKind } from "../../../lib/availability";
import { isMatchPreference } from "../../../lib/room";

/** "I want a game", separate from "I have time". A `tonight` or `window` intent also publishes the
 *  window as real availability — same path `/api/availability` uses — so the grid, offers and
 *  open-call targeting stay correct without knowing intent exists. `standby` posts nothing beyond the
 *  intent row itself; the member is asking to be found, not publishing a time. */
/** `window` and `standby` are both a mood rather than a slot booking, so neither one requires a
 *  time. `tonight` always carries a real interval: it arrives either from `/api/availability/now`
 *  alongside the free-now publish, or from The Room's 「今晚得閒到 X」 control, which is the same
 *  declaration with the end time chosen rather than counted off in hours. */
function body(input:unknown){
  const value=input as {kind?:unknown;startAt?:unknown;endAt?:unknown;note?:unknown;preference?:unknown};
  const kind=value.kind;
  /* `tonight` is accepted here now that The Room posts 「今晚得閒到 23:00」 directly — a declaration
     with a real end time, which is the whole point of that control. It still carries a window, so
     nothing downstream changes. */
  if(kind!=="tonight"&&kind!=="window"&&kind!=="standby")throw new Error("Choose 今晚、呢個星期想打或有啱就得");
  const note=typeof value.note==="string"?value.note.trim().slice(0,200):"";
  /* An unrecognised preference falls back to 求其打下 rather than failing the whole declaration: the
     member's answer to "do you want a game" matters far more than their answer to "what kind". */
  const preference=isMatchPreference(value.preference)?value.preference:"any";
  if(kind==="standby"||value.startAt===undefined)return {kind:kind as IntentKind,window:null,note,preference};
  const window=validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});
  return {kind:kind as IntentKind,window,note,preference};
}

export async function GET(){
  try{
    const member=await requireMember();
    const [byPlayer,mine]=await Promise.all([
      liveIntentsByPlayer(),
      member?.statePlayerId?myIntent(member.statePlayerId):Promise.resolve(null),
    ]);
    return Response.json({byPlayer,mine},{headers:{"cache-control":"no-store"}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Intents unavailable"},{status:400});}
}

export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{
    const {kind,window,note,preference}=body(await request.json());
    const intent=await postIntent(member.statePlayerId,kind,window,note,preference);
    let offers=0;
    if(window){
      await publishAvailability(member.statePlayerId,[window]);
      offers=(await announceAvailability(member.statePlayerId,[window])).offers;
    }
    return Response.json({intent,offers},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Invalid intent"},{status:400});}
}
