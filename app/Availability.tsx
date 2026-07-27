"use client";
import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
import {PlayerBadge} from "./UiBits";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import {addDaysHongKong,availabilityDensity,availabilityPeak,composeAvailabilityInterval,dayRangeHongKong,hkClock,hkDate,hkDayLabel,intervalFromHours,intersectIntervals,mergeIntervals,nextAvailabilityStart,rankOpponents,validateAvailabilityInterval,type AvailabilitySlot,type Interval} from "../lib/availability";
type Player={id:string;name:string;short:string;rating:number;colour?:string;avatar?:string|null};type Match={a:string;b:string;playedOn:string;status:"confirmed"|"void"};type Member=Player&{slots:AvailabilitySlot[]};type MatchInfo={overlaps:Interval[];minutes:number;recent:number;score:number;difference:number;qualifies:boolean;chips:string[]};type View="find"|"recommendations"|"manage"|"create";
const time=hkClock,dayLabel=hkDayLabel,range=(x:Interval)=>`${time(x.startAt)}–${time(x.endAt)}`,utc=(d:string,t:string)=>new Date(`${d}T${t}:00+08:00`).toISOString(),days=(start:string,horizon=7)=>Array.from({length:horizon},(_,i)=>addDaysHongKong(start,i)),fullDay=(d:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"long",day:"numeric",weekday:"long"}).format(new Date(`${d}T00:00:00+08:00`));
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
  <header><div><small>{hovered?"游標所在時段":"球手時間分佈"}</small><b className={(preview??best)?"":"muted"}>{preview?`${time(preview.at)}–${time(new Date(Date.parse(preview.at)+30*60000).toISOString())}`:best?`${time(best.startAt)}–${time(best.endAt)}`:"未有高峰"}{preview?<span>{preview.count} 位</span>:best&&<span>{best.count} 位</span>}</b></div>{focus&&<button type="button" className="more" onClick={()=>onFocus(null)}>清除篩選</button>}</header>
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
}function AvailabilityGrid({members,mine,date,lo,hi,userPlayerId,focus,onFocus,highlightId,onPlayer}:{members:Member[];mine:Interval[];date:string;lo:number;hi:number;userPlayerId?:string;focus:Interval|null;onFocus:(x:Interval|null)=>void;highlightId?:string|null;onPlayer?:(playerId:string)=>void}){
 const span=hi-lo,ticks=Array.from({length:hi-lo+1},(_,i)=>lo+i),scrollRef=useRef<HTMLDivElement>(null),highlightRef=useRef<HTMLDivElement>(null);
 /* Arriving here from a player's profile card should land on their row, not just the right tab — a
    quiet flash (borrowed from the match-history "just recorded" treatment) is the only way to say
    "this one" without a modal in the way. */
 useEffect(()=>{if(highlightId)highlightRef.current?.scrollIntoView({behavior:"smooth",block:"center"})},[highlightId]);
 const now=hoursOf(date,new Date().toISOString()),showNow=date===hkDate()&&now>=lo&&now<=hi;
 useEffect(()=>{const el=scrollRef.current;if(!el)return;const playerWidth=window.innerWidth<=620?132:150,trackWidth=el.scrollWidth-playerWidth,visibleTrack=el.clientWidth-playerWidth,target=focus?hoursOf(date,focus.startAt):showNow?Math.max(now,18):18;el.scrollTo({left:Math.max(0,(target-lo)/span*trackWidth-visibleTrack*.3),behavior:"smooth"})},[date,focus,hi,lo,now,showNow,span]);
 const me=members.find(x=>x.id===userPlayerId),rows=[...(userPlayerId?[{id:"__me",name:"你",short:"你",rating:me?.rating??0,colour:"#176b55",slots:mine as AvailabilitySlot[]}]:[]),...members.filter(x=>x.id!==userPlayerId)];
 const position=(iso:string)=>`${(hoursOf(date,iso)-lo)/span*100}%`,slotWidth=(slot:Interval)=>`${(hoursOf(date,slot.endAt)-hoursOf(date,slot.startAt))/span*100}%`;
 return <section className="availability-card availability-grid-card" aria-labelledby="availability-grid-title">
  <header className="availability-grid-head"><div><h3 id="availability-grid-title">球員空檔</h3><small>左右滑動查看時間，點按空檔即可篩選</small></div><span>{rows.length} 位</span></header>
  <div className="availability-grid-scroll" ref={scrollRef}><div className="availability-grid">
   <div className="availability-grid-corner">球員</div><div className="availability-grid-axis" aria-hidden="true">{ticks.map(h=><b key={h} style={{left:`${(h-lo)/span*100}%`}}>{clockAt(h)}</b>)}</div>
   {rows.map(member=>{const isMe=member.id==="__me",isHighlighted=highlightId===member.id;return <div ref={isHighlighted?highlightRef:undefined} className={`availability-grid-row${isMe?" is-me":""}${isHighlighted?" is-highlighted":""}`} key={member.id}>
    {onPlayer&&!isMe
      ? <button type="button" className="availability-grid-player is-clickable" aria-label={`查看 ${member.name} 的球員卡`} onClick={()=>onPlayer(member.id)}><PlayerBadge player={member}/><span><b>{member.name}</b><small>{Math.round(member.rating)} ELO</small></span></button>
      : <div className="availability-grid-player">{isMe?<span className="availability-grid-you">你</span>:<PlayerBadge player={member}/>}<span><b>{member.name}</b>{!isMe&&<small>{Math.round(member.rating)} ELO</small>}</span></div>}
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
function MatchPrompt({hasMine,userPlayerId,members,focus,onManage}:{hasMine:boolean;userPlayerId?:string;members:number;focus:Interval|null;onManage:(v:"manage"|"create")=>void}){
 if(!userPlayerId)return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">找對手</p><h2>登入後即可看到最合適的對手</h2><p>連結球員帳戶，我們會按你公開的時間、ELO 及近期交手紀錄排出建議。</p></section>;
 if(!hasMine)return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">先設定你的時間</p><h2>{members?`這天有 ${members} 位球員有空`:"這天暫時未有人公開時段"}</h2><p>公開你自己的空閒時間後，這裡會直接告訴你今晚最值得約的對手。</p><button className="primary" onClick={()=>onManage("create")}>公開我的時段</button></section>;
 return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">{focus?"這個時段":"這一天"}沒有重疊</p><h2>暫時沒有人與你的時間重疊</h2><p>{focus?"試試清除時段篩選，或選擇其他日子。":"換一天，或加闊你的可配對時間，配對機會會明顯提高。"}</p><button className="secondary" onClick={()=>onManage("manage")}>調整我的時段</button></section>;
}
/** One card per overlapping opponent, all in the same full-size treatment. There is no single "best
    tonight" card any more: every name you could actually play gets the same room to make its case. */
function OpponentCard({opponent,rank,onPlayer}:{opponent:MatchInfo&{member:Member};rank:number;onPlayer?:(playerId:string)=>void}){
 const open=()=>onPlayer?.(opponent.member.id);
 return <section className={`match-hero match-hero-compact${onPlayer?" is-clickable":""}`} role={onPlayer?"button":undefined} tabIndex={onPlayer?0:undefined} onClick={onPlayer?open:undefined} onKeyDown={onPlayer?(e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}}):undefined}>
  <div className="match-hero-main">
   <span className="match-hero-rank">{rank}</span>
   <PlayerBadge player={opponent.member}/>
   <div className="match-hero-who"><h2>{opponent.member.name}</h2><small>{Math.round(opponent.member.rating)} ELO · 相差 {Math.round(opponent.difference)}</small></div>
  </div>
  <div className="match-hero-windows">{opponent.overlaps.map(o=><span key={o.startAt} className="match-hero-window-chip">{range(o)}</span>)}<small>共 {durationLabel(opponent.minutes)}重疊</small></div>
  {opponent.chips.length>0&&<div className="track-chips">{opponent.chips.map(c=><span key={c}>{c}</span>)}</div>}
  <div className="match-hero-foot">
   <small>近 30 日交手 {opponent.recent} 場</small>
   <button className="secondary" disabled onClick={e=>e.stopPropagation()}>邀請對局<small>即將推出</small></button>
  </div>
 </section>
}
/* The board speaks in hours from the start of a row's Hong Kong day, so a slot that runs past
   midnight simply extends beyond 24 on the row it started in — one bar, one row, no wrapping. */
const clockAt=(h:number)=>`${String(Math.floor(h)%24).padStart(2,"0")}:${h%1?"30":"00"}`;
const hoursOf=(date:string,iso:string)=>(Date.parse(iso)-Date.parse(dayRangeHongKong(date).startAt))/3600000;
const snapHalf=(h:number)=>Math.round(h*2)/2;
const MIN_HOURS=0.5,MAX_HOURS=12,TAP_HOURS=2;
type BoardItem={key:string;id?:string;date:string;from:number;to:number;draft:boolean;pending?:boolean};
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
      return <button type="button" key={item.key} className={`board-slot${item.draft||item.pending?" is-draft":""}${on?" is-selected":""}`} style={{left:pct(from),width:width(from,to)}}
       aria-label={`${label} ${clockAt(from)} 至 ${clockAt(to)}${item.draft?"（未發佈）":item.pending?"（未儲存的變更）":""}，按下以調整或刪除`} aria-pressed={on}
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
export default function Availability({userPlayerId,matches,onDirtyChange,jumpTo,onPlayer}:{userPlayerId?:string;matches:Match[];onDirtyChange?:(dirty:boolean)=>void;jumpTo?:{playerId:string;date:string}|null;onPlayer?:(playerId:string)=>void}){
 const week=useMemo(()=>days(hkDate(),HORIZON),[]),[date,setDate]=useState(jumpTo?.date??hkDate()),[appliedJump,setAppliedJump]=useState(jumpTo??null),[members,setMembers]=useState<Member[]>([]),[counts,setCounts]=useState<Record<string,number>>({}),[own,setOwn]=useState<AvailabilitySlot[]>([]),[view,setView]=useState<View>("find"),[draft,setDraft]=useState<Interval[]>([]),[selected,setSelected]=useState<string|null>(null),[adjustments,setAdjustments]=useState<Record<string,Interval>>({}),[focus,setFocus]=useState<Interval|null>(null),[boardWide,setBoardWide]=useState(false),[pending,setPending]=useState<AvailabilitySlot|null>(null),[leaveTo,setLeaveTo]=useState<View|null>(null),[confirmClear,setConfirmClear]=useState(false),[clearing,setClearing]=useState(false),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[cancelling,setCancelling]=useState(false),[confirmingChange,setConfirmingChange]=useState(false),[message,setMessage]=useState(""),[recommendationNow]=useState(()=>Date.now());
 const dialogRef=useRef<HTMLElement|null>(null),firstLoad=useRef(true),savingRef=useRef(false),cancellingRef=useRef(false),confirmingChangeRef=useRef(false),clearingRef=useRef(false);
 useEffect(()=>{const c=new AbortController();async function load(){setLoading(true);try{const[selected,summary,mine]=await Promise.all([fetch(`/api/availability?date=${date}`,{signal:c.signal}).then(r=>r.json()),fetch(`/api/availability?week=${week[0]}&days=${HORIZON}`,{signal:c.signal}).then(r=>r.json()),userPlayerId?fetch("/api/availability?me",{signal:c.signal}).then(r=>r.json()):Promise.resolve({slots:[]})]);if(selected.error)throw Error(selected.error);setMembers(selected.members);setCounts(summary.counts??{});setOwn(mine.slots??[]);setMessage("")}catch(e){if(e instanceof Error&&e.name!=="AbortError")setMessage(e.message)}finally{if(!c.signal.aborted)setLoading(false)}}if(firstLoad.current)firstLoad.current=false;else trackAvailabilityEvent("availability_date_select");void load();return()=>c.abort()},[date,userPlayerId,week]);
 /* A profile card's "在可配對查看" button lands here with a target player and their nearest free day.
    Adjusted during render rather than in an effect: the jump can arrive while this tab is already
    open (card opened from the grid itself), so mount-time initial state alone would miss it, and an
    effect would paint the wrong day first. The highlight is the parent's to clear, mirroring
    highlightMatch in Matches, so it survives until the member navigates away. */
 if(jumpTo&&jumpTo!==appliedJump){setAppliedJump(jumpTo);setView("find");setFocus(null);setDate(jumpTo.date)}
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
 /* Pending edits are keyed by slot, so moving the selection elsewhere no longer throws one away, and
    every unsaved slot keeps its edited geometry on the board instead of only the selected one. */
 const adjustment=selected?adjustments[selected]??null:null;
 /* A slot can vanish under a pending edit (cancelled here, or elsewhere before a refresh), so the live
    set is derived from what still exists rather than synced — an orphan can never be saved. */
 const pendingKeys=useMemo(()=>{const ids=new Set(own.map(s=>s.id));return Object.keys(adjustments).filter(k=>ids.has(k))},[adjustments,own]);
 /* Edited slots and unpublished ones read as one pile of uncommitted work, listed in clock order so
    the summary matches the board top to bottom. */
 const uncommitted=useMemo(()=>[...pendingKeys.map(k=>adjustments[k]),...draft].sort((a,b)=>a.startAt.localeCompare(b.startAt)),[pendingKeys,adjustments,draft]);
 const adjusted=active&&adjustment?{...active,from:hoursOf(active.date,adjustment.startAt),to:hoursOf(active.date,adjustment.endAt)}:active;
 const displayedBoardItems=useMemo(()=>boardItems.map(item=>{const x=adjustments[item.key];return x?{...item,from:hoursOf(item.date,x.startAt),to:hoursOf(item.date,x.endAt),pending:true}:item}),[boardItems,adjustments]);
 const rosterRange=useMemo(()=>timelineRange([...mine,...members.flatMap(m=>m.slots)],date),[mine,members,date]);
 const perMember=useMemo(()=>members.map(m=>m.slots as Interval[]),[members]);
 const busiest=useMemo(()=>availabilityPeak(perMember),[perMember]);
 const density=useMemo(()=>availabilityDensity(perMember,date,rosterRange.lo,rosterRange.hi),[perMember,date,rosterRange]);
 /* Every overlapping opponent, ranked — the page recommends the whole list, not one name. Ranking
    lives in lib so it stays testable and so the focused band narrows the overlap it ranks on. */
 const shortlist=useMemo(()=>{
  if(!userPlayerId)return [];
  const me=members.find(x=>x.id===userPlayerId),cut=recommendationNow-30*864e5,byId=new Map(members.map(m=>[m.id,m]));
  const ranked=rankOpponents({
   mine,rating:me?.rating??0,window:focus,
   opponents:members.filter(m=>m.id!==userPlayerId).map(m=>({id:m.id,rating:m.rating,slots:m.slots as Interval[]})),
   recentMatches:id=>matches.filter(m=>m.status==="confirmed"&&Date.parse(`${m.playedOn}T00:00:00+08:00`)>=cut&&((m.a===userPlayerId&&m.b===id)||(m.b===userPlayerId&&m.a===id))).length,
  });
  const longest=Math.max(0,...ranked.map(x=>x.minutes));
  return ranked.map(x=>({...x,member:byId.get(x.id)!,chips:[...(longest>0&&x.minutes===longest?["時間重疊最長"]:[]),...(x.difference<50?["ELO 相近"]:[]),...(x.recent===0?["近期未交手"]:[])]}));
 },[members,matches,mine,userPlayerId,recommendationNow,focus]);
 const changeDate=(next:string)=>{setFocus(null);setDate(next)};
 const editor=view==="manage"||view==="create";
 /* Unsaved work only lives in this component's state, so every way out of it has to ask first: the
    tabs here, the app-level tabs (via the parent), and closing the tab outright. */
 const dirty=uncommitted.length>0;
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange]);
 useEffect(()=>{
  if(!dirty)return;
  const warn=(ev:BeforeUnloadEvent)=>{ev.preventDefault();ev.returnValue=""};
  window.addEventListener("beforeunload",warn);
  return()=>window.removeEventListener("beforeunload",warn);
 },[dirty]);
 const discard=()=>{setAdjustments({});setDraft([]);setSelected(null)};
 const go=(v:View)=>{if(v==="create"){trackAvailabilityEvent("availability_composer_open");setSelected(null)}setView(v)};
 /* Moving between the two editor views keeps the work; only stepping out of the editor loses it. */
 const nav=(v:View)=>{if(dirty&&editor&&!(v==="manage"||v==="create"))return setLeaveTo(v);go(v)};
 /* Edits to published slots and brand-new slots are both just "work I have not committed yet", so one
    action commits the lot. Edits go first: they are independent PATCHes, and publishing returns the
    full slot list, which then stands as the final truth. */
 const commitAll=async()=>{
  if(savingRef.current)return;
  const entries=pendingKeys.map(key=>[key,adjustments[key]] as const);
  if(!entries.length&&!draft.length)return;
  savingRef.current=true;setSaving(true);setMessage("");
  let slots=own;const saved:string[]=[];
  /* A later step failing must not discard the steps that already landed on the server, so settle to
     the newest truth we hold and keep only the parts still uncommitted. */
  const settle=()=>{setOwn(slots);if(saved.length)setAdjustments(a=>{const rest={...a};for(const key of saved)delete rest[key];return rest})};
  try{
   for(const[id,x]of entries){
    const r=await fetch(`/api/availability/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(x)}),b=await r.json();
    if(!r.ok){settle();setMessage(b.error??"更新失敗，請再試一次。");return}
    slots=b.slots??slots;saved.push(id);
   }
   if(draft.length){
    const r=await fetch("/api/availability",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({slots:draft})}),b=await r.json();
    if(!r.ok){settle();setMessage(b.error??"發佈失敗，請再試一次。");return}
    slots=b.slots??slots;setDraft([]);trackAvailabilityEvent("availability_slot_publish");
   }
   if(entries.length)trackAvailabilityEvent("availability_slot_edit");
   settle();setSelected(null);setView("manage");await refreshFind();
   setMessage(entries.length&&draft.length?"變更已儲存，新時段已發佈。":draft.length?"時段已發佈，推薦已更新。":entries.length>1?`${entries.length} 個時段已更新。`:"時段已更新。");
  }catch{settle();setMessage("網絡連線失敗，請再試一次。")}
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
  const held=adjustments[item.key];
  const base=held?{from:hoursOf(item.date,held.startAt),to:hoursOf(item.date,held.endAt)}:item;
  const floor=Math.ceil(hoursOf(item.date,new Date(soonest).toISOString())*2)/2;
  const from=Math.max(Math.min(base.from+startBy,base.to-.5),floor,10),to=Math.min(Math.max(base.to+endBy,from+.5),from+12,26);
  if(from===base.from&&to===base.to)return;
  setAdjustments(a=>({...a,[item.key]:intervalFromHours(item.date,from,to)}));
 };
 const dropAdjustment=(key:string)=>setAdjustments(a=>{const rest={...a};delete rest[key];return rest});
 const confirmNudge=async()=>{
  if(!active||!adjustment||confirmingChangeRef.current)return;
  if(active.draft){setDraft(a=>mergeIntervals([...a.filter(v=>v.startAt!==active.key),adjustment]));setSelected(adjustment.startAt);dropAdjustment(active.key);return}
  confirmingChangeRef.current=true;setConfirmingChange(true);
  try{if(await update(active.key,adjustment))dropAdjustment(active.key)}
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
 /* Clearing out a whole week one bar at a time is the tedious path this avoids. There is no bulk
    endpoint, so it cancels one by one and keeps whatever actually went through if it stops short. */
 const clearAll=async()=>{
  if(clearingRef.current||!own.length)return;
  clearingRef.current=true;setClearing(true);setMessage("");
  const removed:string[]=[];
  const settle=()=>{setOwn(a=>a.filter(x=>!removed.includes(x.id)));setSelected(null);setConfirmClear(false)};
  try{
   for(const slot of own){
    const r=await fetch(`/api/availability/${slot.id}`,{method:"DELETE"});
    if(!r.ok){const b=await r.json().catch(()=>({}));settle();await refreshFind();setMessage(b.error??"取消失敗，請再試一次。");return}
    removed.push(slot.id);
   }
   setOwn([]);setAdjustments({});setSelected(null);setConfirmClear(false);await refreshFind();
   setMessage(`已取消全部 ${removed.length} 個時段。`);trackAvailabilityEvent("availability_slot_cancel");
  }catch{settle();setMessage("網絡連線失敗，請再試一次。")}
  finally{clearingRef.current=false;setClearing(false)}
 };
 useEffect(()=>{if(!pending&&!leaveTo&&!confirmClear)return;const previous=document.activeElement as HTMLElement|null,dialog=dialogRef.current,focusable=dialog?Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')):[];focusable[0]?.focus();function onKey(ev:KeyboardEvent){if(ev.key==="Escape"){setPending(null);setLeaveTo(null);setConfirmClear(false);return}if(ev.key==="Tab"&&focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}}}document.addEventListener("keydown",onKey);return()=>{document.removeEventListener("keydown",onKey);previous?.focus()}},[pending,leaveTo,confirmClear]);
 return <section className="availability-page">
<section className="hero small availability-hero"><div><p className="kicker">MATCHMAKING</p><h1>找對手，約一局</h1><p>公開你的空閒時間，快速找到最合適的球友。</p></div>{userPlayerId&&<button className="primary" onClick={()=>nav("create")}>＋ 新增時段</button>}</section>
<nav className="availability-tabs" aria-label="配對功能" role="tablist"><button role="tab" aria-selected={view==="find"} className={view==="find"?"active":""} onClick={()=>nav("find")}><span className="availability-tab-label">尋找對手</span></button>{userPlayerId&&<button role="tab" aria-selected={view==="manage"||view==="create"} className={view==="manage"||view==="create"?"active":""} onClick={()=>nav("manage")}><span className="availability-tab-label">我的時段</span>{own.length>0&&<span className="availability-tab-count">{own.length}</span>}</button>}</nav>
{view==="find"&&<DateScroller dates={week} selected={date} counts={counts} onSelect={changeDate}/>}
{message&&<p key={message} className="availability-notice" role="status">{message}</p>}
{view==="find"&&<>
{userPlayerId&&mine.length>0&&<header className="availability-day-head"><span/><button className="more" onClick={()=>nav("manage")}>{`我的時段 ${mine.map(range).join("、")}`}</button></header>}
{loading?<div className="availability-skeleton" aria-hidden="true"/>:<div className="find-stack">
 {members.length>0&&<DensityChart buckets={density} best={busiest} lo={rosterRange.lo} hi={rosterRange.hi} focus={focus} onFocus={setFocus}/>}
 {members.length>0&&<AvailabilityGrid members={members} mine={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi} userPlayerId={userPlayerId} focus={focus} onFocus={setFocus} highlightId={jumpTo?.playerId} onPlayer={onPlayer}/>}
 {shortlist.length
  ?<section className="availability-card match-stack">
    <header className="availability-grid-head match-stack-head"><div><h3>{focus?`${time(focus.startAt)}–${time(focus.endAt)} 可約的對手`:"和你都有空的對手"}</h3><small>按 ELO 相近及近期較少交手排序，點按卡片查看球員資料</small></div><span>{shortlist.length} 位</span></header>
    <div className="match-stack-list">{shortlist.map((o,i)=><OpponentCard key={o.member.id} opponent={o} rank={i+1} onPlayer={onPlayer}/>)}</div>
   </section>
  :<MatchPrompt hasMine={mine.length>0} userPlayerId={userPlayerId} members={members.length} focus={focus} onManage={nav}/>}
</div>}</>}
{/* One screen, one gesture: the board is the list, the editor and the composer at once. Nothing here
    navigates away, so a member can paint three evenings and publish them in a single pass. */}
{editor&&userPlayerId&&<section className="availability-editor">
 <header className="availability-day-head"><div><h2>公開你的空閒時間</h2><small>拖曳加入時段，點按可調整或刪除。</small></div>
  <span className="slot-tally-group"><span className="slot-tally"><b>{own.length}</b>個已公開</span>{own.length>0&&<button type="button" className="clear-all-link" onClick={()=>setConfirmClear(true)}>全部刪除</button>}</span></header>
 <section className={`availability-card slot-board-card${draft.length||pendingKeys.length?" has-draft":""}`}>
  <SlotBoard dates={boardDates} items={displayedBoardItems} lo={boardRange.lo} hi={boardRange.hi} soonest={soonest} selected={selected}
   onSelect={key=>setSelected(key)}
   onCreate={x=>{setDraft(a=>mergeIntervals([...a,x]));setSelected(null);setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}
   onResize={(item,x)=>{if(item.draft){setDraft(a=>mergeIntervals([...a.filter(v=>v.startAt!==item.key),x]));setSelected(x.startAt)}else setAdjustments(a=>({...a,[item.key]:x}))}}/>
  {!own.length&&!draft.length&&<p className="board-hint">在上面任何一行拖曳，就能加入可配對時段。輕按一下等於兩小時。</p>}
  <div className="board-legend"><span><i className="legend-live"/>已公開</span><span><i className="legend-draft"/>未發佈／未儲存</span><button type="button" className="more" onClick={()=>setBoardWide(v=>!v)}>{boardWide?"只看未來 7 天":"顯示未來 14 天"}</button></div>
 </section>
 {active&&adjusted&&<section className={`slot-detail${adjustment?" has-adjustment":""}`} role="group" aria-label="調整已選時段">
  <div><small>{fullDay(active.date)}</small><b>{clockAt(adjusted.from)}–{clockAt(adjusted.to)}</b><span>{durationLabel((adjusted.to-adjusted.from)*60)}{active.draft?" · 未發佈":""}{adjustment?" · 待確認":""}</span></div>
  <div className="slot-nudge"><small>開始</small><button type="button" aria-label="開始時間提早 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,-.5,0)}>−</button><button type="button" aria-label="開始時間延後 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,.5,0)}>+</button></div>
  <div className="slot-nudge"><small>結束</small><button type="button" aria-label="結束時間提早 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,0,-.5)}>−</button><button type="button" aria-label="結束時間延後 30 分鐘" disabled={confirmingChange} onClick={()=>nudge(active,0,.5)}>+</button></div>
  <span className="card-tools"><button className="card-tool danger" aria-label={`刪除 ${dayLabel(active.date)} ${clockAt(active.from)}–${clockAt(active.to)} 的時段`} onClick={()=>{const found=own.find(v=>v.id===active.key);if(active.draft)setDraft(a=>a.filter(v=>v.startAt!==active.key));else if(found)setPending(found);setSelected(null);dropAdjustment(active.key)}}>✕</button></span>{adjustment&&<div className="slot-confirm-actions"><button type="button" className="secondary" disabled={confirmingChange} onClick={()=>dropAdjustment(active.key)}>取消變更</button><button type="button" className="primary publish-button" disabled={confirmingChange} aria-busy={confirmingChange} onClick={()=>void confirmNudge()}>{confirmingChange&&<i className="button-spinner" aria-hidden="true"/>}<span>{confirmingChange?"儲存中…":"確認變更"}</span></button></div>}
 </section>}
 {uncommitted.length>0&&<div className="draft-bar" role="status"><div><b>{[pendingKeys.length?`${pendingKeys.length} 個變更`:"",draft.length?`${draft.length} 個新時段`:""].filter(Boolean).join(" · ")}未儲存</b>
   <span>{uncommitted.map(x=>`${dayLabel(hkDate(new Date(x.startAt)))} ${range(x)}`).join("、")}</span></div>
  <div><button className="secondary" disabled={saving} onClick={()=>{setAdjustments({});setDraft([]);setSelected(null)}}>{pendingKeys.length?"全部還原":"清除"}</button>
   <button className="primary publish-button" disabled={saving} aria-busy={saving} onClick={()=>void commitAll()}>{saving&&<i className="button-spinner" aria-hidden="true"/>}<span>{saving?"儲存中…":pendingKeys.length&&draft.length?"儲存並發佈":draft.length?"發佈":"儲存變更"}</span></button></div></div>}
 <details className="board-precise"><summary>用選單精確加入時段</summary><SlotComposer initialDate={date} onSave={x=>{setDraft(a=>mergeIntervals([...a,x]));setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}/></details>
</section>}
{confirmClear&&<div className="availability-dialog-backdrop" onMouseDown={()=>!clearing&&setConfirmClear(false)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>刪除全部時段</small><h2 id="clear-title">刪除全部 {own.length} 個時段？</h2><p>所有已公開的時段都會被取消，其他球員將不會再看到你的空檔。此操作無法復原。</p><div><button className="secondary" disabled={clearing} onClick={()=>setConfirmClear(false)}>保留時段</button><button className="danger cancel-button" disabled={clearing} aria-busy={clearing} onClick={()=>void clearAll()}>{clearing&&<i className="button-spinner" aria-hidden="true"/>}<span>{clearing?"刪除中…":`刪除全部 ${own.length} 個`}</span></button></div></section></div>}
{leaveTo&&<div className="availability-dialog-backdrop" onMouseDown={()=>setLeaveTo(null)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>未儲存的變更</small><h2 id="leave-title">離開後變更會消失</h2><p>{[pendingKeys.length?`${pendingKeys.length} 個時段變更`:"",draft.length?`${draft.length} 個新時段`:""].filter(Boolean).join("、")}尚未儲存。離開後這些變更不會保留。</p><div><button className="secondary" onClick={()=>setLeaveTo(null)}>留在此頁</button><button className="primary publish-button" disabled={saving} aria-busy={saving} onClick={()=>{const next=leaveTo;setLeaveTo(null);void commitAll().then(()=>go(next))}}>{saving&&<i className="button-spinner" aria-hidden="true"/>}<span>儲存後離開</span></button><button className="danger" onClick={()=>{const next=leaveTo;discard();setLeaveTo(null);go(next)}}>捨棄變更</button></div></section></div>}
{pending&&<div className="availability-dialog-backdrop" onMouseDown={()=>setPending(null)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>取消可配對時段</small><h2 id="cancel-title">{dayLabel(hkDate(new Date(pending.startAt)))} {range(pending)}</h2><p>取消後，這段時間不會再出現在其他球員的配對結果中。</p><div><button className="secondary" disabled={cancelling} onClick={()=>setPending(null)}>保留時段</button><button className="danger cancel-button" disabled={cancelling} aria-busy={cancelling} onClick={()=>void cancel()}>{cancelling&&<i className="button-spinner" aria-hidden="true"/>}<span>{cancelling?"取消中…":"確認取消"}</span></button></div></section></div>}
</section>}
