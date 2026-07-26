"use client";
import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
import {PlayerBadge} from "./UiBits";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import {addDaysHongKong,availabilityDensity,availabilityPeak,composeAvailabilityInterval,dayRangeHongKong,intervalFromHours,intersectIntervals,mergeIntervals,nextAvailabilityStart,overlapMinutes,recommendationScore,validateAvailabilityInterval,type AvailabilitySlot,type Interval} from "../lib/availability";
type Player={id:string;name:string;short:string;rating:number;colour?:string;avatar?:string|null};type Match={a:string;b:string;playedOn:string;status:"confirmed"|"void"};type Member=Player&{slots:AvailabilitySlot[]};type MatchInfo={overlaps:Interval[];minutes:number;recent:number;difference:number;score:number;qualifies:boolean;chips:string[]};type View="find"|"manage"|"create";type Sort="fit"|"start";
const hkDate=(d=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"}).format(d),time=(iso:string)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Hong_Kong",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(iso)),range=(x:Interval)=>`${time(x.startAt)}–${time(x.endAt)}`,days=(start:string,count=7)=>Array.from({length:count},(_,i)=>{const d=new Date(`${start}T12:00:00+08:00`);d.setUTCDate(d.getUTCDate()+i);return hkDate(d)}),dayLabel=(d:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"numeric",day:"numeric",weekday:"short"}).format(new Date(`${d}T00:00:00+08:00`)),fullDay=(d:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"long",day:"numeric",weekday:"long"}).format(new Date(`${d}T00:00:00+08:00`));
function hoursFromAnchor(iso:string,anchor:number){return (Date.parse(iso)-anchor)/3600000}
function timelineRange(intervals:Interval[],date:string){const anchor=Date.parse(dayRangeHongKong(date).startAt),hs=intervals.flatMap(x=>[hoursFromAnchor(x.startAt,anchor),hoursFromAnchor(x.endAt,anchor)]);return {lo:hs.some(h=>h<12)?0:12,hi:hs.some(h=>h>24)?27:24}}
function scaleLabels(lo:number,hi:number){const out:string[]=[];for(let x=lo;x<=hi;x+=3)out.push(`${String(((Math.round(x)%24)+24)%24).padStart(2,"0")}:00`);return out}
function Timeline({slots,overlaps=[],date,lo=12,hi=24}:{slots:Interval[];overlaps?:Interval[];date:string;lo?:number;hi?:number}){
 const anchor=Date.parse(dayRangeHongKong(date).startAt),h=(iso:string)=>hoursFromAnchor(iso,anchor);
 const mark=(x:Interval,k:string)=>{const s=Math.max(lo,h(x.startAt)),e=Math.min(hi,h(x.endAt));if(e<=s)return null;const cls=`${k}${h(x.startAt)<0?" continues-before":""}${h(x.endAt)>24?" continues-after":""}`;return <i key={`${k}${x.startAt}`} className={cls} style={{left:`${(s-lo)/(hi-lo)*100}%`,width:`${Math.max(1,(e-s)/(hi-lo)*100)}%`}}/>};
 const before=slots.some(x=>h(x.startAt)<0),after=slots.some(x=>h(x.endAt)>24);
 return <div className={`availability-timeline${overlaps.length?" has-overlap":""}`} aria-label="可配對時間線">{before&&<small className="timeline-tag before">← 前日延續</small>}<div>{slots.map(x=>mark(x,"slot"))}{overlaps.map(x=>mark(x,"overlap"))}</div>{after&&<small className="timeline-tag after">次日凌晨延續 →</small>}</div>
}
const hourBand=(iso:string):Interval=>{const at=new Date(iso);at.setUTCMinutes(0,0,0);return {startAt:at.toISOString(),endAt:new Date(at.getTime()+3600000).toISOString()}};
/* The histogram is the page's filter, not decoration: a bar is the club's count for that quarter
   hour, and pressing one narrows every list below to the players free in that hour. */
function DensityChart({buckets,best,lo,hi,focus,onFocus}:{buckets:{at:string;count:number}[];best:{startAt:string;endAt:string;count:number}|null;lo:number;hi:number;focus:Interval|null;onFocus:(x:Interval|null)=>void}){
 const max=Math.max(1,...buckets.map(b=>b.count)),from=focus?Date.parse(focus.startAt):0,to=focus?Date.parse(focus.endAt):0;
 const peakFrom=best?Date.parse(best.startAt):0,peakTo=best?Date.parse(best.endAt):0;
 return <section className="availability-card density-card">
  <header><div><small>全會所人數分佈</small>{best?<b>{time(best.startAt)}–{time(best.endAt)} 最多人<span>{best.count} 位</span></b>:<b className="muted">今天未有人公開時段</b>}</div>
   {focus?<button className="more" onClick={()=>onFocus(null)}>顯示全日</button>:best&&<button className="more" onClick={()=>onFocus({startAt:best.startAt,endAt:best.endAt})}>只看高峰時段</button>}</header>
  <div className={`density-bars${focus?" is-filtered":""}`} role="group" aria-label="按時段篩選球員">
   {buckets.map(b=>{const at=Date.parse(b.at),on=Boolean(focus)&&at>=from&&at<to,peak=!focus&&Boolean(best)&&at>=peakFrom&&at<peakTo;
    return <button type="button" key={b.at} className={on?"on":peak?"peak":""} aria-pressed={on} aria-label={`${time(b.at)}，${b.count} 位球員有空${on?"，已篩選":""}`}
     onClick={()=>onFocus(on?null:hourBand(b.at))}><i style={{height:`${b.count?Math.max(8,b.count/max*100):2}%`}}/></button>})}
  </div>
  <div className="density-axis" aria-hidden="true">{scaleLabels(lo,hi).map(l=><span key={l}>{l}</span>)}</div>
  <p className="density-note">{focus?`已篩選 ${time(focus.startAt)}–${time(focus.endAt)}，下方只顯示這段時間有空的球員。`:"按一下柱狀圖，只看該小時有空的球員。"}</p>
 </section>
}
const HALF_HOURS=Array.from({length:48},(_,i)=>`${String(Math.floor(i/2)).padStart(2,"0")}:${i%2?"30":"00"}`);
const durationLabel=(minutes:number)=>minutes%60?`${Math.floor(minutes/60)?`${Math.floor(minutes/60)} 小時 `:""}${minutes%60} 分鐘`:`${minutes/60} 小時`;
const PRESETS=[{label:"下午",start:"14:00",end:"17:00"},{label:"傍晚",start:"18:00",end:"21:00"},{label:"晚上",start:"19:30",end:"22:30"},{label:"深夜",start:"22:00",end:"01:00"}];
const DURATIONS=[60,120,180];
/* Every option the composer can reach makes a slot the server already accepts: starts that have
   passed are dropped, and the end list is generated from the chosen start at 30 minutes to 12 hours.
   Slots crossing midnight say so on the option itself rather than in a footnote nobody reads. */
function SlotComposer({dates,initialDate,slot,onSave,onCancel}:{dates:string[];initialDate:string;slot?:AvailabilitySlot;onSave:(x:Interval)=>void;onCancel?:()=>void}){
 const soonest=useMemo(()=>nextAvailabilityStart(),[]);
 const days=useMemo(()=>dates.filter(v=>v>=soonest.date),[dates,soonest]);
 const[d,setD]=useState(()=>{const from=slot?hkDate(new Date(slot.startAt)):initialDate;return from<soonest.date?soonest.date:from});
 const startOptions=useMemo(()=>HALF_HOURS.filter(v=>d>soonest.date||v>=soonest.time),[d,soonest]);
 const[s,setS]=useState(slot?time(slot.startAt):"");
 const start=s&&startOptions.includes(s)?s:startOptions[0]??"";
 const endOptions=useMemo(()=>{const from=HALF_HOURS.indexOf(start);return from<0?[]:Array.from({length:24},(_,i)=>({value:HALF_HOURS[(from+i+1)%48],minutes:(i+1)*30,overnight:from+i+1>=48}))},[start]);
 const[e,setE]=useState(slot?time(slot.endAt):"");
 const end=endOptions.find(o=>o.value===e)??endOptions[3]??endOptions.at(-1);
 const interval=useMemo(()=>{if(!start||!end)return null;try{return validateAvailabilityInterval(composeAvailabilityInterval(d,start,end.value))}catch{return null}},[d,start,end]);
 /* A preset whose start has already gone by today means the member meant the next such evening,
    so the rail moves with it instead of silently snapping the time to "now". */
 const preset=(p:typeof PRESETS[number])=>{const day=d===soonest.date&&p.start<soonest.time?days[days.indexOf(d)+1]??d:d;setD(day);setS(p.start);setE(p.end)};
 return <form className="slot-composer" onSubmit={ev=>{ev.preventDefault();if(!interval||!end)return;if(end.overnight)trackAvailabilityEvent("availability_overnight_created");onSave(interval);if(!slot)setS("")}}>
  <div className="date-strip-scroll"><div className="date-strip compact" role="group" aria-label="選擇日期">{days.map(v=><button type="button" key={v} className={v===d?"active":""} aria-pressed={v===d} onClick={()=>setD(v)}><small>{v===soonest.date?"最快":v===addDaysHongKong(soonest.date,1)?"明天":new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${v}T00:00:00+08:00`))}</small><em>{v.slice(5,7)}/{v.slice(8,10)}</em></button>)}</div></div>
  {!slot&&<div className="composer-presets" role="group" aria-label="常用時段">{PRESETS.map(p=><button type="button" key={p.label} className={start===p.start&&end?.value===p.end?"active":""} onClick={()=>preset(p)}>{p.label}<small>{p.start}–{p.end}</small></button>)}</div>}
  <div className="composer-times">
   <label>由<select value={start} onChange={x=>setS(x.target.value)} aria-label="開始時間">{startOptions.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
   <span aria-hidden="true">→</span>
   <label>至<select value={end?.value??""} onChange={x=>setE(x.target.value)} aria-label="結束時間">{endOptions.map(o=><option key={o.value} value={o.value}>{o.overnight?`次日 ${o.value}`:o.value} · {durationLabel(o.minutes)}</option>)}</select></label>
   <div className="composer-durations" role="group" aria-label="快速長度">{DURATIONS.map(m=><button type="button" key={m} className={end?.minutes===m?"active":""} aria-pressed={end?.minutes===m} disabled={!endOptions[m/30-1]} onClick={()=>setE(endOptions[m/30-1].value)}>{m/60} 小時</button>)}</div>
  </div>
  <div className="composer-foot">
   <p aria-live="polite">{interval&&end?<><b>{dayLabel(d)}</b> {start} → {end.overnight&&<i>次日</i>}{end.value}<span>{durationLabel(end.minutes)}</span></>:<span className="composer-blocked">這天已沒有可選的開始時間，請選擇之後的日期。</span>}</p>
   <div>{onCancel&&<button type="button" className="secondary" onClick={onCancel}>取消</button>}<button className="primary" disabled={!interval}>{slot?"儲存變更":"＋ 加入"}</button></div>
  </div>
 </form>
}
/* One candidate, one line, ranked. The bar carries when, the figure carries how much, and exactly
   one reason carries why they are this high — more than one reason is noise at a glance. */
function CandidateRow({member,info,date,lo,hi,rank}:{member:Member;info:MatchInfo;date:string;lo:number;hi:number;rank?:number}){
 const first=member.slots[0],last=member.slots[member.slots.length-1];
 const spoken=`${rank?`第 ${rank} 位，`:""}${member.name}，${Math.round(member.rating)} ELO${first&&last?`，有空 ${time(first.startAt)} 至 ${time(last.endAt)}`:""}${info.minutes?`，與你重疊 ${durationLabel(info.minutes)}，${info.overlaps.map(range).join("、")}`:"，與你沒有重疊"}${info.chips[0]?`，${info.chips[0]}`:""}`;
 return <article className={`candidate${info.minutes?"":" no-overlap"}`} aria-label={spoken}>
  {rank&&<b className="candidate-rank" aria-hidden="true">{rank}</b>}
  <PlayerBadge player={member}/>
  <div className="candidate-who" aria-hidden="true"><b>{member.name}</b><small>{Math.round(member.rating)} ELO</small></div>
  <div className="candidate-track" aria-hidden="true"><span className="track-time">{first?time(first.startAt):""}</span><Timeline slots={member.slots} overlaps={info.overlaps} date={date} lo={lo} hi={hi}/><span className="track-time">{last?time(last.endAt):""}</span></div>
  <div className="candidate-fit" aria-hidden="true">{info.minutes?<><b>{durationLabel(info.minutes)}</b><small>{info.overlaps.map(range).join("、")}</small></>:<small className="candidate-none">無重疊</small>}</div>
  {info.chips[0]&&<span className="candidate-reason" aria-hidden="true">{info.chips[0]}</span>}
 </article>
}
/* The one question the page exists to answer, answered before anything else on screen. Which card
   shows up depends on what is actually blocking the member from playing tonight. */
function MatchHero({top,mine,date,lo,hi,userPlayerId,members,focus,onManage}:{top:{member:Member}&MatchInfo|null;mine:Interval[];date:string;lo:number;hi:number;userPlayerId?:string;members:number;focus:Interval|null;onManage:(v:"manage"|"create")=>void}){
 if(!userPlayerId)return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">找對手</p><h2>登入後即可看到最合適的對手</h2><p>連結球員帳戶，我們會按你公開的時間、ELO 及近期交手紀錄排出建議。</p></section>;
 if(!mine.length)return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">先設定你的時間</p><h2>{members?`這天有 ${members} 位球員有空`:"這天暫時未有人公開時段"}</h2><p>公開你自己的空閒時間後，這裡會直接告訴你今晚最值得約的對手。</p><button className="primary" onClick={()=>onManage("create")}>公開我的時段</button></section>;
 if(!top)return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">{focus?"這個時段":"這一天"}沒有重疊</p><h2>暫時沒有人與你的時間重疊</h2><p>{focus?"試試清除時段篩選，或選擇其他日子。":"換一天，或加闊你的可配對時間，配對機會會明顯提高。"}</p><button className="secondary" onClick={()=>onManage("manage")}>調整我的時段</button></section>;
 return <section className="availability-card match-hero">
  <p className="match-hero-kicker">{focus?`${time(focus.startAt)}–${time(focus.endAt)} 最合適`:"這天最合適"}</p>
  <div className="match-hero-main">
   <PlayerBadge player={top.member}/>
   <div className="match-hero-who"><h2>{top.member.name}</h2><small>{Math.round(top.member.rating)} ELO</small></div>
   <div className="match-hero-window"><b>{top.overlaps.map(range).join("、")}</b><small>可一起打 {durationLabel(top.minutes)}</small></div>
  </div>
  <div className="match-hero-track" aria-hidden="true"><Timeline slots={top.member.slots} overlaps={top.overlaps} date={date} lo={lo} hi={hi}/></div>
  {top.chips.length>0&&<div className="track-chips">{top.chips.map(c=><span key={c}>{c}</span>)}</div>}
  <div className="match-hero-foot">
   <dl><div><dt>ELO 相差</dt><dd>{Math.round(top.difference)}</dd></div><div><dt>近 30 日交手</dt><dd>{top.recent} 場</dd></div><div><dt>你的時間</dt><dd>{mine.map(range).join("、")}</dd></div></dl>
   <button className="secondary" disabled>邀請對局<small>即將推出</small></button>
  </div>
 </section>
}
/* The board speaks in hours from the start of a row's Hong Kong day, so a slot that runs past
   midnight simply extends beyond 24 on the row it started in — one bar, one row, no wrapping. */
const clockAt=(h:number)=>`${String(Math.floor(h)%24).padStart(2,"0")}:${h%1?"30":"00"}`;
const hoursOf=(date:string,iso:string)=>(Date.parse(iso)-Date.parse(dayRangeHongKong(date).startAt))/3600000;
const snapHalf=(h:number)=>Math.round(h*2)/2;
const MIN_HOURS=0.5,MAX_HOURS=12,TAP_HOURS=2;
type BoardItem={key:string;id?:string;date:string;from:number;to:number;draft:boolean};
type Drag={key:string;date:string;from:number;to:number;mode:"create"|"start"|"end"};

/* Painting on the track is the fast path; the buttons under a selected bar and the precise composer
   below the board are the equivalent paths for keyboards and screen readers, which cannot drag. */
function SlotBoard({dates,items,lo,hi,soonest,selected,onSelect,onCreate,onResize}:{dates:string[];items:BoardItem[];lo:number;hi:number;soonest:number;selected:string|null;onSelect:(key:string|null)=>void;onCreate:(x:Interval)=>void;onResize:(item:BoardItem,x:Interval)=>void}){
 const[drag,setDrag]=useState<Drag|null>(null);
 const span=hi-lo,pct=(h:number)=>`${(Math.max(lo,Math.min(hi,h))-lo)/span*100}%`;
 const width=(from:number,to:number)=>`${(Math.min(hi,to)-Math.max(lo,from))/span*100}%`;
 const hourAt=(el:Element,clientX:number)=>{const r=el.getBoundingClientRect();return Math.max(lo,Math.min(hi,lo+(clientX-r.left)/r.width*span))};
 const floorFor=(date:string)=>hoursOf(date,new Date(soonest).toISOString());
 /* A resize must not also count as "clicked the empty track", but starting a fresh drag should still
    bubble up and clear the current selection. */
 const begin=(ev:ReactPointerEvent,date:string,next:Omit<Drag,"date">)=>{ev.preventDefault();if(next.mode!=="create")ev.stopPropagation();(ev.currentTarget as Element).closest(".board-track")?.setPointerCapture?.(ev.pointerId);setDrag({...next,date});};
 const move=(ev:ReactPointerEvent,date:string)=>{if(!drag||drag.date!==date)return;const at=snapHalf(hourAt(ev.currentTarget,ev.clientX));setDrag(drag.mode==="start"?{...drag,from:at}:{...drag,to:at});};
 const finish=(ev:ReactPointerEvent,date:string)=>{
  if(!drag||drag.date!==date)return;setDrag(null);
  const floor=Math.max(lo,Math.ceil(floorFor(date)*2)/2);
  let from=Math.min(drag.from,drag.to),to=Math.max(drag.from,drag.to);
  if(drag.mode==="create"&&to-from<MIN_HOURS)to=from+TAP_HOURS;                 // a tap means "the usual couple of hours"
  if(drag.mode==="start")({from,to}={from:Math.min(drag.from,drag.to-MIN_HOURS),to:drag.to});
  if(drag.mode==="end")({from,to}={from:drag.from,to:Math.max(drag.to,drag.from+MIN_HOURS)});
  from=Math.max(from,floor);to=Math.min(Math.max(to,from+MIN_HOURS),from+MAX_HOURS,36);
  if(from>=36||to<=from)return;
  const item=items.find(i=>i.key===drag.key);
  if(drag.mode==="create")onCreate(intervalFromHours(date,from,to));else if(item)onResize(item,intervalFromHours(date,from,to));
  ev.stopPropagation();
 };
 return <div className="slot-board" onPointerDown={()=>onSelect(null)}>
  <div className="board-scale" aria-hidden="true"><span/><div>{Array.from({length:Math.floor(span/2)+1},(_,i)=>lo+i*2).map(h=><b key={h} style={{left:pct(h)}}>{clockAt(h)}</b>)}</div></div>
  {dates.map(date=>{
   const rows=items.filter(i=>i.date===date),floor=floorFor(date),past=floor>lo?width(lo,Math.min(floor,hi)):"0%";
   const label=date===dates[0]?"今天":date===addDaysHongKong(dates[0],1)?"明天":new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${date}T00:00:00+08:00`));
   return <div className={`board-row${floor>=hi?" is-past":""}`} key={date}>
    <span className="board-day"><b>{label}</b><small>{date.slice(5,7)}/{date.slice(8,10)}</small></span>
    <div className="board-track" onPointerDown={ev=>{if(floor>=hi)return;begin(ev,date,{key:"new",from:snapHalf(hourAt(ev.currentTarget,ev.clientX)),to:snapHalf(hourAt(ev.currentTarget,ev.clientX)),mode:"create"})}} onPointerMove={ev=>move(ev,date)} onPointerUp={ev=>finish(ev,date)} onPointerCancel={()=>setDrag(null)}>
     {Array.from({length:Math.floor(span/2)},(_,i)=>lo+(i+1)*2).map(h=><i key={h} className="board-grid" style={{left:pct(h)}}/>)}
     <i className="board-past" style={{width:past}}/>
     {rows.map(item=>{const live=drag&&drag.key===item.key,from=live?Math.min(drag.from,drag.to):item.from,to=live?Math.max(drag.from,drag.to):item.to,on=selected===item.key;
      return <button type="button" key={item.key} className={`board-slot${item.draft?" is-draft":""}${on?" is-selected":""}`} style={{left:pct(from),width:width(from,to)}}
       aria-label={`${label} ${clockAt(from)} 至 ${clockAt(to)}${item.draft?"（未發佈）":""}，按下以調整或刪除`} aria-pressed={on}
       onPointerDown={ev=>{ev.stopPropagation();onSelect(item.key)}} onClick={ev=>{ev.stopPropagation();onSelect(item.key)}}>
       <span>{clockAt(from)}–{clockAt(to)}</span>
       {on&&!item.draft&&<><i className="board-handle start" onPointerDown={ev=>begin(ev,date,{key:item.key,from:item.from,to:item.to,mode:"start"})}/><i className="board-handle end" onPointerDown={ev=>begin(ev,date,{key:item.key,from:item.from,to:item.to,mode:"end"})}/></>}
      </button>})}
     {drag?.date===date&&drag.mode==="create"&&Math.abs(drag.to-drag.from)>=MIN_HOURS&&<i className="board-ghost" style={{left:pct(Math.min(drag.from,drag.to)),width:width(Math.min(drag.from,drag.to),Math.max(drag.from,drag.to))}}>{clockAt(Math.min(drag.from,drag.to))}–{clockAt(Math.max(drag.from,drag.to))}</i>}
    </div>
   </div>})}
 </div>;
}
const HORIZON=14,ROSTER_LIMIT=8;
export default function Availability({userPlayerId,matches}:{userPlayerId?:string;matches:Match[]}){
 const week=useMemo(()=>days(hkDate(),HORIZON),[]),[expanded,setExpanded]=useState(false),[date,setDate]=useState(hkDate()),[members,setMembers]=useState<Member[]>([]),[counts,setCounts]=useState<Record<string,number>>({}),[own,setOwn]=useState<AvailabilitySlot[]>([]),[view,setView]=useState<View>("find"),[sort,setSort]=useState<Sort>("fit"),[draft,setDraft]=useState<Interval[]>([]),[selected,setSelected]=useState<string|null>(null),[focus,setFocus]=useState<Interval|null>(null),[boardWide,setBoardWide]=useState(false),[pending,setPending]=useState<AvailabilitySlot|null>(null),[loading,setLoading]=useState(true),[message,setMessage]=useState("");
 const dialogRef=useRef<HTMLElement|null>(null),firstLoad=useRef(true);
 useEffect(()=>{const c=new AbortController();async function load(){setLoading(true);try{const[selected,week2,mine]=await Promise.all([fetch(`/api/availability?date=${date}`,{signal:c.signal}).then(r=>r.json()),fetch(`/api/availability?week=${week[0]}&days=${HORIZON}`,{signal:c.signal}).then(r=>r.json()),userPlayerId?fetch("/api/availability?me",{signal:c.signal}).then(r=>r.json()):Promise.resolve({slots:[]})]);if(selected.error)throw Error(selected.error);setMembers(selected.members);setOwn(mine.slots??[]);setCounts(week2.counts??{});setMessage("")}catch(e){if(e instanceof Error&&e.name!=="AbortError")setMessage(e.message)}finally{if(!c.signal.aborted)setLoading(false)}}if(firstLoad.current)firstLoad.current=false;else trackAvailabilityEvent("availability_date_select");void load();return()=>c.abort()},[date,userPlayerId,week]);
 useEffect(()=>trackAvailabilityEvent("availability_view"),[]);
 const mine=useMemo(()=>{const r=dayRangeHongKong(date);return own.filter(s=>Date.parse(s.startAt)<Date.parse(r.endAt)&&Date.parse(s.endAt)>Date.parse(r.startAt))},[own,date]);
 /* The board reads chronologically top to bottom: today's row first, each slot placed on the day it
    starts. Published and unpublished slots share the same geometry so they line up on one axis. */
 const soonest=useMemo(()=>nextAvailabilityStart().at,[own,draft]);
 const boardDates=useMemo(()=>week.slice(0,boardWide?HORIZON:7),[week,boardWide]);
 const boardItems=useMemo(()=>{const make=(key:string,x:Interval,id?:string):BoardItem=>{const d=hkDate(new Date(x.startAt));return {key,id,date:d,from:hoursOf(d,x.startAt),to:hoursOf(d,x.endAt),draft:!id}};
  return [...own.map(x=>make(x.id,x,x.id)),...draft.map(x=>make(x.startAt,x))].sort((a,b)=>a.date.localeCompare(b.date)||a.from-b.from)},[own,draft]);
 const boardRange=useMemo(()=>({lo:Math.max(0,Math.min(12,...boardItems.map(i=>Math.floor(i.from)))),hi:Math.min(36,Math.max(26,...boardItems.map(i=>Math.ceil(i.to))))}),[boardItems]);
 const active=useMemo(()=>boardItems.find(i=>i.key===selected)??null,[boardItems,selected]);
 const rosterRange=useMemo(()=>timelineRange([...mine,...members.flatMap(m=>m.slots)],date),[mine,members,date]);
 const perMember=useMemo(()=>members.map(m=>m.slots as Interval[]),[members]);
 const busiest=useMemo(()=>availabilityPeak(perMember),[perMember]);
 const density=useMemo(()=>availabilityDensity(perMember,date,rosterRange.lo,rosterRange.hi),[perMember,date,rosterRange]);
 const matchInfo=useMemo(()=>{const map=new Map<string,MatchInfo>();if(!userPlayerId)return map;const me=members.find(x=>x.id===userPlayerId),cut=Date.now()-30*864e5;for(const member of members){if(member.id===userPlayerId)continue;const overlaps=intersectIntervals(mine,member.slots),minutes=overlapMinutes(overlaps),recent=matches.filter(m=>m.status==="confirmed"&&Date.parse(`${m.playedOn}T00:00:00+08:00`)>=cut&&((m.a===userPlayerId&&m.b===member.id)||(m.b===userPlayerId&&m.a===member.id))).slice(0,5).length,difference=Math.abs((me?.rating??0)-member.rating),scored=recommendationScore({minutes,eloDifference:(me?.rating??0)-member.rating,recentMatches:recent});map.set(member.id,{overlaps,minutes,recent,difference,score:scored?.score??-1,qualifies:Boolean(scored),chips:[]})}
  /* One reason per candidate, strongest first, so the list explains its own order without a legend. */
  const longest=Math.max(0,...[...map.values()].map(x=>x.minutes));
  for(const info of map.values()){if(!info.minutes)continue;if(longest>0&&info.minutes===longest)info.chips.push("時間重疊最長");if(info.difference<50)info.chips.push("ELO 相近");if(info.recent===0)info.chips.push("近期未交手")}
  return map},[members,matches,mine,userPlayerId]);
 /* Focus is the histogram's output: a one-hour band that every list below is measured against, so
    "who is around at nine" is one press rather than a re-read of the whole roster. */
 const inFocus=useMemo(()=>(x:Interval[])=>!focus||intersectIntervals(x,[focus]).length>0,[focus]);
 const candidates=useMemo(()=>members.filter(m=>m.id!==userPlayerId&&inFocus(m.slots)).map(member=>({member,...(matchInfo.get(member.id)??{overlaps:[],minutes:0,recent:0,difference:0,score:-1,qualifies:false,chips:[]})})),[members,matchInfo,userPlayerId,inFocus]);
 const byStart=(a:{member:Member},b:{member:Member})=>(Date.parse(a.member.slots[0]?.startAt??"")||Infinity)-(Date.parse(b.member.slots[0]?.startAt??"")||Infinity);
 const shortlist=useMemo(()=>candidates.filter(c=>c.minutes>0).sort((a,b)=>sort==="start"?byStart(a,b):b.score-a.score||b.minutes-a.minutes||a.difference-b.difference),[candidates,sort]);
 /* Kept, not hidden: someone free tonight with no overlap is still a person you might message, but
    they do not belong above the players you can actually meet. */
 const others=useMemo(()=>candidates.filter(c=>c.minutes===0).sort(byStart),[candidates]);
 const top=shortlist[0]??null;
 const shown=expanded?shortlist:shortlist.slice(0,ROSTER_LIMIT);
 useEffect(()=>{setExpanded(false);setFocus(null)},[date]);
 const editor=view==="manage"||view==="create";
 const nav=(v:View)=>{if(v==="create"){trackAvailabilityEvent("availability_composer_open");setSelected(null)}setView(v)};
 const save=async()=>{const r=await fetch("/api/availability",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({slots:draft})}),b=await r.json();if(!r.ok)return setMessage(b.error);setOwn(b.slots??[]);setDraft([]);setView("manage");setMessage("時段已發佈，推薦已更新。");trackAvailabilityEvent("availability_slot_publish")};
 const update=async(id:string,x:Interval)=>{const r=await fetch(`/api/availability/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(x)}),b=await r.json();if(!r.ok)return setMessage(b.error);setOwn(b.slots??[]);setSelected(null);setMessage("時段已更新。");trackAvailabilityEvent("availability_slot_edit")};
 /* Nudging keeps the slot legal rather than bouncing an error: the edge stops at 30 minutes wide,
    at 12 hours long, and never reaches back before the next bookable half hour. */
 const nudge=(item:BoardItem,startBy:number,endBy:number)=>{
  const floor=Math.ceil(hoursOf(item.date,new Date(soonest).toISOString())*2)/2;
  const from=Math.max(Math.min(item.from+startBy,item.to-.5),floor,0),to=Math.min(Math.max(item.to+endBy,from+.5),from+12,36);
  if(from===item.from&&to===item.to)return;
  const next=intervalFromHours(item.date,from,to);
  if(item.draft){setDraft(a=>mergeIntervals([...a.filter(v=>v.startAt!==item.key),next]));setSelected(next.startAt)}else void update(item.key,next);
 };
 const cancel=async()=>{if(!pending)return;const r=await fetch(`/api/availability/${pending.id}`,{method:"DELETE"}),b=await r.json();if(!r.ok)return setMessage(b.error);setOwn(a=>a.filter(x=>x.id!==pending.id));setPending(null);setMessage("時段已取消。");trackAvailabilityEvent("availability_slot_cancel")};
 useEffect(()=>{if(!pending)return;const previous=document.activeElement as HTMLElement|null,dialog=dialogRef.current,focusable=dialog?Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')):[];focusable[0]?.focus();function onKey(ev:KeyboardEvent){if(ev.key==="Escape")return setPending(null);if(ev.key==="Tab"&&focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}}}document.addEventListener("keydown",onKey);return()=>{document.removeEventListener("keydown",onKey);previous?.focus()}},[pending]);
 return <section className="availability-page">
<section className="hero small availability-hero"><div><p className="kicker">MATCHMAKING</p><h1>找對手，約一局</h1><p>公開你的空閒時間，快速找到最合適的球友。</p></div>{userPlayerId&&<button className="primary" onClick={()=>nav("create")}>＋ 新增時段</button>}</section>
<nav className="availability-tabs" aria-label="配對功能" role="tablist"><button role="tab" aria-selected={view==="find"} className={view==="find"?"active":""} onClick={()=>nav("find")}>找對手</button>{userPlayerId&&<button role="tab" aria-selected={view==="manage"||view==="create"} className={view==="manage"||view==="create"?"active":""} onClick={()=>nav("manage")}>我的時段{own.length>0&&<span>{own.length}</span>}</button>}</nav>
{view==="find"&&<div className="date-strip-scroll"><div className="date-strip" role="tablist" aria-label="選擇日期">{week.map((d,i)=>{const isToday=i===0,isTomorrow=i===1,narrow=new Intl.DateTimeFormat("zh-HK",{weekday:"narrow",timeZone:"Asia/Hong_Kong"}).format(new Date(`${d}T00:00:00+08:00`)),full=new Intl.DateTimeFormat("zh-HK",{weekday:"short",timeZone:"Asia/Hong_Kong"}).format(new Date(`${d}T00:00:00+08:00`)),n=counts[d];return <button key={d} role="tab" aria-selected={d===date} aria-current={d===date?"date":undefined} className={d===date?"active":""} onClick={()=>setDate(d)}><small>{isToday?"今天":isTomorrow?"明天":full}</small><em>{d.slice(5,7)}/{d.slice(8,10)}（{narrow}）</em><strong>{n??"–"} 位</strong></button>})}</div></div>}
{message&&<p className="availability-notice" role="status">{message}</p>}
{view==="find"&&<>
<header className="availability-day-head"><div><p>{fullDay(date)}</p><h2>{members.length?`${members.length} 位球員有空`:"暫時未有人有空"}</h2></div>
 {userPlayerId&&<button className="more" onClick={()=>nav("manage")}>{mine.length?`我的時段 ${mine.map(range).join("、")}`:"未設定我的時段"}</button>}</header>
{loading?<div className="availability-skeleton" aria-hidden="true"/>:<div className="find-stack">
 <MatchHero top={top} mine={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi} userPlayerId={userPlayerId} members={members.length} focus={focus} onManage={nav}/>
 {members.length>0&&<DensityChart buckets={density} best={busiest} lo={rosterRange.lo} hi={rosterRange.hi} focus={focus} onFocus={setFocus}/>}
 {members.length>0?<section className="availability-card candidate-card">
  <header className="candidate-head"><div><h3>{mine.length?"可以一起打的球員":"這天有空的球員"}<span>{mine.length?shortlist.length:candidates.length}</span></h3>
   <small>{focus?`只顯示 ${time(focus.startAt)}–${time(focus.endAt)} 有空的人`:mine.length?"按與你的重疊時間、ELO 差距及近期交手排序":"公開你的時段後，這裡會按配對度排序"}</small></div>
   {userPlayerId&&mine.length>0&&shortlist.length>1&&<div className="sort-toggle" role="radiogroup" aria-label="排序方式"><button role="radio" aria-checked={sort==="fit"} className={sort==="fit"?"active":""} onClick={()=>setSort("fit")}>最佳配對</button><button role="radio" aria-checked={sort==="start"} className={sort==="start"?"active":""} onClick={()=>setSort("start")}>最早開始</button></div>}</header>
  <div className="timeline-scale" aria-hidden="true"><span/><div className="timeline-scale-track">{scaleLabels(rosterRange.lo,rosterRange.hi).map(l=><span key={l}>{l}</span>)}</div></div>
  {mine.length>0&&<article className="candidate is-me" aria-label={`你的基準時段 ${mine.map(range).join("、")}`}><b className="candidate-rank" aria-hidden="true">你</b><div className="candidate-who" aria-hidden="true"><b>你的時間</b><small>基準</small></div><div className="candidate-track" aria-hidden="true"><span className="track-time">{mine[0]?time(mine[0].startAt):""}</span><Timeline slots={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi}/><span className="track-time">{mine.at(-1)?time(mine.at(-1)!.endAt):""}</span></div><div className="candidate-fit" aria-hidden="true"><b>{durationLabel(overlapMinutes(mine))}</b><small>已公開</small></div></article>}
  <div className="candidate-list">
   {shown.map((c,i)=><CandidateRow key={c.member.id} member={c.member} info={c} date={date} lo={rosterRange.lo} hi={rosterRange.hi} rank={sort==="fit"&&mine.length?i+1:undefined}/>)}
   {!mine.length&&candidates.map(c=><CandidateRow key={c.member.id} member={c.member} info={c} date={date} lo={rosterRange.lo} hi={rosterRange.hi}/>)}
   {mine.length>0&&!shortlist.length&&<p className="candidate-empty">{focus?"這個時段沒有人與你重疊。":"這天沒有人與你的時間重疊。"}</p>}
   {shortlist.length>ROSTER_LIMIT&&<button className="candidate-more" onClick={()=>setExpanded(v=>!v)}>{expanded?"收起":`顯示其餘 ${shortlist.length-ROSTER_LIMIT} 位可配對球員`}</button>}
  </div>
  {mine.length>0&&others.length>0&&<details className="candidate-others"><summary>其他 {others.length} 位有空但與你無重疊的球員</summary><div className="candidate-list">{others.map(c=><CandidateRow key={c.member.id} member={c.member} info={c} date={date} lo={rosterRange.lo} hi={rosterRange.hi}/>)}</div></details>}
  <div className="timeline-legend"><span><i className="legend-overlap"/>你們都有空</span><span><i className="legend-slot"/>對方有空</span></div></section>
 :<section className="availability-card availability-empty-state"><b>這天暫時未有人公開時段</b><p>選擇其他日期，或率先公開你的可配對時段。</p>{userPlayerId&&<button className="primary" onClick={()=>nav("create")}>公開我的時段</button>}</section>}
</div>}</>}
{/* One screen, one gesture: the board is the list, the editor and the composer at once. Nothing here
    navigates away, so a member can paint three evenings and publish them in a single pass. */}
{editor&&userPlayerId&&<section className="availability-editor">
 <header className="availability-day-head"><div><p>我的時段</p><h2>公開你的空閒時間</h2><small>在日子的時間列上拖曳即可加入，點按已公開的時段可調整或刪除。</small></div>
  <span className="slot-tally"><b>{own.length}</b>個已公開</span></header>
 <section className={`availability-card slot-board-card${draft.length?" has-draft":""}`}>
  <SlotBoard dates={boardDates} items={boardItems} lo={boardRange.lo} hi={boardRange.hi} soonest={soonest} selected={selected}
   onSelect={setSelected}
   onCreate={x=>{setDraft(a=>mergeIntervals([...a,x]));setSelected(null);setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}
   onResize={(item,x)=>{if(item.draft)setDraft(a=>mergeIntervals([...a.filter(v=>v.startAt!==item.key),x]));else void update(item.key,x)}}/>
  {!own.length&&!draft.length&&<p className="board-hint">在上面任何一行拖曳，就能加入可配對時段。輕按一下等於兩小時。</p>}
  <div className="board-legend"><span><i className="legend-live"/>已公開</span><span><i className="legend-draft"/>未發佈</span><button type="button" className="more" onClick={()=>setBoardWide(v=>!v)}>{boardWide?"只看未來 7 天":"顯示未來 14 天"}</button></div>
 </section>
 {active&&<section className="slot-detail" role="group" aria-label="調整已選時段">
  <div><small>{fullDay(active.date)}</small><b>{clockAt(active.from)}–{clockAt(active.to)}</b><span>{durationLabel((active.to-active.from)*60)}{active.draft?" · 未發佈":""}</span></div>
  <div className="slot-nudge"><small>開始</small><button type="button" aria-label="開始時間提早 30 分鐘" onClick={()=>nudge(active,-.5,0)}>−</button><button type="button" aria-label="開始時間延後 30 分鐘" onClick={()=>nudge(active,.5,0)}>+</button></div>
  <div className="slot-nudge"><small>結束</small><button type="button" aria-label="結束時間提早 30 分鐘" onClick={()=>nudge(active,0,-.5)}>−</button><button type="button" aria-label="結束時間延後 30 分鐘" onClick={()=>nudge(active,0,.5)}>+</button></div>
  <span className="card-tools"><button className="card-tool danger" aria-label={`刪除 ${dayLabel(active.date)} ${clockAt(active.from)}–${clockAt(active.to)} 的時段`} onClick={()=>{const found=own.find(v=>v.id===active.key);if(active.draft)setDraft(a=>a.filter(v=>v.startAt!==active.key));else if(found)setPending(found);setSelected(null)}}>✕</button></span>
 </section>}
 {draft.length>0&&<div className="draft-bar" role="status"><div><b>{draft.length} 個未發佈時段</b><span>{draft.map(x=>`${dayLabel(hkDate(new Date(x.startAt)))} ${range(x)}`).join("、")}</span></div>
  <div><button className="secondary" onClick={()=>{setDraft([]);setSelected(null)}}>清除</button><button className="primary" onClick={()=>void save()}>發佈</button></div></div>}
 <details className="board-precise"><summary>用選單精確加入時段</summary><SlotComposer dates={week} initialDate={date} onSave={x=>{setDraft(a=>mergeIntervals([...a,x]));setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}/></details>
</section>}
{pending&&<div className="availability-dialog-backdrop" onMouseDown={()=>setPending(null)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>取消可配對時段</small><h2 id="cancel-title">{dayLabel(hkDate(new Date(pending.startAt)))} {range(pending)}</h2><p>取消後，這段時間不會再出現在其他球員的配對結果中。</p><div><button className="secondary" onClick={()=>setPending(null)}>保留時段</button><button className="danger" onClick={()=>void cancel()}>確認取消</button></div></section></div>}
</section>}
