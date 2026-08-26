import { requireMember } from "../../../db/auth";
import { boardSlots, createPostedSlot, myPostedSlots, playerProfiles, type SlotConditions, type FillRule } from "../../../db/availability";
import { handSummaries, handsForSlots, myHands, type SlotHandSummary } from "../../../db/slot-hands";
import { sortBoard } from "../../../lib/slots";
import { announceSlotPosted } from "../../../db/slot-actions";
import { validateAvailabilityInterval } from "../../../lib/availability";
import { getSettings } from "../../../db/state";
import { proposeHandicap, type HandicapSettings } from "../../../lib/handicap";

/* --- 讓分, said next to every name -------------------------------------------
 *
 * The same proposal the leaderboard and the session cards already compute (`lib/handicap.ts`), read
 * for this viewer against whoever they are looking at here -- a poster on the board, someone already
 * in a slot, a name on a waiting list. `withHandicap` is the one seam every one of those player
 * objects passes through, so the number is never computed twice with two different settings. */

async function handicapSettings():Promise<HandicapSettings|null>{
  const raw=await getSettings().catch(()=>null) as Partial<HandicapSettings>|null;
  const s=raw??{};
  return {handicapPointsToElo:s.handicapPointsToElo??25,handicapMinimumElo:s.handicapMinimumElo??7,
    handicapSensitivityRange:s.handicapSensitivityRange??16,handicapSensitivityWidth:s.handicapSensitivityWidth??250,
    start:s.start};
}

function withHandicap<T extends {rating:number}>(player:T,myRating:number|null,settings:HandicapSettings|null):
  T&{handicap:ReturnType<typeof proposeHandicap>|null}{
  return {...player,handicap:myRating==null||!settings?null:proposeHandicap(myRating,player.rating,settings)};
}

/** 開局卡 — the board. One primitive for every persona: post a slot, raise a hand, get filled.
 *
 *  Returns everything the screen needs in one round trip: the club-wide board with a hand *count* on
 *  every row, this member's own posted slots (the private waiting list lives on each one), the hands
 *  this member has raised elsewhere. The app-shell summary owns the club-wide counts, so this route
 *  stays focused on the board payload the tab actually renders.
 *
 *  Counts are public; the names of people still waiting are not. That split is the design: a card
 *  reading 「3 人舉咗手」 and a card saying nothing are different objects to somebody deciding whether
 *  to bother, so hiding the number to protect whoever might be passed over would manufacture the
 *  silence it was meant to soften. Accepted names are public too — an accepted player is the reason
 *  the next member joins. Only the poster ever sees who is still waiting.
 *
 *  Signed out, the board still renders. Looking is the most common thing anybody does here and the
 *  least defensible thing to charge for: requiring an account before showing whether anyone is
 *  playing tonight guarantees the club looks dead to exactly the people deciding whether to join. */

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

/** Attach the public part of the hand data to a board row: the counts, plus the names of anyone
    accepted, plus whether this reader has a hand on it. Never the waiting names. */
async function withHands<T extends {id:string}>(slots:T[],me:string|null){
  const summaries=await handSummaries(slots.map(slot=>slot.id)).catch(()=>new Map<string,SlotHandSummary>());
  return slots.map(slot=>{
    const summary=summaries.get(slot.id);
    return {...slot,
      hands:{total:summary?.total??0,accepted:summary?.accepted??0,waiting:summary?.waiting??0},
      acceptedPlayers:summary?.acceptedPlayers??[],
      iRaised:Boolean(me&&summary?.raisers.includes(me)&&!summary.acceptedPlayers.some(p=>p.id===me)),
      iAccepted:Boolean(me&&summary?.acceptedPlayers.some(p=>p.id===me)),
    };
  });
}

export async function GET(){
  const member=await requireMember();
  if(!member?.statePlayerId){
    /* No profile linked, or nobody signed in: the board, and nothing pretending to be actionable.
       `canAct` is what the client uses to decide whether to draw the buttons. */
    const board=await boardSlots("").catch(()=>[]);
    return Response.json({signedIn:Boolean(member),canAct:false,
      board:sortBoard((await withHands(board,null)).map(slot=>({...slot,mine:false}))),mine:[],hands:[]},
      {headers:{"cache-control":"no-store"}});
  }
  const me=member.statePlayerId;
  try{
    const [board,mine,hands,settings]=await Promise.all([
      boardSlots(me),
      myPostedSlots(me),
      myHands(me),
      handicapSettings(),
    ]);
    /* The waiting list with names on it is owner-only, so it is fetched one card at a time rather
       than joined into the board query above — the board query must never be capable of returning
       it. The counts are a different matter and travel with everything. `board` and `mine` never
       share an id (the board query excludes this member's own posts), so one `handSummaries` call
       covers both rather than one per list, and the filler profiles and this member's own profile
       come from the same `playerProfiles` call for the same reason. None of these three depend on
       each other's results, so they run together rather than as separate round trips. */
    const [summaries,profiles,mineHands]=await Promise.all([
      handSummaries([...board.map(slot=>slot.id),...mine.map(slot=>slot.id)]).catch(()=>new Map<string,SlotHandSummary>()),
      playerProfiles([...new Set([...mine.flatMap(item=>item.filledBy?[item.filledBy]:[]),me])]),
      handsForSlots(me,mine.map(item=>item.id)),
    ]);
    const myProfile=profiles.get(me)??null;
    const myRating=myProfile?.rating??null;
    const rated=<T extends {rating:number}>(player:T)=>withHandicap(player,myRating,settings);
    const boardWithHandicap=board.map(slot=>{
      const summary=summaries.get(slot.id);
      return {...slot,
        hands:{total:summary?.total??0,accepted:summary?.accepted??0,waiting:summary?.waiting??0},
        acceptedPlayers:(summary?.acceptedPlayers??[]).map(rated),
        iRaised:Boolean(summary?.raisers.includes(me)&&!summary.acceptedPlayers.some(p=>p.id===me)),
        iAccepted:Boolean(summary?.acceptedPlayers.some(p=>p.id===me)),
        player:rated(slot.player),
      };
    });
    const mineWithHands=mine.map(item=>{
      const summary=summaries.get(item.id);
      return {...item,
        mine:true,
        /* The poster's own profile, so a member's own row can name, picture and show the same ELO /
           recommended handicap treatment as anyone else's -- distinguishing "your slot" from
           "somebody else's" is the row's colour, not the absence of stats. */
        player:myProfile?rated(myProfile):null,
        filler:item.filledBy?(f=>f?rated(f):null)(profiles.get(item.filledBy)??null):null,
        counts:{total:summary?.total??0,accepted:summary?.accepted??0,waiting:summary?.waiting??0},
        acceptedPlayers:(summary?.acceptedPlayers??[]).map(rated),
        hands:(mineHands.get(item.id)??[]).map(hand=>({...hand,player:rated(hand.player)})),
      };
    });
    const handsWithHandicap=hands.map(hand=>({...hand,slot:{...hand.slot,player:rated(hand.slot.player)}}));
    return Response.json({signedIn:true,canAct:true,
      board:sortBoard(boardWithHandicap.map(slot=>({...slot,mine:false}))),
      mine:mineWithHands,hands:handsWithHandicap},
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
    const notified=await announceSlotPosted(member.statePlayerId,created).catch(()=>0);
    return Response.json({slot:created,notified:notified??0},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Could not post slot"},{status:400});
  }
}
