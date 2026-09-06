"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {PlayerBadge} from "./UiBits";
import {BackdropSheet,ConfirmDialog} from "./components/ui/Overlay";
import {Button,IconButton,InlineNotice,SegmentedControl} from "./components/ui/Primitives";
import { WeekBand } from "./WeekBand";
import {CounterSheet,ResponseQueue,VenueField,WaitingStrip,reliabilityChips,type IntentState,type MatchmakingSummary,type QueueItem,type WaitingItem} from "./MatchmakingBits";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import {addDaysHongKong,availabilityEndTimes,availabilityStartTimes,composeAvailabilityInterval,dayRangeHongKong,gamesPlayed,hkClock,hkDate,hkDayLabel,intersectIntervals,matchesBetween,nextAvailabilityStart,partitionInvites,partitionOffers,rankOpponents,validateAvailabilityInterval,type AvailabilitySlot,type Interval,type IntentSignal,type RankedOpponent,type MutualOffer,type ReliabilitySignals} from "../lib/availability";
type Player={id:string;name:string;short:string;rating:number;colour?:string;avatar?:string|null};type Match={a:string;b:string;playedOn:string;status:"confirmed"|"void"};type Member=Player&{slots:AvailabilitySlot[]};
type InviteStatus="pending"|"accepted"|"declined"|"cancelled"|"expired"|"played"|"missed";type InvitePlayer={id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null};
type MatchInvite={id:string;startAt:string;endAt:string;message:string;status:InviteStatus;venue:string;createdAt:string;respondedAt:string|null;counter:{startAt:string;endAt:string;byPlayerId:string}|null;fromPlayer:InvitePlayer;toPlayer:InvitePlayer};
type ListFilter="all"|"new"|"never"|"close";
type OpponentCardVM={member:Member;difference:number;windows:Interval[];windowsCaption:string;isNew:boolean;games:number;neverEver:boolean;chips:string[];ranked?:RankedOpponent};
const time=hkClock,dayLabel=hkDayLabel,range=(x:Interval)=>`${time(x.startAt)}–${time(x.endAt)}`,days=(start:string,horizon=7)=>Array.from({length:horizon},(_,i)=>addDaysHongKong(start,i));
const durationLabel=(minutes:number)=>{const hours=Math.floor(minutes/60),rest=Math.round(minutes%60);return hours?`${hours} 小時${rest?` ${rest} 分鐘`:""}`:`${rest} 分鐘`};
/* Shared by both the overlap-ranked shortlist and the no-overlap-yet browse tier, so the same
   opponent reads identically ("新會員", "從未交手", …) no matter which tier is showing them. */
function buildOpponentChips(o:{isNew:boolean;games:number;difference:number;neverEver:boolean;recentZero:boolean}){
 const chips:string[]=[];
 if(o.isNew)chips.push(`新會員 · ${o.games} 場`);
 if(o.difference<50)chips.push("ELO 相近");
 if(o.neverEver)chips.push("從未交手");else if(o.recentZero)chips.push("近期未交手");
 return chips;
}
/** The one chip that answers "why now" rather than "why them" — the reason the deck's redesign
    exists. Always positive, same principle as `reliabilityChips`: a member who has not posted an
    intent is unmeasured, not uninterested, so absence renders nothing rather than a negative claim. */
function intentChip(intent?:IntentSignal){
 if(!intent)return [];
 if(intent.kind==="tonight")return ["今晚想打球"];
 if(intent.kind==="window")return ["本週想打球"];
 return ["時間合適即可"];
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
const PROPOSE_START_TIMES=availabilityStartTimes();
const clockMinutes=(time:string)=>{const[h,m]=time.split(":").map(Number);return h*60+m};
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
 const options=availabilityEndTimes(start);
 const end=options.find(option=>option.minutes>=clockMinutes(start)+120)?.value??options.at(-1)?.value??"21:00";
 return {start,end};
 }
const ICEBREAKER_MESSAGE="歡迎入會！有興趣一起打第一局嗎？我們可以從輕鬆的友誼賽開始。";
/** The time an invite is actually about. A counter-proposal supersedes the original everywhere it is
    displayed, so every surface agrees on which hour the two are currently negotiating over. */
const effectiveSlot=(invite:{startAt:string;endAt:string;counter?:{startAt:string;endAt:string}|null}):Interval=>invite.counter??{startAt:invite.startAt,endAt:invite.endAt};
 const timelineRange=(items:Interval[],date:string)=>{void items;void date;return {lo:10,hi:26}};
function DateScroller({dates,selected,counts,onSelect}:{dates:string[];selected:string;counts:Record<string,number>;onSelect:(date:string)=>void}){
 const scrollRef=useRef<HTMLDivElement>(null);
 const move=(direction:-1|1)=>scrollRef.current?.scrollBy({left:direction*Math.max(220,scrollRef.current.clientWidth*.72),behavior:"smooth"});
 useEffect(()=>{scrollRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"})},[selected]);
 return <section className="availability-date-selector" aria-label="未來 14 日">
  <div className="availability-date-selector-head"><b>選擇日期</b><span aria-hidden="true">左右滑動查看未來 14 日 <i>↔</i></span></div>
  <div className="availability-date-strip-wrap">
   <IconButton className="availability-date-scroll-button previous" label="向前捲動日期" onClick={()=>move(-1)}>‹</IconButton>
   <div className="availability-date-strip" role="tablist" aria-label="選擇日期，左右滑動查看更多" ref={scrollRef}>
    {dates.map((value,index)=>{const active=value===selected,count=counts[value]??0,weekday=new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${value}T00:00:00+08:00`));return <button type="button" key={value} role="tab" aria-label={`${index===0?"今日":index===1?"明日":weekday}，${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日，${count} 位球員有空`} aria-selected={active} aria-current={active?"date":undefined} className={active?"active":""} onClick={()=>onSelect(value)}><small>{index===0?"今日":index===1?"明日":weekday}</small><span>{Number(value.slice(5,7))}/{Number(value.slice(8,10))}</span><strong>{count} 位</strong></button>})}
   </div>
   <IconButton className="availability-date-scroll-button next" label="向後捲動日期" onClick={()=>move(1)}>›</IconButton>
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
  <div className="availability-grid-legend"><span><i/>該時段有空</span>{focus&&<Button variant="quiet" onClick={()=>onFocus(null)}>清除 {range(focus)}</Button>}</div>
 </section>
}
/* One row of the invite inbox. Every pending invite gets one of these — the previous design surfaced
   only the first, so a member with three people waiting on them answered one and silently ignored
   two. `tone` drives nothing but colour; the actions are what differ between the buckets. */
/* An open call: one member offering a table to the whole club rather than asking one person. The
   claim button is the entire point, so it stays primary and single-tap — a member should never have
   to open a sheet to say yes to a game that is already on offer. */
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
  const proposeEndTimes=useMemo(()=>availabilityEndTimes(proposeStart),[proposeStart]);
  const changeProposeStart=(value:string)=>{onProposeStart(value);const options=availabilityEndTimes(value);if(!options.some(option=>option.value===proposeEnd))onProposeEnd(options.at(-1)?.value??"")};
  return <BackdropSheet onClose={onClose} labelledBy="invite-sheet-title">
   <p className="kicker">邀請對局</p>
   <h2 id="invite-sheet-title">{opponent.member.name}</h2>
   <div className="invite-mode-toggle"><SegmentedControl label="邀請方式" value={mode} onChange={value=>onModeChange(value as typeof mode)}
     items={[{value:"simple",label:"快速邀請"},{value:"propose",label:"提議時段"}]}/></div>
   {mode==="simple"
    ?<div className="invite-window-list">
      <p className="sub">{opponent.windows.length?"對方公開的時段，選一個即可送出：":"對方今日未公開時段 — 可改用「提議時段」直接建議時間。"}</p>
      {opponent.windows.map(w=><button type="button" key={w.startAt} className={`invite-window-option${selectedWindow?.startAt===w.startAt?" active":""}`} onClick={()=>onSelectWindow(w)}><span>{dayLabel(hkDate(new Date(w.startAt)))} {range(w)}</span>{selectedWindow?.startAt===w.startAt&&<span aria-hidden="true">✓</span>}</button>)}
     </div>
    :<div className="invite-propose">
      <p className="sub">提議 {dateLabel} 一個具體時段，對方直接確認或改期。</p>
       <div className="two">
        <label>開始<select value={proposeStart} onChange={e=>changeProposeStart(e.target.value)}>{PROPOSE_START_TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
        <label>結束<select value={proposeEnd} onChange={e=>onProposeEnd(e.target.value)}>{proposeEndTimes.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
     </div>}
   {opponent.isNew&&<button type="button" className="icebreaker-suggestion" onClick={()=>onMessageChange(ICEBREAKER_MESSAGE)}><span aria-hidden="true">★</span><span>這位是新會員 — 加一句「歡迎入會，一起打第一局？」會讓對方更放心答應</span></button>}
   {/* Naming the table turns a vague "let's play" into something the other side can just turn up to,
       which is the difference between an accepted invite and a game that actually happens. */}
   <VenueField value={venue} onChange={onVenueChange}/>
   <label className="invite-message-field">留言（可省略）<textarea value={message} onChange={e=>onMessageChange(e.target.value)} placeholder="加句留言（可省略）"/></label>
   <Button variant="primary" className="full" disabled={sending||(mode==="simple"&&!selectedWindow)} onClick={onSend}>{sending?"送出中…":sendLabel}</Button>
 </BackdropSheet>;
}
/* The board speaks in hours from the start of a row's Hong Kong day, so a slot that runs past
   midnight simply extends beyond 24 on the row it started in — one bar, one row, no wrapping. */
const clockAt=(h:number)=>`${String(Math.floor(h)%24).padStart(2,"0")}:${h%1?"30":"00"}`;
const hoursOf=(date:string,iso:string)=>(Date.parse(iso)-Date.parse(dayRangeHongKong(date).startAt))/3600000;

const HORIZON=14;
export default function Availability({userPlayerId,matches,provisionalGames=10,onDirtyChange,jumpTo,onPlayer,onRecordMatch,onActivity,matchmakingSummary}:{userPlayerId?:string;matches:Match[];provisionalGames?:number;onDirtyChange?:(dirty:boolean)=>void;jumpTo?:{playerId:string;date:string}|null;onPlayer?:(playerId:string)=>void;onRecordMatch?:(opponentId:string,playedOn:string)=>void;
 /** Anything that changes what the shell's badge should say. The tab owns the truth while it is
    open, so it tells the shell rather than making the shell poll faster on the off-chance. */
 onActivity?:()=>void;matchmakingSummary?:MatchmakingSummary|null}){
  const week=useMemo(()=>days(hkDate(),HORIZON),[]),[date,setDate]=useState(jumpTo?.date??hkDate()),[appliedJump,setAppliedJump]=useState(jumpTo??null),[members,setMembers]=useState<Member[]>([]),[counts,setCounts]=useState<Record<string,number>>({}),[own,setOwn]=useState<AvailabilitySlot[]>([]),[focus,setFocus]=useState<Interval|null>(null),[pending,setPending]=useState<AvailabilitySlot|null>(null),[cancelling,setCancelling]=useState(false),[message,setMessage]=useState(""),[recommendationNow]=useState(()=>Date.now());
 const[filter,setFilter]=useState<ListFilter>("all"),[prioritizeNew,setPrioritizeNew]=useState(false),
  [invites,setInvites]=useState<{sent:MatchInvite[];received:MatchInvite[]}>({sent:[],received:[]}),
  [inviteFor,setInviteFor]=useState<string|null>(null),[inviteMode,setInviteMode]=useState<"simple"|"propose">("simple"),[selectedWindow,setSelectedWindow]=useState<Interval|null>(null),
  [proposeStart,setProposeStart]=useState("19:00"),[proposeEnd,setProposeEnd]=useState("21:00"),[inviteMessage,setInviteMessage]=useState(""),
  [sendingInvite,setSendingInvite]=useState(false),[respondingId,setRespondingId]=useState<string|null>(null),[cancellingInviteId,setCancellingInviteId]=useState<string|null>(null),
  [closingInviteId,setClosingInviteId]=useState<string|null>(null);
 /* The pieces the redesign added: mutual offers, per-fixture venue, weekly rules, counter-proposals,
    and the reliability signals only the server can know. */
 const[offers,setOffers]=useState<MutualOffer[]>([]),[answeringOfferId,setAnsweringOfferId]=useState<string|null>(null),
  [inviteVenue,setInviteVenue]=useState(""),
  [counterFor,setCounterFor]=useState<MatchInvite|null>(null),[counteringId,setCounteringId]=useState<string|null>(null),
  [reliability,setReliability]=useState<Record<string,ReliabilitySignals>>({}),
  [intentsByPlayer,setIntentsByPlayer]=useState<Record<string,IntentSignal>>({}),[myIntent,setMyIntent]=useState<IntentState>(null),
  [showBoard,setShowBoard]=useState(false);
 /* The buckets below are time-dependent, and a member can sit on this screen while a slot starts or
    ends. A one-minute tick re-evaluates them so the follow-up prompt appears on its own. */
 const[tick,setTick]=useState(()=>Date.now());
 const[bootstrapState,setBootstrapState]=useState<"loading"|"loaded"|"failed">("loading");
 /* Bumped by anything that changes club state from outside the poll's own effect — going live in The
    Room, claiming a table there — so invites, calls and offers refresh immediately instead of at the
    next 30-second tick, which is long enough for a member to think their tap did nothing. */
 const[refreshNonce,setRefreshNonce]=useState(0);
 /* A load failure needs to outlive `message`, which clears itself after four seconds. Without its
    own state the tab settled into a blank board with nothing on screen to say why, and no way back
    other than reloading the page. `retryNonce` re-runs the load effect; `loadAttempts` bounds the
    automatic ones so a genuinely down endpoint is not hammered. */
 const[loadError,setLoadError]=useState(""),[retryNonce,setRetryNonce]=useState(0);
 const loadAttempts=useRef(0);
 useEffect(()=>{const id=window.setInterval(()=>setTick(Date.now()),60000);return()=>window.clearInterval(id)},[]);
 const firstLoad=useRef(true),bootstrapLoadedRef=useRef(false),cancellingRef=useRef(false);
 useEffect(()=>{const c=new AbortController();let timedOut=false,retry:number|undefined;const timeout=window.setTimeout(()=>{timedOut=true;c.abort()},15000);async function load(){try{
  if(!bootstrapLoadedRef.current){
   const response=await fetch(`/api/matchmaking/bootstrap?date=${date}&week=${week[0]}&days=${HORIZON}`,{signal:c.signal});
   const body=await response.json();if(!response.ok||body.selected?.error)throw Error(body.selected?.error??body.error??"約戰資料暫時未能載入");
   setMembers(body.selected?.members??[]);setCounts(body.calendar?.counts??{});setOwn(body.own?.slots??[]);
   setInvites({sent:body.inbox?.sent??[],received:body.inbox?.received??[]});setOffers(body.mutual?.offers??[]);
   bootstrapLoadedRef.current=true;setBootstrapState("loaded");setMessage("");setLoadError("");loadAttempts.current=0;return;
  }
  const[selected,calendar,mine]=await Promise.all([fetch(`/api/availability?date=${date}`,{signal:c.signal}).then(r=>r.json()),fetch(`/api/availability?week=${week[0]}&days=${HORIZON}`,{signal:c.signal}).then(r=>r.json()),userPlayerId?fetch("/api/availability?me",{signal:c.signal}).then(r=>r.json()):Promise.resolve({slots:[]})]);
  if(selected.error)throw Error(selected.error);setMembers(selected.members);setCounts(calendar.counts??{});setOwn(mine.slots??[]);setMessage("");setLoadError("");loadAttempts.current=0;setBootstrapState("loaded");
 }catch(e){if(e instanceof Error&&(e.name!=="AbortError"||timedOut)){
   /* Marking the bootstrap done on failure is deliberate: the retry below then takes the lighter
      per-endpoint path rather than re-running the whole fan-out that just timed out. */
   if(!bootstrapLoadedRef.current){bootstrapLoadedRef.current=true}
   setBootstrapState("failed");
   setLoadError(timedOut?"約戰資料載入逾時。":(e.message||"約戰資料暫時未能載入。"));
   /* The old copy said 正在重試 while nothing retried. Retry for real, twice, backing off — then
      leave it to the member, who now has a button instead of a blank screen. */
   if(loadAttempts.current<2){const wait=2000*2**loadAttempts.current;loadAttempts.current+=1;retry=window.setTimeout(()=>setRetryNonce(value=>value+1),wait)}
  }}finally{window.clearTimeout(timeout)}}
 if(firstLoad.current)firstLoad.current=false;else trackAvailabilityEvent("availability_date_select");void load();return()=>{window.clearTimeout(timeout);if(retry!==undefined)window.clearTimeout(retry);c.abort()}},[date,userPlayerId,week,retryNonce]);
 /* A profile card's "在可配對查看" button lands here with a target player and their nearest free day.
    Adjusted during render rather than in an effect: the jump can arrive while this tab is already
    open (card opened from the grid itself), so mount-time initial state alone would miss it, and an
    effect would paint the wrong day first. The highlight is the parent's to clear, mirroring
    highlightMatch in Matches, so it survives until the member navigates away. */
 if(jumpTo&&jumpTo!==appliedJump){setAppliedJump(jumpTo);setShowBoard(true);setFocus(null);setDate(jumpTo.date)}
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
 /* Pending edits are keyed by slot, so moving the selection elsewhere no longer throws one away, and
    every unsaved slot keeps its edited geometry on the board instead of only the selected one. */
 /* A slot can vanish under a pending edit (cancelled here, or elsewhere before a refresh), so the live
    set is derived from what still exists rather than synced — an orphan can never be saved. */
 /* Edited slots and unpublished ones read as one pile of uncommitted work, listed in clock order so
    the summary matches the board top to bottom. */
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
 /* Same one-minute tick as the invite buckets: an offer for 20:00 stops being answerable at 20:30,
    and it should take itself off the screen rather than wait for a reload. */
 const liveOffers=useMemo(()=>partitionOffers(offers,tick),[offers,tick]);
 useEffect(()=>{if(liveOffers.awaitingMe.length)trackAvailabilityEvent("matchmaking_offer_shown",{count:liveOffers.awaitingMe.length})},[liveOffers.awaitingMe.length]);
 /* One list out of what used to be four sections. A result to confirm, an invite to answer and an
    offer to accept are the same thing to a member — something waiting on them — and differ only in
    which buttons the row carries. Results sort first because they already happened; everything else
    goes by when it is due. */
 const queueItems=((): QueueItem[]=>{
  if(!userPlayerId)return [];
  const across=(invite:MatchInvite)=>invite.fromPlayer.id===userPlayerId?invite.toPlayer:invite.fromPlayer;
  const results:QueueItem[]=buckets.followUps.map(invite=>{
   const other=across(invite);
   return {id:`r-${invite.id}`,kind:"result" as const,person:other,startAt:invite.startAt,endAt:invite.endAt,venue:invite.venue,
    reason:"這一場打了嗎？記錄之後才計算 ELO。",busy:closingInviteId===invite.id,
    actions:[
     {label:"未有對局",tone:"secondary" as const,onClick:()=>void closeInviteOutcome(invite.id,"missed")},
     ...(onRecordMatch?[{label:"記錄比分",tone:"primary" as const,onClick:()=>onRecordMatch(other.id,hkDate(new Date(invite.startAt)))}]:[]),
    ]};
  });
  const invites:QueueItem[]=buckets.needsResponse.map(invite=>{
   const other=across(invite),slot=effectiveSlot(invite);
   return {id:`i-${invite.id}`,kind:"invite" as const,person:other,startAt:slot.startAt,endAt:slot.endAt,venue:invite.venue,
    reason:invite.counter?"提議改時間":"想邀你打球",
    note:invite.counter?`原本 ${range(invite)}${invite.message?` · ${invite.message}`:""}`:invite.message||undefined,
    busy:respondingId===invite.id,
    /* Three doors, and which one is easiest to reach is the whole design.
       改時間 keeps the fixture alive. 今個星期唔打 is the important one: it withdraws *my own intent*
       rather than rejecting *this person*, so the sender is told 「佢今個星期唔打波」 instead of
       「佢拒絕咗你」. Same outcome for the evening, completely different social meaning — and that
       difference is what makes saying no survivable in a club where everyone meets at the same table. */
    actions:[
     {label:"改時間",tone:"secondary" as const,onClick:()=>setCounterFor(invite)},
     {label:"本週不打球",tone:"secondary" as const,onClick:()=>void declineForTheWeek(invite.id)},
     {label:invite.counter?"接受新時間":"接受",tone:"primary" as const,onClick:()=>void respondToInvite(invite.id,"accept")},
    ]};
  });
  const asks:QueueItem[]=liveOffers.awaitingMe.map(offer=>({
   id:`o-${offer.id}`,kind:"offer" as const,person:offer.opponent,startAt:offer.startAt,endAt:offer.endAt,venue:offer.venue,
   reason:"雙方時間吻合 · 回覆「未能出席」對方不會知道",busy:answeringOfferId===offer.id,
   actions:[
    {label:"未能出席",tone:"secondary" as const,onClick:()=>void answerOffer(offer.id,"no")},
    {label:"應戰",tone:"primary" as const,onClick:()=>void answerOffer(offer.id,"yes")},
   ]}));
  return [...results,...[...invites,...asks].sort((a,b)=>a.startAt.localeCompare(b.startAt))];
 })();
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
/* Mirrors the mount-time `load()` above: an effect that sets state declares its own inline fetch
    rather than calling out to a function defined elsewhere, so an incoming invite still shows up
    without a manual refresh while the find tab stays open. */
 /* Runs regardless of which tab (find/manage/create) is open — an accepted invite is otherwise
    invisible to the sender the moment they leave "find", since nothing else in the app pushes it to
    them. */
 useEffect(()=>{
  if(bootstrapState==="loading")return;
   let cancelled=false,polling=false;
  async function poll(){
    if(polling)return;
    polling=true;
    try{
   if(userPlayerId)try{const r=await fetch("/api/invites");const b=await r.json();if(!cancelled&&r.ok)setInvites({sent:b.sent??[],received:b.received??[]});}catch{/* keep the previous invites in view if a background poll fails */}
   /* An offer is time-critical in a way an invite is not — it exists because two people are free
      *now-ish* — so it rides the same 30-second poll rather than waiting for a reload. */
   if(userPlayerId)try{const r=await fetch("/api/offers");const b=await r.json();if(!cancelled&&r.ok)setOffers(b.offers??[]);}catch{/* last known offers stay on screen */}
    }finally{polling=false}
  }
  if(bootstrapState==="failed")void poll();
  const id=window.setInterval(()=>{if(document.visibilityState==="visible")void poll()},30000);
  return()=>{cancelled=true;window.clearInterval(id)};
 },[bootstrapState,userPlayerId,refreshNonce]);
 /* The app shell already polls this summary for the navigation badge. Reuse that response for the
    ranking and intent state instead of opening a second summary request from the tab itself. */
 useEffect(()=>{
  if(!matchmakingSummary)return;
  setReliability(matchmakingSummary.reliability??{});
  setIntentsByPlayer(matchmakingSummary.intents??{});
  setMyIntent(matchmakingSummary.mine??null);
 },[matchmakingSummary]);
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
  else{try{interval=validateAvailabilityInterval(composeAvailabilityInterval(date,proposeStart,proposeEnd));}catch{setMessage("請選擇一個尚未開始、香港時間上午 10 時至翌日凌晨 2 時之間的時段。");return;}}
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
   setMessage(b.matched?"對局已確認！":answer==="yes"?"已回覆，等對方答應就即刻confirm。":"知道了，不會再提示這個配對。");
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
  catch{setMessage("請選擇一個尚未開始、香港時間上午 10 時至翌日凌晨 2 時之間的時段。");return;}
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
 /* --- Post-slot follow-up -------------------------------------------------- */
 const closeInviteOutcome=async(id:string,outcome:"played"|"missed")=>{
  if(closingInviteId)return;
  setClosingInviteId(id);setMessage("");
  try{
   const r=await fetch(`/api/invites/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:outcome})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"未能更新，請再試一次。");return;}
   trackAvailabilityEvent(outcome==="played"?"matchmaking_result_played":"matchmaking_result_missed");
   await refreshInvites();setMessage(outcome==="played"?"多謝，已記錄這場對局。":"已記錄這次未有對局。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setClosingInviteId(null)}
 };
 const changeDate=(next:string)=>{setFocus(null);setDate(next)};
 /* 時段軸把「畫草稿、再儲存」變成一個動作：拖出時段之後按一下就直接寫入，畫面上不再存在未儲存的工作。
    因此這個分頁再沒有 dirty 狀態，只在掛載時告訴外殼一次，清掉之前版本可能留下的旗標。 */
 useEffect(()=>{onDirtyChange?.(false);return()=>onDirtyChange?.(false)},[onDirtyChange]);
 /* Edits to published slots and brand-new slots are both just "work I have not committed yet", so one
    action commits the lot. Edits go first: they are independent PATCHes, and publishing returns the
    full slot list, which then stands as the final truth. */
 /* Nudging keeps the slot legal rather than bouncing an error: the edge stops at 30 minutes wide,
    at 12 hours long, and never reaches back before the next bookable half hour. */
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
 /* --- What is this screen about right now? ---------------------------------
    Nothing, any more — and that is the change. The screen used to switch wholesale between four
    states, and one of them (`owed`) replaced the entire tab with the response queue: a member who
    owed somebody a score could not look at tonight's games until they had settled it. Ranking the
    queue above the timeline says "this first" without taking the club away while it is unresolved,
    so there is one composition and the queue is simply the top of it. */
 return <>
<section className="availability-page">

{/* 一個手勢，同時是查詢，也是宣告。時段軸取代了「先在另一個分頁公開時段、再回來看有誰」的兩段旅程：
    拖出的那一格即時回答「這段時間有誰重疊」，按下確認就是公開，姓名同時解鎖。 */}
<WeekBand signedIn={Boolean(userPlayerId)} refreshKey={refreshNonce}
  onOpenPlayer={onPlayer}
  onInvite={(playerId,slot)=>openInviteSheet(playerId,slot)}
  onChanged={()=>{setRefreshNonce(value=>value+1);void refreshFind();onActivity?.()}}/>

{message&&<p key={message} className="availability-notice" role="status">{message}</p>}
{loadError&&<div className="availability-load-error">
  <InlineNotice tone="warning" title="未能載入約戰資料">
    {loadError}
    <Button variant="secondary" onClick={()=>{loadAttempts.current=0;setLoadError("");setBootstrapState("loading");setRetryNonce(value=>value+1)}}>重試</Button>
  </InlineNotice>
</div>}

{/* 等待回應的事項排在時段軸之下：需要作答的東西優先於發現，但不再霸佔整個畫面。 */}
{queueItems.length>0&&userPlayerId&&<ResponseQueue items={queueItems}/>}

<WaitingStrip items={waitingItems} cancellingId={cancellingInviteId} onCancel={id=>void cancelInviteAction(id)}/>

{/* 整週空檔表。舊版把它收在另一個分頁的摺疊掣裡，等於把「看得見別人的空檔」這件事藏起來；現在它是
    時段軸的下一層，兩者共用同一個時間游標。 */}
{userPlayerId&&<section className="availability-roster">
 <Button variant="quiet" className="mm-see-all availability-roster-toggle" onClick={()=>setShowBoard(v=>!v)} aria-expanded={showBoard}>
   {showBoard?"收起全部空檔":`查看全部 ${members.length} 位球員的空檔`}</Button>
 {showBoard&&<>
  <DateScroller dates={week} selected={date} counts={counts} onSelect={changeDate}/>
  {members.length
   ?<AvailabilityGrid members={members} mine={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi} userPlayerId={userPlayerId} focus={focus} onFocus={setFocus} highlightId={jumpTo?.playerId} onPlayer={onPlayer}/>
   :<p className="mm-note">這一天暫時未有人公開時段。</p>}
 </>}
</section>}

{pending&&<ConfirmDialog kicker="取消可配對時段" titleId="cancel-title" title={`${dayLabel(hkDate(new Date(pending.startAt)))} ${range(pending)}`} description="取消後，這段時間不會再出現在其他球員的配對結果中。" onClose={()=>setPending(null)}><Button variant="secondary" disabled={cancelling} onClick={()=>setPending(null)}>保留時段</Button><Button variant="danger" className="cancel-button" disabled={cancelling} aria-busy={cancelling} onClick={()=>void cancel()}>{cancelling&&<i className="button-spinner" aria-hidden="true"/>}<span>{cancelling?"取消中…":"確認取消"}</span></Button></ConfirmDialog>}
{inviteFor&&activeOpponent&&<InviteSheet opponent={activeOpponent} mode={inviteMode} onModeChange={setInviteMode} selectedWindow={selectedWindow} onSelectWindow={setSelectedWindow} proposeStart={proposeStart} proposeEnd={proposeEnd} onProposeStart={setProposeStart} onProposeEnd={setProposeEnd} dateLabel={dayLabel(date)} message={inviteMessage} onMessageChange={setInviteMessage} venue={inviteVenue} onVenueChange={setInviteVenue} onSend={()=>void sendInviteAction()} onClose={closeInviteSheet} sending={sendingInvite} sendLabel={inviteMode==="simple"?(selectedWindow?`送出邀請 · ${range(selectedWindow)}`:"請先選擇時段"):`提議 ${proposeStart}–${proposeEnd}`}/>}
{counterFor&&<CounterSheet title={(counterFor.fromPlayer.id===userPlayerId?counterFor.toPlayer:counterFor.fromPlayer).name} date={hkDate(new Date(effectiveSlot(counterFor).startAt))} busy={counteringId===counterFor.id} onClose={()=>setCounterFor(null)} onSubmit={input=>void sendCounter(input)}/>}
</section></>}
