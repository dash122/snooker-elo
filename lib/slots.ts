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
