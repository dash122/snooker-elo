import { requireMember } from "../../../db/auth";
import { boardSlots, boardOpenCount, createPostedSlot, myPostedSlots, playerProfiles, type SlotConditions, type FillRule } from "../../../db/availability";
import { handsForSlot, myHands, waitingForMeCount } from "../../../db/slot-hands";
import { announceSlotPosted } from "../../../db/slot-actions";
import { liveIntentsByPlayer } from "../../../db/intents";
import { validateAvailabilityInterval } from "../../../lib/availability";

/** 開局卡 — the board. One primitive for every persona: post a slot, raise a hand, get filled.
 *
 *  Returns everything the screen needs in one round trip: the club-wide board (nobody's hand count
 *  attached, per the whole point of this design), this member's own posted slots (their private hand
 *  list lives on each one), the hands this member has raised elsewhere, and the two counts that turn
 *  hidden demand into a reason to post — how many want a game tonight, and how many are waiting for
 *  this member specifically to open one. */

export const dynamic="force-dynamic";

function readConditions(value:unknown):SlotConditions {
  if(!value||typeof value!=="object")return {};
  const raw=value as Record<string,unknown>;
  const out:SlotConditions={};
  if(raw.handicap===true)out.handicap=true;
  if(raw.noSmoking===true)out.noSmoking=true;
  if(typeof raw.frames==="number"&&raw.frames>0)out.frames=Math.round(raw.frames);
  if(raw.levelOnly===true)out.levelOnly=true;
  if(raw.tableBooked===true)out.tableBooked=true;
  return out;
}

export async function GET(){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({signedIn:Boolean(member),board:[],mine:[],hands:[]},{headers:{"cache-control":"no-store"}});
  const me=member.statePlayerId;
  try{
    const [board,mine,hands,waitingForMe,wantTonight,openCount]=await Promise.all([
      boardSlots(me),
      myPostedSlots(me),
      myHands(me),
      waitingForMeCount(me),
      liveIntentsByPlayer().then(byPlayer=>Object.keys(byPlayer).length).catch(()=>0),
      boardOpenCount(),
    ]);
    /* Hand lists are owner-only, so they are fetched one card at a time rather than joined into the
       board query above — the board query must never be capable of returning this. */
    const fillers=await playerProfiles(mine.flatMap(item=>item.filledBy?[item.filledBy]:[]));
    const mineWithHands=await Promise.all(mine.map(async item=>({
      ...item,
      filler:item.filledBy?fillers.get(item.filledBy)??null:null,
      hands:item.fillRule==="review"&&!item.filledBy?await handsForSlot(me,item.id):[],
    })));
    return Response.json({signedIn:true,board,mine:mineWithHands,hands,waitingForMe,wantTonight,openCount},
      {headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Board unavailable"},{status:500});
  }
}

export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{
    const body=await request.json() as {startAt?:unknown;endAt?:unknown;venue?:unknown;note?:unknown;fillRule?:unknown;conditions?:unknown};
    const window=validateAvailabilityInterval({startAt:String(body.startAt),endAt:String(body.endAt)});
    const fillRule:FillRule=body.fillRule==="review"?"review":"first";
    const created=await createPostedSlot(member.statePlayerId,{...window,
      venue:typeof body.venue==="string"?body.venue.trim().slice(0,60):"",
      note:typeof body.note==="string"?body.note.trim().slice(0,200):"",
      fillRule,conditions:readConditions(body.conditions)});
    if(!created)return Response.json({error:"呢段時間你已經開咗局，改一改時間先。"},{status:409});
    await announceSlotPosted(member.statePlayerId,created).catch(()=>{});
    return Response.json({slot:created},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Could not post slot"},{status:400});
  }
}
