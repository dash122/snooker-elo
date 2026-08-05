"use client";
import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
import {PlayerBadge} from "./UiBits";
import {CardHead,CounterSheet,NextUpCard,NotificationPrefsPanel,PushOptIn,RecurrenceEditor,ResponseQueue,VenueField,WaitingStrip,reliabilityChips,type QueueItem,type RecurrenceRule,type WaitingItem} from "./MatchmakingBits";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import {addDaysHongKong,composeAvailabilityInterval,dayRangeHongKong,gamesPlayed,hkClock,hkDate,hkDayLabel,intervalFromHours,intersectIntervals,matchesBetween,mergeIntervals,nextAvailabilityStart,partitionInvites,partitionOffers,partitionOpenCalls,rankOpponents,validateAvailabilityInterval,type AvailabilitySlot,type Interval,type MutualOffer,type ReliabilitySignals} from "../lib/availability";
type Player={id:string;name:string;short:string;rating:number;colour?:string;avatar?:string|null};type Match={a:string;b:string;playedOn:string;status:"confirmed"|"void"};type Member=Player&{slots:AvailabilitySlot[]};type View="find"|"recommendations"|"manage"|"create"|"tournaments";
type InviteStatus="pending"|"accepted"|"declined"|"cancelled"|"expired"|"played"|"missed";type InvitePlayer={id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null};
type MatchInvite={id:string;startAt:string;endAt:string;message:string;status:InviteStatus;venue:string;createdAt:string;respondedAt:string|null;counter:{startAt:string;endAt:string;byPlayerId:string}|null;fromPlayer:InvitePlayer;toPlayer:InvitePlayer};
type OpenCall={id:string;startAt:string;endAt:string;message:string;status:"open"|"claimed"|"cancelled"|"expired";venue:string;createdAt:string;claimedAt:string|null;player:InvitePlayer;claimedBy:InvitePlayer|null};
type ListFilter="all"|"new"|"never"|"close";type CardStatus="none"|"pendingSent"|"pendingReceived"|"accepted";
/** The three ways a member browses for a game, as one segmented control rather than three stacked
    sections competing for the same screen. */
type FindView="suggested"|"calls"|"board";
type Tournament={id:string;name:string;handicapMode:"suggested"|"none";signupDeadline:string;createdAt:string;createdBy?:string;signups:string[]};
type OpponentCardVM={member:Member;difference:number;windows:Interval[];windowsCaption:string;isNew:boolean;games:number;neverEver:boolean;chips:string[]};
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
  <div className="availability-form-actions"><button className="primary">{slot?"儲存變更":"加入時段"}</button>{onCancel&&<button type="button" className="secondary" onClick={onCancel}>取消</button>}</div>
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
function OpenCallCard({call,mine,onClaim,onWithdraw,busy,canClaim}:{call:OpenCall;mine:boolean;onClaim:()=>void;onWithdraw:()=>void;busy:boolean;canClaim:boolean}){
 return <li className={`open-call-card${mine?" is-mine":""}`}>
  <PlayerBadge player={call.player}/>
  <div className="open-call-copy">
   <b>{mine?"你的開放邀請":call.player.name}</b>
   <small>{dayLabel(hkDate(new Date(call.startAt)))} · {range(call)}{call.venue?` · ${call.venue}`:""}</small>
   {call.message&&<p>{call.message}</p>}
  </div>
  <div className="open-call-actions">
   {mine
    ?<button type="button" className="secondary" disabled={busy} onClick={onWithdraw}>{busy?"收回中…":"收回"}</button>
    :<button type="button" className="primary" disabled={busy||!canClaim} title={canClaim?undefined:"需要連結球員檔案才可接受"} onClick={onClaim}>{busy?"接受中…":"我要打"}</button>}
  </div>
 </li>;
}

function SlotComposer({initialDate,onSave}:{initialDate:string;onSave:(x:Interval)=>void}){return <SlotForm initialDate={initialDate} onSave={onSave}/>}/* The one question the page exists to answer, answered before anything else on screen. Which card
   shows up depends on what is actually blocking the member from playing tonight. */
function MatchPrompt({hasMine,userPlayerId,members,focus,onManage}:{hasMine:boolean;userPlayerId?:string;members:number;focus:Interval|null;onManage:(v:"manage"|"create")=>void}){
 if(!userPlayerId)return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">找對手</p><h2>登入後即可看到最合適的對手</h2><p>連結球員帳戶，我們會按你公開的時間、ELO 及近期交手紀錄排出建議。</p></section>;
 if(!hasMine)return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">先設定你的時間</p><h2>{members?`這天有 ${members} 位球員有空`:"這天暫時未有人公開時段"}</h2><p>公開你自己的空閒時間後，這裡會直接告訴你今晚最值得約的對手。</p><button className="primary" onClick={()=>onManage("create")}>公開我的時段</button></section>;
 return <section className="availability-card match-hero is-prompt"><p className="match-hero-kicker">{focus?"這個時段":"這一天"}沒有重疊</p><h2>暫時沒有人與你的時間重疊</h2><p>{focus?"試試清除時段篩選，或選擇其他日子。":"換一天，或加闊你的可配對時間，配對機會會明顯提高。"}</p><button className="secondary" onClick={()=>onManage("manage")}>調整我的時段</button></section>;
}
/** One card per candidate opponent — ranked overlaps and the no-overlap-yet browse tier both render
    through here, in the same full-size treatment. There is no single "best tonight" card any more:
    every name a member could actually play gets the same room to make its case. */
function OpponentCard({opponent,rank,onPlayer,cardStatus,onInvite,onCancelInvite}:{opponent:OpponentCardVM;rank:number;onPlayer?:(playerId:string)=>void;cardStatus:{status:CardStatus;invite:MatchInvite|null};onInvite:(playerId:string,window?:Interval)=>void;onCancelInvite:(inviteId:string)=>void}){
 const open=()=>onPlayer?.(opponent.member.id);
 return <section className={`match-hero match-hero-compact${onPlayer?" is-clickable":""}`} role={onPlayer?"button":undefined} tabIndex={onPlayer?0:undefined} onClick={onPlayer?open:undefined} onKeyDown={onPlayer?(e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}}):undefined}>
  <div className="match-hero-main">
   <span className="match-hero-rank">{rank}</span>
   <span className="opponent-badge-wrap">
    <PlayerBadge player={opponent.member}/>
    {opponent.isNew&&<i className="new-player-flag" aria-hidden="true">新</i>}
   </span>
   <div className="match-hero-who"><h2>{opponent.member.name}</h2><small>{Math.round(opponent.member.rating)} ELO · 相差 {Math.round(opponent.difference)}</small></div>
  </div>
  <div className="match-hero-windows">{opponent.windows.map(w=><button type="button" key={w.startAt} className="match-hero-window-chip match-hero-window-action" onClick={e=>{e.stopPropagation();onInvite(opponent.member.id,w)}} aria-label={`邀請 ${opponent.member.name} 在 ${dayLabel(hkDate(new Date(w.startAt)))} ${range(w)} 對局`}>{dayLabel(hkDate(new Date(w.startAt)))} {range(w)} <span aria-hidden="true">→</span></button>)}<small>{opponent.windowsCaption}</small></div>
  {opponent.chips.length>0&&<div className="track-chips">{opponent.chips.map(c=><span key={c} className={c.startsWith("新加入")?"chip-new":undefined}>{c}</span>)}</div>}
   <div className="match-hero-foot" onClick={e=>e.stopPropagation()}>
   {cardStatus.status==="none"&&<button type="button" className="secondary" onClick={()=>onInvite(opponent.member.id)}>邀請對局</button>}
   {cardStatus.status==="pendingSent"&&<span className="invite-status-pending"><small>邀請待回覆…</small><button type="button" className="secondary" onClick={()=>cardStatus.invite&&onCancelInvite(cardStatus.invite.id)}>收回</button></span>}
   {cardStatus.status==="pendingReceived"&&<small className="invite-status-incoming">對方已邀請你 · 見上方「收到的邀請」</small>}
   {cardStatus.status==="accepted"&&cardStatus.invite&&<span className="invite-status-accepted">✓ 已確認 · {range(cardStatus.invite)}</span>}
  </div>
 </section>
}
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
 return <div className="backdrop invite-backdrop" onMouseDown={onClose}>
  <section className="sheet invite-sheet" onMouseDown={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="invite-sheet-title">
   <button type="button" className="close" aria-label="關閉" onClick={onClose}>×</button>
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
  </section>
 </div>;
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
 const week=useMemo(()=>days(hkDate(),HORIZON),[]),[date,setDate]=useState(jumpTo?.date??hkDate()),[appliedJump,setAppliedJump]=useState(jumpTo??null),[members,setMembers]=useState<Member[]>([]),[counts,setCounts]=useState<Record<string,number>>({}),[own,setOwn]=useState<AvailabilitySlot[]>([]),[view,setView]=useState<View>("find"),[draft,setDraft]=useState<Interval[]>([]),[selected,setSelected]=useState<string|null>(null),[adjustments,setAdjustments]=useState<Record<string,Interval>>({}),[focus,setFocus]=useState<Interval|null>(null),[boardWide,setBoardWide]=useState(false),[pending,setPending]=useState<AvailabilitySlot|null>(null),[leaveTo,setLeaveTo]=useState<View|null>(null),[confirmClear,setConfirmClear]=useState(false),[clearing,setClearing]=useState(false),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[cancelling,setCancelling]=useState(false),[confirmingChange,setConfirmingChange]=useState(false),[message,setMessage]=useState(""),[recommendationNow]=useState(()=>Date.now());
 const[filter,setFilter]=useState<ListFilter>("all"),[prioritizeNew,setPrioritizeNew]=useState(false),
  [invites,setInvites]=useState<{sent:MatchInvite[];received:MatchInvite[]}>({sent:[],received:[]}),
  [inviteFor,setInviteFor]=useState<string|null>(null),[inviteMode,setInviteMode]=useState<"simple"|"propose">("simple"),[selectedWindow,setSelectedWindow]=useState<Interval|null>(null),
  [proposeStart,setProposeStart]=useState("19:00"),[proposeEnd,setProposeEnd]=useState("21:00"),[inviteMessage,setInviteMessage]=useState(""),
  [sendingInvite,setSendingInvite]=useState(false),[respondingId,setRespondingId]=useState<string|null>(null),[cancellingInviteId,setCancellingInviteId]=useState<string|null>(null),
  [openCalls,setOpenCalls]=useState<OpenCall[]>([]),[callComposerOpen,setCallComposerOpen]=useState(false),[callStart,setCallStart]=useState("19:00"),[callEnd,setCallEnd]=useState("21:00"),[callMessage,setCallMessage]=useState(""),
  [postingCall,setPostingCall]=useState(false),[claimingCallId,setClaimingCallId]=useState<string|null>(null),[withdrawingCallId,setWithdrawingCallId]=useState<string|null>(null),[closingInviteId,setClosingInviteId]=useState<string|null>(null);
 /* The pieces the redesign added: mutual offers, per-fixture venue, weekly rules, counter-proposals,
    and the reliability signals only the server can know. */
 const[offers,setOffers]=useState<MutualOffer[]>([]),[answeringOfferId,setAnsweringOfferId]=useState<string|null>(null),
  [inviteVenue,setInviteVenue]=useState(""),[callVenue,setCallVenue]=useState(""),
  [rules,setRules]=useState<RecurrenceRule[]>([]),[rulesBusy,setRulesBusy]=useState(false),
  [counterFor,setCounterFor]=useState<MatchInvite|null>(null),[counteringId,setCounteringId]=useState<string|null>(null),
  [reliability,setReliability]=useState<Record<string,ReliabilitySignals>>({}),[findView,setFindView]=useState<FindView>("suggested");
 /* The buckets below are time-dependent, and a member can sit on this screen while a slot starts or
    ends. A one-minute tick re-evaluates them so the follow-up prompt appears on its own. */
 const[tick,setTick]=useState(()=>Date.now());
 useEffect(()=>{const id=window.setInterval(()=>setTick(Date.now()),60000);return()=>window.clearInterval(id)},[]);
 const openTournaments=useMemo(()=> (tournaments??[]).filter(t=>{const value=t.signupDeadline.length===10?`${t.signupDeadline}T23:59`:t.signupDeadline;const deadline=Date.parse(`${value}:00+08:00`);return Number.isNaN(deadline)||deadline>=tick}),[tournaments,tick]);
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
  });
  const longest=Math.max(0,...ranked.map(x=>x.minutes));
  return ranked.map(x=>{
   const games=gamesPlayed(matches,x.id),isNew=games<provisionalGames,neverEver=matchesBetween(matches,userPlayerId,x.id).length===0;
   const chips=[...(longest>0&&x.minutes===longest?["時間重疊最長"]:[]),...buildOpponentChips({isNew,games,difference:x.difference,neverEver,recentZero:x.recent===0}),...reliabilityChips(x.signals)];
   return {member:byId.get(x.id)!,difference:x.difference,windows:x.overlaps,windowsCaption:`共 ${durationLabel(x.minutes)}重疊`,isNew,games,neverEver,chips};
  });
 },[members,matches,mine,userPlayerId,recommendationNow,focus,provisionalGames,reliability]);
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
   return {member:m,difference,windows:m.slots as Interval[],windowsCaption:`${m.slots.length} 個公開時段`,isNew,games,neverEver,chips:[...buildOpponentChips({isNew,games,difference,neverEver,recentZero}),...reliabilityChips(reliability[m.id])]};
  }).sort((a,b)=>a.difference-b.difference);
 },[userPlayerId,rankedPool.length,members,matches,focus,recommendationNow,provisionalGames,reliability]);
 const browseList=useMemo(()=>byPriority(browsePool.filter(o=>passesListFilter(filter,o)),prioritizeNew),[browsePool,filter,prioritizeNew]);
 const activeList=shortlist.length?shortlist:browseList;
 const isBrowseTier=!shortlist.length&&browseList.length>0;
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
 const inviteStatusById=useMemo(()=>{
  const map=new Map<string,{status:CardStatus;invite:MatchInvite|null}>();
  const combined=[...invites.sent,...invites.received].filter(i=>i.status==="pending"||i.status==="accepted").sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  for(const invite of combined){
   const otherId=invite.fromPlayer.id===userPlayerId?invite.toPlayer.id:invite.fromPlayer.id;
   if(map.has(otherId))continue;
   const status:CardStatus=invite.status==="accepted"?"accepted":invite.fromPlayer.id===userPlayerId?"pendingSent":"pendingReceived";
   map.set(otherId,{status,invite});
  }
  return map;
 },[invites,userPlayerId]);
 const activeOpponent=useMemo(()=>inviteFor?[...shortlist,...browseList].find(o=>o.member.id===inviteFor)??null:null,[inviteFor,shortlist,browseList]);
 /* One pass over the inbox, re-derived on every poll so a slot that has just finished moves itself
    from "upcoming" into "needs a result" without the member reloading anything. `recommendationNow`
    is deliberately not used here — that is pinned at mount to keep the shortlist stable, whereas
    these buckets are about the clock actually moving. */
 const buckets=useMemo(()=>partitionInvites({sent:invites.sent,received:invites.received,playerId:userPlayerId??"",matches,now:tick}),[invites,userPlayerId,matches,tick]);
 const confirmedMatches=buckets.upcoming;
 const {mine:myOpenCalls,others:claimableCalls}=useMemo(()=>partitionOpenCalls(openCalls,userPlayerId,tick),[openCalls,userPlayerId,tick]);
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
    actions:[
     {label:"婉拒",tone:"secondary" as const,onClick:()=>void respondToInvite(invite.id,"decline")},
     {label:"改時間",tone:"secondary" as const,onClick:()=>setCounterFor(invite)},
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
 const refreshOpenCalls=async()=>{
  try{const r=await fetch("/api/open-calls");const b=await r.json();if(r.ok)setOpenCalls(b.calls??[]);}catch{/* a failed background refresh leaves the last known calls on screen */}
 };
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
   try{const r=await fetch("/api/open-calls");const b=await r.json();if(!cancelled&&r.ok)setOpenCalls(b.calls??[]);}catch{/* same: last known calls stay on screen */}
   /* An offer is time-critical in a way an invite is not — it exists because two people are free
      *now-ish* — so it rides the same 30-second poll rather than waiting for a reload. */
   if(userPlayerId)try{const r=await fetch("/api/offers");const b=await r.json();if(!cancelled&&r.ok)setOffers(b.offers??[]);}catch{/* last known offers stay on screen */}
  }
  void poll();
  const id=window.setInterval(()=>{if(document.visibilityState==="visible")void poll()},30000);
  return()=>{cancelled=true;window.clearInterval(id)};
 },[userPlayerId]);
 /* Reliability changes over weeks, not seconds, so it is fetched once per mount rather than polled —
    and it arrives before first paint of the shortlist so the ranking never visibly reshuffles. */
 useEffect(()=>{
  let cancelled=false;
  void (async()=>{try{const r=await fetch("/api/matchmaking/summary");const b=await r.json();if(!cancelled&&r.ok)setReliability(b.reliability??{})}catch{/* ranking falls back to neutral signals */}})();
  return()=>{cancelled=true};
 },[]);
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
 /* --- Open calls ---------------------------------------------------------- */
 const postOpenCall=async()=>{
  if(postingCall)return;
  let interval:Interval;
  /* `validateAvailabilityInterval` throws in English for the server's benefit; every string a member
     reads in this app is Traditional Chinese, so the reason is restated rather than passed through. */
  try{interval=validateAvailabilityInterval(composeAvailabilityInterval(date,callStart,callEnd));}
  catch{setMessage("請揀一個未開始、香港時間上午 10 時至翌日凌晨 2 時之間的時段。");return;}
  setPostingCall(true);setMessage("");
  try{
   const r=await fetch("/api/open-calls",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({startAt:interval.startAt,endAt:interval.endAt,message:callMessage,venue:callVenue})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"開放邀請未能發出，請再試一次。");return;}
   trackAvailabilityEvent("matchmaking_open_call_post");
   setCallComposerOpen(false);setCallMessage("");setCallVenue("");await refreshOpenCalls();setMessage("開放邀請已發出，得閒嘅球友會收到通知。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setPostingCall(false)}
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
 const withdrawCall=async(id:string)=>{
  if(withdrawingCallId)return;
  setWithdrawingCallId(id);setMessage("");
  try{
   const r=await fetch(`/api/open-calls/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"cancel"})});
   const b=await r.json();
   if(!r.ok){setMessage(b.error??"未能收回，請再試一次。");return;}
   await refreshOpenCalls();setMessage("已收回開放邀請。");
  }catch{setMessage("網絡連線失敗，請再試一次。")}
  finally{setWithdrawingCallId(null)}
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
 useEffect(()=>{if(!pending&&!leaveTo&&!confirmClear)return;const previous=document.activeElement as HTMLElement|null,dialog=dialogRef.current,focusable=dialog?Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')):[];focusable[0]?.focus();function onKey(ev:KeyboardEvent){if(ev.key==="Escape"){setPending(null);setLeaveTo(null);setConfirmClear(false);return}if(ev.key==="Tab"&&focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}}}document.addEventListener("keydown",onKey);return()=>{document.removeEventListener("keydown",onKey);previous?.focus()}},[pending,leaveTo,confirmClear]);
 return <section className="availability-page">
<section className="hero small availability-hero"><div><p className="kicker">MATCHMAKING</p><h1>約一局</h1><p>公開你嘅空閒時間，快速搵到啱傾嘅球友。</p></div></section>
<nav className="availability-tabs" aria-label="配對功能" role="tablist"><button role="tab" aria-selected={view==="find"} className={view==="find"?"active":""} onClick={()=>nav("find")}><span className="availability-tab-label">搵對手</span>{userPlayerId&&queueItems.length>0&&<span className="availability-tab-count is-alert">{queueItems.length}</span>}</button>{userPlayerId&&<button role="tab" aria-selected={view==="manage"||view==="create"} className={view==="manage"||view==="create"?"active":""} onClick={()=>nav("manage")}><span className="availability-tab-label">我的時段</span>{own.length>0&&<span className="availability-tab-count">{own.length}</span>}</button>}<button role="tab" aria-selected={view==="tournaments"} className={view==="tournaments"?"active":""} onClick={()=>nav("tournaments")}><span className="availability-tab-label">報名盃賽</span>{openTournaments.length>0&&<span className="availability-tab-count">{openTournaments.length}</span>}</button></nav>
{message&&<p key={message} className="availability-notice" role="status">{message}</p>}
{view==="tournaments"&&<section className="availability-card tournament-directory"><header><p className="kicker">SCAA CUP</p><h2>報名盃賽</h2><small>選擇想參加的會友盃，截止時間前都可以取消報名。</small></header>{openTournaments.length>0?<div className="tournament-directory-list">{openTournaments.map(t=>{const signed=Boolean(userPlayerId&&(t.signups||[]).includes(userPlayerId));const deadline=t.signupDeadline.replace("T"," ");return <article className={`tournament-directory-item${signed?" signed":""}`} key={t.id}><div><b>{t.name}</b><small>報名截止 {deadline}</small><span>{(t.signups||[]).length} 人已報名</span></div>{userPlayerId?<button type="button" className={signed?"secondary":"primary"} onClick={()=>onSignUpTournament?.(t.id)}>{signed?"取消報名":"報名"}</button>:<a className="secondary" href="/login">登入後報名</a>}</article>})}</div>:<p className="mm-note">暫時未有可報名的會友盃。</p>}</section>}
{view==="find"&&<>
{/* ZONE 1 — "Am I playing?" Answered first, and only about what is settled: what still needs an
    answer belongs to the queue below, and surfacing the top of that queue here as well (as the old
    status card did, with a 「全部列於下方」 footnote) made one obligation look like two. */}
<NextUpCard signedIn={Boolean(userPlayerId)} slotCount={own.length}
  game={confirmedMatches[0]?{id:confirmedMatches[0].id,startAt:confirmedMatches[0].startAt,endAt:confirmedMatches[0].endAt,venue:confirmedMatches[0].venue,
    opponent:confirmedMatches[0].fromPlayer.id===userPlayerId?confirmedMatches[0].toPlayer:confirmedMatches[0].fromPlayer}:null}
  others={Math.max(0,confirmedMatches.length-1)}
  onRecord={(opponentId,startAt)=>onRecordMatch?.(opponentId,hkDate(new Date(startAt)))}
  onCancel={id=>void cancelInviteAction(id)} cancelling={Boolean(cancellingInviteId)}
  onEditSlots={()=>nav(own.length?"manage":"create")}
  onFreeNow={result=>{
    void Promise.all([reloadOwn(),refreshFind(),refreshOpenCalls(),refreshOffers()]);
    setMessage(result.offers?`已公開你嘅時間，仲問咗 ${result.offers} 位夾得到嘅球友。`:"已公開你嘅時間，全會所都睇到你想打波。");
  }}/>
{userPlayerId&&<PushOptIn/>}
{/* ZONE 2 — everything waiting on this member, as one list. */}
{userPlayerId&&<ResponseQueue items={queueItems}/>}
{userPlayerId&&<WaitingStrip items={waitingItems} cancellingId={cancellingInviteId} onCancel={id=>void cancelInviteAction(id)}/>}
{/* ZONE 3 — one place to go looking, with three ways to look, instead of three stacked sections
    each re-asking for the same screen space. */}
<section className="availability-card mm-card find-section" aria-label="搵人打波">
 <CardHead title="搵人打波" hint={findView==="suggested"?"已按共同空檔、ELO、近期交手同回覆習慣排序":findView==="calls"?"任何人都可以接受，先到先得":"自己揀時間同對手"}
   aside={userPlayerId&&findView==="calls"?<button type="button" className="more" onClick={()=>setCallComposerOpen(open=>{if(!open){const t=defaultProposalTimes(date);setCallStart(t.start);setCallEnd(t.end)}return !open})}>{callComposerOpen?"收起":"貼開放邀請"}</button>:undefined}/>
 <div className="mm-segmented" role="tablist" aria-label="搵人方式">
  {([["suggested","建議對手",activeList.length],["calls","開放邀請",claimableCalls.length+myOpenCalls.length],["board","全部空檔",members.length]] as [FindView,string,number][]).map(([id,label,count])=>
   <button type="button" key={id} role="tab" aria-selected={findView===id} className={findView===id?"active":""} onClick={()=>setFindView(id)}>
    {label}{count>0&&<i>{count}</i>}
   </button>)}
 </div>
 {findView!=="calls"&&<DateScroller dates={week} selected={date} counts={counts} onSelect={changeDate}/>}
 {loading&&findView!=="calls"
  ?<div className="availability-skeleton" aria-hidden="true"/>
  :<>
   {findView==="suggested"&&(activeList.length
   ?<><div className="match-stack-list">{activeList.slice(0,5).map((o,i)=><OpponentCard key={o.member.id} opponent={o} rank={i+1} onPlayer={onPlayer} cardStatus={inviteStatusById.get(o.member.id)??{status:"none",invite:null}} onInvite={openInviteSheet} onCancelInvite={cancelInviteAction}/>)}</div>
      {isBrowseTier&&<p className="mm-note">暫時未有重疊時段 — 你仍然可以直接提議時間。</p>}</>
    :<MatchPrompt hasMine={mine.length>0} userPlayerId={userPlayerId} members={members.length} focus={focus} onManage={nav}/>)}
   {findView==="calls"&&<>
    {callComposerOpen&&userPlayerId&&<div className="open-call-composer availability-slot-form">
     <div className="composer-times">
      <label><span>開始時間</span><select value={callStart} onChange={e=>setCallStart(e.target.value)}>{PROPOSE_START_TIMES.map(v=><option key={v}>{v}</option>)}</select></label>
      <label><span>結束時間</span><select value={callEnd} onChange={e=>setCallEnd(e.target.value)}>{PROPOSE_END_TIMES.map(v=><option key={v}>{v}{v<=callStart?" · 次日":""}</option>)}</select></label>
     </div>
     <VenueField value={callVenue} onChange={setCallVenue}/>
     <label className="invite-message-field"><span>留言（可選）</span><textarea rows={2} maxLength={300} value={callMessage} placeholder="例如：訂咗枱，有冇人一齊打？" onChange={e=>setCallMessage(e.target.value)}/></label>
     <p className="availability-form-hint">{dayLabel(date)} · 任何會員都可以接受，接受後即成為已確認對局。得閒嘅球友會收到通知。</p>
     <div className="availability-form-actions">
      <button type="button" className="primary publish-button" disabled={postingCall} aria-busy={postingCall} onClick={()=>void postOpenCall()}>{postingCall&&<i className="button-spinner" aria-hidden="true"/>}<span>{postingCall?"發出中…":`發出 · ${callStart}–${callEnd}`}</span></button>
      <button type="button" className="secondary" onClick={()=>setCallComposerOpen(false)}>取消</button>
     </div>
    </div>}
    {myOpenCalls.length===0&&claimableCalls.length===0
     ?<p className="mm-note">暫時未有開放邀請。{userPlayerId?"你可以做第一個 — 貼一個時段，全會所都睇到。":"登入後即可貼出。"}</p>
     :<ul className="open-call-list">
       {myOpenCalls.map(call=><OpenCallCard key={call.id} call={call} mine onClaim={()=>{}} onWithdraw={()=>void withdrawCall(call.id)} busy={withdrawingCallId===call.id} canClaim={false}/>)}
       {claimableCalls.map(call=><OpenCallCard key={call.id} call={call} mine={false} onClaim={()=>void claimCall(call.id)} onWithdraw={()=>{}} busy={claimingCallId===call.id} canClaim={Boolean(userPlayerId)}/>)}
      </ul>}
   </>}
   {findView==="board"&&(members.length
    ?<AvailabilityGrid members={members} mine={mine} date={date} lo={rosterRange.lo} hi={rosterRange.hi} userPlayerId={userPlayerId} focus={focus} onFocus={setFocus} highlightId={jumpTo?.playerId} onPlayer={onPlayer}/>
    :<p className="mm-note">呢日暫時未有人公開時段。</p>)}
  </>}
</section>
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
      <div className="tournament-actions-inline">{tournaments.map(t=>{const signed=Boolean(userPlayerId&&(t.signups||[]).includes(userPlayerId));return <button key={t.id} type="button" className={`secondary tournament-action${signed?" signed":""}`} onClick={()=>onSignUpTournament?.(t.id)}>{signed?`取消 ${t.name}`:`報名 ${t.name}`}</button>})}</div>
   </div>}
   {adjustment&&<div className="slot-confirm-actions"><button type="button" className="secondary" disabled={confirmingChange} onClick={()=>dropAdjustment(active.key)}>取消變更</button><button type="button" className="primary publish-button" disabled={confirmingChange} aria-busy={confirmingChange} onClick={()=>void confirmNudge()}>{confirmingChange&&<i className="button-spinner" aria-hidden="true"/>}<span>{confirmingChange?"儲存中…":"確認變更"}</span></button></div>}
 </section>}
 {uncommitted.length>0&&<div className="draft-bar" role="status"><div><b>{[pendingKeys.length?`${pendingKeys.length} 個變更`:"",draft.length?`${draft.length} 個新時段`:""].filter(Boolean).join(" · ")}未儲存</b>
   <span>{uncommitted.map(x=>`${dayLabel(hkDate(new Date(x.startAt)))} ${range(x)}`).join("、")}</span></div>
  <div><button className="secondary" disabled={saving} onClick={()=>{setAdjustments({});setDraft([]);setSelected(null)}}>{pendingKeys.length?"全部還原":"清除"}</button>
   <button className="primary publish-button" disabled={saving} aria-busy={saving} onClick={()=>void commitAll()}>{saving&&<i className="button-spinner" aria-hidden="true"/>}<span>{saving?"儲存中…":pendingKeys.length&&draft.length?"儲存並發佈":draft.length?"發佈":"儲存變更"}</span></button></div></div>}
 {/* Sits under the board rather than beside it: painting is how a member starts, and a rule is what
     they reach for once they notice they are painting the same evening every week. */}
 <RecurrenceEditor rules={rules} busy={rulesBusy} onAdd={input=>void addRule(input)} onRemove={id=>void removeRule(id)} onCopyLastWeek={()=>void copyLastWeek()}/>
 {/* Lives with the member's own settings rather than in the busy find tab: turning a channel off is
     a considered decision, not something anyone does mid-search. */}
 <NotificationPrefsPanel/>
 <PushOptIn/>
 <details className="board-precise"><summary>用選單精確加入時段</summary><SlotComposer initialDate={date} onSave={x=>{setDraft(a=>mergeIntervals([...a,x]));setMessage("");trackAvailabilityEvent("availability_slot_draft_add")}}/></details>
</section>}
{confirmClear&&<div className="availability-dialog-backdrop" onMouseDown={()=>!clearing&&setConfirmClear(false)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>刪除全部時段</small><h2 id="clear-title">刪除全部 {own.length} 個時段？</h2><p>所有已公開的時段都會被取消，其他球員將不會再看到你的空檔。此操作無法復原。</p><div><button className="secondary" disabled={clearing} onClick={()=>setConfirmClear(false)}>保留時段</button><button className="danger cancel-button" disabled={clearing} aria-busy={clearing} onClick={()=>void clearAll()}>{clearing&&<i className="button-spinner" aria-hidden="true"/>}<span>{clearing?"刪除中…":`刪除全部 ${own.length} 個`}</span></button></div></section></div>}
{leaveTo&&<div className="availability-dialog-backdrop" onMouseDown={()=>setLeaveTo(null)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>未儲存的變更</small><h2 id="leave-title">離開後變更會消失</h2><p>{[pendingKeys.length?`${pendingKeys.length} 個時段變更`:"",draft.length?`${draft.length} 個新時段`:""].filter(Boolean).join("、")}尚未儲存。離開後這些變更不會保留。</p><div><button className="secondary" onClick={()=>setLeaveTo(null)}>留在此頁</button><button className="primary publish-button" disabled={saving} aria-busy={saving} onClick={()=>{const next=leaveTo;setLeaveTo(null);void commitAll().then(()=>go(next))}}>{saving&&<i className="button-spinner" aria-hidden="true"/>}<span>儲存後離開</span></button><button className="danger" onClick={()=>{const next=leaveTo;discard();setLeaveTo(null);go(next)}}>捨棄變更</button></div></section></div>}
{pending&&<div className="availability-dialog-backdrop" onMouseDown={()=>setPending(null)}><section className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" ref={dialogRef as never} onMouseDown={e=>e.stopPropagation()}><small>取消可配對時段</small><h2 id="cancel-title">{dayLabel(hkDate(new Date(pending.startAt)))} {range(pending)}</h2><p>取消後，這段時間不會再出現在其他球員的配對結果中。</p><div><button className="secondary" disabled={cancelling} onClick={()=>setPending(null)}>保留時段</button><button className="danger cancel-button" disabled={cancelling} aria-busy={cancelling} onClick={()=>void cancel()}>{cancelling&&<i className="button-spinner" aria-hidden="true"/>}<span>{cancelling?"取消中…":"確認取消"}</span></button></div></section></div>}
{inviteFor&&activeOpponent&&<InviteSheet opponent={activeOpponent} mode={inviteMode} onModeChange={setInviteMode} selectedWindow={selectedWindow} onSelectWindow={setSelectedWindow} proposeStart={proposeStart} proposeEnd={proposeEnd} onProposeStart={setProposeStart} onProposeEnd={setProposeEnd} dateLabel={dayLabel(date)} message={inviteMessage} onMessageChange={setInviteMessage} venue={inviteVenue} onVenueChange={setInviteVenue} onSend={()=>void sendInviteAction()} onClose={closeInviteSheet} sending={sendingInvite} sendLabel={inviteMode==="simple"?(selectedWindow?`送出邀請 · ${range(selectedWindow)}`:"請先揀時段"):`提議 ${proposeStart}–${proposeEnd}`}/>}
{counterFor&&<CounterSheet title={(counterFor.fromPlayer.id===userPlayerId?counterFor.toPlayer:counterFor.fromPlayer).name} date={hkDate(new Date(effectiveSlot(counterFor).startAt))} busy={counteringId===counterFor.id} onClose={()=>setCounterFor(null)} onSubmit={input=>void sendCounter(input)}/>}
</section>}
