/* --- 開局卡 · the posted slot -----------------------------------------------
 *
 * One primitive replaces four: a member posts a slot instead of publishing availability, opening a
 * call, or sending an invite. Two rules decide what happens when somebody wants it —
 *
 *   fill_rule 'first'  — the first hand raised fills it, in the same instant it is raised.
 *   fill_rule 'review' — the poster picks later, from a list nobody else ever sees.
 *
 * — and either way, nobody who did not win a slot is ever told they lost one. The functions here are
 * pure and table-agnostic on purpose: no database import, so the rules that decide what a member
 * sees are checked the same way whether they are read from Postgres or a unit test. */

export type FillRule = "first"|"review";
export type SlotConditions = { handicap?:boolean; noSmoking?:boolean; frames?:number|null; levelOnly?:boolean; tableBooked?:boolean };
export type SlotResult = "pending"|"played"|"missed";

export type SlotInput = {
  startAt:string; endAt:string;
  filledBy:string|null; result:SlotResult; cancelledAt?:string|null;
  /** 夠喇 · 唔再收. A slot stops taking hands when its poster says so, not when the first person is
      taken — see `handsView`. */
  closedAt?:string|null;
};

export type SlotStatus =
  /** Open, nobody has filled it yet. */
  | "open"
  /** Filled, still ahead of us. */
  | "filled"
  /** The time has passed, filled, no result recorded. */
  | "toRecord"
  /** Filled and scored (or marked missed). */
  | "done"
  /** The time passed with nobody filling it. */
  | "expired";

export function slotStatus(slot:SlotInput,now=Date.now()):SlotStatus {
  const over=Date.parse(slot.endAt)<=now;
  if(slot.filledBy){
    if(!over)return "filled";
    return slot.result==="pending"?"toRecord":"done";
  }
  return over?"expired":"open";
}

/** Can this slot still take a hand?
 *
 *  Note what is *not* here: being filled. Taking somebody used to close the slot, which quietly
 *  encoded "one game, two people" as a rule of the product — but a club night is often three or four
 *  players round one table taking turns, and there is no honest number to ask a poster for before
 *  anybody has turned up. So there is no capacity anywhere; a slot keeps taking hands until its
 *  poster says 夠喇, cancels, or the evening passes. */
export function slotTakingHands(slot:SlotInput,now=Date.now()):boolean {
  return !slot.cancelledAt&&!slot.closedAt&&Date.parse(slot.endAt)>now;
}

/* --- Hands ------------------------------------------------------------------
 *
 * The rule this file exists to hold: **counts are public, identities are not.**
 *
 * Those get conflated, and hiding the count to protect whoever might be passed over costs far more
 * than it saves. 「3 人舉咗手」 and a card that says nothing are different objects to the next member
 * deciding whether to bother — the first is a live evening, the second is a question — so a board
 * that hides how much interest there is manufactures exactly the silence that stops anyone posting
 * to it. What actually stings is being identifiably passed over, and that is what stays hidden.
 *
 * Identity is withheld only while a hand is still waiting. Once somebody is taken, their name is
 * public: an accepted player is the reason the next member joins. Anyone not taken is never named,
 * never counted apart, and never told a decision happened — so there is no way to learn you were
 * left out, or that there was anything to be left out of. */

export type HandState = "raised"|"accepted";

export type HandsView = {
  /** Waiting plus taken. The number every card shows, to everyone. */
  total:number;
  /** Taken, and therefore nameable. */
  accepted:number;
  /** Waiting. Counted, but named only to the poster. */
  waiting:number;
};

export function handsView(hands:{state:HandState}[]):HandsView {
  const accepted=hands.filter(hand=>hand.state==="accepted").length;
  const waiting=hands.filter(hand=>hand.state==="raised").length;
  return {total:accepted+waiting,accepted,waiting};
}

/** Whose names may leave the server, for a given viewer. The poster sees the waiting list because
    they are the one who has to act on it; nobody else does, including the other people on it — who
    could otherwise count each other and infer a competition. */
export function visibleHands<T extends {playerId:string;state:HandState}>(
  hands:T[],viewerId:string|null,posterId:string,
):T[] {
  if(viewerId===posterId)return hands;
  return hands.filter(hand=>hand.state==="accepted"||hand.playerId===viewerId);
}

const minute=60_000;

/** How long a slot has been up, in the words a poster needs.
 *
 *  This exists to keep the number 0 off the screen. 「0 人舉手」 is not a status, it is a verdict: it
 *  renders a slot posted two minutes ago and one nobody touched for three hours as the same failure,
 *  and it puts the poster's exact fear in writing at the moment they are most likely to delete it and
 *  never post again. Elapsed time says the same fact without the judgement, and unlike a count it
 *  keeps moving on its own. */
export function freshnessLabel(createdAt:string,now=Date.now()):string {
  const minutes=Math.max(0,Math.round((now-Date.parse(createdAt))/minute));
  if(minutes<1)return "啱啱開";
  if(minutes<60)return `啱啱開 · ${minutes} 分鐘`;
  const hours=Math.floor(minutes/60);
  return hours<24?`開咗 ${hours} 個鐘`:`開咗 ${Math.floor(hours/24)} 日`;
}

/** The line under a card — a different sentence depending on who is reading it.
 *
 *  An empty slot is the *best* card on the board for anyone thinking of raising a hand: no
 *  competition, and on a 先舉先得 slot it settles on the spot. It is only bad news for its poster.
 *  One fact, two frames — and getting this wrong is self-fulfilling, because a card that reads as
 *  unwanted is a card nobody joins. */
export function handsLine(input:{
  hands:HandsView; mine:boolean; iRaised:boolean; fillRule:FillRule; createdAt:string;
},now=Date.now()):string {
  const {hands,mine,iRaised,fillRule,createdAt}=input;
  if(hands.total===0){
    if(mine)return freshnessLabel(createdAt,now);
    return fillRule==="first"?"仲未有人舉手 · 你舉就即刻成事":"仲未有人舉手 · 你會係第一個";
  }
  const parts=[`${hands.total} 人舉咗手`];
  if(hands.accepted>0)parts.push(`已經收咗 ${hands.accepted} 個`);
  else if(mine)parts.push("等你收人");
  if(iRaised)parts.push("你舉咗手");
  return parts.join(" · ");
}

/** The poster's primary action. Never "pick one" while "take everyone" is available: the rejection
    problem is a default, not a capability, and this label is most of the fix. */
export function takeActionLabel(hands:HandsView):string|null {
  if(hands.waiting===0)return null;
  return hands.waiting===1?"收佢":`全部收 · ${hands.waiting} 個都要`;
}

/** One board, not two.
 *
 *  My own slots sort to the front and are styled apart rather than moved to their own section: this
 *  club fits its whole evening on one screen, so splitting four cards into two lists of two makes
 *  both look empty — and it re-separates, in the interface, the records this redesign spent its
 *  effort merging. What differs is the card, not the section. */
export function sortBoard<T extends {id:string;startAt:string;mine:boolean}>(slots:T[]):T[] {
  return [...slots].sort((a,b)=>{
    if(a.mine!==b.mine)return a.mine?-1:1;
    return a.startAt.localeCompare(b.startAt)||a.id.localeCompare(b.id);
  });
}

/** Order a member thinks about their own posted slots in: what needs a score first, then what is
    still live, then everything else — mirrors `lib/sessions.ts`'s `STATUS_WEIGHT`, adapted to a
    status set that has no "missed" (an unfilled slot expiring is not an obligation the way a
    missed booking is; it just stops being worth a card). */
const STATUS_WEIGHT:Record<SlotStatus,number> = {toRecord:0,filled:1,open:1,done:2,expired:2};

export function sortPostedSlots<T extends SlotInput>(slots:T[],now=Date.now()):T[] {
  return [...slots].sort((a,b)=>{
    const byStatus=STATUS_WEIGHT[slotStatus(a,now)]-STATUS_WEIGHT[slotStatus(b,now)];
    return byStatus||a.startAt.localeCompare(b.startAt);
  });
}

const EXPIRED_VISIBLE_HOURS=12;

/** Drops an unfilled, expired slot off the list after a while — an old empty post left on screen
    forever reads as a room nobody visits, not as history worth keeping. */
export function visiblePostedSlots<T extends SlotInput>(slots:T[],now=Date.now()):T[] {
  return slots.filter(slot=>{
    if(slot.cancelledAt)return false;
    if(slotStatus(slot,now)!=="expired")return true;
    return Date.parse(slot.endAt)>now-EXPIRED_VISIBLE_HOURS*3_600_000;
  });
}

/** The condition chips, in a fixed order so a scanning eye always finds 讓分 in the same place. Only
    ever the conditions actually set — an empty slot means "no stated preference", not "no smoking
    allowed" or any other claim the poster never made. */
export function conditionChips(conditions:SlotConditions):string[] {
  const chips:string[]=[];
  if(conditions.handicap)chips.push("要讓分");
  if(conditions.noSmoking)chips.push("無煙");
  if(conditions.frames)chips.push(`${conditions.frames} 局`);
  if(conditions.levelOnly)chips.push("水平接近");
  if(conditions.tableBooked)chips.push("已訂枱");
  return chips;
}

export function hasConditions(conditions:SlotConditions):boolean {
  return conditionChips(conditions).length>0;
}

/** The pre-filled hand-off message. Written from the poster's side of a filled slot — no phone
    number is stored anywhere in this app, so the link opens WhatsApp's composer for the member to
    pick the right contact themselves rather than pretending to deep-link a specific number. */
export function handoffMessage(input:{venue:string;whenLabel:string}):string {
  return `${input.whenLabel}${input.venue?` ${input.venue}`:""}，SCAA App 夾到嘅，見！`;
}

export function whatsappShareUrl(text:string):string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** The message a poster shares to a WhatsApp group, with the club's own preview link attached — the
    guest who taps it can read the slot and, once signed in, raise a hand without ever opening a
    separate app first. */
export function shareMessage(input:{whenLabel:string;venue:string;url:string}):string {
  const venue=input.venue?` · ${input.venue}`:"";
  return `${input.whenLabel}${venue} 開咗局，有冇人？\n${input.url}`;
}

/* --- The timeline ------------------------------------------------------------
 *
 * The board used to be filtered by three overlapping day chips (今晚／明天／週末); the tab now reuses
 * the exact-date 14-day scroller the roster grid uses elsewhere (`DateScroller` in Availability.tsx,
 * `DateRail` in Slots.tsx) so there is one date-picking pattern in the app, not two. `weekendDates`
 * stays — the composer's own day presets still need "the coming Saturday". */

/** The Saturday and Sunday of the coming weekend, as Hong Kong dates. A Saturday counts as its own
    weekend; a Sunday's weekend is the day itself, not the one six days out. */
export function weekendDates(today:string):string[]{
  const weekday=new Date(`${today}T12:00:00+08:00`).getUTCDay();          // 0 = Sunday
  if(weekday===0)return [today];
  const saturday=addDays(today,6-weekday);
  return [saturday,addDays(saturday,1)];
}

const addDays=(date:string,days:number)=>{
  const at=new Date(`${date}T12:00:00+08:00`);
  at.setUTCDate(at.getUTCDate()+days);
  return at.toISOString().slice(0,10);
};
