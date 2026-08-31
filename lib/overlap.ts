import { AVAILABILITY_MINUTES } from "./availability.ts";

/* --- 重疊 · when are we actually in the same room? -------------------------
 *
 * A day is not one session. Eight members spread from 14:00 to midnight never meet, and a screen
 * that prints 「8 人會去」 is telling them something true about the date and useless about the
 * evening. What a member needs before leaving home is the *overlap*: how many people are there at
 * once, and between which hours.
 *
 * So the unit here is a half-hour bucket, matching `AVAILABILITY_MINUTES` — the granularity members
 * already publish at. Anything coarser silently merges 18:00 and 21:00 people into one number; the
 * whole reason this module exists is that such a number lies.
 *
 * Two commitments feed it. `going` counts toward the overlap. `interested` never does: it is a
 * subscription — 「夠人叫我」 — and counting a subscription as attendance would inflate exactly the
 * figure a member is about to act on. Interested members are tallied separately so the screen can
 * say who is waiting on the room to fill without pretending they are in it. */

export type Commitment = "going"|"interested";

export function isCommitment(value:unknown):value is Commitment {
  return value==="going"||value==="interested";
}

export const COMMITMENT_LABELS:Record<Commitment,string> = { going:"我會去", interested:"有興趣" };

export type SlotLike = { playerId:string; startAt:string; endAt:string; commitment:Commitment };

export type Bucket = {
  /** Minutes from midnight Hong Kong time; may exceed 24*60 for after-midnight play. */
  minutes:number;
  label:string;
  going:number;
  interested:number;
};

export type OverlapView = {
  buckets:Bucket[];
  /** The largest number of `going` members present at the same moment. */
  peak:number;
  /** The window that peak spans, as HH:MM strings, or null when nobody has committed. */
  peakStart:string|null;
  peakEnd:string|null;
  /** Distinct members with a `going` slot anywhere in the day — the honest "all day" figure, kept
      well away from the headline so it is never mistaken for people who will meet. */
  goingTotal:number;
  interestedTotal:number;
};

const pad=(n:number)=>String(n).padStart(2,"0");

/** Minutes-from-midnight for an instant, in Hong Kong time, carrying past 24:00 when the window
    started the previous evening — a 23:30–01:00 slot has to stay contiguous on the strip. */
export function hkMinutes(iso:string,dayStartMs:number):number{
  const delta=(Date.parse(iso)-dayStartMs)/60000;
  return Math.round(delta);
}

export function clockLabel(minutes:number):string{
  const normalised=((minutes%1440)+1440)%1440;
  return `${pad(Math.floor(normalised/60))}:${pad(normalised%60)}`;
}

/** The day's strip runs from the club's earliest realistic start to after midnight, so an evening
    that runs past 00:00 is one continuous run of buckets rather than two ends of the same row. */
export const STRIP_START_MINUTES = 10*60;
export const STRIP_END_MINUTES = 26*60;

export function overlapView(slots:SlotLike[],dayStartMs:number):OverlapView{
  const count=(STRIP_END_MINUTES-STRIP_START_MINUTES)/AVAILABILITY_MINUTES;
  const buckets:Bucket[]=Array.from({length:count},(_,index)=>{
    const minutes=STRIP_START_MINUTES+index*AVAILABILITY_MINUTES;
    return {minutes,label:clockLabel(minutes),going:0,interested:0};
  });

  const goingPlayers=new Set<string>();
  const interestedPlayers=new Set<string>();

  for(const slot of slots){
    const from=hkMinutes(slot.startAt,dayStartMs);
    const to=hkMinutes(slot.endAt,dayStartMs);
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)continue;
    (slot.commitment==="going"?goingPlayers:interestedPlayers).add(slot.playerId);
    for(const bucket of buckets){
      /* A bucket is covered when the slot spans its whole width. Half-covered buckets are not
         counted: 「兩個人 19:00 撞到」 has to mean they are both there for that half hour, not that
         one arrived as the other left. */
      if(bucket.minutes>=from&&bucket.minutes+AVAILABILITY_MINUTES<=to){
        if(slot.commitment==="going")bucket.going+=1; else bucket.interested+=1;
      }
    }
  }

  let peak=0;
  for(const bucket of buckets)if(bucket.going>peak)peak=bucket.going;

  /* The longest run at the peak, not merely the first bucket that reaches it — a member deciding
     when to leave wants the width of the busy window, not its opening minute. */
  let peakStart:string|null=null,peakEnd:string|null=null;
  if(peak>0){
    let bestFrom=-1,bestTo=-1,runFrom=-1;
    buckets.forEach((bucket,index)=>{
      const atPeak=bucket.going===peak;
      if(atPeak&&runFrom<0)runFrom=index;
      const runEnds=!atPeak||index===buckets.length-1;
      if(runFrom>=0&&runEnds){
        const to=atPeak?index:index-1;
        /* `bestFrom<0` first: a run of one bucket spans zero, which would never beat the zero span
           of the uninitialised best and would leave the window unset entirely. */
        if(bestFrom<0||to-runFrom>bestTo-bestFrom){bestFrom=runFrom;bestTo=to}
        runFrom=-1;
      }
    });
    peakStart=clockLabel(buckets[bestFrom].minutes);
    peakEnd=clockLabel(buckets[bestTo].minutes+AVAILABILITY_MINUTES);
  }

  return {
    buckets,
    peak,
    peakStart,
    peakEnd,
    goingTotal:goingPlayers.size,
    interestedTotal:interestedPlayers.size,
  };
}

/** The headline. The peak leads because it is the number a member can act on; the all-day figure
    follows, and only when it differs — printing 「全日 3 人」 beside 「3 人」 is noise. */
export function overlapHeadline(view:OverlapView):string{
  if(view.peak===0)return view.goingTotal>0?"未有人時間撞到":"今日未有人";
  return `${view.peak} 人 · ${view.peakStart}–${view.peakEnd}`;
}

/** Trim the strip to the part worth drawing: from the first bucket anybody occupies to the last,
    with a little air either side. A strip that always spans 10:00–02:00 is mostly empty columns. */
export function visibleBuckets(view:OverlapView,padBuckets=2):Bucket[]{
  const used=view.buckets.map((b,i)=>({b,i})).filter(({b})=>b.going>0||b.interested>0).map(({i})=>i);
  if(!used.length){
    const from=(18*60-STRIP_START_MINUTES)/AVAILABILITY_MINUTES;
    return view.buckets.slice(from,from+8);
  }
  const lo=Math.max(0,Math.min(...used)-padBuckets);
  const hi=Math.min(view.buckets.length,Math.max(...used)+padBuckets+1);
  return view.buckets.slice(lo,hi);
}

/** Does this member's own window touch the busiest run? The one line that turns a headcount into a
    decision: 「你揀嘅時間同 4 個人撞到」. */
export function overlapWithMine(view:OverlapView,mine:{startAt:string;endAt:string}|null,dayStartMs:number):number{
  if(!mine)return 0;
  const from=hkMinutes(mine.startAt,dayStartMs),to=hkMinutes(mine.endAt,dayStartMs);
  let best=0;
  for(const bucket of view.buckets){
    if(bucket.minutes>=from&&bucket.minutes+AVAILABILITY_MINUTES<=to&&bucket.going>best)best=bucket.going;
  }
  return best;
}
