/** The messages the club emails a member, composed in one place.
 *
 *  Kept free of any database or transport import so the wording is unit-testable. The only senders
 *  today are the cup draw routes: matchmaking no longer sends anything, because a member learns about
 *  a game by opening the app or from a link a friend shares, never from an unprompted message. */

export type NotificationChannel = "result";

export type NotificationMessage = {
  channel:NotificationChannel; title:string; body:string;
  /** Collapse key. A second message about the same cup replaces the first rather than stacking. */
  tag:string;
  url?:string; urgency?:"very-low"|"low"|"normal"|"high"; ttl?:number;
};

/** The draw is done. A player does not need the whole bracket pushed at them, they need to know who
 *  to go and beat. */
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
 *  the `cup-draw` tag so an unread original-draw message is replaced rather than stacking a second one. */
export function cupRedrawn(cupName:string,opponent:string|null,roundName:string):NotificationMessage {
  return {
    channel:"result",
    title:`${cupName} 對陣更新咗`,
    body:opponent?`${roundName}：你而家對 ${opponent} — 撳入去約時間、打完記低賽果。`:`${roundName}：你而家輪空，直接晉級下一圈。`,
    tag:`cup-draw:${cupName}`,url:"/?tab=matches&view=cup",urgency:"normal",
  };
}

/** A host took a name out of a frozen draw. The player is no longer in the bracket, so the redraw
 *  message above has no tie to quote them — without this they would only find out by opening the cup
 *  and not finding themselves in it. Shares the `cup-draw` tag for the same reason `cupRedrawn` does. */
export function cupWithdrawn(cupName:string):NotificationMessage {
  return {
    channel:"result",
    title:`${cupName} 參賽名單更新咗`,
    body:"主持人已將你移出呢個盃賽嘅名單 — 如果有疑問，請聯絡主持人。",
    tag:`cup-draw:${cupName}`,url:"/?tab=matches&view=cup",urgency:"normal",
  };
}
