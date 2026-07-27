"use client";
import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
import {PlayerBadge} from "./UiBits";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import {addDaysHongKong,availabilityDensity,availabilityPeak,composeAvailabilityInterval,dayRangeHongKong,intervalFromHours,intersectIntervals,mergeIntervals,nextAvailabilityStart,overlapMinutes,recommendationScore,validateAvailabilityInterval,type AvailabilitySlot,type Interval} from "../lib/availability";
type Player={id:string;name:string;short:string;rating:number;colour?:string;avatar?:string|null};type Match={a:string;b:string;playedOn:string;status:"confirmed"|"void"};type Member=Player&{slots:AvailabilitySlot[]};type MatchInfo={overlaps:Interval[];minutes:number;recent:number;score:number;difference:number;qualifies:boolean;chips:string[]};type View="find"|"recommendations"|"manage"|"create";
const hkDate=(d=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"}).format(d),time=(iso:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso)),range=(x:Interval)=>`${time(x.startAt)}–${time(x.endAt)}`,utc=(d:string,t:string)=>new Date(`${d}T${t}:00+08:00`).toISOString(),days=(start:string,horizon=7)=>Array.from({length:horizon},(_,i)=>addDaysHongKong(start,i)),dayLabel=(d:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"numeric",day:"numeric",weekday:"short"}).format(new Date(`${d}T00:00:00+08:00`)),fullDay=(d:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"long",day:"numeric",weekday:"long"}).format(new Date(`${d}T00:00:00+08:00`));
const durationLabel=(minutes:number)=>{const hours=Math.floor(minutes/60),rest=Math.round(minutes%60);return hours?`${hours} 小時${rest?` ${rest} 分鐘`:""}`:`${rest} 分鐘`};
const shortDurationLabel=(minutes:number)=>minutes<60?`${Math.round(minutes)}分鐘`:`${Math.round(minutes/6)/10}小時`;
function Timeline({slots,overlaps=[],date,lo,hi}:{slots:Interval[];overlaps?:Interval[];date:string;lo:number;hi:number}){
 const span=hi-lo;
 const mark=(x:Interval,k:string)=>{const s=Math.max(lo,hoursOf(date,x.startAt)),e=Math.min(hi,hoursOf(date,x.endAt));return e<=s||e<=lo||s>=hi?null:<i key={`${k}${x.startAt}`} className={k} style={{left:`${(s-lo)/span*100}%`,width:`${Math.max(1,(e-s)/span*100)}%`}}/>};
 return <div className={`availability-timeline${overlaps.length?" has-overlap":""}`} aria-label="可配對時間線"><div>{slots.map(x=>mark(x,"slot"))}{overlaps.map(x=>mark(x,"overlap"))}</div></div>
}
function peak(members:Member[]){const e=members.flatMap(m=>m.slots.flatMap(s=>[{at:Date.parse(s.startAt),n:1},{at:Date.parse(s.endAt),n:-1}])).sort((a,b)=>a.at-b.at);let n=0,i=0,b:{s:number;e:number;n:number}|null=null;while(i<e.length){const at=e[i].at;while(i<e.length&&e[i].at===at)n+=e[i++].n;const next=e[i]?.at;if(next&&n>0&&(!b||n>b.n||(n===b.n&&next-at>b.e-b.s)))b={s:at,e:next,n}}return b?{label:`${time(new Date(b.s).toISOString())}–${time(new Date(b.e).toISOString())}`,count:b.n}:null}
function SlotForm({initialDate,slot,onSave,onCancel}:{initialDate:string;slot?:AvailabilitySlot;onSave:(x:Interval)=>void;onCancel?:()=>void}){
 const[d,setD]=useState(slot?hkDate(new Date(slot.startAt)):initialDate),[s,setS]=useState(slot?time(slot.startAt):"19:00"),[e,setE]=useState(slot?time(slot.endAt):"21:00"),[error,setError]=useState("");
 const startTimes=Array.from({length:28},(_,i)=>`${String(10+Math.floor(i/2)).padStart(2,"0")}:${i%2?"30":"00"}`),endTimes=Array.from({length:32},(_,i)=>`${String((10+Math.floor((i+1)/2))%24).padStart(2,"0")}:${(i+1)%2?"30":"00"}`);
 const next=e<=s;
 const preview=()=>{try{return validateAvailabilityInterval(composeAvailabilityInterval(d,s,e))}catch{return null}};
 const value=preview(),hours=value?Math.round((Date.parse(value.endAt)-Date.parse(value.startAt))/360000)/10:0;
 return <form className="slot-composer availability-slot-form" onSubmit={ev=>{ev.preventDefault();if(!value)return setError("請選擇香港時間上午 10 時至翌日凌晨 2 時內、至少 30 分鐘且不超過 12 小時的未來時段。");setError("");onSave(value)}}>
  <div className="composer-times">
   <label><span>日期</span><input type="date" min={hkDate()} value={d} onChange={x=>setD(x.target.value)} required/></label>
   <label><span>開始時間</span><select value={s} onChange={x=>setS(x.target.value)}>{startTimes.map(v=><option key={v}>{v}</option>)}</select></label>
   <label><span>結束時間</span><select value={e} onChange={x=>setE(x.target.value)}>{endTimes.map(v=><option key={v}>{v}{v<=s?" · 次日":""}</option>)}</select></label>
  </div>
  <div className="availability-form-preview" aria-live="polite"><span>時段預覽</span><b>{value?`${dayLabel(d)} ${time(value.startAt)}–${time(value.endAt)}`:"請完成日期及時間選擇"}</b>{value&&<small>{hours} 小時{next?" · 次日結束":""}</small>}</div>
  <p className="availability-form-hint">結束時間早於開始時間時，時段會在翌日結束。</p>
  {error&&<p className="availability-form-error" role="alert">{error}</p>}
  <div className="availability-form-actions"><button className="primary">{slot?"儲存變更":"加入時段"}</button>{onCancel&&<button type="button" className="secondary" onClick={onCancel}>取消</button>}</div>
 </form>
}const timelineRange=(items:Interval[],date:string)=>{void items;void date;return {lo:10,hi:26}};
const scaleLabels=(lo:number,hi:number)=>Array.from({length:Math.floor((hi-lo)/2)+1},(_,i)=>`${String((lo+i*2)%24).padStart(2,"0")}:00`);
const mobileScaleLabels=(lo:number,hi:number)=>Array.from({length:Math.floor((hi-lo)/4)+1},(_,i)=>`${String((lo+i*4)%24).padStart(2,"0")}:00`);
function DensityChart({buckets,best,lo,hi,focus,onFocus}:{buckets:{at:string;count:number}[];best:{startAt:string;endAt:string;count:number}|null;lo:number;hi:number;focus:Interval|null;onFocus:(x:Interval|null)=>void}){
 const max=Math.max(1,...buckets.map(x=>x.count));
 const[hovered,setHovered]=useState<{at:string;count:number}|null>(null);
 const preview=hovered??(focus?buckets.find(x=>x.at===focus.startAt)??null:null);
 return <section className="availability-card density-card" aria-label="可配對密度圖">
  <header><div><small>{hovered?"游標所在時段":"球員空閒分佈"}</small><b className={(preview??best)?"":"muted"}>{preview?`${time(preview.at)}–${time(new Date(Date.parse(preview.at)+30*60000).toISOString())}`:best?`${time(best.startAt)}–${time(best.endAt)}`:"未有高峰"}{preview?<span>{preview.count} 位</span>:best&&<span>{best.count} 位</span>}</b></div>{focus&&<button type="button" className="more" onClick={()=>onFocus(null)}>清除篩選</button>}</header>
  <div className={`density-bars${focus?" is-filtered":""}`}>{buckets.map(x=>{const active=focus?.startAt===x.at,isPeak=best?.startAt===x.at,isHovered=hovered?.at===x.at;return <button type="button" key={x.at} aria-label={`${time(x.at)} 至 ${time(new Date(Date.parse(x.at)+30*60000).toISOString())}，${x.count} 位球員；按下篩選這 30 分鐘`} className={`${active?"on ":""}${isPeak?"peak ":""}${isHovered?"hovered":""}`.trim()} onPointerEnter={()=>setHovered(x)} onPointerLeave={()=>setHovered(null)} onFocus={()=>setHovered(x)} onBlur={()=>setHovered(null)} onClick={()=>onFocus(active?null:{startAt:x.at,endAt:new Date(Date.parse(x.at)+30*60000).toISOString()})}><i style={{height:`${Math.max(8,x.count/max*100)}%`}}/></button>})}</div>
  <div className="density-axis" aria-hidden="true"><span>{clockAt(lo)}</span><span>{clockAt((lo+hi)/2)}</span><span>{clockAt(hi)}</span></div>
  <p className="density-note">{hovered?`${time(hovered.at)}–${time(new Date(Date.parse(hovered.at)+30*60000).toISOString())} 有 ${hovered.count} 位球員有空；按下可篩選這 30 分鐘。`:focus?`${time(focus.startAt)}–${time(focus.endAt)} 的球員已篩選。`:"每條柱代表 30 分鐘；游標停留可預覽，點按可篩選該 30 分鐘。"}</p>
 </section>
}
function DateScroller({dates,selected,counts,onSelect}:{dates:string[];selected:string;counts:Record<string,number>;onSelect:(date:string)=>void}){
 const scrollRef=useRef<HTMLDivElement>(null);
 const move=(direction:-1|1)=>scrollRef.current?.scrollBy({left:direction*Math.max(220,scrollRef.current.clientWidth*.72),behavior:"smooth"});
 useEffect(()=>{scrollRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"})},[selected]);
 return <section className="availability-date-selector" aria-label="未來 14 日">
  <div className="availability-date-selector-head"><b>選擇日期</b><span aria-hidden="true">左右滑動查看未來 14 日 <i>↔</i></span></div>
  <div className="availability-date-strip-wrap">
   <button type="button" className="availability-date-scroll-button previous" aria-label="向前捲動日期" onClick={()=>move(-1)}>‹</button>
   <div className="availability-date-strip" role="tablist" aria-label="選擇日期，左右滑動查看更多" ref={scrollRef}>
    {dates.map((value,index)=>{const active=value===selected,count=counts[value]??0,weekday=new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${value}T00:00:00+08:00`));return <button type="button" key={value} role="tab" aria-label={`${index===0?"今天":index===1?"明天":weekday}，${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日，${count} 位球員有空`} aria-selected={active} aria-current={active?"date":undefined} className={active?"active":""} onClick={()=>onSelect(value)}><small>{index===0?"今天":index===1?"明天":weekday}</small><span>{Number(value.slice(5,7))}/{Number(value.slice(8,10))}</span><strong>{count} 位</strong></button>})}
   </div>
   <button type="button" className="availability-date-scroll-button next" aria-label="向後捲動日期" onClick={()=>move(1)}>›</button>
  </div>
 </section>
}function AvailabilityGrid({members,mine,date,lo,hi,userPlayerId,focus,onFocus}:{members:Member[];mine:Interval[];date:string;lo:number;hi:number;userPlayerId?:string;focus:Interval|null;onFocus:(x:Interval|null)=>void}){
 const span=hi-lo,ticks=Array.from({length:hi-lo+1},(_,i)=>lo+i),scrollRef=useRef<HTMLDivElement>(null);
 const now=hoursOf(date,new Date().toISOString()),showNow=date===hkDate()&&now>=lo&&now<=hi;
 useEffect(()=>{const el=scrollRef.current;if(!el)return;const playerWidth=window.innerWidth<=620?132:150,trackWidth=el.scrollWidth-playerWidth,visibleTrack=el.clientWidth-playerWidth,target=focus?hoursOf(date,focus.startAt):showNow?Math.max(now,18):18;el.scrollTo({left:Math.max(0,(target-lo)/span*trackWidth-visibleTrack*.3),behavior:"smooth"})},[date,focus,hi,lo,now,showNow,span]);
 const me=members.find(x=>x.id===userPlayerId),rows=[...(userPlayerId?[{id:"__me",name:"你",short:"你",rating:me?.rating??0,colour:"#176b55",slots:mine as AvailabilitySlot[]}]:[]),...members.filter(x=>x.id!==userPlayerId)];
 const position=(iso:string)=>`${(hoursOf(date,iso)-lo)/span*100}%`,slotWidth=(slot:Interval)=>`${(hoursOf(date,slot.endAt)-hoursOf(date,slot.startAt))/span*100}%`;
 return <section className="availability-card availability-grid-card" aria-labelledby="availability-grid-title">
  <header className="availability-grid-head"><div><h3 id="availability-grid-title">球員空檔</h3><small>左右滑動查看時間，點按空檔即可篩選</small></div><span>{rows.length} 位</span></header>
  <div className="availability-grid-scroll" ref={scrollRef}><div className="availability-grid">
   <div className="availability-grid-corner">球員</div><div className="availability-grid-axis" aria-hidden="true">{ticks.map(h=><b key={h} style={{left:`${(h-lo)/span*100}%`}}>{clockAt(h)}</b>)}</div>
   {rows.map(member=>{const isMe=member.id==="__me";return <div className={`availability-grid-row${isMe?" is-me":""}`} key={member.id}>
    <div className="availability-grid-player">{isMe?<span className="availability-grid-you">你</span>:<PlayerBadge player={member}/>}<span><b>{member.name}</b>{!isMe&&<small>{Math.round(member.rating)} ELO</small>}</span></div>
    <div className="availability-grid-track">{ticks.slice(1).map(h=><i className="availability-grid-line" key={h} style={{left:`${(h-lo)/span*100}%`}}/>)}
     {member.slots.map(slot=>{const active=Boolean(focus&&intersectIntervals([slot],[focus]).length);return <button type="button" key={`${member.id}-${slot.startAt}`} className={`availability-grid-slot${active?" is-active":""}`} style={{left:position(slot.startAt),width:slotWidth(slot)}} aria-label={`${member.name} ${range(slot)}`} onClick={()=>onFocus(active?null:{startAt:slot.startAt,endAt:slot.endAt})}><span>{range(slot)}</span></button>})}
     {focus&&<i className="availability-grid-focus" style={{left:position(focus.startAt),width:slotWidth(focus)}}/>}{showNow&&<i className="availability-grid-now" style={{left:`${(now-lo)/span*100}%`}}/>}
    </div></div>})}
  </div></div>
  <div className="availability-grid-legend"><span><i/>該時段有空</span>{focus&&<button type="button" className="more" onClick={()=>onFocus(null)}>清除 {range(focus)}</button>}</div>
 </section>
}
function SlotComposer({initialDate,onSave}:{initialDate:string;onSave:(x:Interval)=>void}){return <SlotForm initialDate={initialDate} onSave={onSave}/>}/* The one question the page exists to answer, answered before anything else on screen. Which card
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
  from=Math.max(from,floor);
  if(drag.mode==="start")from=Math.min(from,25.5);
  if(from>=26)return;
  to=Math.min(Math.max(to,from+MIN_HOURS),from+MAX_HOURS,26);
  if(to<=from)return;
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
       {on&&<><i className="board-handle start" onPointerDown={ev=>begin(ev,date,{key:item.key,from:item.from,to:item.to,mode:"start"})}/><i className="board-handle end" onPointerDown={ev=>begin(ev,date,{key:item.key,from:item.from,to:item.to,mode:"end"})}/></>}
      </button>})}
     {drag?.date===date&&drag.mode==="create"&&Math.abs(drag.to-drag.from)>=MIN_HOURS&&<i className="board-ghost" style={{left:pct(Math.min(drag.from,drag.to)),width:width(Math.min(drag.from,drag.to),Math.max(drag.from,drag.to))}}>{clockAt(Math.min(drag.from,drag.to))}–{clockAt(Math.max(drag.from,drag.to))}</i>}
    </div>
   </div>})}
 </div>;
}
const HORIZON=14;
export default function Availability({userPlayerId,matches}:{userPlayerId?:string;matches:Match[]}){
 const week=useMemo(()=>days(hkDate(),HORIZON),[]),[date,setDate]=useState(hkDate()),[members,setMembers]=useState<Member[]>([]),[counts,setCounts]=useState<Record<string,number>>({}),[own,setOwn]=useState<AvailabilitySlot[]>([]),[view,setView]=useState<View>("find"),[draft,setDraft]=useState<Interval[]>([]),[selected,setSelected]=useState<string|null>(null),[adjustment,setAdjustment]=useState<Interval|null>(null),[focus,setFocus]=useState<Interval|null>(null),[boardWide,setBoardWide]=useState(false),[pending,setPending]=useState<AvailabilitySlot|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[cancelling,setCancelling]=useState(false),[confirmingChange,setConfirmingChange]=useState(false),[message,setMessage]=useState(""),[recommendationNow]=useState(()=>Date.now());
 const dialogRef=useRef<HTMLElement|null>(null),firstLoad=useRef(true),savingRef=useRef(false),cancellingRef=useRef(false),confirmingChangeRef=useRef(false);
 useEffect(()=>{const c=new AbortController();async function load(){setLoading(true);try{const[selected,summary,mine]=await Promise.all([fetch(`/api/availability?date=${date}`,{signal:c.signal}).then(r=>r.json()),fetch(`/api/availability?week=${week[0]}&days=${HORIZON}`,{signal:c.signal}).then(r=>r.json()),userPlayerId?fetch("/api/availability?me",{signal:c.signal}).then(r=>r.json()):Promise.resolve({slots:[]})]);if(selected.error)throw Error(selected.error);setMembers(selected.members);setCounts(summary.counts??{});setOwn(mine.slots??[]);setMessage("")}catch(e){if(e instanceof Error&&e.name!=="AbortError")setMessage(e.message)}finally{if(!c.signal.aborted)setLoading(false)}}if(firstLoad.current)firstLoad.current=false;else trackAvailabilityEvent("availability_date_select");void load();return()=>c.abort()},[date,userPlayerId,week]);
 useEffect(()=>trackAvailabilityEvent("availability_view"),[]);
 useEffect(()=>{if(!message)return;const timer=window.setTimeout(()=>setMessage(""),4000);return()=>window.clearTimeout(timer)},[message]);
 const refreshFind=async()=>{
  try{const[selectedDate,summary]=await Promise.all([fetch(`/api/availability?date=${date}`).then(r=>r.json()),fetch(`/api/availability?week=${week[0]}&days=${HORIZON}`).then(r=>r.json())]);
  if(!selectedDate.error)setMembers(selectedDate.members??[]);if(!summary.error)setCounts(summary.counts??{});
  }catch{/* The mutation succeeded; retain the updated own slots if discovery refresh is temporarily unavailable. */}
 };
 const mine=useMemo(()=>{const r=dayRangeHongKong(date);return own.filter(s=>Date.parse(s.startAt)<Date.parse(r.endAt)&&Date.parse(s.endAt)>Date.parse(r.startAt))},[own,date]);
 /* The board reads chronologically top to bottom: today's row first, each slot placed on the day it
    starts. Published and unpublished slots share the same geometry so they line up on one axis. */
 const soonest=useMemo(()=>nextAvailabilityStart().at,[own,draft]);
 const boardDates=useMemo(()=>week.slice(0,boardWide?HORIZON:7),[week,boardWide]);
 const boardItems=useMemo(()=>{const make=(key:string,x:Interval,id?:string):BoardItem=>{const calendarDate=hkDate(new Date(x.startAt)),calendarHour=hoursOf(calendarDate,x.startAt),d=calendarHour<2?addDaysHongKong(calendarDate,-1):calendarDate;return {key,id,date:d,from:hoursOf(d,x.startAt),to:hoursOf(d,x.endAt),draft:!id}};
  return [...own.map(x=>make(x.id,x,x.id)),...draft.map(x=>make(x.startAt,x))].sort((a,b)=>a.date.localeCompare(b.date)||a.from-b.from)},[own,draft]);
 const boardRange={lo:10,hi:26};
 const active=useMemo(()=>boardItems.find(i=>i.key===selected)??null,[boardItems,selected]);
 const adjusted=active&&adjustment?{...active,from:hoursOf(active.date,adjustment.startAt),to:hoursOf(active.date,adjustment.endAt)}:active;
 const displayedBoardItems=useMemo(()=>adjustment&&selected?boardItems.map(item=>item.key===selected?{...item,from:hoursOf(item.date,adjustment.startAt),to:hoursOf(item.date,adjustment.endAt)}:item):boardItems,[boardItems,adjustment,selected]);
 const rosterRange=useMemo(()=>timelineRange([...mine,...members.flatMap(m=>m.slots)],date),[mine,members,date]);
 const perMember=useMemo(()=>members.map(m=>m.slots as Interval[]),[members]);
 const busiest=useMemo(()=>availabilityPeak(perMember),[perMember]);
 const density=useMemo(()=>availabilityDensity(perMember,date,rosterRange.lo,rosterRange.hi),[perMember,date,rosterRange]);
 const matchInfo=useMemo(()=>{const map=new Map<string,MatchInfo>();if(!userPlayerId)return map;const me=members.find(x=>x.id===userPlayerId),cut=recommendationNow-30*864e5;for(const member of members){if(member.id===userPlayerId)continue;const overlaps=intersectIntervals(mine,member.slots),minutes=overlapMinutes(overlaps),recent=matches.filter(m=>m.status==="confirmed"&&Date.parse(`${m.playedOn}T00:00:00+08:00`)>=cut&&((m.a===userPlayerId&&m.b===member.id)||(m.b===userPlayerId&&m.a===member.id))).slice(0,5).length,difference=Math.abs((me?.rating??0)-member.rating),scored=recommendationScore({minutes,eloDifference:(me?.rating??0)-member.rating,recentMatches:recent});map.set(member.id,{overlaps,minutes,recent,difference,score:scored?.score??-1,qualifies:Boolean(scored),chips:[]})}
  /* One reason per candidate, strongest first, so the list explains its own order without a legend. */
  const longest=Math.max(0,...[...map.values()].map(x=>x.minutes));
  for(const info of map.values()){if(!info.minutes)continue;if(longest>0&&info.minutes===longest)info.chips.push("時間重疊最長");if(info.difference<50)info.chips.push("ELO 相近");if(info.recent===0)info.chips.push("近期未交手")}
  return map},[members,matches,mine,userPlayerId,recommendationNow]);
 /* Focus is the histogram's output: a one-hour band that every list below is measured against, so
    "who is around at nine" is one press rather than a re-read of the whole roster. */
 const inFocus=useMemo(()=>(x:Interval[])=>!focus||intersectIntervals(x,[focus]).length>0,[focus]);
 const candidates=useMemo(()=>members.filter(m=>m.id!==userPlayerId&&inFocus(m.slots)).map(member=>({member,...(matchInfo.get(member.id)??{overlaps:[],minutes:0,recent:0,difference:0,score:-1,qualifies:false,chips:[]})})),[members,matchInfo,userPlayerId,inFocus]);
 const shortlist=useMemo(()=>candidates.filter(c=>c.minutes>0).sort((a,b)=>b.score-a.score||b.minutes-a.minutes||a.difference-b.difference),[candidates]);
 const top=shortlist[0]??null;
 const changeDate=(next:string)=>{setFocus(null);setDate(next)};
 const editor=view==="manage"||view==="create";
 const nav=(v:View)=>{if(v==="create"){trackAvailabilityEvent("availability_composer_open");setSelected(null)}setView(v)};
 const save=async()=>{
  if(savingRef.current)return;
  savingRef.current=true;setSaving(true);setMessage("");
  try{
   const r=await fetch("/api/availability",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({slots:draft})}),b=await r.json();
   if(!r.ok){setMessage(b.error??"發佈失敗，請再試一次。");return}
   setOwn(b.slots??[]);setDraft([]);setView("manage");await refreshFind();setMessage("時段已發佈，推薦已更新。");trackAvailabilityEvent("availability_slot_publish");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{savingRef.current=false;setSaving(false)}
 };
 const update=async(id:string,x:Interval)=>{
  const previous=own;
  setOwn(current=>current.map(slot=>slot.id===id?{...slot,...x,updatedAt:new Date().toISOString()}:slot));
  try{
   const r=await fetch(`/api/availability/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(x)}),b=await r.json();
   if(!r.ok){setOwn(previous);setMessage(b.error??"更新失敗，請再試一次。");return false}
   setOwn(b.slots??[]);setSelected(null);await refreshFind();setMessage("時段已更新。");trackAvailabilityEvent("availability_slot_edit");return true;
  }catch{setOwn(previous);setMessage("網絡連線失敗，請再試一次。");return false}
 };
 /* Nudging keeps the slot legal rather than bouncing an error: the edge stops at 30 minutes wide,
    at 12 hours long, and never reaches back before the next bookable half hour. */
 const nudge=(item:BoardItem,startBy:number,endBy:number)=>{
  const base=adjustment?{from:hoursOf(item.date,adjustment.startAt),to:hoursOf(item.date,adjustment.endAt)}:item;
  const floor=Math.ceil(hoursOf(item.date,new Date(soonest).toISOString())*2)/2;
  const from=Math.max(Math.min(base.from+startBy,base.to-.5),floor,10),to=Math.min(Math.max(base.to+endBy,from+.5),from+12,26);
  if(from===base.from&&to===base.to)return;
  setAdjustment(intervalFromHours(item.date,from,to));
 };
 const confirmNudge=async()=>{
  if(!active||!adjustment||confirmingChangeRef.current)return;
  if(active.draft){setDraft(a=>mergeIntervals([...a.filter(v=>v.startAt!==active.key),adjustment]));setSelected(adjustment.startAt);setAdjustment(null);return}
  confirmingChangeRef.current=true;setConfirmingChange(true);
  try{if(await update(active.key,adjustment))setAdjustment(null)}
  finally{confirmingChangeRef.current=false;setConfirmingChange(false)}
 };
 const cancel=async()=>{
  if(!pending||cancellingRef.current)return;
  cancellingRef.current=true;setCancelling(true);setMessage("");
  try{
   const r=await fetch(`/api/availability/${pending.id}`,{method:"DELETE"}),b=await r.json();
   if(!r.ok){setMessage(b.error??"取消失敗，請再試一次。");return}
   setOwn(a=>a.filter(x=>x.id!==pending.id));setPending(null);await refreshFind();setMessage("時段已取消。");trackAvailabilityEvent("availability_slot_cancel");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{cancellingRef.current=false;setCancelling(false)}
 };
 useEffect(()=>{if(!pending)return;const previous=document.activeElement as HTMLElement|null,dialog=dialogRef.current,focusable=dialog?Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')):[];focusable[0]?.focus();function onKey(ev:KeyboardEvent){if(ev.key==="Escape")return setPending(null);if(ev.key==="Tab"&&focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}}}document.addEventListener("keydown",onKey);return()=>{document.removeEventListener("keydown",onKey);previous?.focus()}},[pending]);
 return <section className="availability-page">
<section className="hero small availability-hero"><div><p className="kicker">MATCHMAKING</p><h1>找對手，約一局</h1><p>公開你的空閒時間，快速找到最合適的球友。</p></div>{userPlayerId&&<button className="primary" onClick={()=>nav("create")}>＋ 新增時段</button>}</section>
<nav className="availability-tabs" aria-label="配對功能" role="tablist"><button role="tab" aria-selected={view==="find"} className={view==="find"?"active":""} onClick={()=>nav("find")}><span className="availability-tab-label">尋找對手</span></button>{userPlayerId&&<button role="tab" aria-selected={view==="manage"||view==="create"} className={view==="manage"||view==="create"?"active":""} onClick={()=>nav("manage")}><span className="availability-tab-label">我的時段</span>{own.length>0&&<span className="availability-tab-count">{own.length}</span>}</button>}</nav>
{view==="find"&&<DateScroller dates={week} selected={date} counts={counts} onSelect={changeDate}/>}
{message&&<p key={message} className="availability-notice" role="status">{message}</p>}
{view==="find"&&<>
<header className="availability-day-head"><div><p>{fullDay(date)}</p><h2>{members.length?`${members.length} 位球員有空`:"暫時未有人有空"}</h2></div>
 {userPlayerId&&<button className="more" onClick={()=>nav("manage")}>{mine.length?`我的時段 ${mine.map(range).join("、")}`:"未設定我的時段"}</button>}</header>
{loading?<div className="availability-skeleton" aria-hidden="true"/>:<div className="find-stack">
 {members.length>0&&<DensityChart buckets={density} best={busiest} lo={rosterRange.lo} hi={rosterRange.hi} focus={focus} onFocus={setFocus}/>}
 {members.length>0&&<AvailabilityGrid members={members} mine={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi} userPlayerId={userPlayerId} focus={focus} onFocus={setFocus}/>}
 <MatchHero top={top} mine={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi} userPlayerId={userPlayerId} members={members.length} focus={focus} onManage={nav}/>
</div>}</>}
{/* One screen, one gesture: the board is the list, the editor and the composer at once. Nothing here
    navigates away, so a member can paint three evenings and publish them in a single pass. */}
{editor&&userPlayerId&&<section className="availability-editor">
 <header className="availability-day-head"><div><p>我的時段</p><h2>公開你的空閒時間</h2><small>在日子的時間列上拖曳即可加入，點按已公開的時段可調整或刪除。</small></div>
  <span className="slot-tally"><b>{own.length}</b>個已公開</span></header>
 <section className={`availability-card slot-board-card${draft.length?" has-draft":""}`}>
  <SlotBoard dates={boardDates} items={displayedBoardItems} lo={boardRange.lo} hi={boardRange.hi} soonest={soonest} selected={selected}
   onSelect={key=>{setSelected(key);setAdjustment(null)}}
   onCreate={x=>{setDraft(a=>mergeIntervals([...a,x]));setSelected(null);setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}
   onResize={(item,x)=>{if(item.draft){setDraft(a=>mergeIntervals([...a.filter(v=>v.startAt!==item.key),x]));setSelected(x.startAt)}else setAdjustment(x)}}/>
  {!own.length&&!draft.length&&<p className="board-hint">在上面任何一行拖曳，就能加入可配對時段。輕按一下等於兩小時。</p>}
  <div className="board-legend"><span><i className="legend-live"/>已公開</span><span><i className="legend-draft"/>未發佈</span><button type="button" className="more" onClick={()=>setBoardWide(v=>!v)}>{boardWide?"只看未來 7 天":"顯示未來 14 天"}</button></div>
 </section>
 {active&&adjusted&&<section className={`slot-detail${adjustment?" has-adjustment":""}`} role="group" aria-label="調整已選時段">
  <div><small>{fullDay(active.date)}</small><b>{clockAt(adjusted.from)}–{clockAt(adjusted.to)}</b><span>{durationLabel((adjusted.to-adjusted.from)*60)}{active.draft?" · 未發佈":""}{adjustment?" · 待確認":""}</span></div>
  <div className="slot-nudge"><small>開始</small><button type="button" aria-label="開始時間提早 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,-.5,0)}>−</button><button type="button" aria-label="開始時間延後 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,.5,0)}>+</button></div>
  <div className="slot-nudge"><small>結束</small><button type="button" aria-label="結束時間提早 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,0,-.5)}>−</button><button type="button" aria-label="結束時間延後 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,0,.5)}>+</button></div>
  <span className="card-tools"><button className="card-tool danger" aria-label={`刪除 ${dayLabel(active.date)} ${clockAt(active.from)}–${clockAt(active.to)} 的時段`} onClick={()=>{const found=own.find(v=>v.id===active.key);if(active.draft)setDraft(a=>a.filter(v=>v.startAt!==active.key));else if(found)setPending(found);setSelected(null);setAdjustment(null)}}>✕</button></span>{adjustment&&<div className="slot-confirm-actions"><button type="button" className="secondary" disabled={confirmingChange} onClick={()=>setAdjustment(null)}>取消變更</button><button type="button" className="primary publish-button" disabled={confirmingChange} aria-busy={confirmingChange} onClick={()=>void confirmNudge()}>{confirmingChange&&<i className="button-spinner" aria-hidden="true"/>}<span>{confirmingChange?"儲存中…":"確認變更"}</span></button></div>}
 </section>}
 {draft.length>0&&<div className="draft-bar" role="status"><div><b>{draft.length} 個未發佈時段</b><span>{draft.map(x=>`${dayLabel(hkDate(new Date(x.startAt)))} ${range(x)}`).join("、")}</span></div>
  <div><button className="secondary" disabled={saving} onClick={()=>{setDraft([]);setSelected(null)}}>清除</button><button className="primary publish-button" disabled={saving} aria-busy={saving} onClick={()=>void save()}>{saving&&<i className="button-spinner" aria-hidden="true"/>}<span>{saving?"發佈中…":"發佈"}</span></button></div></div>}
 <details className="board-precise"><summary>用選單精確加入時段</summary><SlotComposer initialDate={date} onSave={x=>{setDraft(a=>mergeIntervals([...a,x]));setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}/></details>
</section>}
{pending&&<div className="availability-dialog-backdrop" onMouseDown={()=>setPending(null)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>取消可配對時段</small><h2 id="cancel-title">{dayLabel(hkDate(new Date(pending.startAt)))} {range(pending)}</h2><p>取消後，這段時間不會再出現在其他球員的配對結果中。</p><div><button className="secondary" disabled={cancelling} onClick={()=>setPending(null)}>保留時段</button><button className="danger cancel-button" disabled={cancelling} aria-busy={cancelling} onClick={()=>void cancel()}>{cancelling&&<i className="button-spinner" aria-hidden="true"/>}<span>{cancelling?"取消中…":"確認取消"}</span></button></div></section></div>}
</section>}
