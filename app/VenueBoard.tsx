"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { Button } from "./components/ui/Primitives";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { addDaysHongKong, availabilityEndTimes, availabilityStartTimes, hkDate, hkDayLabel } from "../lib/availability";
import { COMMITMENT_LABELS, overlapHeadline, overlapWithMine, visibleBuckets,
  type Bucket, type Commitment, type OverlapView } from "../lib/overlap";

/* --- 場次 · 幾點、邊度、有幾多人 --------------------------------------------
 *
 * The screen answers two questions at once, because a member deciding whether to leave the house is
 * really asking both: is it worth going, and *when*.
 *
 * That second half is why the headline is the OVERLAP rather than the day's headcount. Eight members
 * spread from 14:00 to midnight never meet; printing 「8 人會去」 would be true about the date and
 * useless — worse than useless, since somebody travels on it. So the big number is how many are
 * there at once, and it comes with the window it falls in.
 *
 * Everything a member writes is one row in `availability_slots`: a venue, a start, an end. One tap
 * fills all three from a default; the time selects below correct it at half-hour resolution. The
 * planner who wants 19:30–21:00 exactly and the member who just taps are writing the same kind of
 * data into the same table, which is the only reason publishing availability is worth anything. */

type VenuePlayer={id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
type GoingRow=VenuePlayer&{startAt:string;endAt:string};
type Venue={id:string;name:string;district:string;tables:Record<string,number>};
type VenueDay={venue:Venue;date:string;overlap:OverlapView;going:GoingRow[];mine:{id:string;startAt:string;endAt:string;commitment:Commitment}|null};
type VenueSummary=Venue&{peak:number;peakStart:string|null;peakEnd:string|null;goingTotal:number;interestedTotal:number};

/** The club's default answer to 「幾時」, so the first tap never has to ask. Evening, because that is
    when this club plays; a member who wants the afternoon says so with one more tap. */
const DEFAULT_START="19:00", DEFAULT_END="22:00";

const hkClockOf=(iso:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso));

/** A clock string on a date becomes an instant. Times past 24:00 belong to the next morning, which
    is how a 23:30–01:00 window stays one continuous run rather than two. */
function instantFor(date:string,clock:string):string{
  const [h,m]=clock.split(":").map(Number);
  const dayOffset=h>=24?1:0;
  return `${addDaysHongKong(date,dayOffset)}T${String(h%24).padStart(2,"0")}:${String(m).padStart(2,"0")}:00+08:00`;
}

function dayLabel(date:string,today:string):string{
  if(date===today)return "今日";
  if(date===addDaysHongKong(today,1))return "聽日";
  return hkDayLabel(date);
}

/** The strip. Half-hour columns, because that is the resolution members publish at and anything
    coarser silently merges an 18:00 crowd with a 21:00 one. */
function OverlapStrip({buckets,peak,mineRange}:{buckets:Bucket[];peak:number;mineRange:[number,number]|null}){
  const max=Math.max(1,peak,...buckets.map(b=>b.going+b.interested));
  return <div className="vb-strip" role="img"
    aria-label={peak>0?`最多 ${peak} 人同時喺度`:"未有人時間撞到"}>
    {buckets.map(bucket=>{
      const mine=mineRange&&bucket.minutes>=mineRange[0]&&bucket.minutes<mineRange[1];
      const atPeak=peak>0&&bucket.going===peak;
      return <div key={bucket.minutes} className={`vb-col${mine?" mine":""}`}>
        <span className="vb-col-n">{bucket.going||""}</span>
        <div className="vb-col-track">
          {bucket.interested>0&&<i className="vb-col-int" style={{height:`${(bucket.interested/max)*100}%`}}/>}
          <i className={`vb-col-bar${atPeak?" peak":""}`} style={{height:`${(bucket.going/max)*100}%`}}/>
        </div>
        <small className="vb-col-t">{bucket.label.endsWith(":00")?bucket.label.slice(0,2):""}</small>
      </div>;
    })}
  </div>;
}

export function VenueBoard({signedIn,onChanged}:{signedIn:boolean;onChanged?:()=>void}){
  const today=useMemo(()=>hkDate(),[]);
  const week=useMemo(()=>Array.from({length:7},(_,i)=>addDaysHongKong(today,i)),[today]);

  const [venues,setVenues]=useState<VenueSummary[]>([]);
  const [venueId,setVenueId]=useState<string|null>(null);
  const [date,setDate]=useState(today);
  const [day,setDay]=useState<VenueDay|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"error"|"unavailable">("loading");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [start,setStart]=useState(DEFAULT_START);
  const [end,setEnd]=useState(DEFAULT_END);

  const loadDirectory=useCallback(async()=>{
    try{
      const response=await fetch(`/api/venues?date=${today}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error);
      if(body?.unavailable){setState("unavailable");return}
      setVenues(body.venues??[]);
      setVenueId(current=>current??body.venues?.[0]?.id??null);
      setState("ready");
    }catch{setState("error")}
  },[today]);

  const loadDay=useCallback(async(id:string,on:string)=>{
    try{
      const response=await fetch(`/api/venues/${id}?date=${on}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error);
      if(body?.unavailable){setState("unavailable");return}
      setDay(body.day??null);
      if(body.day?.mine){setStart(hkClockOf(body.day.mine.startAt));setEnd(hkClockOf(body.day.mine.endAt))}
    }catch{setState("error")}
  },[]);

  useEffect(()=>{void loadDirectory();trackAvailabilityEvent("venue_board_view")},[loadDirectory]);
  useEffect(()=>{if(venueId)void loadDay(venueId,date)},[venueId,date,loadDay]);

  const endOptions=useMemo(()=>availabilityEndTimes(start),[start]);
  useEffect(()=>{
    /* Moving the start can strand an end that is now before it; snap to the first legal choice
       rather than letting the form hold a window that cannot be saved. */
    if(endOptions.length&&!endOptions.some(option=>option.value===end))setEnd(endOptions[0].value);
  },[endOptions,end]);

  const submit=useCallback(async(commitment:Commitment|null)=>{
    if(!venueId||busy)return;
    setBusy(true);setMessage("");
    try{
      const response=commitment===null
        ?await fetch(`/api/venues/${venueId}?date=${date}`,{method:"DELETE"})
        :await fetch(`/api/venues/${venueId}`,{method:"POST",headers:{"content-type":"application/json"},
            body:JSON.stringify({date,commitment,startAt:instantFor(date,start),endAt:instantFor(date,end)})});
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error??"暫時儲存唔到");
      setDay(body.day??null);
      setMessage(commitment===null?"已經取消。"
        :commitment==="going"?"已經公開咗你嘅時段。":"夠人重疊我哋會叫你一次。");
      trackAvailabilityEvent(commitment===null?"venue_slot_cleared":"venue_slot_set");
      void loadDirectory();onChanged?.();
    }catch(error){setMessage(error instanceof Error?error.message:"網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  },[venueId,date,start,end,busy,loadDirectory,onChanged]);

  if(state==="unavailable")return null;
  if(state==="error")return <section className="vb-card vb-error">
    <p>場次資料暫時載入唔到。</p>
    <Button variant="secondary" onClick={()=>{setState("loading");void loadDirectory()}}>重試</Button>
  </section>;
  if(state==="loading"||!day)return <section className="vb-card" aria-busy="true"><div className="vb-skeleton"/></section>;

  const {overlap,going,mine,venue}=day;
  const buckets=visibleBuckets(overlap);
  const mineRange:[number,number]|null=mine
    ?[(()=>{const [h,m]=hkClockOf(mine.startAt).split(":").map(Number);return h*60+m})(),
      (()=>{const [h,m]=hkClockOf(mine.endAt).split(":").map(Number);const v=h*60+m;
        return v<=(()=>{const [sh,sm]=hkClockOf(mine.startAt).split(":").map(Number);return sh*60+sm})()?v+1440:v})()]
    :null;
  const withMine=overlapWithMine(overlap,mine,Date.parse(`${date}T00:00:00+08:00`));

  return <section className="vb-card">
    <header className="vb-head">
      <div>
        <span className="vb-kicker">{dayLabel(date,today)} · {venue.district}</span>
        <h2 className="vb-venue">{venue.name}</h2>
      </div>
      {venues.length>1&&<select className="vb-venue-pick" value={venue.id} aria-label="揀場地"
        onChange={event=>{setVenueId(event.target.value);setMessage("")}}>
        {venues.map(item=><option key={item.id} value={item.id}>
          {item.name}{item.peak>0?` · ${item.peak} 人`:" · 未有人"}
        </option>)}
      </select>}
    </header>

    {/* The peak, and the window it falls in. The all-day figure follows in small type and only when
        it differs — a member acts on the first number, so it has to be the honest one. */}
    <div className="vb-peak">
      <b>{overlapHeadline(overlap)}</b>
      {overlap.goingTotal>overlap.peak&&<small>全日 {overlap.goingTotal} 人，但分散喺唔同時間</small>}
      {overlap.interestedTotal>0&&<small>{overlap.interestedTotal} 人有興趣，等緊夠人</small>}
    </div>

    <OverlapStrip buckets={buckets} peak={overlap.peak} mineRange={mineRange}/>

    {going.length>0&&<div className="vb-faces">
      {going.map(player=><span key={player.id+player.startAt} className="vb-face">
        <PlayerBadge player={player}/>
        <b>{player.name}</b>
        <small>{hkClockOf(player.startAt)}–{hkClockOf(player.endAt)}</small>
      </span>)}
    </div>}

    {signedIn?<>
      {/* Start and end, both at half-hour steps. Not a single "for four hours" button: a member who
          can only stay until 21:00 is a different person on the strip from one who stays to 23:00. */}
      <div className="vb-times">
        <label><span>由</span>
          <select value={start} disabled={busy} onChange={event=>setStart(event.target.value)}>
            {availabilityStartTimes().map(option=><option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label><span>到</span>
          <select value={end} disabled={busy} onChange={event=>setEnd(event.target.value)}>
            {endOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="vb-actions">
        <button type="button" className={`vb-go${mine?.commitment==="going"?" active":""}`}
          disabled={busy} aria-pressed={mine?.commitment==="going"}
          onClick={()=>void submit(mine?.commitment==="going"?null:"going")}>
          {mine?.commitment==="going"?`✓ ${COMMITMENT_LABELS.going}`:COMMITMENT_LABELS.going}
        </button>
        <button type="button" className={`vb-int${mine?.commitment==="interested"?" active":""}`}
          disabled={busy} aria-pressed={mine?.commitment==="interested"}
          onClick={()=>void submit(mine?.commitment==="interested"?null:"interested")}>
          {mine?.commitment==="interested"?`✓ ${COMMITMENT_LABELS.interested}`:COMMITMENT_LABELS.interested}
        </button>
      </div>

      <p className="vb-hint">{
        mine?.commitment==="going"
          ? withMine>1?`你揀嘅時間同 ${withMine-1} 個人撞到。`:"暫時未有人同你嘅時間撞到。"
          : mine?.commitment==="interested"
            ? "夠人喺你嗰段時間撞到，我哋先叫你一次。"
            : "撳一下就得，時間用預設。想改就揀上面嘅開始／結束時間。"
      }</p>
    </>:<p className="vb-hint">登入之後就可以公開你嘅時段。</p>}

    {message&&<p key={message} className="vb-message" role="status">{message}</p>}

    <div className="vb-week" role="tablist" aria-label="揀日子">
      {week.map(value=><button key={value} type="button" role="tab" aria-selected={value===date}
        className={`vb-day${value===date?" active":""}`}
        onClick={()=>{setDate(value);setMessage("")}}>
        <small>{dayLabel(value,today)}</small>
      </button>)}
    </div>
  </section>;
}
