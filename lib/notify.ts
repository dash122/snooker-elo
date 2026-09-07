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

/** Option A formation messages. They reuse the invite channel so existing delivery preferences and
 * email templates continue to work, while the copy describes a request that needs one clear answer. */
export function gameRequestReceived(from:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"invite",title:`${from} 想同你打波`,body:withVenue(`${when(slot)} · 撳入去接受或婉拒`,venue),tag:`game-request:${from}`,url:"/?tab=availability",urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

export function gameRequestAccepted(by:string,slot:Interval,venue?:string|null):NotificationMessage {
  return {channel:"invite",title:`${by} 接受咗約戰`,body:withVenue(`${when(slot)} · 對局已確認`,venue),tag:`game-confirmed:${by}`,url:"/?tab=availability",urgency:urgencyFor(slot),ttl:untilSlot(slot)};
}

export function gameRequestUnavailable(slot:Interval):NotificationMessage {
  return {channel:"invite",title:"今次約戰未能確認",body:`${when(slot)} 嘅機會已經關閉；試下其他時間或球友。`,tag:`game-unavailable:${slot.startAt}`,url:"/?tab=availability",urgency:"low"};
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

/* --- 開局板 ---------------------------------------------------------------
 *
 * Three messages, and only the last asks the member to do anything. A club app is not a social
 * network: we cannot assume anybody opens it between one game and the next, so each of these has to
 * be complete on its own, and the one sent before a game must not require a reply from the people
 * who are simply going to turn up.
 *
 * Written in 書面語, unlike the older composers above — the 開局板 copy is written throughout. */

/** A 局 just reached two participants, which is the only threshold this product has. Sent once, on
    the 1→2 transition, to everyone in it. */
export function gameFormed(names:string[],slot:Interval,venue?:string|null):NotificationMessage {
  const who=names.length>2?`${names.slice(0,2).join("、")} 等 ${names.length} 人`:names.join("、");
  return {
    channel:"openCall",title:`成局：${when(slot)}`,
    body:withVenue(`${who}參加。`,venue),
    tag:"open-board:formed",urgency:urgencyFor(slot),ttl:untilSlot(slot),url:"/?tab=availability",
  };
}

/** Three hours out. Deliberately has no "confirm" action: asking everyone to tap yes is asking
    everyone to open the app, which is the assumption we are not allowed to make. Silence means
    attending, so the only thing this has to carry is the way out for the member who cannot come. */
export function gameReminder(count:number,slot:Interval,venue?:string|null):NotificationMessage {
  return {
    channel:"openCall",title:withVenue(`今日 ${when(slot)}`,venue),
    body:`${count} 人參加。如常出席的話不用理會這則通知；去不到請在 app 內按「我去不到」，讓其他人知道。`,
    tag:"open-board:reminder",urgency:"high",ttl:untilSlot(slot),url:"/?tab=availability",
  };
}

/** The morning after. The only message in the set that asks for something, and the only reason a
    member has to come back — a recorded result is what turns a game into ELO, which is the thing no
    group chat can do for them. */
export function resultPrompt(slot:Interval,venue?:string|null):NotificationMessage {
  return {
    channel:"result",title:"昨天打成怎樣？",
    body:withVenue(`${when(slot)} 的一局 — 記錄賽果，計入 ELO 與對賽紀錄。`,venue),
    tag:"open-board:result",urgency:"low",url:"/?tab=availability",
  };
}
