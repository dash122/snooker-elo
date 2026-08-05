import type { Interval } from "./availability";

/* --- Sessions --------------------------------------------------------------
 *
 * One slot is one session: a block of time a member has set aside to play. 今晚 21:00–23:00 is a
 * session; Friday 11:00–14:00 is another; a member can hold several at once and each stands or falls
 * on its own.
 *
 * This replaces three concepts that were really one. An availability slot said "I could play then",
 * an intent said "I want a game", and an open call said "come take this time" — three records, three
 * screens, three ways to say the same sentence, which is exactly why the tab grew four controls that
 * all did the same thing. A session is the sentence: *I have set aside this time and I am looking
 * for someone to play it with.*
 *
 * Everything else on the screen hangs off a session rather than floating beside it. A recommendation
 * is always a recommendation *for a particular evening*, so it belongs on that evening's card — not
 * in a global shortlist that leaves the member to work out which of their slots it refers to. */

const minute = 60_000;

export type SessionStatus =
  /** Nobody has agreed yet. The card carries the best opponent for this time. */
  | "looking"
  /** Somebody said yes. The card carries the fixture. */
  | "booked"
  /** The time has passed with a game agreed, and no score recorded yet. */
  | "toRecord"
  /** Played and scored. Nothing is owed; the card is history. */
  | "done"
  /** The time has passed with nothing agreed. Shown once, quietly, then it stops mattering. */
  | "missed";

export type SessionInput = {
  id:string; startAt:string; endAt:string;
  /** A confirmed game inside this window, if one exists. */
  booking?:{inviteId:string;opponentId:string;startAt:string;endAt:string}|null;
  /** Whether that booking's result has already been recorded. */
  recorded?:boolean;
};

export function sessionStatus(session:SessionInput,now=Date.now()):SessionStatus {
  const over=Date.parse(session.endAt)<=now;
  if(session.booking){
    if(!over)return "booked";
    return session.recorded?"done":"toRecord";
  }
  return over?"missed":"looking";
}

/** Has this session begun? Drives the "而家進行緊" treatment, and the reason the grace window matters:
    a member standing at the table at 21:05 has not missed their own 21:00 session. */
export function sessionLive(session:SessionInput,now=Date.now()) {
  return Date.parse(session.startAt)<=now&&Date.parse(session.endAt)>now;
}

/** Sessions in the order a member thinks about them: what is happening now or next, first.
 *
 *  Finished sessions sink rather than disappearing — one that needs a score recorded is a real
 *  obligation, and one that simply passed is worth seeing once so the member knows the evening
 *  closed rather than wondering whether the app is still looking. */
const STATUS_WEIGHT:Record<SessionStatus,number> = {toRecord:0,booked:1,looking:1,done:2,missed:2};

export function sortSessions<T extends SessionInput>(sessions:T[],now=Date.now()):T[] {
  return [...sessions].sort((a,b)=>{
    const byStatus=STATUS_WEIGHT[sessionStatus(a,now)]-STATUS_WEIGHT[sessionStatus(b,now)];
    return byStatus||a.startAt.localeCompare(b.startAt);
  });
}

/** A finished, unplayed session stops being shown after this long. Keeping 「上星期三你冇打成」 on
    screen forever is a reproach, not information. */
const MISSED_VISIBLE_HOURS = 12;

export function visibleSessions<T extends SessionInput>(sessions:T[],now=Date.now()):T[] {
  return sessions.filter(session=>{
    const status=sessionStatus(session,now);
    if(status==="toRecord")return true;
    return Date.parse(session.endAt)>now-MISSED_VISIBLE_HOURS*60*minute;
  });
}

/* --- Creating one ---------------------------------------------------------
 *
 * The whole creation flow is two taps: which evening, and until when. Everything the old form asked
 * on top of that — how long, what kind of game, whether you are at the club — was either derivable,
 * or a question that belongs on a profile, or a question nobody should be asked before they have
 * been shown a single opponent. */

export type SessionShape = "tonight"|"weekend"|"pick";

/** The evening options offered on the cold open, resolved against today's Hong Kong date. `weekend`
    means the next Saturday — the club's busiest afternoon, and the one a member means when they say
    「今個週末」 on a Tuesday. */
export function defaultEnd(startHour:number){
  return startHour<22?"23:00":"01:00";
}

/** Half-hour boundary at or after now, as an ISO instant. A session starting "now" is honest about
    starting now; rounding up would quietly discard the rest of the current half hour. */
export function nowStart(now=Date.now()){
  const step=30*minute;
  return new Date(Math.floor(now/step)*step).toISOString();
}

/** Sessions must not silently overlap: two sessions covering the same evening are one session the
    member entered twice, and they would produce two cards racing to fill the same table. */
export function overlapsExisting(candidate:Interval,existing:Interval[]) {
  return existing.some(session=>
    Date.parse(candidate.startAt)<Date.parse(session.endAt)
    &&Date.parse(candidate.endAt)>Date.parse(session.startAt));
}
