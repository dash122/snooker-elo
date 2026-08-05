export type AvailabilitySlot = { id:string; playerId:string; startAt:string; endAt:string; createdAt:string; updatedAt:string; cancelledAt?:string|null };

export type Interval = { startAt:string; endAt:string };

const minute = 60_000;

/** How long after a slot begins it is still considered current. Shared by publishing, open calls and
    their expiry sweep so a member never meets three different opinions of "too late". */
export const AVAILABILITY_GRACE_MINUTES = 30;

export function validateAvailabilityInterval(input:Interval, now=Date.now()) {
  const startAt=Date.parse(input.startAt), endAt=Date.parse(input.endAt);
  if(!Number.isFinite(startAt)||!Number.isFinite(endAt)) throw new Error("Invalid availability time");
  if(startAt<now-AVAILABILITY_GRACE_MINUTES*minute) throw new Error("Availability must start in the future");
  if(endAt<=startAt) throw new Error("End time must be after start time");
  if(startAt%(30*minute)!==0 || endAt%(30*minute)!==0) throw new Error("Times must use 30-minute intervals");
  const duration=(endAt-startAt)/minute;
  if(duration<30) throw new Error("Availability must be at least 30 minutes");
  if(duration>720) throw new Error("Availability cannot be longer than 12 hours");
  const date=hongKongDay.format(startAt),calendarDayStart=Date.parse(`${date}T00:00:00+08:00`);
  const calendarStartMinutes=(startAt-calendarDayStart)/minute;
  const playingDayStart=calendarDayStart-(calendarStartMinutes<120?24*60*minute:0);
  const startMinutes=(startAt-playingDayStart)/minute,endMinutes=(endAt-playingDayStart)/minute;
  if(startMinutes<600||startMinutes>=1560||endMinutes>1560) throw new Error("Availability must be between 10:00 and 02:00 the next day");
  return {startAt:new Date(startAt).toISOString(),endAt:new Date(endAt).toISOString()};
}

const hongKongDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"});
const hongKongClock=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Hong_Kong",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});

/* Shared with any surface that lists availability slots (the Availability tab, a player's profile
   card, …), so "今天"/weekday labels and clock times never drift into two spellings. */
export const hkDate=(d=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
export const hkClock=(iso:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso));
export const hkDayLabel=(d:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"numeric",day:"numeric",weekday:"short"}).format(new Date(`${d}T00:00:00+08:00`));
export const hkRange=(x:Interval)=>`${hkClock(x.startAt)}–${hkClock(x.endAt)}`;

/** Calendar arithmetic on a `YYYY-MM-DD` Hong Kong date. Anchored at UTC noon so the shift never
    lands on the previous day the way a midnight-in-UTC+8 anchor does. */
export function addDaysHongKong(date:string,days:number) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid date");
  const at=new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate()+days);
  return at.toISOString().slice(0,10);
}

/** Day of the week for a Hong Kong calendar date, 0 = Sunday.
    Anchored at midday so the reading never falls on the wrong side of the UTC+8 offset the way a
    midnight anchor does — the same trap `addDaysHongKong` sidesteps. */
export function hongKongWeekday(date:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid date");
  return new Date(`${date}T12:00:00+08:00`).getUTCDay();
}

/** Which of the next `horizonDays` days fall on this weekday, as Hong Kong dates. The engine behind
    recurring availability: a rule is expanded to concrete days rather than stored as a query, so
    everything that reads availability keeps reading plain slots and knows nothing about recurrence. */
export function recurrenceDates(weekday:number,from:string,horizonDays:number) {
  const dates:string[]=[];
  for(let offset=0;offset<horizonDays;offset+=1){
    const date=addDaysHongKong(from,offset);
    if(hongKongWeekday(date)===weekday)dates.push(date);
  }
  return dates;
}

/** `2026-08-01` + `19:30` in Hong Kong, as an ISO instant. */
export function hongKongInstant(date:string,time:string) {
  if(!/^\d{2}:\d{2}$/.test(time))throw new Error("Invalid time");
  const at=Date.parse(`${date}T${time}:00+08:00`);
  if(!Number.isFinite(at))throw new Error("Invalid date");
  return new Date(at).toISOString();
}

/** A slot the member picked as a date plus two wall-clock times. An end at or before the start means
    the slot runs past midnight and finishes the next day. */
export function composeAvailabilityInterval(date:string,start:string,end:string):Interval {
  return {startAt:hongKongInstant(date,start),endAt:hongKongInstant(addDaysHongKong(date,end<=start?1:0),end)};
}

/** A slot painted on a day's timeline, measured in hours from that day's Hong Kong midnight. Hours
    past 24 belong to the following morning, which is how an overnight slot stays on one row. */
export function intervalFromHours(date:string,from:number,to:number):Interval {
  const clock=(hours:number)=>`${String(Math.floor(hours)%24).padStart(2,"0")}:${hours%1?"30":"00"}`;
  if(!(to>from))throw new Error("End time must be after start time");
  if(from<10||from>=26||to>26)throw new Error("Availability must be between 10:00 and 02:00 the next day");
  return {startAt:hongKongInstant(addDaysHongKong(date,Math.floor(from/24)),clock(from)),endAt:hongKongInstant(addDaysHongKong(date,Math.floor(to/24)),clock(to))};
}

/** The soonest start a member can still pick: the 30-minute boundary at or after 30 minutes ago, in
    Hong Kong terms, mirroring the grace window in `validateAvailabilityInterval`. A slot that just
    started remains pickable for a little while instead of vanishing from the menu the instant it begins. */
export function nextAvailabilityStart(now=Date.now()) {
  const at=Math.ceil((now-AVAILABILITY_GRACE_MINUTES*minute+1)/(30*minute))*(30*minute);
  return {date:hongKongDay.format(at),time:hongKongClock.format(at),at};
}

export function mergeIntervals<T extends Interval>(items:T[]):Interval[] {
  const sorted=items
    .filter(item=>Date.parse(item.endAt)>Date.parse(item.startAt))
    .map(item=>({startAt:new Date(item.startAt).toISOString(),endAt:new Date(item.endAt).toISOString()}))
    .sort((a,b)=>a.startAt.localeCompare(b.startAt));
  const merged:Interval[]=[];
  for(const item of sorted){
    const previous=merged.at(-1);
    if(previous&&Date.parse(item.startAt)<=Date.parse(previous.endAt)){
      if(Date.parse(item.endAt)>Date.parse(previous.endAt))previous.endAt=item.endAt;
    }else merged.push(item);
  }
  return merged;
}

export function intersectIntervals(left:Interval[],right:Interval[]):Interval[] {
  const overlaps:Interval[]=[];
  for(const a of left) for(const b of right){
    const startAt=Date.parse(a.startAt)>Date.parse(b.startAt)?a.startAt:b.startAt;
    const endAt=Date.parse(a.endAt)<Date.parse(b.endAt)?a.endAt:b.endAt;
    if(Date.parse(startAt)<Date.parse(endAt))overlaps.push({startAt,endAt});
  }
  return mergeIntervals(overlaps);
}

export function overlapMinutes(items:Interval[]) {
  return Math.round(items.reduce((total,item)=>total+(Date.parse(item.endAt)-Date.parse(item.startAt))/minute,0));
}

export function dayRangeHongKong(date:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid date");
  return {startAt:new Date(`${date}T00:00:00+08:00`).toISOString(),endAt:new Date(`${date}T24:00:00+08:00`).toISOString()};
}

export function clipToDay(items:Interval[],date:string) {
  const day=dayRangeHongKong(date);
  return intersectIntervals(items,[day]);
}

/** Widest window where the most members are simultaneously free. `perMember` is one entry per member. */
export function availabilityPeak(perMember:Interval[][]) {
  const events=perMember
    .flatMap(slots=>mergeIntervals(slots))
    .flatMap(slot=>[{at:Date.parse(slot.startAt),delta:1},{at:Date.parse(slot.endAt),delta:-1}])
    .sort((a,b)=>a.at-b.at);
  let live=0,index=0,best:{startAt:string;endAt:string;count:number}|null=null;
  while(index<events.length){
    const at=events[index].at;
    while(index<events.length&&events[index].at===at)live+=events[index++].delta;
    const next=events[index]?.at;
    if(next===undefined||live<1)continue;
    const wider=best!==null&&live===best.count&&next-at>Date.parse(best.endAt)-Date.parse(best.startAt);
    if(best===null||live>best.count||wider)best={startAt:new Date(at).toISOString(),endAt:new Date(next).toISOString(),count:live};
  }
  return best;
}

/** Member counts per fixed-width bucket between `lo` and `hi` hours from the start of `date`. */
export function availabilityDensity(perMember:Interval[][],date:string,lo:number,hi:number,stepMinutes=30) {
  const anchor=Date.parse(dayRangeHongKong(date).startAt),step=stepMinutes*minute;
  const merged=perMember.map(slots=>mergeIntervals(slots));
  const buckets:{at:string;count:number}[]=[];
  for(let start=anchor+lo*60*minute;start<anchor+hi*60*minute;start+=step){
    const end=start+step;
    buckets.push({at:new Date(start).toISOString(),count:merged.filter(slots=>slots.some(slot=>Date.parse(slot.startAt)<end&&Date.parse(slot.endAt)>start)).length});
  }
  return buckets;
}

/** What the club knows about how a member behaves once invited. Every field is optional and every
    missing field scores neutral — a newcomer with no history must never rank below a known flake
    simply for being unmeasured, which is the trap a naive reliability score falls into. */
export type ReliabilitySignals = { acceptRate?:number; showRate?:number; responseHours?:number };

const NEUTRAL = 0.5;
/** Answering within the hour is worth full marks; a day later is worth nothing. Snooker plans are
    made the same evening, so a reply that arrives tomorrow may as well not have arrived. */
const responsiveness=(hours?:number)=>hours===undefined?NEUTRAL:Math.max(0,Math.min(1,1-(hours-1)/23));

export function reliabilityFactor(signals?:ReliabilitySignals) {
  if(!signals)return NEUTRAL;
  const accept=signals.acceptRate??NEUTRAL,show=signals.showRate??NEUTRAL;
  return Math.max(0,Math.min(1,accept*.5+show*.3+responsiveness(signals.responseHours)*.2));
}

/** Whether a member currently wants a game, distinct from merely having free time.
 *
 *  "得閒" and "想打" are different facts — the whole reason this exists — so it stays its own signal
 *  rather than folding into availability. `tonight` and `window` both come with a real time slot (the
 *  intent doubles as an availability publish, so the rest of matchmaking never has to know it exists
 *  as a separate concept); `standby` has none and represents "ask me if something fits". */
export type IntentKind = "tonight"|"window"|"standby";
export type IntentSignal = { kind:IntentKind };

/** `tonight` is the strongest signal a shortlist can carry — immediate, unambiguous, expires in
    hours. `standby` is real but softer: a member who said "ask me" is not necessarily thinking about
    it right now, so it counts for less than an active `window` intent. Absence stays neutral, on the
    same principle as `reliabilityFactor`: a member who has not touched the intent control yet must
    never rank below one who deliberately said "not this week". */
const INTENT_STRENGTH:Record<IntentKind,number> = {tonight:1,window:.85,standby:.6};
export function intentFactor(intent?:IntentSignal) {
  return intent?INTENT_STRENGTH[intent.kind]:NEUTRAL;
}

/** How good a game is this likely to be, and how likely is it to actually happen?
 *
 *  The original model answered only the first half — overlap, ELO closeness and variety. That ranks
 *  the *fixture* rather than the *outcome*, so the member who never replies sat top of the list every
 *  evening, and the member who has no overlapping availability but is actively asking "who wants to
 *  play" was invisible to it. Reliability and intent are each roughly a seventh of the score: enough
 *  to move a proven, currently-keen partner above a marginally better-matched stranger who has not
 *  said a word about wanting a game, not enough to freeze the ranking into a clique. */
export function recommendationScore(input:{minutes:number;eloDifference:number;recentMatches:number;signals?:ReliabilitySignals;intent?:IntentSignal}) {
  if(input.minutes<30)return null;
  const overlap=Math.min(input.minutes/120,1)*40;
  const elo=Math.max(1-Math.abs(input.eloDifference)/400,0)*22;
  const variety=(1-Math.min(input.recentMatches,5)/5)*8;
  const reliability=reliabilityFactor(input.signals)*15;
  const intent=intentFactor(input.intent)*15;
  return {score:Math.round((overlap+elo+variety+reliability+intent)*10)/10,overlap,elo,variety,reliability,intent};
}

/** Every confirmed match ever played between two players, regardless of side. Shared by the
    matchmaking shortlist (「從沒交手」 is a lifetime check) and anywhere else "have these two played"
    needs an answer that outlives the 30-day recent-form window. */
export function matchesBetween<T extends {a:string;b:string;status:"confirmed"|"void"}>(matches:T[],x:string,y:string) {
  return matches.filter(m=>m.status==="confirmed"&&((m.a===x&&m.b===y)||(m.a===y&&m.b===x)));
}

/** Lifetime confirmed-match count for one player, singles only — mirrors the `a`/`b` participant
    check the rest of matchmaking already uses (team modes aren't part of this reckoning). */
export function gamesPlayed<T extends {a:string;b:string;status:"confirmed"|"void"}>(matches:T[],id:string) {
  return matches.filter(m=>m.status==="confirmed"&&(m.a===id||m.b===id)).length;
}

export type OpponentSlots={id:string;rating:number;slots:Interval[]};
export type RankedOpponent={id:string;overlaps:Interval[];minutes:number;recent:number;difference:number;score:number;qualifies:boolean;signals?:ReliabilitySignals;intent?:IntentSignal};

/** Everyone whose free time touches mine, best first — the whole shortlist, not just the top pick.
    `window` narrows both sides to one band, so a focused hour ranks on the hour actually asked about
    rather than on a whole-day overlap that happens elsewhere. */
export function rankOpponents(input:{mine:Interval[];rating:number;opponents:OpponentSlots[];recentMatches?:(id:string)=>number;window?:Interval|null;signals?:(id:string)=>ReliabilitySignals|undefined;intents?:(id:string)=>IntentSignal|undefined}):RankedOpponent[] {
  const mine=input.window?intersectIntervals(input.mine,[input.window]):mergeIntervals(input.mine);
  return input.opponents.flatMap(opponent=>{
    const overlaps=intersectIntervals(mine,opponent.slots),minutes=overlapMinutes(overlaps);
    if(minutes<=0)return [];
    const recent=input.recentMatches?.(opponent.id)??0,eloDifference=input.rating-opponent.rating;
    const signals=input.signals?.(opponent.id),intent=input.intents?.(opponent.id);
    const scored=recommendationScore({minutes,eloDifference,recentMatches:recent,signals,intent});
    return [{id:opponent.id,overlaps,minutes,recent,difference:Math.abs(eloDifference),score:scored?.score??-1,qualifies:Boolean(scored),signals,intent}];
  }).sort((a,b)=>b.score-a.score||b.minutes-a.minutes||a.difference-b.difference);
}

/* --- "I'm free now" ------------------------------------------------------- */

/** The interval behind the one-tap free-now button.
 *
 *  Rounds *down* to the half hour rather than up: at 19:42 a member is free now, not at 20:00, and
 *  the 30-minute grace window in `validateAvailabilityInterval` is exactly wide enough to accept it.
 *  Rounding up would also silently discard the next eighteen minutes of a member's evening. */
export function nowInterval(minutes:number,now=Date.now()):Interval {
  const step=30*minute;
  const startAt=Math.floor(now/step)*step;
  const length=Math.max(step,Math.round(minutes*minute/step)*step);
  return {startAt:new Date(startAt).toISOString(),endAt:new Date(startAt+length).toISOString()};
}

/* --- Mutual match offers -------------------------------------------------- */

export type OfferProposal={opponentId:string;startAt:string;endAt:string;minutes:number};

/** The longest overlap the two share, trimmed to a plausible session.
    A four-hour mutual gap is not a four-hour frame commitment; proposing the whole thing makes the
    offer easy to refuse. Two hours from the start of the widest window is the club's normal booking. */
const OFFER_LENGTH_MINUTES=120;
function offerWindow(overlaps:Interval[]):Interval|null {
  const widest=overlaps.reduce<Interval|null>((best,item)=>{
    const span=Date.parse(item.endAt)-Date.parse(item.startAt);
    return !best||span>Date.parse(best.endAt)-Date.parse(best.startAt)?item:best;
  },null);
  if(!widest)return null;
  const startAt=Date.parse(widest.startAt);
  return {startAt:widest.startAt,endAt:new Date(Math.min(Date.parse(widest.endAt),startAt+OFFER_LENGTH_MINUTES*minute)).toISOString()};
}

/** Who should be asked "有人同你夾到 — 打唔打?" after this member publishes time.
 *
 *  This is the half of matchmaking that removes the social risk: neither side is told the other
 *  declined, so saying no costs nothing and saying yes is not an exposure. That only works if the
 *  ask stays rare and well-targeted — a broadcast to everyone free tonight would train members to
 *  ignore it within a week. Hence: a real overlap (an hour, not a passing fifteen minutes), nobody
 *  already mid-conversation with this member, and a hard cap on how many go out at once, closest
 *  ELO first. */
export function proposeMatchOffers(input:{
  mine:Interval[]; rating:number; opponents:OpponentSlots[];
  /** Anyone already in a live offer, a pending invite or a confirmed game with this member. */
  excluded?:Iterable<string>;
  minMinutes?:number; limit?:number;
}):OfferProposal[] {
  const skip=new Set(input.excluded??[]);
  const minMinutes=input.minMinutes??60,limit=input.limit??3;
  const mine=mergeIntervals(input.mine);
  return input.opponents
    .filter(opponent=>!skip.has(opponent.id))
    .flatMap(opponent=>{
      const overlaps=intersectIntervals(mine,opponent.slots);
      if(overlapMinutes(overlaps)<minMinutes)return [];
      const window=offerWindow(overlaps);
      if(!window)return [];
      return [{opponentId:opponent.id,startAt:window.startAt,endAt:window.endAt,
        minutes:overlapMinutes(overlaps),difference:Math.abs(input.rating-opponent.rating)}];
    })
    .sort((a,b)=>a.difference-b.difference||b.minutes-a.minutes)
    .slice(0,limit)
    .map(({opponentId,startAt,endAt,minutes})=>({opponentId,startAt,endAt,minutes}));
}

export type OfferSide="a"|"b";
export type MutualOffer={
  id:string; startAt:string; endAt:string; venue:string; status:"live"|"matched"|"dead"|"expired";
  createdAt:string; opponent:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null};
  /** This member's own answer. The other side's is deliberately never sent to the client — that
      secrecy is the whole reason declining is safe. */
  myResponse:"pending"|"yes"|"no";
};

/** A live offer stops being answerable once its slot has begun, on the same grace window everything
    else in matchmaking uses. */
export function isOfferLive(offer:{status:string;startAt:string},now=Date.now()) {
  return offer.status==="live"&&Date.parse(offer.startAt)>now-AVAILABILITY_GRACE_MINUTES*minute;
}

export function partitionOffers<T extends MutualOffer>(offers:T[],now=Date.now()) {
  const live=offers.filter(offer=>isOfferLive(offer,now)).sort((a,b)=>a.startAt.localeCompare(b.startAt));
  return {awaitingMe:live.filter(offer=>offer.myResponse==="pending"),answered:live.filter(offer=>offer.myResponse!=="pending")};
}

/* --- Invite lifecycle ---------------------------------------------------- */

export type InviteLifecycleStatus="pending"|"accepted"|"declined"|"cancelled"|"expired"|"played"|"missed";
export type InviteCounterProposal={startAt:string;endAt:string;byPlayerId:string};
export type LifecycleInvite={
  id:string; startAt:string; endAt:string; status:InviteLifecycleStatus;
  createdAt:string; fromPlayer:{id:string}; toPlayer:{id:string};
  counter?:InviteCounterProposal|null;
};

/** The times an invite is currently about. A counter-proposal supersedes the original, so every
    deadline, label and sort key downstream reads through here rather than off the raw columns. */
export function invitedSlot<T extends {startAt:string;endAt:string;counter?:InviteCounterProposal|null}>(invite:T):Interval {
  return invite.counter?{startAt:invite.counter.startAt,endAt:invite.counter.endAt}:{startAt:invite.startAt,endAt:invite.endAt};
}

/** A pending invite is only answerable until the slot it proposes begins. Past that, "still waiting"
    is a lie to the sender and a guilt trip for the recipient, so it expires. Keeping this as one
    named predicate means the database sweep and the client agree on the cutoff to the millisecond. */
export function isInviteExpired(invite:{status:string;startAt:string;counter?:InviteCounterProposal|null},now=Date.now()) {
  return invite.status==="pending"&&Date.parse(invite.counter?.startAt??invite.startAt)<=now;
}

/** Whose turn is it?
 *
 *  Normally the recipient's. Once someone counter-proposes it is the *other* side's, whichever
 *  direction the invite originally went. Every surface that sorts an inbox or draws a button asks
 *  this one question, so a member is never shown an action the server would refuse — and, more
 *  importantly, never has an invite silently waiting on them in a bucket labelled "waiting on them". */
export function inviteOwedBy(invite:LifecycleInvite):string {
  return invite.counter?(invite.counter.byPlayerId===invite.fromPlayer.id?invite.toPlayer.id:invite.fromPlayer.id):invite.toPlayer.id;
}

/** An accepted invite whose slot has finished but whose result nobody has recorded. This is the step
    the funnel used to lose silently: the app knew two members agreed to play and then never asked
    whether they did. */
export function inviteAwaitsOutcome(invite:{status:string;endAt:string},now=Date.now()) {
  return invite.status==="accepted"&&Date.parse(invite.endAt)<=now;
}

/** Has a confirmed match between these two been recorded on or after the invited slot's day? Used to
    retire a follow-up prompt the moment the score lands, so members who already did the right thing
    are never nagged for it. */
export function hasRecordedMatchSince<T extends {a:string;b:string;playedOn:string;status:"confirmed"|"void"}>(
  matches:T[],x:string,y:string,sinceDate:string
) {
  return matchesBetween(matches,x,y).some(match=>(match.playedOn||"")>=sinceDate);
}

export type InviteBuckets<T>={needsResponse:T[];awaitingReply:T[];upcoming:T[];followUps:T[]};

/** The whole invite inbox in one pass, ordered the way a member would triage it: what needs an answer
    from me, what I am waiting on, what is locked in, and what still needs a score. Sorting is by the
    slot time rather than creation time so "next game" always means next, and every bucket is a full
    list — surfacing only the first pending invite is how three people asking to play reads as two of
    them being ignored. */
export function partitionInvites<T extends LifecycleInvite>(input:{
  sent:T[]; received:T[]; playerId:string;
  matches?:{a:string;b:string;playedOn:string;status:"confirmed"|"void"}[];
  now?:number;
}):InviteBuckets<T> {
  const now=input.now??Date.now(),matches=input.matches??[];
  const bySlot=(a:T,b:T)=>invitedSlot(a).startAt.localeCompare(invitedSlot(b).startAt);
  const live=(invite:T)=>!isInviteExpired(invite,now);
  const other=(invite:T)=>invite.fromPlayer.id===input.playerId?invite.toPlayer.id:invite.fromPlayer.id;
  const settled=(invite:T)=>hasRecordedMatchSince(matches,input.playerId,other(invite),hkDate(new Date(invitedSlot(invite).startAt)));
  const accepted=[...input.sent,...input.received].filter(invite=>invite.status==="accepted");
  /* Both directions go into one pile before being split by whose turn it is, rather than assuming
     sent = waiting and received = mine to answer. After a counter-proposal that assumption is
     exactly backwards, and an invite waiting on me would sit in "等對方回覆" where I would never
     think to look for it. */
  const pending=[...input.sent,...input.received].filter(invite=>invite.status==="pending"&&live(invite));
  return {
    needsResponse:pending.filter(invite=>inviteOwedBy(invite)===input.playerId).sort(bySlot),
    awaitingReply:pending.filter(invite=>inviteOwedBy(invite)!==input.playerId).sort(bySlot),
    upcoming:accepted.filter(invite=>!inviteAwaitsOutcome(invite,now)).sort(bySlot),
    followUps:accepted.filter(invite=>inviteAwaitsOutcome(invite,now)&&!settled(invite)).sort(bySlot),
  };
}

/* --- Open calls ---------------------------------------------------------- */

export type OpenCallStatus="open"|"claimed"|"cancelled"|"expired";

/** An open call stays claimable until its slot has been under way for longer than the grace window —
    the same 30 minutes `validateAvailabilityInterval` already allows when publishing. A member
    standing at the table who posted "starting now" must still be visible to the club; holding this
    to a strict `startAt > now` made a freshly posted call disappear from its own author's screen. */
export function isOpenCallLive(call:{status:string;startAt:string},now=Date.now()) {
  return call.status==="open"&&Date.parse(call.startAt)>now-AVAILABILITY_GRACE_MINUTES*minute;
}

/** Open calls a member can act on, soonest first, with their own calls separated out — you cannot
    claim your own table, and mixing the two lists makes the board read as busier than it is. */
export function partitionOpenCalls<T extends {id:string;status:string;startAt:string;player:{id:string}}>(
  calls:T[],playerId:string|undefined,now=Date.now()
) {
  const live=calls.filter(call=>isOpenCallLive(call,now)).sort((a,b)=>a.startAt.localeCompare(b.startAt));
  return {mine:live.filter(call=>call.player.id===playerId),others:live.filter(call=>call.player.id!==playerId)};
}

/* --- Intent ---------------------------------------------------------------
 *
 * "得閒" and "想打" are different facts. Availability answers the first; intent answers the second,
 * and it decays on its own rather than sitting stale until a member remembers to clear it — a
 * `standby` flag left on for a month is worse than no signal at all, because it teaches the shortlist
 * to keep offering someone who stopped meaning it weeks ago. */

/** How long a `standby` intent (no window attached) stays live before it must be renewed. Also the
    ceiling for `window` intents whose own end is further out than that — nobody's "I want a game this
    week" should still be steering a shortlist a fortnight later. */
const INTENT_STANDBY_HOURS = 72;

export function intentExpiry(kind:IntentKind,window:Interval|null,now=Date.now()) {
  const cap = now+INTENT_STANDBY_HOURS*60*minute;
  if(kind==="standby"||!window)return new Date(cap).toISOString();
  return new Date(Math.min(Date.parse(window.endAt),cap)).toISOString();
}

export function isIntentLive(intent:{status:string;expiresAt:string},now=Date.now()) {
  return intent.status==="live"&&Date.parse(intent.expiresAt)>now;
}
