export type AvailabilitySlot = { id:string; playerId:string; startAt:string; endAt:string; createdAt:string; updatedAt:string; cancelledAt?:string|null };

export type Interval = { startAt:string; endAt:string };

const minute = 60_000;

export function validateAvailabilityInterval(input:Interval, now=Date.now()) {
  const startAt=Date.parse(input.startAt), endAt=Date.parse(input.endAt);
  if(!Number.isFinite(startAt)||!Number.isFinite(endAt)) throw new Error("Invalid availability time");
  if(startAt<=now) throw new Error("Availability must start in the future");
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

/** Calendar arithmetic on a `YYYY-MM-DD` Hong Kong date. Anchored at UTC noon so the shift never
    lands on the previous day the way a midnight-in-UTC+8 anchor does. */
export function addDaysHongKong(date:string,days:number) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid date");
  const at=new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate()+days);
  return at.toISOString().slice(0,10);
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

/** The soonest start a member can still pick: the next 30-minute boundary, in Hong Kong terms. */
export function nextAvailabilityStart(now=Date.now()) {
  const at=Math.ceil((now+1)/(30*minute))*(30*minute);
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

export function recommendationScore(input:{minutes:number;eloDifference:number;recentMatches:number}) {
  if(input.minutes<30)return null;
  const overlap=Math.min(input.minutes/120,1)*60;
  const elo=Math.max(1-Math.abs(input.eloDifference)/400,0)*30;
  const variety=(1-Math.min(input.recentMatches,5)/5)*10;
  return {score:Math.round((overlap+elo+variety)*10)/10,overlap,elo,variety};
}
