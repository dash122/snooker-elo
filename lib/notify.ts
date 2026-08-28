import { hkClock, hkDate, hkDayLabel, type Interval } from "./availability";

/** Every message the club can send a member, composed in one place.
 *
 *  Kept free of any database or transport import so the wording is unit-testable and so the same
 *  composer serves push, email and (later) anything else. The four channels match the four things a
 *  member can switch off independently in settings — a channel is a promise about what kind of
 *  interruption this is, not a technical detail. */

export type NotificationChannel = "invite" | "openCall" | "offer" | "result";

export type NotificationMessage = {
  channel:NotificationChannel; title:string; body:string;
  /** Collapse key. A second invite from the same person replaces the first in the tray rather than
      stacking, which is the difference between a useful nudge and a notification spammer. */
  tag:string;
  url?:string; urgency?:"very-low"|"low"|"normal"|"high"; ttl?:number;
};

const when=(slot:Interval)=>`${hkDayLabel(hkDate(new Date(slot.startAt)))} ${hkClock(slot.startAt)}–${hkClock(slot.endAt)}`;
const withVenue=(text:string,venue?:string|null)=>venue?`${text} · ${venue}`:text;

/** How soon does this stop being worth delivering? A push about a game starting in 40 minutes is
    worthless tomorrow morning, so the TTL is the time left until the slot rather than a flat value —
    the push service drops it on its own if the member's phone stays offline past then. */
const untilSlot=(slot:Interval,now=Date.now())=>Math.max(60,Math.round((Date.parse(slot.startAt)-now)/1000));
/* Inside two hours a game is a "come now" message and should wake the screen; beyond that it can wait
   for the member to pick the phone up. */
const urgencyFor=(slot:Interval,now=Date.now()):"normal"|"high"=>Date.parse(slot.startAt)-now<2*60*60*1000?"high":"normal";

export function inviteReceived(from:string,slot:Interval,message:string,venue?:string|null):NotificationMessage {
  return {
    channel:"invite",title:`${from} 想約你打波`,
    body:withVenue(`${when(slot)}${message?` · ${message}`:""}`,venue),
    tag:`invite:${from}`,urgency:urgencyFor(slot),ttl:untilSlot(slot),
  };
}

export function inviteAccepted(by:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"invite",title:`${by} 接受咗你嘅邀請`,body:withVenue(`${when(slot)} · 對局已確認`,venue),tag:`invite:${by}`,urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

export function inviteDeclined(by:string,slot:Interval):NotificationMessage {
  return {channel:"invite",title:`${by} 今次未得閒`,body:`${when(slot)} 嘅邀請被婉拒；試下其他時間或其他球友。`,tag:`invite:${by}`,urgency:"low"};
}

/** A counter-proposal is the one notification that must never read as a rejection — the whole point
    of adding it was to give "no" a next step. */
export function inviteCountered(by:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"invite",title:`${by} 提議改時間`,body:withVenue(`改為 ${when(slot)} — 睇下就唔就`,venue),tag:`invite:${by}`,urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

export function openCallPosted(from:string,slot:Interval,message:string,venue?:string|null):NotificationMessage {
  return {
    channel:"openCall",title:`${from} 開枱搵人`,
    body:withVenue(`${when(slot)}${message?` · ${message}`:""} · 先到先得`,venue),
    tag:"open-call",urgency:urgencyFor(slot),ttl:untilSlot(slot),
  };
}

/** The mutual-match ask. Phrased so that neither side learns the other said no: it is an invitation
    from the club, not from a person, which is exactly why it costs nothing to decline. */
export function offerProposed(other:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"offer",title:"有人同你夾到時間",body:withVenue(`${other} · ${when(slot)} — 打唔打？`,venue),tag:`offer:${other}`,urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

export function offerMatched(other:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"offer",title:`同 ${other} 嘅對局已確認`,body:withVenue(`${when(slot)} · 兩邊都答應咗`,venue),tag:`offer:${other}`,urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

export function followUpDue(other:string,slot:Interval):NotificationMessage {
  return {channel:"result",title:"你哋打咗未？",body:`${when(slot)} 同 ${other} 嘅對局 — 記低賽果先計 ELO。`,tag:`result:${other}`,urgency:"low"};
}

/** 「佢開局通知我」 firing: one push per post, to everyone watching that member, never naming who
    else is watching. Reuses the `openCall` channel — a posted slot is the same kind of "somebody
    opened a table" news an open call already sends, so this does not need its own preference toggle. */
export function slotWatcherPosted(by:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"openCall",title:`${by} 開咗局`,body:withVenue(`${when(slot)} · 你早前話想知`,venue),tag:`slot-watch:${by}`,urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

/** A slot has a filler — first-hand-wins landed, or the poster picked. Reuses the `offer` channel:
    like a mutual offer, this is the club telling both sides a game now exists, not one member
    telling the other. */
export function slotFilled(other:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"offer",title:`同 ${other} 夾到今晚呢局`,body:withVenue(`${when(slot)} · 撳入去交換聯絡方法`,venue),tag:`slot:${other}`,urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

/** The cup draw landed. Sent once per entrant, naming only their own first-round tie: a member does
    not need the whole bracket pushed at them, they need to know who to go and beat. Reuses the
    `result` channel — like a result reminder, this is the club telling you a game now exists that
    only you can go and play. */
export function cupDrawn(cupName:string,opponent:string|null,roundName:string):NotificationMessage {
  return {
    channel:"result",
    title:`${cupName} 抽籤結果出咗`,
    body:opponent?`${roundName}：你對 ${opponent} — 撳入去約時間、打完記低賽果。`:`${roundName}：你輪空，直接晉級下一圈。`,
    tag:`cup-draw:${cupName}`,url:"/?tab=matches&view=cup",urgency:"normal",
  };
}

/** The draw already landed, but an admin reshuffled it, dragged one name onto another, or swapped in
 *  a reserve — anyone whose first-round opponent changed as a result needs telling again, the same
 *  way the original draw told them, or they turn up ready to play whoever the old bracket said. Reuses
 *  the `cup-draw` tag so an unread original-draw push is replaced rather than stacking a second one. */
export function cupRedrawn(cupName:string,opponent:string|null,roundName:string):NotificationMessage {
  return {
    channel:"result",
    title:`${cupName} 對陣更新咗`,
    body:opponent?`${roundName}：你而家對 ${opponent} — 撳入去約時間、打完記低賽果。`:`${roundName}：你而家輪空，直接晉級下一圈。`,
    tag:`cup-draw:${cupName}`,url:"/?tab=matches&view=cup",urgency:"normal",
  };
}
