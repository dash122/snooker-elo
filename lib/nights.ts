/* --- 場次 · one night, one number ------------------------------------------
 *
 * The club's matchmaking has always modelled a *pair*: an invite has a from and a to, an offer has
 * an A and a B, a posted slot has a `filled_by` — singular. Nothing modelled 「星期二夜晚」, the
 * thing members are actually deciding about. The question they ask before leaving home is not "who
 * will play me", it is 「今晚上去有無人」, and a product that cannot answer it makes them guess.
 *
 * So a night is the object, and it is *derived* — every evening exists whether or not anybody has
 * acted on it. Nobody has to be the first mover, and there is no empty state asking a member to
 * take initiative before they can see anything.
 *
 * What a member writes against a night is a **confidence**, not a commitment. Three levels, because
 * two forces the lie back (a 70%-likely member has to pick 好呀 or 唔得, so they pick silence) and
 * four is a decision. What each level is *worth* is never what the member declared — it is their own
 * historical conversion at that level, so the optimist and the realist are both counted accurately
 * and neither is ever corrected, told off, or shown a score.
 *
 * Everything in this file is pure and unit-tested. The database supplies signals and calibration;
 * the arithmetic that turns them into a number a member will act on lives here. */

/** How likely you are to turn up. Deliberately about *you* — who you would play is a separate axis
    that this slice does not model yet (see 開團 / 指定 in the design memo). */
export type Confidence = "high"|"mid"|"low"|"out";

export const CONFIDENCE_LABELS:Record<Confidence,string> = {
  high:"一定去", mid:"應該去", low:"睇下先", out:"今晚唔得",
};

/** Said before the tap, not after. A member choosing a level is choosing what the club will read
    about them, and 「唔會有人追你」 is the part that makes 睇下先 safe to press. */
export const CONFIDENCE_HINTS:Record<Confidence,string> = {
  high:"會顯示你個名，計入確定人數",
  mid:"只計人數，唔會顯示名，冇人會追你",
  low:"只計人數，隨時可以改",
  out:"唔會再收到今晚嘅提示",
};

/** The club-wide fallback conversion for each level, used until a member has enough history of
    their own. These are priors, not targets: 0.5 for 應該去 says the honest thing, which is that a
    hedge is a coin toss until that particular member proves otherwise. */
export const BASE_RATE:Record<Confidence,number> = { high:0.9, mid:0.5, low:0.2, out:0 };

/** Below this many observations a member's own rate is noise, so the club prior is used instead.
    Two missed evenings in somebody's first week must not brand them for the season. */
export const MIN_CALIBRATION_SAMPLE = 5;

/* --- 夠人就去 --------------------------------------------------------------
 *
 * Not a fourth confidence level but a trigger riding on an existing one: 「有 N 個我就實去」. It is
 * the exact thought a member already has and currently has no way to express, so today it produces
 * nothing at all. Made explicit it becomes a pool of people who will each come if enough of them
 * will — a coordination problem software solves easily and a group chat solves badly.
 *
 * The threshold is the member's own, not a club constant. What counts as 「夠人」 is a personal
 * judgement (one member wants a partner, another wants a crowd) and hard-coding it would be the
 * product telling members what a good evening is. Two is the floor because below two there is no
 * game to be had. */
export const MIN_QUORUM = 2;
export const MAX_QUORUM = 12;
export const DEFAULT_QUORUM = 2;
export const QUORUM_CHOICES = [2,3,4,6] as const;

export function isConfidence(value:unknown):value is Confidence {
  return value==="high"||value==="mid"||value==="low"||value==="out";
}

/** Clamp a submitted threshold, or drop it entirely. Returns null for "no condition", which is also
    what an out-of-range or non-numeric value degrades to — a malformed threshold must never become
    a silent promise to show up. */
export function normaliseQuorum(value:unknown):number|null {
  if(value===null||value===undefined||value==="")return null;
  const n=typeof value==="number"?value:Number(value);
  if(!Number.isFinite(n))return null;
  const rounded=Math.round(n);
  if(rounded<MIN_QUORUM)return MIN_QUORUM;
  if(rounded>MAX_QUORUM)return MAX_QUORUM;
  return rounded;
}

/** What we know about how often one member actually turns up, per level. Private: it exists to make
    the forecast accurate, never to rank anybody, and no surface renders it. A visible flakiness
    score would be the fastest possible way to stop members signalling at all. */
export type Calibration = { high?:number|null; mid?:number|null; low?:number|null; sampleN:number };

export function rateFor(level:Confidence,calibration?:Calibration|null):number {
  if(level==="out")return 0;
  if(!calibration||calibration.sampleN<MIN_CALIBRATION_SAMPLE)return BASE_RATE[level];
  const own=calibration[level];
  if(own===null||own===undefined||!Number.isFinite(own))return BASE_RATE[level];
  return Math.min(1,Math.max(0,own));
}

/* --- Time decay ------------------------------------------------------------
 *
 * A 應該去 set three days ago is weaker evidence than the same words typed an hour ago, and the gap
 * is not a rounding error — plans change, and the member who set it has not looked at the app since.
 *
 * The point of decaying rather than expiring is that **nobody has to refresh anything**. A member
 * who never returns to tidy up is not punished and is not treated as a liar; their signal simply
 * carries less weight as it ages, converging on the club prior rather than on zero. Anything else
 * would require housekeeping from exactly the members least likely to do any. */
export const DECAY_FLOOR = 0.55;
export const DECAY_FULL_WEIGHT_HOURS = 6;
export const DECAY_HALF_LIFE_HOURS = 48;

export function recencyWeight(setAt:string|number,nightStart:string|number,now:number=Date.now()):number{
  const set=typeof setAt==="number"?setAt:Date.parse(setAt);
  const start=typeof nightStart==="number"?nightStart:Date.parse(nightStart);
  if(!Number.isFinite(set)||!Number.isFinite(start))return 1;
  /* Age is measured from the signal to the night, not from the signal to now: a signal set two
     hours before kick-off is fresh evidence however long ago that evening was, which is what makes
     a forecast for a past night reproducible. Clamped at zero so a signal set after the band opens
     — somebody deciding at 20:00 — is at full weight rather than negative age. */
  void now;
  const hours=Math.max(0,(start-set)/3_600_000);
  if(hours<=DECAY_FULL_WEIGHT_HOURS)return 1;
  const decayed=Math.pow(0.5,(hours-DECAY_FULL_WEIGHT_HOURS)/DECAY_HALF_LIFE_HOURS);
  return DECAY_FLOOR+(1-DECAY_FLOOR)*decayed;
}

export type AttendanceSignal = {
  playerId:string;
  confidence:Confidence;
  /** 夠人就去: promote to `high` once the floor reaches this many. */
  upgradeAt?:number|null;
  setAt:string|number;
};

export type NightForecast = {
  /** Members who said 一定去, plus everyone their threshold has promoted. The number a member can
      rely on, and the only one printed before the estimate. */
  floor:number;
  /** Player ids promoted by 夠人就去 this evaluation — the club's own doing, not theirs. */
  promoted:string[];
  counts:{ high:number; mid:number; low:number; out:number };
  /** Expected headcount, floor included. Never rendered on its own. */
  expected:number;
  /** An 80% interval from the exact Poisson-binomial distribution, floored at `floor` because a
      member who has committed cannot un-attend by arithmetic. */
  lo:number; hi:number;
  /** P(at least two people present) — the club's actual question, 「上去有冇波打」. */
  chanceOfGame:number;
  band:"high"|"mid"|"low";
  /** Still waiting on a threshold, so the reader can see their own tap might tip it. */
  conditional:number;
};

/* --- The promotion fixpoint ------------------------------------------------
 *
 * Promoting one member raises the floor, which can satisfy somebody else's threshold, which raises
 * it again. Resolving that cascade is the entire value of the mechanic: three members who each
 * would not have gone alone all go, because each one's participation was conditional and something
 * outside the group resolved the condition for them.
 *
 * A threshold counts the member themselves: 「夠 2 個我就去」 is satisfied by one other person,
 * because the two of them are the two. Reading it as "two *others*" would make the lowest allowed
 * threshold mean three at the table, which is not what anybody typing 2 means — and 2 is the floor
 * precisely because two people are one table.
 *
 * Lowest threshold first, so the cascade is deterministic regardless of row order — two members on
 * the same threshold either both promote or neither does. Promotion is one-way: a member who has
 * been told 「夠人喇」 is not un-promoted if somebody later drops out, because they may already have
 * left the house. */
export function promotionsFor(signals:AttendanceSignal[],startingFloor?:number):string[]{
  let floor=startingFloor??signals.filter(s=>s.confidence==="high").length;
  const pending=signals
    .filter(s=>s.confidence!=="high"&&s.confidence!=="out"&&typeof s.upgradeAt==="number"&&s.upgradeAt!==null)
    .sort((a,b)=>(a.upgradeAt as number)-(b.upgradeAt as number));
  const promoted:string[]=[];
  let moved=true;
  while(moved){
    moved=false;
    for(const signal of pending){
      if(promoted.includes(signal.playerId))continue;
      if((signal.upgradeAt as number)<=floor+1){promoted.push(signal.playerId);floor+=1;moved=true}
    }
  }
  return promoted;
}

/** The exact distribution of "how many turn up", by convolving one Bernoulli per member.
    Club-sized n makes this trivial, and an exact distribution beats a normal approximation that
    would report a fractional person and a nonsense interval at n = 4. */
function headcountDistribution(probabilities:number[]):number[]{
  let dist=[1];
  for(const p of probabilities){
    const next=new Array(dist.length+1).fill(0);
    for(let k=0;k<dist.length;k+=1){ next[k]+=dist[k]*(1-p); next[k+1]+=dist[k]*p }
    dist=next;
  }
  return dist;
}

function quantile(dist:number[],target:number):number{
  let cumulative=0;
  for(let k=0;k<dist.length;k+=1){ cumulative+=dist[k]; if(cumulative>=target)return k }
  return dist.length-1;
}

export function forecastNight(input:{
  signals:AttendanceSignal[];
  calibrations?:Record<string,Calibration>;
  nightStart:string|number;
  now?:number;
}):NightForecast{
  const {signals,calibrations={},nightStart,now=Date.now()}=input;
  const live=signals.filter(s=>s.confidence!=="out");
  const promoted=promotionsFor(signals);
  const effective=(s:AttendanceSignal):Confidence=>promoted.includes(s.playerId)?"high":s.confidence;

  const counts={high:0,mid:0,low:0,out:signals.length-live.length};
  const probabilities:number[]=[];
  for(const signal of live){
    const level=effective(signal);
    counts[level as "high"|"mid"|"low"]+=1;
    /* A promoted member is a commitment the club made on their behalf and told them about, so it is
       counted like any other 一定去 — decayed by the age of the signal it grew from, not treated as
       freshly typed. */
    probabilities.push(rateFor(level,calibrations[signal.playerId])*recencyWeight(signal.setAt,nightStart,now));
  }

  const dist=headcountDistribution(probabilities);
  const expected=probabilities.reduce((a,b)=>a+b,0);
  const floor=counts.high;
  const chanceOfGame=1-(dist[0]??0)-(dist[1]??0);
  return {
    floor,
    promoted,
    counts,
    expected:Math.round(expected*10)/10,
    lo:Math.max(floor,quantile(dist,0.1)),
    hi:Math.max(floor,quantile(dist,0.9)),
    chanceOfGame:Math.max(0,Math.min(1,Math.round(chanceOfGame*100)/100)),
    band:chanceOfGame>=0.75?"high":chanceOfGame>=0.45?"mid":"low",
    conditional:live.filter(s=>effective(s)!=="high"&&typeof s.upgradeAt==="number").length,
  };
}

export const BAND_LABELS:Record<NightForecast["band"],string> = { high:"高", mid:"中等", low:"偏低" };

/** The headline, written so the floor is always read before the estimate. A member who travels on
    the strength of a number that did not hold never trusts the number again, so the reliable half
    goes first and the optimistic half is explicitly an estimate. */
export function forecastHeadline(forecast:NightForecast):string{
  if(forecast.floor===0&&forecast.expected<0.5)return "暫時未有人回覆";
  const range=forecast.lo===forecast.hi?`${forecast.lo} 人`:`${forecast.lo}–${forecast.hi} 人`;
  return forecast.floor>0?`${forecast.floor} 人確定 · 估 ${range}`:`估 ${range}`;
}

/** 「再多 N 個就夠」 — the line that makes a reader's own tap feel pivotal, which is the strongest
    non-coercive reason to tap there is. Null when their condition is already met or unset. */
export function stillNeeded(upgradeAt:number|null|undefined,floor:number):number|null{
  if(typeof upgradeAt!=="number")return null;
  const gap=upgradeAt-floor;
  return gap>0?gap:null;
}

/* --- Which evenings exist --------------------------------------------------
 *
 * A night is a date plus the band people actually play in, and it is generated rather than opened.
 * The band is deliberately wide and shared: this slice asks a member how likely they are to come at
 * all, not to nominate an hour, because picking a window is the decision that stops the hedgers. */
export const NIGHT_BAND_START_HOUR = 19;
export const NIGHT_BAND_END_HOUR = 23;

export function nightWindow(date:string):{startAt:string;endAt:string}{
  return {
    startAt:`${date}T${String(NIGHT_BAND_START_HOUR).padStart(2,"0")}:00:00+08:00`,
    endAt:`${date}T${String(NIGHT_BAND_END_HOUR).padStart(2,"0")}:00:00+08:00`,
  };
}
