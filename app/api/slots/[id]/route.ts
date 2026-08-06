import { requireMember } from "../../../../db/auth";
import { cancelAvailability, playerProfiles, postedSlotById, recordSlotResult } from "../../../../db/availability";
import { pickHand, raiseHand, retractHand, retractHandsInWindow } from "../../../../db/slot-hands";
import { announceSlotFilled } from "../../../../db/slot-actions";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({error:"A linked member account is required"},{status:403});
  const me=member.statePlayerId;
  const {id}=await params;
  const body=await request.json() as {action?:unknown;playerId?:unknown;result?:unknown;startAt?:unknown;endAt?:unknown};

  if(body.action==="raise"){
    const outcome=await raiseHand(me,id);
    if(outcome.tooLate)return Response.json({error:"呢張局唔喺度喇 — 可能啱啱夾咗，或者已經過期。"},{status:409});
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

  /* Owner-only, and only meaningful on a `review` slot: pick a name from a list nobody else could
     ever have seen. */
  if(body.action==="pick"){
    if(typeof body.playerId!=="string")return Response.json({error:"Choose who to pick"},{status:400});
    const filled=await pickHand(me,id,body.playerId);
    if(!filled)return Response.json({error:"呢個人冇舉手，或者局已經夾咗。"},{status:409});
    await announceSlotFilled(filled).catch(()=>{});
    return Response.json({slot:filled});
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
