"use client";
import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
import {PlayerBadge} from "./UiBits";
import {BackdropSheet,ConfirmDialog} from "./components/ui/Overlay";
import {Button} from "./components/ui/Primitives";
import {Slots} from "./Slots";
import {CounterSheet,NotificationPrefsPanel,PushOptIn,RecurrenceEditor,ResponseQueue,VenueField,WaitingStrip,reliabilityChips,type IntentState,type QueueItem,type RecurrenceRule,type WaitingItem} from "./MatchmakingBits";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import {addDaysHongKong,composeAvailabilityInterval,dayRangeHongKong,gamesPlayed,hkClock,hkDate,hkDayLabel,intervalFromHours,intersectIntervals,matchesBetween,mergeIntervals,nextAvailabilityStart,partitionInvites,partitionOffers,rankOpponents,screenState,validateAvailabilityInterval,type AvailabilitySlot,type Interval,type IntentSignal,type RankedOpponent,type MutualOffer,type ReliabilitySignals} from "../lib/availability";
type Player={id:string;name:string;short:string;rating:number;colour?:string;avatar?:string|null};type Match={a:string;b:string;playedOn:string;status:"confirmed"|"void"};type Member=Player&{slots:AvailabilitySlot[]};type View="screen"|"manage"|"create";
type InviteStatus="pending"|"accepted"|"declined"|"cancelled"|"expired"|"played"|"missed";type InvitePlayer={id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null};
type MatchInvite={id:string;startAt:string;endAt:string;message:string;status:InviteStatus;venue:string;createdAt:string;respondedAt:string|null;counter:{startAt:string;endAt:string;byPlayerId:string}|null;fromPlayer:InvitePlayer;toPlayer:InvitePlayer};
type ListFilter="all"|"new"|"never"|"close";
type Tournament={id:string;name:string;handicapMode:"suggested"|"none";signupDeadline:string;createdAt:string;createdBy?:string;signups:string[]};
type OpponentCardVM={member:Member;difference:number;windows:Interval[];windowsCaption:string;isNew:boolean;games:number;neverEver:boolean;chips:string[];ranked?:RankedOpponent};
const time=hkClock,dayLabel=hkDayLabel,range=(x:Interval)=>`${time(x.startAt)}–${time(x.endAt)}`,days=(start:string,horizon=7)=>Array.from({length:horizon},(_,i)=>addDaysHongKong(start,i)),fullDay=(d:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"long",day:"numeric",weekday:"long"}).format(new Date(`${d}T00:00:00+08:00`));
const durationLabel=(minutes:number)=>{const hours=Math.floor(minutes/60),rest=Math.round(minutes%60);return hours?`${hours} 小時${rest?` ${rest} 分鐘`:""}`:`${rest} 分鐘`};
/* Shared by both the overlap-ranked shortlist and the no-overlap-yet browse tier, so the same
   opponent reads identically ("新加入", "從沒交手", …) no matter which tier is showing them. */
function buildOpponentChips(o:{isNew:boolean;games:number;difference:number;neverEver:boolean;recentZero:boolean}){
 const chips:string[]=[];
 if(o.isNew)chips.push(`新加入 · ${o.games} 場`);
 if(o.difference<50)chips.push("ELO 相近");
 if(o.neverEver)chips.push("從沒交手");else if(o.recentZero)chips.push("近期未交手");
 return chips;
}
/** The one chip that answers "why now" rather than "why them" — the reason the deck's redesign
    exists. Always positive, same principle as `reliabilityChips`: a member who has not posted an
    intent is unmeasured, not uninterested, so absence renders nothing rather than a negative claim. */
function intentChip(intent?:IntentSignal){
 if(!intent)return [];
 if(intent.kind==="tonight")return ["佢今晚想打"];
 if(intent.kind==="window")return ["佢呢個星期想打"];
 return ["佢話有啱就打"];
}
function passesListFilter(filter:ListFilter,o:{isNew:boolean;neverEver:boolean;difference:number}){
 if(filter==="new")return o.isNew;
 if(filter==="never")return o.neverEver;
 if(filter==="close")return o.difference<50;
 return true;
}
/* An opt-in nudge, not a hard rule: stable-sorts new players to the front of whichever list (ranked
   or browse) is already sorted, without disturbing order within each group. */
function byPriority<T extends {isNew:boolean}>(list:T[],prioritizeNew:boolean){
 return prioritizeNew?[...list].sort((a,b)=>(b.isNew?1:0)-(a.isNew?1:0)):list;
}
const PROPOSE_START_TIMES=Array.from({length:28},(_,i)=>`${String(10+Math.floor(i/2)).padStart(2,"0")}:${i%2?"30":"00"}`);
const PROPOSE_END_TIMES=Array.from({length:32},(_,i)=>`${String((10+Math.floor((i+1)/2))%24).padStart(2,"0")}:${(i+1)%2?"30":"00"}`);
/* Defaults for any "propose a time" control. Hardcoding 19:00 meant that from 19:00 onwards — the
   exact hours a club fills up — the composer opened pre-loaded with a time the validator rejects,
   and the member's first action was an error message. Today's defaults start from the next pickable
   half-hour instead; other days keep the sensible evening default. */
function defaultProposalTimes(date:string,now=Date.now()){
 const evening={start:"19:00",end:"21:00"};
 if(date!==hkDate(new Date(now)))return evening;
 const next=nextAvailabilityStart(now);
 const start=PROPOSE_START_TIMES.find(t=>t>=next.time);
 if(!start)return evening;
 const end=PROPOSE_END_TIMES.find(t=>t>start)??PROPOSE_END_TIMES[PROPOSE_END_TIMES.length-1];
 return {start,end:start>=end?end:(PROPOSE_END_TIMES.find(t=>t>=addHours(start,2))??end)};
}
const addHours=(time:string,hours:number)=>{const[h,m]=time.split(":").map(Number);return `${String((h+hours)%24).padStart(2,"0")}:${String(m).padStart(2,"0")}`};
const ICEBREAKER_MESSAGE="歡迎入會！有冇興趣一齊打第一局？我哋可以由輕鬆嘅友誼賽開始。";
/** The time an invite is actually about. A counter-proposal supersedes the original everywhere it is
    displayed, so every surface agrees on which hour the two are currently negotiating over. */
const effectiveSlot=(invite:{startAt:string;endAt:string;counter?:{startAt:string;endAt:string}|null}):Interval=>invite.counter??{startAt:invite.startAt,endAt:invite.endAt};
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
  <div className="availability-form-actions"><Button>{slot?"儲存變更":"加入時段"}</Button>{onCancel&&<Button variant="secondary" type="button" onClick={onCancel}>取消</Button>}</div>
 </form>
}const timelineRange=(items:Interval[],date:string)=>{void items;void date;return {lo:10,hi:26}};
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
 const span=hi-lo,ticks=Array.from({length:hi-lo+1},(_,i)=>lo+i),labelTicks=ticks.filter((_,i)=>i%2===0),scrollRef=useRef<HTMLDivElement>(null),highlightRef=useRef<HTMLDivElement>(null);
 /* Arriving here from a player's profile card should land on their row, not just the right tab — a
    quiet flash (borrowed from the match-history "just recorded" treatment) is the only way to say
    "this one" without a modal in the way. */
 useEffect(()=>{if(highlightId)highlightRef.current?.scrollIntoView({behavior:"smooth",block:"center"})},[highlightId]);
 const now=hoursOf(date,new Date().toISOString()),showNow=date===hkDate()&&now>=lo&&now<=hi;
 useEffect(()=>{const el=scrollRef.current;if(!el)return;const playerWidth=window.innerWidth<=620?132:150,trackWidth=el.scrollWidth-playerWidth,visibleTrack=el.clientWidth-playerWidth,target=focus?hoursOf(date,focus.startAt):showNow?Math.max(now,18):18;el.scrollTo({left:Math.max(0,(target-lo)/span*trackWidth-visibleTrack*.3),behavior:"smooth"})},[date,focus,hi,lo,now,showNow,span]);
 const me=members.find(x=>x.id===userPlayerId),rows=[...(userPlayerId?[{id:"__me",name:"你",short:"你",rating:me?.rating??0,colour:"#176b55",slots:mine as AvailabilitySlot[]}]:[]),...members.filter(x=>x.id!==userPlayerId)];
 const position=(iso:string)=>`${(hoursOf(date,iso)-lo)/span*100}%`,slotWidth=(slot:Interval)=>`${(hoursOf(date,slot.endAt)-hoursOf(date,slot.startAt))/span*100}%`;
 return <section className="availability-card availability-grid-card" aria-labelledby="availability-grid-title">
  <header className="availability-grid-head"><div><h3 id="availability-grid-title">球員空檔</h3><small>時間標記每兩小時對齊格線；輕掃查看更多，點按空檔即可篩選</small></div><span>{rows.length} 位</span></header>
  <div className="availability-grid-scroll" ref={scrollRef}><div className="availability-grid">
   <div className="availability-grid-headrow"><div className="availability-grid-corner">球員</div><div className="availability-grid-axis" aria-hidden="true">{labelTicks.map(h=><b key={h} style={h>=hi?{right:0}:{left:`${(h-lo)/span*100}%`}}>{clockAt(h)}</b>)}</div></div>
   {rows.map(member=>{const isMe=member.id==="__me",isHighlighted=highlightId===member.id;return <div ref={isHighlighted?highlightRef:undefined} className={`availability-grid-row${isMe?" is-me":""}${isHighlighted?" is-highlighted":""}`} key={member.id}>
    {onPlayer&&!isMe
      ? <button type="button" className="availability-grid-player is-clickable" aria-label={`查看 ${member.name} 的球員卡`} onClick={()=>onPlayer(member.id)}><PlayerBadge player={member}/><span><b>{member.name}</b><small>{Math.round(member.rating)} ELO</small></span></button>
      : <div className="availability-grid-player">{isMe?<span className="availability-grid-you">你</span>:<PlayerBadge player={member}/>}<span><b>{member.name}</b>{!isMe&&<small>{Math.round(member.rating)} ELO</small>}</span></div>}
    <div className="availability-grid-track">{ticks.slice(1).map(h=><i className="availability-grid-line" key={h} style={h>=hi?{right:0}:{left:`${(h-lo)/span*100}%`}}/>)}
     {member.slots.map(slot=>{const active=Boolean(focus&&intersectIntervals([slot],[focus]).length);return <button type="button" key={`${member.id}-${slot.startAt}`} className={`availability-grid-slot${active?" is-active":""}`} style={{left:position(slot.startAt),width:slotWidth(slot)}} aria-label={`${member.name} ${range(slot)}`} onClick={()=>onFocus(active?null:{startAt:slot.startAt,endAt:slot.endAt})}><span>{range(slot)}</span></button>})}
     {focus&&<i className="availability-grid-focus" style={{left:position(focus.startAt),width:slotWidth(focus)}}/>}{showNow&&<i className="availability-grid-now" style={{left:`${(now-lo)/span*100}%`}}/>}
    </div></div>})}
  </div></div>
  <div className="availability-grid-legend"><span><i/>該時段有空</span>{focus&&<button type="button" className="more" onClick={()=>onFocus(null)}>清除 {range(focus)}</button>}</div>
 </section>
}
/* One row of the invite inbox. Every pending invite gets one of these — the previous design surfaced
   only the first, so a member with three people waiting on them answered one and silently ignored
   two. `tone` drives nothing but colour; the actions are what differ between the buckets. */
/* An open call: one member offering a table to the whole club rather than asking one person. The
   claim button is the entire point, so it stays primary and single-tap — a member should never have
   to open a sheet to say yes to a game that is already on offer. */
function SlotComposer({initialDate,onSave}:{initialDate:string;onSave:(x:Interval)=>void}){return <SlotForm initialDate={initialDate} onSave={onSave}/>}
/** The bottom-sheet-on-mobile / centered-modal-on-desktop invite composer, reusing the app's existing
    `.backdrop`/`.sheet` pattern rather than a one-off overlay. */
function InviteSheet({opponent,mode,onModeChange,selectedWindow,onSelectWindow,proposeStart,proposeEnd,onProposeStart,onProposeEnd,dateLabel,message,onMessageChange,venue,onVenueChange,onSend,onClose,sending,sendLabel}:{
 opponent:OpponentCardVM;mode:"simple"|"propose";onModeChange:(mode:"simple"|"propose")=>void;
 selectedWindow:Interval|null;onSelectWindow:(window:Interval)=>void;
 proposeStart:string;proposeEnd:string;onProposeStart:(value:string)=>void;onProposeEnd:(value:string)=>void;
 dateLabel:string;message:string;onMessageChange:(value:string)=>void;
 venue:string;onVenueChange:(value:string)=>void;
 onSend:()=>void;onClose:()=>void;sending:boolean;sendLabel:string;
}){
 return <BackdropSheet onClose={onClose} labelledBy="invite-sheet-title">
   <p className="kicker">邀請對局</p>
   <h2 id="invite-sheet-title">{opponent.member.name}</h2>
   <div className="invite-mode-toggle" role="tablist" aria-label="邀請方式">
    <button type="button" role="tab" aria-selected={mode==="simple"} className={mode==="simple"?"active":""} onClick={()=>onModeChange("simple")}>快速邀請</button>
    <button type="button" role="tab" aria-selected={mode==="propose"} className={mode==="propose"?"active":""} onClick={()=>onModeChange("propose")}>提議時段</button>
   </div>
   {mode==="simple"
    ?<div className="invite-window-list">
      <p className="sub">{opponent.windows.length?"佢公開嘅得閒時段，揀一個一鍵送出：":"對方今日未公開時段 — 可以改用「提議時段」直接建議時間。"}</p>
      {opponent.windows.map(w=><button type="button" key={w.startAt} className={`invite-window-option${selectedWindow?.startAt===w.startAt?" active":""}`} onClick={()=>onSelectWindow(w)}><span>{dayLabel(hkDate(new Date(w.startAt)))} {range(w)}</span>{selectedWindow?.startAt===w.startAt&&<span aria-hidden="true">✓</span>}</button>)}
     </div>
    :<div className="invite-propose">
      <p className="sub">提議 {dateLabel} 一個具體時段，對方直接確認或改期。</p>
      <div className="two">
       <label>開始<select value={proposeStart} onChange={e=>onProposeStart(e.target.value)}>{PROPOSE_START_TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
       <label>結束<select value={proposeEnd} onChange={e=>onProposeEnd(e.target.value)}>{PROPOSE_END_TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
      </div>
     </div>}
   {opponent.isNew&&<button type="button" className="icebreaker-suggestion" onClick={()=>onMessageChange(ICEBREAKER_MESSAGE)}><span aria-hidden="true">★</span><span>呢位係新加入球友 — 加句「歡迎入會，一齊打第一局？」使佢更放心答應</span></button>}
   {/* Naming the table turns a vague "let's play" into something the other side can just turn up to,
       which is the difference between an accepted invite and a game that actually happens. */}
   <VenueField value={venue} onChange={onVenueChange}/>
   <label className="invite-message-field">留言（可省略）<textarea value={message} onChange={e=>onMessageChange(e.target.value)} placeholder="加句留言（可省略）"/></label>
   <button type="button" className="primary full" disabled={sending||(mode==="simple"&&!selectedWindow)} onClick={onSend}>{sending?"送出中…":sendLabel}</button>
 </BackdropSheet>;
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
export default function Availability({userPlayerId,matches,tournaments,provisionalGames=10,onDirtyChange,jumpTo,onPlayer,onRecordMatch,onActivity,onSignUpTournament}:{userPlayerId?:string;matches:Match[];tournaments?:Tournament[];provisionalGames?:number;onDirtyChange?:(dirty:boolean)=>void;jumpTo?:{playerId:string;date:string}|null;onPlayer?:(playerId:string)=>void;onRecordMatch?:(opponentId:string,playedOn:string)=>void;
 /** Anything that changes what the shell's badge should say. The tab owns the truth while it is
    open, so it tells the shell rather than making the shell poll faster on the off-chance. */
 onActivity?:()=>void; onSignUpTournament?:(tournamentId:string)=>void}){
 const week=useMemo(()=>days(hkDate(),HORIZON),[]),[date,setDate]=useState(jumpTo?.date??hkDate()),[appliedJump,setAppliedJump]=useState(jumpTo??null),[members,setMembers]=useState<Member[]>([]),[counts,setCounts]=useState<Record<string,number>>({}),[own,setOwn]=useState<AvailabilitySlot[]>([]),[view,setView]=useState<View>("screen"),[draft,setDraft]=useState<Interval[]>([]),[selected,setSelected]=useState<string|null>(null),[adjustments,setAdjustments]=useState<Record<string,Interval>>({}),[focus,setFocus]=useState<Interval|null>(null),[boardWide,setBoardWide]=useState(false),[pending,setPending]=useState<AvailabilitySlot|null>(null),[leaveTo,setLeaveTo]=useState<View|null>(null),[confirmClear,setConfirmClear]=useState(false),[clearing,setClearing]=useState(false),[saving,setSaving]=useState(false),[cancelling,setCancelling]=useState(false),[confirmingChange,setConfirmingChange]=useState(false),[message,setMessage]=useState(""),[recommendationNow]=useState(()=>Date.now());
 const[filter,setFilter]=useState<ListFilter>("all"),[prioritizeNew,setPrioritizeNew]=useState(false),
  [invites,setInvites]=useState<{sent:MatchInvite[];received:MatchInvite[]}>({sent:[],received:[]}),
  [inviteFor,setInviteFor]=useState<string|null>(null),[inviteMode,setInviteMode]=useState<"simple"|"propose">("simple"),[selectedWindow,setSelectedWindow]=useState<Interval|null>(null),
  [proposeStart,setProposeStart]=useState("19:00"),[proposeEnd,setProposeEnd]=useState("21:00"),[inviteMessage,setInviteMessage]=useState(""),
  [sendingInvite,setSendingInvite]=useState(false),[respondingId,setRespondingId]=useState<string|null>(null),[cancellingInviteId,setCancellingInviteId]=useState<string|null>(null),
  [claimingCallId,setClaimingCallId]=useState<string|null>(null),[closingInviteId,setClosingInviteId]=useState<string|null>(null);
 /* The pieces the redesign added: mutual offers, per-fixture venue, weekly rules, counter-proposals,
    and the reliability signals only the server can know. */
 const[offers,setOffers]=useState<MutualOffer[]>([]),[answeringOfferId,setAnsweringOfferId]=useState<string|null>(null),
  [inviteVenue,setInviteVenue]=useState(""),
  [rules,setRules]=useState<RecurrenceRule[]>([]),[rulesBusy,setRulesBusy]=useState(false),
  [counterFor,setCounterFor]=useState<MatchInvite|null>(null),[counteringId,setCounteringId]=useState<string|null>(null),
  [reliability,setReliability]=useState<Record<string,ReliabilitySignals>>({}),
  [intentsByPlayer,setIntentsByPlayer]=useState<Record<string,IntentSignal>>({}),[myIntent,setMyIntent]=useState<IntentState>(null),[intentBusy,setIntentBusy]=useState(false),
  [showBoard,setShowBoard]=useState(false),[sentAsk,setSentAsk]=useState<{key:string;inviteId:string}|null>(null);
 /* The buckets below are time-dependent, and a member can sit on this screen while a slot starts or
    ends. A one-minute tick re-evaluates them so the follow-up prompt appears on its own. */
 const[tick,setTick]=useState(()=>Date.now());
 /* Bumped by anything that changes club state from outside the poll's own effect — going live in The
    Room, claiming a table there — so invites, calls and offers refresh immediately instead of at the
    next 30-second tick, which is long enough for a member to think their tap did nothing. */
 const[refreshNonce,setRefreshNonce]=useState(0);
 useEffect(()=>{const id=window.setInterval(()=>setTick(Date.now()),60000);return()=>window.clearInterval(id)},[]);
 const firstLoad=useRef(true),savingRef=useRef(false),cancellingRef=useRef(false),confirmingChangeRef=useRef(false),clearingRef=useRef(false);
 useEffect(()=>{const c=new AbortController();async function load(){try{const[selected,summary,mine]=await Promise.all([fetch(`/api/availability?date=${date}`,{signal:c.signal}).then(r=>r.json()),fetch(`/api/availability?week=${week[0]}&days=${HORIZON}`,{signal:c.signal}).then(r=>r.json()),userPlayerId?fetch("/api/availability?me",{signal:c.signal}).then(r=>r.json()):Promise.resolve({slots:[]})]);if(selected.error)throw Error(selected.error);setMembers(selected.members);setCounts(summary.counts??{});setOwn(mine.slots??[]);setMessage("")}catch(e){if(e instanceof Error&&e.name!=="AbortError")setMessage(e.message)}finally{/* the session list owns its own loading state */}}if(firstLoad.current)firstLoad.current=false;else trackAvailabilityEvent("availability_date_select");void load();return()=>c.abort()},[date,userPlayerId,week]);
 /* A profile card's "在可配對查看" button lands here with a target player and their nearest free day.
    Adjusted during render rather than in an effect: the jump can arrive while this tab is already
    open (card opened from the grid itself), so mount-time initial state alone would miss it, and an
    effect would paint the wrong day first. The highlight is the parent's to clear, mirroring
    highlightMatch in Matches, so it survives until the member navigates away. */
 if(jumpTo&&jumpTo!==appliedJump){setAppliedJump(jumpTo);setView("screen");setShowBoard(true);setFocus(null);setDate(jumpTo.date)}
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
 /* Every overlapping opponent, ranked — the page recommends the whole list, not one name. Ranking
    lives in lib so it stays testable and so the focused band narrows the overlap it ranks on. */
 /* Unfiltered pools, so the filter chips can tell — before the member taps them — whether tapping
    would actually leave anyone on screen, instead of toggling into a dead end. */
 const rankedPool=useMemo(()=>{
  if(!userPlayerId)return [];
  const me=members.find(x=>x.id===userPlayerId),cut=recommendationNow-30*864e5,byId=new Map(members.map(m=>[m.id,m]));
  const ranked=rankOpponents({
   mine,rating:me?.rating??0,window:focus,
   opponents:members.filter(m=>m.id!==userPlayerId).map(m=>({id:m.id,rating:m.rating,slots:m.slots as Interval[]})),
   recentMatches:id=>matches.filter(m=>m.status==="confirmed"&&Date.parse(`${m.playedOn}T00:00:00+08:00`)>=cut&&((m.a===userPlayerId&&m.b===id)||(m.b===userPlayerId&&m.a===id))).length,
   /* The signal the browser cannot compute for itself: how this opponent actually behaves once
      invited. Supplied by the server, composed here, so the ranking stays one tested function. */
   signals:id=>reliability[id],
   intents:id=>intentsByPlayer[id],
  });
  const longest=Math.max(0,...ranked.map(x=>x.minutes));
  return ranked.map(x=>{
   const games=gamesPlayed(matches,x.id),isNew=games<provisionalGames,neverEver=matchesBetween(matches,userPlayerId,x.id).length===0;
   const chips=[...intentChip(x.intent),...(longest>0&&x.minutes===longest?["時間重疊最長"]:[]),...buildOpponentChips({isNew,games,difference:x.difference,neverEver,recentZero:x.recent===0}),...reliabilityChips(x.signals)];
   return {member:byId.get(x.id)!,difference:x.difference,windows:x.overlaps,windowsCaption:`共 ${durationLabel(x.minutes)}重疊`,isNew,games,neverEver,chips,ranked:x};
  });
 },[members,matches,mine,userPlayerId,recommendationNow,focus,provisionalGames,reliability,intentsByPlayer]);
 const shortlist=useMemo(()=>byPriority(rankedPool.filter(o=>passesListFilter(filter,o)),prioritizeNew),[rankedPool,filter,prioritizeNew]);
 /* Requirement: a member can invite anyone even before publishing (or overlapping) their own
    availability. When the overlap-ranked shortlist above comes up empty — no slots of their own yet,
    or simply nobody free at the same time today — fall back to everyone with a slot that day, ranked
    by ELO closeness instead of overlap, so the invite flow never dead-ends into an empty screen. */
 const browsePool=useMemo(()=>{
  if(!userPlayerId||rankedPool.length)return [];
  const me=members.find(x=>x.id===userPlayerId),myRating=me?.rating??0,cut=recommendationNow-30*864e5;
  let candidates=members.filter(m=>m.id!==userPlayerId);
  if(focus)candidates=candidates.filter(m=>m.slots.some(s=>intersectIntervals([s],[focus]).length>0));
  return candidates.map(m=>{
   const games=gamesPlayed(matches,m.id),isNew=games<provisionalGames,neverEver=matchesBetween(matches,userPlayerId,m.id).length===0;
   const recentZero=matches.filter(x=>x.status==="confirmed"&&Date.parse(`${x.playedOn}T00:00:00+08:00`)>=cut&&((x.a===userPlayerId&&x.b===m.id)||(x.b===userPlayerId&&x.a===m.id))).length===0;
   const difference=Math.abs(myRating-m.rating);
   return {member:m,difference,windows:m.slots as Interval[],windowsCaption:`${m.slots.length} 個公開時段`,isNew,games,neverEver,chips:[...intentChip(intentsByPlayer[m.id]),...buildOpponentChips({isNew,games,difference,neverEver,recentZero}),...reliabilityChips(reliability[m.id])]};
  }).sort((a,b)=>a.difference-b.difference);
 },[userPlayerId,rankedPool.length,members,matches,focus,recommendationNow,provisionalGames,reliability,intentsByPlayer]);
 const browseList=useMemo(()=>byPriority(browsePool.filter(o=>passesListFilter(filter,o)),prioritizeNew),[browsePool,filter,prioritizeNew]);
 /* Whichever tier is actually live right now — same rule the display uses — is what the filter chips
    and the priority toggle should judge "would this leave anyone on screen?" against. */
 const candidatePool=rankedPool.length?rankedPool:browsePool;
 const filterHasResults=useMemo(()=>({
  all:candidatePool.length>0,
  new:candidatePool.some(o=>o.isNew),
  never:candidatePool.some(o=>o.neverEver),
  close:candidatePool.some(o=>o.difference<50),
 }),[candidatePool]);
 const canPrioritizeNew=candidatePool.some(o=>o.isNew);
 useEffect(()=>{if(filter!=="all"&&!filterHasResults[filter])setFilter("all")},[filter,filterHasResults]);
 useEffect(()=>{if(!canPrioritizeNew&&prioritizeNew)setPrioritizeNew(false)},[canPrioritizeNew,prioritizeNew]);
 const activeOpponent=useMemo(()=>inviteFor?[...shortlist,...browseList].find(o=>o.member.id===inviteFor)??null:null,[inviteFor,shortlist,browseList]);
 /* One pass over the inbox, re-derived on every poll so a slot that has just finished moves itself
    from "upcoming" into "needs a result" without the member reloading anything. `recommendationNow`
    is deliberately not used here — that is pinned at mount to keep the shortlist stable, whereas
    these buckets are about the clock actually moving. */
 const buckets=useMemo(()=>partitionInvites({sent:invites.sent,received:invites.received,playerId:userPlayerId??"",matches,now:tick}),[invites,userPlayerId,matches,tick]);
 const confirmedMatches=buckets.upcoming;
 /* Same one-minute tick as the invite buckets: an offer for 20:00 stops being answerable at 20:30,
    and it should take itself off the screen rather than wait for a reload. */
 const liveOffers=useMemo(()=>partitionOffers(offers,tick),[offers,tick]);
 useEffect(()=>{if(liveOffers.awaitingMe.length)trackAvailabilityEvent("matchmaking_offer_shown",{count:liveOffers.awaitingMe.length})},[liveOffers.awaitingMe.length]);
 /* One list out of what used to be four sections. A result to confirm, an invite to answer and an
    offer to accept are the same thing to a member — something waiting on them — and differ only in
    which buttons the row carries. Results sort first because they already happened; everything else
    goes by when it is due. */
 const queueItems=useMemo<QueueItem[]>(()=>{
  if(!userPlayerId)return [];
  const across=(invite:MatchInvite)=>invite.fromPlayer.id===userPlayerId?invite.toPlayer:invite.fromPlayer;
  const results:QueueItem[]=buckets.followUps.map(invite=>{
   const other=across(invite);
   return {id:`r-${invite.id}`,kind:"result" as const,person:other,startAt:invite.startAt,endAt:invite.endAt,venue:invite.venue,
    reason:"呢場打咗未？記錄咗先計 ELO。",busy:closingInviteId===invite.id,
    actions:[
     {label:"冇打成",tone:"secondary" as const,onClick:()=>void closeInviteOutcome(invite.id,"missed")},
     ...(onRecordMatch?[{label:"記錄比分",tone:"primary" as const,onClick:()=>onRecordMatch(other.id,hkDate(new Date(invite.startAt)))}]:[]),
    ]};
  });
  const invites:QueueItem[]=buckets.needsResponse.map(invite=>{
   const other=across(invite),slot=effectiveSlot(invite);
   return {id:`i-${invite.id}`,kind:"invite" as const,person:other,startAt:slot.startAt,endAt:slot.endAt,venue:invite.venue,
    reason:invite.counter?"提議改時間":"想約你打波",
    note:invite.counter?`原本 ${range(invite)}${invite.message?` · ${invite.message}`:""}`:invite.message||undefined,
    busy:respondingId===invite.id,
    /* Three doors, and which one is easiest to reach is the whole design.
       改時間 keeps the fixture alive. 今個星期唔打 is the important one: it withdraws *my own intent*
       rather than rejecting *this person*, so the sender is told 「佢今個星期唔打波」 instead of
       「佢拒絕咗你」. Same outcome for the evening, completely different social meaning — and that
       difference is what makes saying no survivable in a club where everyone meets at the same table. */
    actions:[
     {label:"改時間",tone:"secondary" as const,onClick:()=>setCounterFor(invite)},
     {label:"今個星期唔打",tone:"secondary" as const,onClick:()=>void declineForTheWeek(invite.id)},
     {label:invite.counter?"接受新時間":"接受",tone:"primary" as const,onClick:()=>void respondToInvite(invite.id,"accept")},
    ]};
  });
  const asks:QueueItem[]=liveOffers.awaitingMe.map(offer=>({
   id:`o-${offer.id}`,kind:"offer" as const,person:offer.opponent,startAt:offer.startAt,endAt:offer.endAt,venue:offer.venue,
   reason:"大家時間夾到 · 答「唔得閒」對方唔會知",busy:answeringOfferId===offer.id,
   actions:[
    {label:"唔得閒",tone:"secondary" as const,onClick:()=>void answerOffer(offer.id,"no")},
    {label:"打！",tone:"primary" as const,onClick:()=>void answerOffer(offer.id,"yes")},
   ]}));
  return [...results,...[...invites,...asks].sort((a,b)=>a.startAt.localeCompare(b.startAt))];
 },[userPlayerId,buckets.followUps,buckets.needsResponse,liveOffers.awaitingMe,closingInviteId,respondingId,answeringOfferId,onRecordMatch]);
 /* Work I have already done my part on. Information, not a task — so it collapses to one line. */
 const waitingItems=useMemo<WaitingItem[]>(()=>{
  if(!userPlayerId)return [];
  const fromInvites=buckets.awaitingReply.map(invite=>{
   const other=invite.fromPlayer.id===userPlayerId?invite.toPlayer:invite.fromPlayer;
   return {id:invite.id,name:other.name,label:`${dayLabel(hkDate(new Date(effectiveSlot(invite).startAt)))} ${range(effectiveSlot(invite))}`,cancellable:true};
  });
  const fromOffers=liveOffers.answered.map(offer=>
   ({id:offer.id,name:offer.opponent.name,label:`${dayLabel(hkDate(new Date(offer.startAt)))} ${range(offer)} · 已回覆`,cancellable:false}));
  return [...fromInvites,...fromOffers];
 },[userPlayerId,buckets.awaitingReply,liveOffers.answered]);
 const refreshInvites=async()=>{
  if(!userPlayerId)return;
  try{const r=await fetch("/api/invites");const b=await r.json();if(r.ok)setInvites({sent:b.sent??[],received:b.received??[]});}catch{/* keep the previous invites in view if a background refresh fails */}
  onActivity?.();
 };
 /* Open calls are public, so this runs signed out too — a visitor browsing the club's free tables is
    exactly the person most worth showing them to. */
 /* The calls themselves are read by The Room, which owns that list now. Claiming one still has to
    make it disappear promptly, so this bumps the shared refresh counter the browse tier watches
    rather than holding a second copy of the same data in this component. */
 const refreshOpenCalls=async()=>{setRefreshNonce(value=>value+1)};
/* Mirrors the mount-time `load()` above: an effect that sets state declares its own inline fetch
    rather than calling out to a function defined elsewhere, so an incoming invite still shows up
    without a manual refresh while the find tab stays open. */
 /* Runs regardless of which tab (find/manage/create) is open — an accepted invite is otherwise
    invisible to the sender the moment they leave "find", since nothing else in the app pushes it to
    them. */
 useEffect(()=>{
  let cancelled=false;
  async function poll(){
   if(userPlayerId)try{const r=await fetch("/api/invites");const b=await r.json();if(!cancelled&&r.ok)setInvites({sent:b.sent??[],received:b.received??[]});}catch{/* keep the previous invites in view if a background poll fails */}
   /* An offer is time-critical in a way an invite is not — it exists because two people are free
      *now-ish* — so it rides the same 30-second poll rather than waiting for a reload. */
   if(userPlayerId)try{const r=await fetch("/api/offers");const b=await r.json();if(!cancelled&&r.ok)setOffers(b.offers??[]);}catch{/* last known offers stay on screen */}
  }
  void poll();
  const id=window.setInterval(()=>{if(document.visibilityState==="visible")void poll()},30000);
  return()=>{cancelled=true;window.clearInterval(id)};
 },[userPlayerId,refreshNonce]);
 /* Reliability changes over weeks, not seconds, so it is fetched once per mount rather than polled —
    and it arrives before first paint of the shortlist so the ranking never visibly reshuffles. */
 useEffect(()=>{
  let cancelled=false;
  void (async()=>{try{const r=await fetch("/api/matchmaking/summary");const b=await r.json();if(!cancelled&&r.ok){setReliability(b.reliability??{});setIntentsByPlayer(b.intents??{})}}catch{/* ranking falls back to neutral signals */}})();
  return()=>{cancelled=true};
 },[]);
 /* The member's own intent, separate from everyone else's — polled with the invite/offer inbox so
    "free now" (which posts a `tonight` intent server-side) and an explicit withdrawal both show up
    without a manual refresh. */
 const refreshMyIntent=async()=>{
  if(!userPlayerId)return;
  try{const r=await fetch("/api/intents");const b=await r.json();if(r.ok){setIntentsByPlayer(b.byPlayer??{});setMyIntent(b.mine?{id:b.mine.id,kind:b.mine.kind,expiresAt:b.mine.expiresAt}:null)}}catch{/* keep the previous state on a failed refresh */}
 };
 useEffect(()=>{void refreshMyIntent()},[userPlayerId]);
 /* The sent state is a five-second affordance, not a permanent one — past that the invite belongs in
    the waiting strip like any other, and the card should go back to being a card. */
 useEffect(()=>{
  if(!sentAsk)return;
  const timer=window.setTimeout(()=>setSentAsk(null),5000);
  return()=>window.clearTimeout(timer);
 },[sentAsk]);
 const postIntentAction=async(kind:"window"|"standby")=>{
  if(intentBusy)return;
  setIntentBusy(true);
  try{
   const r=await fetch("/api/intents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind})});
   const b=await r.json();
   if(r.ok){setMyIntent({id:b.intent.id,kind:b.intent.kind,expiresAt:b.intent.expiresAt});setIntentsByPlayer(m=>({...m,[userPlayerId!]:{kind}}));trackAvailabilityEvent("matchmaking_intent_posted",{kind})}
   else setMessage(b.error??"暫時未能更新。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setIntentBusy(false)}
 };
 useEffect(()=>{
  if(!userPlayerId)return;
  let cancelled=false;
  void (async()=>{try{const r=await fetch("/api/availability/recurring");const b=await r.json();if(!cancelled&&r.ok)setRules(b.rules??[])}catch{/* the editor simply shows no rules */}})();
  return()=>{cancelled=true};
 },[userPlayerId]);
 const openInviteSheet=(playerId:string,window?:Interval)=>{
  const opponent=[...shortlist,...browseList].find(o=>o.member.id===playerId);
  const times=defaultProposalTimes(date);
  trackAvailabilityEvent("matchmaking_invite_open");
  setInviteFor(playerId);setInviteMode("simple");setSelectedWindow(window??opponent?.windows[0]??null);setInviteMessage("");setInviteVenue("");setProposeStart(times.start);setProposeEnd(times.end);
 };
 const closeInviteSheet=()=>{setInviteFor(null);setSelectedWindow(null);setInviteMessage("");setInviteVenue("")};
 const sendInviteAction=async()=>{
  if(!inviteFor||sendingInvite)return;
  let interval:Interval;
  if(inviteMode==="simple"){if(!selectedWindow)return;interval=selectedWindow;}
  else{try{interval=validateAvailabilityInterval(composeAvailabilityInterval(date,proposeStart,proposeEnd));}catch{setMessage("請揀一個未開始、香港時間上午 10 時至翌日凌晨 2 時之間的時段。");return;}}
  setSendingInvite(true);setMessage("");
  try{
   const r=await fetch("/api/invites",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({toPlayerId:inviteFor,startAt:interval.startAt,endAt:interval.endAt,message:inviteMessage,venue:inviteVenue})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"邀請未能送出，請再試一次。");return;}
   trackAvailabilityEvent("matchmaking_invite_send",{mode:inviteMode,hasVenue:Boolean(inviteVenue)});
   closeInviteSheet();await refreshInvites();setMessage("邀請已送出，對方會收到通知。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setSendingInvite(false)}
 };
 const respondToInvite=async(id:string,action:"accept"|"decline")=>{
  if(respondingId)return;
  setRespondingId(id);setMessage("");
  try{
   const r=await fetch(`/api/invites/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"操作失敗，請再試一次。");return;}
   trackAvailabilityEvent(action==="accept"?"matchmaking_invite_accept":"matchmaking_invite_decline");
   await refreshInvites();setMessage(action==="accept"?"已確認對局，對方會收到通知。":"已婉拒邀請。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setRespondingId(null)}
 };
 /* --- The one-tap ask -------------------------------------------------------
    The old path opened a five-field sheet (mode, window, start, end, venue, message) for a case
    where the app already knows the opponent, the time and often the table. Asking a member to fill
    in what we already know is how a 20-second job became a form. So the primary action sends, and
    the way back is an undo that sits where the card was rather than a confirmation in front of it.

    Nothing is composed by the member: the invite goes out with no message at all, which is what
    lets it read as the club proposing a fixture rather than a person putting themselves forward. */
 const quickAsk=async(item:{key:string;opponentId:string;slot:Interval})=>{
  if(sendingInvite)return;
  setSendingInvite(true);setInviteFor(item.opponentId);setMessage("");
  try{
   const r=await fetch("/api/invites",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({toPlayerId:item.opponentId,startAt:item.slot.startAt,endAt:item.slot.endAt,message:"",venue:""})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"邀請未能送出，請再試一次。");return;}
   trackAvailabilityEvent("matchmaking_invite_send",{mode:"one-tap",hasVenue:false});
   if(b.invite?.id)setSentAsk({key:item.key,inviteId:b.invite.id});
   await refreshInvites();
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setSendingInvite(false);setInviteFor(null)}
 };
 /* Undo is the whole reason one tap is safe. It cancels the invite outright rather than marking it
    withdrawn, so the other member never sees anything at all if it happens quickly. */
 /* "今晚" on the cold-open screen is the same act as the free-now button: publish the next two hours,
    put a table up, and ask the best-matched people. One tap, no duration picker in the way. */
 /* "Not this week" is a statement about my own week, not about the person asking. So it declines the
    invite *and* withdraws my live intent, which is what lets the other side be told the neutral
    thing. Withdrawing first means that if the decline fails, I have not silently gone quiet while
    still appearing keen to everybody else's shortlist. */
 const declineForTheWeek=async(id:string)=>{
  if(respondingId)return;
  if(myIntent){
   try{await fetch(`/api/intents/${myIntent.id}`,{method:"DELETE"});setMyIntent(null);
    setIntentsByPlayer(m=>{const next={...m};delete next[userPlayerId!];return next});
    trackAvailabilityEvent("matchmaking_intent_withdrawn");
   }catch{/* the decline below is still worth attempting */}
  }
  await respondToInvite(id,"decline");
 };
 const cancelInviteAction=async(id:string)=>{
  if(cancellingInviteId)return;
  setCancellingInviteId(id);setMessage("");
  try{
   const r=await fetch(`/api/invites/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"cancel"})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"操作失敗，請再試一次。");return;}
   await refreshInvites();setMessage("已取消對局。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setCancellingInviteId(null)}
 };
 /* --- Mutual offers -------------------------------------------------------- */
 const answerOffer=async(id:string,answer:"yes"|"no")=>{
  if(answeringOfferId)return;
  setAnsweringOfferId(id);setMessage("");
  try{
   const r=await fetch(`/api/offers/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({answer})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"未能回覆，請再試一次。");await refreshOffers();return;}
   trackAvailabilityEvent(answer==="yes"?"matchmaking_offer_yes":"matchmaking_offer_no");
   if(b.matched)trackAvailabilityEvent("matchmaking_offer_matched");
   await Promise.all([refreshOffers(),refreshInvites()]);
   /* Three outcomes, three different things worth saying: it is on, it is pending the other side,
      or it is quietly gone. The middle one matters most — a member who says yes and sees nothing
      happen assumes the feature is broken. */
   setMessage(b.matched?"對局已確認！":answer==="yes"?"已回覆，等對方答應就即刻confirm。":"知道喇，唔會再提呢個配對。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setAnsweringOfferId(null)}
 };
 const refreshOffers=async()=>{
  if(!userPlayerId)return;
  try{const r=await fetch("/api/offers");const b=await r.json();if(r.ok)setOffers(b.offers??[])}catch{/* keep what is on screen */}
  onActivity?.();
 };
 /* --- Counter-proposals ---------------------------------------------------- */
 const sendCounter=async(input:{date:string;start:string;end:string;venue:string})=>{
  if(!counterFor||counteringId)return;
  let interval:Interval;
  try{interval=validateAvailabilityInterval(composeAvailabilityInterval(input.date,input.start,input.end));}
  catch{setMessage("請揀一個未開始、香港時間上午 10 時至翌日凌晨 2 時之間的時段。");return;}
  setCounteringId(counterFor.id);setMessage("");
  try{
   const r=await fetch(`/api/invites/${counterFor.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"counter",...interval,venue:input.venue})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"未能提議，請再試一次。");return;}
   trackAvailabilityEvent("matchmaking_invite_counter");
   setCounterFor(null);await refreshInvites();setMessage("已提議新時間，等對方確認。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setCounteringId(null)}
 };
 /* --- Recurring availability ----------------------------------------------- */
 const refreshRules=async()=>{try{const r=await fetch("/api/availability/recurring");const b=await r.json();if(r.ok)setRules(b.rules??[])}catch{/* leave the list as it is */}};
 const addRule=async(input:{weekday:number;startTime:string;endTime:string})=>{
  if(rulesBusy)return;
  setRulesBusy(true);setMessage("");
  try{
   const r=await fetch("/api/availability/recurring",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"未能加入，請再試一次。");return;}
   trackAvailabilityEvent("matchmaking_recurrence_add");
   await Promise.all([refreshRules(),reloadOwn()]);setMessage("每週時段已設定，未來四星期已自動公開。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setRulesBusy(false)}
 };
 const removeRule=async(id:string)=>{
  if(rulesBusy)return;
  setRulesBusy(true);setMessage("");
  try{
   const r=await fetch("/api/availability/recurring",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
   const b=await r.json().catch(()=>({}));
   if(!r.ok){setMessage(b.error??"未能刪除，請再試一次。");return;}
   trackAvailabilityEvent("matchmaking_recurrence_remove");
   await refreshRules();setMessage("已停止每週自動公開。已經公開咗嘅時段仍然有效，可以逐個取消。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setRulesBusy(false)}
 };
 const copyLastWeek=async()=>{
  if(rulesBusy)return;
  setRulesBusy(true);setMessage("");
  try{
   const r=await fetch("/api/availability/recurring",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"copyLastWeek"})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"未能複製，請再試一次。");return;}
   trackAvailabilityEvent("matchmaking_copy_last_week",{copied:b.copied??0});
   setOwn(b.slots??[]);await refreshFind();setMessage(`已複製上星期 ${b.copied} 個時段。`);
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setRulesBusy(false)}
 };
 const reloadOwn=async()=>{
  if(!userPlayerId)return;
  try{const r=await fetch("/api/availability?me");const b=await r.json();if(r.ok)setOwn(b.slots??[])}catch{/* board keeps what it has */}
 };
 const claimCall=async(id:string)=>{
  if(claimingCallId)return;
  setClaimingCallId(id);setMessage("");
  try{
   const r=await fetch(`/api/open-calls/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"claim"})});
   const b=await r.json();
   /* A 409 means someone else claimed it first. Refreshing on the failure path is the point: the
      member sees the call disappear and understands why, instead of tapping a dead button again. */
   if(!r.ok){setMessage(b.error??"未能接受，請再試一次。");await refreshOpenCalls();return;}
   trackAvailabilityEvent("matchmaking_open_call_claim");
   await Promise.all([refreshOpenCalls(),refreshInvites()]);setMessage("已接受，對局已確認。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setClaimingCallId(null)}
 };
 /* --- Post-slot follow-up -------------------------------------------------- */
 const closeInviteOutcome=async(id:string,outcome:"played"|"missed")=>{
  if(closingInviteId)return;
  setClosingInviteId(id);setMessage("");
  try{
   const r=await fetch(`/api/invites/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:outcome})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"未能更新，請再試一次。");return;}
   trackAvailabilityEvent(outcome==="played"?"matchmaking_result_played":"matchmaking_result_missed");
   await refreshInvites();setMessage(outcome==="played"?"多謝，已記低你哋打咗。":"已記低今次冇打成。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setClosingInviteId(null)}
 };
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
 /* --- What is this screen about right now? ---------------------------------
    Four situations, one of which is always true, and each fully determines what belongs on screen.
    This replaces the old two-level navigation (搵對手／我的時段／報名盃賽, plus a three-way segmented
    control inside the first): a member made four choices before seeing one name, when the answer was
    never theirs to choose — it follows from what they already owe, hold, or asked for. */
 const pendingAsks=buckets.awaitingReply.length+liveOffers.answered.length;
 const state=useMemo(()=>screenState({
  owed:queueItems.length,upcoming:confirmedMatches.length,intent:myIntent,pendingAsks,
 }),[queueItems.length,confirmedMatches.length,myIntent,pendingAsks]);
 return <section className="availability-page">
<section className="hero small availability-hero"><div><p className="kicker">SCAA MATCHMAKING</p><h1>約戰</h1><p>搵一場啱你嘅球局，或者開一場等人加入。</p></div></section>
{message&&<p key={message} className="availability-notice" role="status">{message}</p>}
{!editor&&<>
{/* STATE · OWED — somebody is waiting on this member. Nothing else belongs on screen: everything
    else here would invite them to start something new while owing somebody an answer. */}
{state==="owed"&&userPlayerId&&<ResponseQueue items={queueItems}/>}

{/* EVERY OTHER STATE — 我嘅場次.
    One slot is one session, and each session's card carries its own answer: the best opponent for
    that evening, or the fixture once somebody said yes, or the score once it has been played. This
    replaced four separate controls that all declared the same intent and three cards that all said
    nobody was free — the union of two designs, which is always worse than either.

    `Slots` replaces `Sessions` as of the 開局卡 redesign: instead of the system proposing a best
    opponent to invite, a member posts a slot — with a fill rule and conditions decided up front —
    and the club raises hands on it. No name is ever read off a public list before a slot is filled,
    which is the whole point: raising a hand costs nothing, and confirming one does not mean reading
    past the others. The board inside `Slots` (「大家開緊嘅局」) plays the same role the old market
    strip did for a club this size: always visible, unranked, proof the club is alive, including on
    the cold open. The Room's own board (ranked, grouped, built on `match_intents`) stays retired for
    the same reason it always was. The raw per-day grid stays reachable as the last-resort,
    fully-manual view underneath. */}
{state!=="owed"&&<Slots signedIn={Boolean(userPlayerId)} availabilityCount={own.length} availability={own}
  onManageAvailability={()=>nav(own.length?"manage":"create")}
  onRecord={(opponentId,playedOn)=>onRecordMatch?.(opponentId,playedOn)}
  onChanged={()=>{setRefreshNonce(value=>value+1);onActivity?.()}}/>}

{/* A disclosure, not a card. Wrapping one link in a full surface produced an empty rounded box on
    an otherwise clean screen — and, being the first `.mm-card`, it also picked up the dark
    "featured" treatment meant for something that actually matters. */}
{userPlayerId&&<section className="availability-roster">
  <button type="button" className="mm-see-all availability-roster-toggle" onClick={()=>setShowBoard(v=>!v)} aria-expanded={showBoard}>
    {showBoard?"收起全部空檔":`睇全部 ${members.length} 位球員空檔`}</button>
  {showBoard&&<>
   <DateScroller dates={week} selected={date} counts={counts} onSelect={changeDate}/>
   {members.length
    ?<AvailabilityGrid members={members} mine={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi} userPlayerId={userPlayerId} focus={focus} onFocus={setFocus} highlightId={jumpTo?.playerId} onPlayer={onPlayer}/>
    :<p className="mm-note">呢日暫時未有人公開時段。</p>}
  </>}
 </section>}

{userPlayerId&&<WaitingStrip items={waitingItems} cancellingId={cancellingInviteId} onCancel={id=>void cancelInviteAction(id)}/>}
{userPlayerId&&<PushOptIn/>}
</>}
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
   <span className="card-tools"><button className="card-tool danger" aria-label={`刪除 ${dayLabel(active.date)} ${clockAt(active.from)}–${clockAt(active.to)} 的時段`} onClick={()=>{const found=own.find(v=>v.id===active.key);if(active.draft)setDraft(a=>a.filter(v=>v.startAt!==active.key));else if(found)setPending(found);setSelected(null);dropAdjustment(active.key)}}>✕</button></span>
   {tournaments&&tournaments.length>0&&userPlayerId&&own.find(s=>s.id===active.key)&&<div className="slot-tournament-signups">
      <small>對應盃賽</small>
      <div className="tournament-actions-inline">{tournaments.map(t=>{const signed=Boolean(userPlayerId&&(t.signups||[]).includes(userPlayerId));return <Button key={t.id} variant="secondary" className={`tournament-action${signed?" signed":""}`} onClick={()=>onSignUpTournament?.(t.id)}>{signed?`取消 ${t.name}`:`報名 ${t.name}`}</Button>})}</div>
   </div>}
   {adjustment&&<div className="slot-confirm-actions"><Button variant="secondary" disabled={confirmingChange} onClick={()=>dropAdjustment(active.key)}>取消變更</Button><Button className="publish-button" disabled={confirmingChange} aria-busy={confirmingChange} onClick={()=>void confirmNudge()}>{confirmingChange&&<i className="button-spinner" aria-hidden="true"/>}<span>{confirmingChange?"儲存中…":"確認變更"}</span></Button></div>}
 </section>}
 {uncommitted.length>0&&<div className="draft-bar" role="status"><div><b>{[pendingKeys.length?`${pendingKeys.length} 個變更`:"",draft.length?`${draft.length} 個新時段`:""].filter(Boolean).join(" · ")}未儲存</b>
   <span>{uncommitted.map(x=>`${dayLabel(hkDate(new Date(x.startAt)))} ${range(x)}`).join("、")}</span></div>
  <div><Button variant="secondary" disabled={saving} onClick={()=>{setAdjustments({});setDraft([]);setSelected(null)}}>{pendingKeys.length?"全部還原":"清除"}</Button>
   <Button className="publish-button" disabled={saving} aria-busy={saving} onClick={()=>void commitAll()}>{saving&&<i className="button-spinner" aria-hidden="true"/>}<span>{saving?"儲存中…":pendingKeys.length&&draft.length?"儲存並發佈":draft.length?"發佈":"儲存變更"}</span></Button></div></div>}
 {/* Sits under the board rather than beside it: painting is how a member starts, and a rule is what
     they reach for once they notice they are painting the same evening every week. */}
 <RecurrenceEditor rules={rules} busy={rulesBusy} onAdd={input=>void addRule(input)} onRemove={id=>void removeRule(id)} onCopyLastWeek={()=>void copyLastWeek()}/>
 {/* Lives with the member's own settings rather than in the busy find tab: turning a channel off is
     a considered decision, not something anyone does mid-search. */}
 <NotificationPrefsPanel/>
 <PushOptIn/>
 <details className="board-precise"><summary>用選單精確加入時段</summary><SlotComposer initialDate={date} onSave={x=>{setDraft(a=>mergeIntervals([...a,x]));setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}/></details>
</section>}
{confirmClear&&<ConfirmDialog kicker="刪除全部時段" titleId="clear-title" title={`刪除全部 ${own.length} 個時段？`} description="所有已公開的時段都會被取消，其他球員將不會再看到你的空檔。此操作無法復原。" onClose={()=>!clearing&&setConfirmClear(false)}><Button variant="secondary" disabled={clearing} onClick={()=>setConfirmClear(false)}>保留時段</Button><Button variant="danger" className="cancel-button" disabled={clearing} aria-busy={clearing} onClick={()=>void clearAll()}>{clearing&&<i className="button-spinner" aria-hidden="true"/>}<span>{clearing?"刪除中…":`刪除全部 ${own.length} 個`}</span></Button></ConfirmDialog>}
{leaveTo&&<ConfirmDialog kicker="未儲存的變更" titleId="leave-title" title="離開後變更會消失" description={`${[pendingKeys.length?`${pendingKeys.length} 個時段變更`:"",draft.length?`${draft.length} 個新時段`:""].filter(Boolean).join("、")}尚未儲存。離開後這些變更不會保留。`} onClose={()=>setLeaveTo(null)}><Button variant="secondary" onClick={()=>setLeaveTo(null)}>留在此頁</Button><Button className="publish-button" disabled={saving} aria-busy={saving} onClick={()=>{const next=leaveTo;setLeaveTo(null);void commitAll().then(()=>go(next))}}>{saving&&<i className="button-spinner" aria-hidden="true"/>}<span>儲存後離開</span></Button><Button variant="danger" onClick={()=>{const next=leaveTo;discard();setLeaveTo(null);go(next)}}>捨棄變更</Button></ConfirmDialog>}
{pending&&<ConfirmDialog kicker="取消可配對時段" titleId="cancel-title" title={`${dayLabel(hkDate(new Date(pending.startAt)))} ${range(pending)}`} description="取消後，這段時間不會再出現在其他球員的配對結果中。" onClose={()=>setPending(null)}><Button variant="secondary" disabled={cancelling} onClick={()=>setPending(null)}>保留時段</Button><Button variant="danger" className="cancel-button" disabled={cancelling} aria-busy={cancelling} onClick={()=>void cancel()}>{cancelling&&<i className="button-spinner" aria-hidden="true"/>}<span>{cancelling?"取消中…":"確認取消"}</span></Button></ConfirmDialog>}
{inviteFor&&activeOpponent&&<InviteSheet opponent={activeOpponent} mode={inviteMode} onModeChange={setInviteMode} selectedWindow={selectedWindow} onSelectWindow={setSelectedWindow} proposeStart={proposeStart} proposeEnd={proposeEnd} onProposeStart={setProposeStart} onProposeEnd={setProposeEnd} dateLabel={dayLabel(date)} message={inviteMessage} onMessageChange={setInviteMessage} venue={inviteVenue} onVenueChange={setInviteVenue} onSend={()=>void sendInviteAction()} onClose={closeInviteSheet} sending={sendingInvite} sendLabel={inviteMode==="simple"?(selectedWindow?`送出邀請 · ${range(selectedWindow)}`:"請先揀時段"):`提議 ${proposeStart}–${proposeEnd}`}/>}
{counterFor&&<CounterSheet title={(counterFor.fromPlayer.id===userPlayerId?counterFor.toPlayer:counterFor.fromPlayer).name} date={hkDate(new Date(effectiveSlot(counterFor).startAt))} busy={counteringId===counterFor.id} onClose={()=>setCounterFor(null)} onSubmit={input=>void sendCounter(input)}/>}
</section>}
