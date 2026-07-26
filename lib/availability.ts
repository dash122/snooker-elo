export type AvailabilitySlot = { id:string; playerId:string; startAt:string; endAt:string; createdAt:string; updatedAt:string; cancelledAt?:string|null };

export type Interval = { startAt:string; endAt:string };

const minute = 60_000;

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

export function recommendationScore(input:{minutes:number;eloDifference:number;recentMatches:number}) {
  if(input.minutes<30)return null;
  const overlap=Math.min(input.minutes/120,1)*60;
  const elo=Math.max(1-Math.abs(input.eloDifference)/400,0)*30;
  const variety=(1-Math.min(input.recentMatches,5)/5)*10;
  return {score:Math.round((overlap+elo+variety)*10)/10,overlap,elo,variety};
}
