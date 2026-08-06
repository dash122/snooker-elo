import { requireMember } from "../../../../db/auth";
import { cancelAvailability, playerProfiles, postedSlotById, recordSlotResult } from "../../../../db/availability";
import { acceptHands, closeSlot, raiseHand, retractHand, retractHandsInWindow } from "../../../../db/slot-hands";
import { announceSlotFilled } from "../../../../db/slot-actions";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"A linked member account is required"},{status:403});
  const me=member.statePlayerId;
  const {id}=await params;
  const body=await request.json() as {action?:unknown;playerId?:unknown;playerIds?:unknown;result?:unknown;startAt?:unknown;endAt?:unknown};

  if(body.action==="raise"){
    const outcome=await raiseHand(me,id);
    /* No longer "somebody beat you to it" — a slot cannot be taken out from under a hand now that it
       has no seat count. This only fires when the poster closed or cancelled it, or it expired. */
    if(outcome.tooLate)return Response.json({error:"呢張局唔收人喇 — 開局嗰位收夠咗，或者已經過期。"},{status:409});
    if(outcome.filled&&outcome.slot)await announceSlotFilled(outcome.slot).catch(()=>{});
    return Response.json({raised:outcome.raised,filled:outcome.filled});
  }

  if(body.action==="retract"){
    const ok=await retractHand(me,id);
    return ok?Response.json({ok:true}):Response.json({error:"搵唔到呢個舉手"},{status:404});
  }

  /* 「今晚唔得 · 全部收返」 — a window rather than a single slot id, so one tap clears every hand
     this member holds on any slot starting inside it. */
  if(body.action==="retract-window"){
    if(typeof body.startAt!=="string"||typeof body.endAt!=="string")
      return Response.json({error:"Missing window"},{status:400});
    const count=await retractHandsInWindow(me,body.startAt,body.endAt);
    return Response.json({retracted:count});
  }

  /* Owner-only: take one hand, or every hand up. `pick` is kept as an alias so a client cached
     mid-deploy still does the thing its button says.

     Everyone taken hears the same thing whether they were the only one or one of four. The members
     not taken hear nothing at all — which is the whole reason there is no rejection to leak. */
  if(body.action==="accept"||body.action==="pick"||body.action==="accept-all"){
    const chosen=body.action==="accept-all"?"all" as const
      :typeof body.playerId==="string"?[body.playerId]
      :Array.isArray(body.playerIds)?body.playerIds.map(String):[];
    const result=await acceptHands(me,id,chosen);
    if(!result)return Response.json({error:"搵唔到呢張局"},{status:404});
    if(!result.accepted.length)return Response.json({error:"佢冇舉手，或者已經收咗。"},{status:409});
    if(result.filled)await announceSlotFilled(result.filled).catch(()=>{});
    return Response.json({accepted:result.accepted.length,slot:result.filled});
  }

  /* 夠喇 · 唔再收. Distinct from cancelling: the evening still happens, it just stops taking people.
     Whoever is still waiting sees a slot that filled — the same thing they would have seen if the
     poster had never opened the list. */
  if(body.action==="close"){
    const ok=await closeSlot(me,id);
    return ok?Response.json({ok:true}):Response.json({error:"搵唔到呢張局"},{status:404});
  }

  /* Either participant reports whether a filled slot was actually played — the one thing that must
     come back once the app hands the two of them off to WhatsApp. */
  if(body.action==="result"){
    if(body.result!=="played"&&body.result!=="missed")return Response.json({error:"Unknown result"},{status:400});
    const slot=await recordSlotResult(me,id,body.result);
    return slot?Response.json({slot}):Response.json({error:"搵唔到呢張局"},{status:404});
  }

  if(body.action==="cancel"){
    const ok=await cancelAvailability(id,me);
    return ok?Response.json({ok:true}):Response.json({error:"搵唔到呢張局"},{status:404});
  }

  return Response.json({error:"Unknown action"},{status:400});
}

/** The confirmation card, fetched by id once a slot is filled — carries what both sides need to see
    to actually show up, and nothing about hands that did not win. Either participant may read it;
    nobody else. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"Sign in required"},{status:401});
  const {id}=await params;
  const slot=await postedSlotById(id);
  if(!slot||(slot.playerId!==member.statePlayerId&&slot.filledBy!==member.statePlayerId))
    return Response.json({error:"搵唔到呢張局"},{status:404});
  const profiles=await playerProfiles([slot.playerId,...(slot.filledBy?[slot.filledBy]:[])]);
  const poster=profiles.get(slot.playerId)??null;
  const filler=slot.filledBy?profiles.get(slot.filledBy)??null:null;
  const opponent=member.statePlayerId===slot.playerId?filler:poster;
  return Response.json({slot,opponent},{headers:{"cache-control":"no-store"}});
}
