import { AVAILABILITY_MINUTES } from "./availability.ts";

/* --- 時段軸 · one gesture, two answers --------------------------------------
 *
 * The band is the whole redesign in one object. Before it, publishing a slot and looking for an
 * opponent were different journeys through different components writing and reading the same table:
 * a member declared into a void from `逐格編輯`, then navigated back to `約戰` to find out whether
 * the declaration had been worth making. Most people did neither.
 *
 * Here the window a member drags *is* the query and *is* the declaration. Every function below is
 * used by both sides of that at once — `overlapping()` answers 「這段時間有誰」 for a window that has
 * not been published yet, and the very same window is what `POST /api/availability` receives when
 * they confirm. That is the only reason the two journeys can collapse: they were always the same
 * fact, asked in two directions.
 *
 * Columns, not minutes. The band is a fixed grid of half-hour columns because that is the
 * granularity `availability_slots` already stores (`AVAILABILITY_MINUTES`), so a dragged window is
 * always expressible as a real slot and never needs rounding at save time. Index 0 is
 * `BAND_START_HOUR` on the selected date; indices past midnight belong to the next morning, which is
 * what keeps a 23:30–01:00 evening one continuous run rather than two stumps at opposite ends. */

/** The band's span: 17:00 to 01:00 the next morning. Deliberately narrower than the roster grid's
    10:00–02:00 — the grid is a lookup tool that must never hide a slot, the band is a decision
    surface, and eight dead columns of afternoon push the evening into a third of the width on a
    phone. Slots outside the span are still saved and still shown in the roster; they just are not
    draggable here. */
export const BAND_START_HOUR = 17;
export const BAND_END_HOUR = 25;
export const BAND_COLUMNS = ((BAND_END_HOUR - BAND_START_HOUR) * 60) / AVAILABILITY_MINUTES;

/** Shortest window the band will produce. Anything under half an hour is a mis-tap, not an
    intention, and would save a slot no opponent could act on. */
export const MIN_COLUMNS = 1;
/** What a tap (as opposed to a drag) means: two hours, the club's usual frame count. */
export const TAP_COLUMNS = 4;

export type Window = { from:number; to:number };

const pad = (n:number) => String(n).padStart(2,"0");

/** Column index → wall clock. Past midnight reads 00:30, not 24:30: the label is what a member says
    out loud, while the index keeps the evening contiguous. */
export function columnClock(column:number):string{
  const minutes = BAND_START_HOUR*60 + column*AVAILABILITY_MINUTES;
  const hour = Math.floor(minutes/60)%24;
  return `${pad(hour)}:${pad(minutes%60)}`;
}

/** Column index → the ISO instant it begins, on `date` in Hong Kong. Columns at or past 24:00 roll
    onto the following calendar day, which is how the saved slot stays a single interval. */
export function columnInstant(date:string,column:number):string{
  const minutes = BAND_START_HOUR*60 + column*AVAILABILITY_MINUTES;
  const dayOffset = Math.floor(minutes/1440);
  const withinDay = minutes%1440;
  const base = new Date(`${date}T00:00:00+08:00`);
  base.setUTCDate(base.getUTCDate()+dayOffset);
  const rolled = base.toLocaleDateString("en-CA",{timeZone:"Asia/Hong_Kong"});
  return `${rolled}T${pad(Math.floor(withinDay/60))}:${pad(withinDay%60)}:00+08:00`;
}

/** An instant → the column it falls in, relative to `date`. Returns a value outside
    `[0, BAND_COLUMNS]` for instants off the band; callers clamp when they need to draw, and check
    the raw value when they need to know something fell outside. */
export function instantColumn(date:string,iso:string):number{
  const dayStart = Date.parse(`${date}T00:00:00+08:00`);
  const minutes = (Date.parse(iso)-dayStart)/60000;
  return (minutes - BAND_START_HOUR*60)/AVAILABILITY_MINUTES;
}

export function clampColumn(column:number):number{
  return Math.max(0,Math.min(BAND_COLUMNS,Math.round(column)));
}

/** A window is legal when it is inside the band and at least `MIN_COLUMNS` wide. Drag handlers are
    free to produce nonsense mid-gesture; this is what decides whether it can be saved. */
export function normaliseWindow(window:Window):Window{
  const from = clampColumn(Math.min(window.from,window.to));
  const to = clampColumn(Math.max(window.from,window.to));
  /* Widen forwards where there is room, backwards where there is not: a member who drags onto the
     band's last column means 「到收爐」, and collapsing that to a zero-width window would make the
     final half hour the one stretch of the evening nobody can publish. */
  if(to-from>=MIN_COLUMNS)return {from,to};
  if(from+MIN_COLUMNS<=BAND_COLUMNS)return {from,to:from+MIN_COLUMNS};
  return {from:BAND_COLUMNS-MIN_COLUMNS,to:BAND_COLUMNS};
}

export type BandSlot = { from:number; to:number };
export type BandPerson = { playerId:string; slots:BandSlot[] };

/** How many people occupy each column. A column counts a person only when their slot spans its
    whole width — the same rule `lib/overlap.ts` applies, and for the same reason: 「兩人 19:00 重疊」
    has to mean both were there for that half hour, not that one arrived as the other left. */
export function density(people:BandPerson[]):number[]{
  const columns = new Array(BAND_COLUMNS).fill(0);
  for(const person of people){
    const covered = new Set<number>();
    for(const slot of person.slots){
      const from = Math.max(0,Math.ceil(slot.from));
      const to = Math.min(BAND_COLUMNS,Math.floor(slot.to));
      for(let i=from;i<to;i++)covered.add(i);
    }
    for(const column of covered)columns[column]+=1;
  }
  return columns;
}

export function peakOf(columns:number[]):number{
  return columns.reduce((best,value)=>value>best?value:best,0);
}

/** The busiest *run*, not the first column that touches the peak — a member choosing when to arrive
    wants the width of the busy window, not its opening minute. Falls back to the club's default
    evening when nobody has published, so the band always opens somewhere defensible. */
export function peakWindow(columns:number[]):Window{
  const peak = peakOf(columns);
  if(peak===0){
    const from = ((19-BAND_START_HOUR)*60)/AVAILABILITY_MINUTES;
    return {from,to:from+TAP_COLUMNS};
  }
  let bestFrom=-1,bestTo=-1,runFrom=-1;
  columns.forEach((value,index)=>{
    const atPeak = value===peak;
    if(atPeak&&runFrom<0)runFrom=index;
    const runEnds = !atPeak||index===columns.length-1;
    if(runFrom>=0&&runEnds){
      const to = atPeak?index+1:index;
      if(bestFrom<0||to-runFrom>bestTo-bestFrom){bestFrom=runFrom;bestTo=to}
      runFrom=-1;
    }
  });
  /* Widen a narrow peak out to a playable window rather than proposing a member publish twenty
     minutes. The peak stays inside what we propose, which is the part that matters. */
  const width = Math.max(TAP_COLUMNS,bestTo-bestFrom);
  const from = Math.max(0,Math.min(BAND_COLUMNS-width,bestFrom-Math.floor((width-(bestTo-bestFrom))/2)));
  return {from,to:from+width};
}

/** Everyone whose published time touches this window. The one function the whole seam rests on: it
    answers for a window that exists only in the member's finger, which is why the payoff can be
    shown before the commitment rather than after it. */
export function overlapping<T extends BandPerson>(people:T[],window:Window):T[]{
  return people.filter(person=>person.slots.some(slot=>slot.from<window.to&&slot.to>window.from));
}

/** The widest stretch of this window during which `playerId` and the reader are both free — what
    the invite should propose, so the member never picks a time twice. */
export function sharedWindow(person:BandPerson,window:Window):Window|null{
  let best:Window|null=null;
  for(const slot of person.slots){
    const from = Math.max(slot.from,window.from);
    const to = Math.min(slot.to,window.to);
    if(to-from<MIN_COLUMNS)continue;
    if(!best||to-from>best.to-best.from)best={from,to};
  }
  return best;
}

/** ELO bands for a gated row. A locked row still has to say something true about who is behind it —
    「1450–1500」 is what makes the lock read as an invitation rather than a wall — while never
    narrowing far enough to identify one member of a fourteen-person club. */
export function ratingBand(rating:number,step=50):string{
  const floor = Math.floor(rating/step)*step;
  return `${floor}–${floor+step}`;
}
