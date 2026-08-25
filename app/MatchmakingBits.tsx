"use client";
import { useCallback, useEffect, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { BackdropSheet } from "./components/ui/Overlay";
import { Button, IconButton, SegmentedControl } from "./components/ui/Primitives";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { hkClock, hkDate, hkDayLabel, type Interval, type ReliabilitySignals } from "../lib/availability";

const range=(x:Interval)=>`${hkClock(x.startAt)}–${hkClock(x.endAt)}`;
const day=(iso:string)=>hkDayLabel(hkDate(new Date(iso)));
export const slotLabel=(x:Interval)=>`${day(x.startAt)} · ${range(x)}`;
/** "今晚 19:30" rather than "8月5日(三) 19:30" for anything happening today. A member reading a
    recommendation for tonight should not have to parse a date to notice it is tonight. */
export const gameLabel=(x:Interval)=>
  hkDate(new Date(x.startAt))===hkDate()?`今晚 ${range(x)}`:slotLabel(x);

/** The one card header in the matchmaking tab.
 *
 *  Previously every section invented its own: `.availability-grid-head` with an h3, `.availability-
 *  day-head` with an h2, `.match-stack-head` with a count, the status card with its own kicker. Four
 *  visual grammars on one screen made the page read as four different products bolted together.
 *  One component, one shape, everywhere. */
export function CardHead({title,hint,aside}:{title:string;hint?:string;aside?:React.ReactNode}){
  return <header className="mm-head">
    <div><h3>{title}</h3>{hint&&<small>{hint}</small>}</div>
    {aside&&<div className="mm-head-aside">{aside}</div>}
  </header>;
}


const DURATIONS=[{minutes:60,label:"1 小時"},{minutes:90,label:"1.5 小時"},{minutes:120,label:"2 小時"},{minutes:180,label:"3 小時"},{minutes:240,label:"4 小時"}];
export const VENUE_CHIPS=["已訂枱","未訂枱","1 號枱","2 號枱","3 號枱"];

export function VenueField({value,onChange,label="枱／地點（可省略）"}:{value:string;onChange:(value:string)=>void;label?:string}){
  return <div className="venue-field">
    <label><span>{label}</span><input type="text" maxLength={60} value={value} placeholder="例如：已訂 3 號枱" onChange={event=>onChange(event.target.value)}/></label>
    <div className="venue-chips">{VENUE_CHIPS.map(chip=>
      <button type="button" key={chip} className={value===chip?"active":""} onClick={()=>onChange(value===chip?"":chip)}>{chip}</button>)}</div>
  </div>;
}

/** The one-tap answer to the job this app is asked to do most: it is tonight, I am free, find me a game.
 *
 *  Everything is pre-filled and the button is always live — the member should be able to reach "the
 *  club now knows I want a game" in a single tap, and only open the details if they want to change
 *  something. That is the whole difference from the old flow, which required painting a slot on a
 *  calendar before anything at all happened. */
export function FreeNowPanel({onDone,disabled}:{onDone:(result:{offers:number;broadcast:boolean})=>void;disabled?:boolean}){
  const [open,setOpen]=useState(false);
  const [minutes,setMinutes]=useState(120);
  const [venue,setVenue]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const go=async()=>{
    if(busy)return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/availability/now",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({minutes,venue,message})});
      const body=await response.json();
      if(!response.ok){setError(body.error??"暫時未能發出，請再試一次。");return}
      trackAvailabilityEvent("matchmaking_free_now",{minutes,offers:body.offers??0});
      setOpen(false);setMessage("");
      onDone({offers:body.offers??0,broadcast:Boolean(body.call)});
    }catch{setError("網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  };
  return <div className="free-now-panel">
    <SegmentedControl label="打幾耐" value={String(minutes)} onChange={value=>setMinutes(Number(value))}
      items={DURATIONS.map(item=>({value:String(item.minutes),label:item.label}))}/>
    <Button variant="primary" className="free-now-button" disabled={busy||disabled} aria-busy={busy} onClick={()=>void go()}>
      {busy&&<i className="button-spinner" aria-hidden="true"/>}
      <span>{busy?"發緊…":`我而家得閒 · ${minutes/60} 小時`}</span>
    </Button>
    <Button variant="quiet" className="free-now-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?"收起":"加枱位或留言"}</Button>
    {open&&<div className="free-now-details">
      <VenueField value={venue} onChange={setVenue}/>
      <label className="invite-message-field"><span>留言（可省略）</span>
        <textarea rows={2} maxLength={300} value={message} placeholder="例如：訂咗枱，隨時開波" onChange={event=>setMessage(event.target.value)}/></label>
    </div>}
    {error&&<p className="availability-form-error" role="alert">{error}</p>}
  </div>;
}

/* --- Intent ----------------------------------------------------------------
 *
 * "得閒" and "想打" are different questions. The find tab already answers the first one (the grid,
 * the shortlist); this answers the second, and it sits on the result rather than gating it — a
 * member who never touches this still sees a shortlist, just one that cannot yet say "佢正想搵局"
 * about anyone. Principle 01 (意圖先於功能) without principle 02's mistake of putting a form in
 * front of the screen a member actually came for. */

export type IntentState={id:string;kind:"tonight"|"window"|"standby";expiresAt:string}|null;

/** The cold open. One question, then the answer immediately underneath it.
 *
 *  This is the whole top of the idle screen, not a strip bolted onto one — asking "想打波？" *is* the
 *  page's job, so it gets the headline rather than a band above the real content. The two buttons
 *  are the only navigation the screen has; everything else on it is already an answer. */
export function IntentAsk({onPost,busy,todayLabel}:{onPost:(kind:"tonight"|"window")=>void;busy:boolean;todayLabel:string}){
  return <section className="mm-ask" aria-label="想唔想打波">
    <h2>想打波？</h2>
    <p>話畀會所知，我哋即刻幫你搵夾得到嘅對手。</p>
    <div className="mm-ask-actions">
      <Button disabled={busy} onClick={()=>onPost("tonight")}>今晚<small>{todayLabel}</small></Button>
      <Button variant="secondary" disabled={busy} onClick={()=>onPost("window")}>呢個星期</Button>
    </div>
  </section>;
}

/* --- One game, one card ----------------------------------------------------
 *
 * The old card opened with a rank number, an avatar and an ELO line, and put the time third. That is
 * identity-first: it answers "who is this person" before "what am I being offered". A member is not
 * shopping for an opponent, they want a game — so the time leads, the person qualifies it, and the
 * reasons are the smallest thing on the card rather than a row of four chips competing for the eye.
 *
 * The button says what will happen ("約佢 · 今晚 7:30"), not which subsystem it calls ("邀請對局"). */

export type PlayableCardKind="claim"|"keen"|"overlap";
export type PlayableCardVM={
  key:string; kind:PlayableCardKind; slot:Interval;
  person:{id:string;name:string;short?:string|null;colour?:string|null;avatar?:string|null;rating?:number};
  difference:number; venue?:string; message?:string;
  /** At most two. Three or more stops being a reason and becomes a wall. */
  reasons:string[];
};

const KIND_TAG:Record<PlayableCardKind,string>={claim:"一撳即成 · 開咗枱",keen:"佢今晚都想打",overlap:"夾到時間"};

export function PlayableCard({item,onAct,onOpen,busy,actionLabel,sent,onUndo,onCustomise}:{
  item:PlayableCardVM; onAct:()=>void; onOpen?:(playerId:string)=>void; busy?:boolean;
  actionLabel:string;
  /** After a one-tap send, the card holds its place and offers the way back rather than vanishing. */
  sent?:boolean; onUndo?:()=>void;
  /** Picking a different time or adding a note stays available — beside the primary action, never in
      front of it. The member who wants the old form can still have it; nobody is made to fill one. */
  onCustomise?:()=>void;
}){
  const open=()=>onOpen?.(item.person.id);
  return <article className={`mm-play is-${item.kind}${sent?" is-sent":""}`}>
    <span className={`mm-play-tag is-${item.kind}`}>{KIND_TAG[item.kind]}</span>
    <p className="mm-play-when">{gameLabel(item.slot)}</p>
    <div className="mm-play-who">
      <button type="button" className="mm-play-person" onClick={open} disabled={!onOpen}>
        <PlayerBadge player={item.person}/>
        <span><b>{item.person.name}</b><small>相差 {Math.round(item.difference)} ELO{item.venue?` · ${item.venue}`:""}</small></span>
      </button>
    </div>
    {item.message&&<p className="mm-play-msg">{item.message}</p>}
    {item.reasons.length>0&&!sent&&<ul className="mm-play-why">{item.reasons.slice(0,2).map(reason=>
      <li key={reason}>{reason}</li>)}</ul>}
    {sent
      ?<div className="mm-play-sent" role="status">
        <span>已送出</span>
        {onUndo&&<Button variant="quiet" className="mm-play-undo" onClick={onUndo}>收回</Button>}
      </div>
      :<div className="mm-play-actions">
        <Button variant="primary" className="mm-play-go" disabled={busy} aria-busy={busy} onClick={onAct}>
          {busy&&<i className="button-spinner" aria-hidden="true"/>}<span>{actionLabel}</span>
        </Button>
        {onCustomise&&<Button variant="quiet" className="mm-play-alt" onClick={onCustomise}>改時間／加留言</Button>}
      </div>}
  </article>;
}

/* --- Searching -------------------------------------------------------------
 *
 * The state the old design gave the least room to and a member feels the most: I have done my part,
 * and now I am waiting with no idea whether anything is happening. A collapsed one-line strip reads
 * as "nothing here". So this says what the club actually did on their behalf, and — more importantly
 * — offers the ways to widen the net without making the member feel they have to start over. */

export function SearchingCard({asked,seen,exits,onWithdraw,busy}:{
  asked:number; seen:number; exits:React.ReactNode; onWithdraw:()=>void; busy:boolean;
}){
  const progress=asked?Math.min(100,Math.round((seen/Math.max(asked,1))*100)):0;
  return <section className="availability-card mm-card mm-searching" aria-label="搵緊對手">
    <CardHead title="搵緊你嘅對手" hint="有人應承就即刻通知你。"/>
    <div className="mm-searching-state">
      <div className="mm-prog" role="img" aria-label={`${asked} 位球友收到，${seen} 位睇咗`}>
        <i style={{width:`${Math.max(progress,asked?8:0)}%`}}/>
      </div>
      <p className="mm-searching-copy">
        {asked>0
          ?<><b>{asked} 位</b>夾得到嘅球友收到咗{seen>0&&<> · <b>{seen} 位</b>睇咗</>}</>
          :<>已話畀會所知你想打波。</>}
      </p>
    </div>
    <div className="mm-exits">{exits}</div>
    <Button variant="quiet" className="mm-withdraw" disabled={busy} onClick={onWithdraw}>收回，暫時唔打住</Button>
  </section>;
}

/* --- Nothing matched -------------------------------------------------------
 *
 * An empty market is where a member decides the club is dead and stops opening the app, so it must
 * never be only a statement of fact. Three ways out, ordered by how little they cost: the one that
 * needs no follow-up at all, the one that is a single tap, and the one that asks for a real decision
 * — but names the night worth picking, because "add another slot" is a chore and "add Friday, 8
 * people are free" is a reason. */

export type Exit={label:string;hint?:string;tone:"primary"|"secondary";onClick:()=>void};

export function ExitList({exits}:{exits:Exit[]}){
  return <>{exits.map(exit=>
    <Button variant={exit.tone} key={exit.label} className="mm-exit" onClick={exit.onClick}>
      <b>{exit.label}</b>{exit.hint&&<small>{exit.hint}</small>}
    </Button>)}</>;
}

/* --- The response queue --------------------------------------------------- */

export type QueueAction={label:string;tone:"primary"|"secondary";onClick:()=>void};
export type QueueItem={
  id:string; kind:"result"|"invite"|"offer";
  person:{id:string;name:string;short?:string|null;colour?:string|null;avatar?:string|null};
  startAt:string; endAt:string; venue?:string;
  /** The one line that explains why this is in front of the member. */
  reason:string;
  /** Free text the other member wrote, or the original time a counter replaced. */
  note?:string;
  busy?:boolean; actions:QueueAction[];
};

/** Everything waiting on this member, as one list.
 *
 *  This replaces four separate sections — the offers card, the follow-up card, the invite inbox and
 *  the first-invite slot inside the status card — that all meant the identical thing: *you owe
 *  somebody an answer*. Splitting them by internal record type was a database schema leaking into
 *  the interface. A member does not think "I have one offer, two invites and a result to confirm";
 *  they think "there are three things to deal with", and they want them in the order they should be
 *  dealt with, in one place, with the buttons on each row.
 *
 *  Ordering is by urgency, not by type: a game that already happened needs an answer before a game
 *  being proposed for next week. */
export function ResponseQueue({items}:{items:QueueItem[]}){
  if(!items.length)return null;
  return <section className="availability-card mm-card is-attention" aria-label="等你回覆">
    <CardHead title="等你回覆" hint="處理完呢度，就冇嘢等緊你。" aside={<span className="mm-count">{items.length}</span>}/>
    <ul className="mm-rows">{items.map(item=>
      <li key={item.id} className={`mm-row is-${item.kind}`}>
        <PlayerBadge player={item.person}/>
        <div className="mm-row-copy">
          <b>{item.person.name}</b>
          <small>{slotLabel(item)}{item.venue?` · ${item.venue}`:""}</small>
          <em>{item.reason}</em>
          {item.note&&<p>{item.note}</p>}
        </div>
        <div className="mm-row-actions">{item.actions.map(action=>
          <Button variant={action.tone} key={action.label} disabled={item.busy} onClick={action.onClick}>{action.label}</Button>)}
        </div>
      </li>)}
    </ul>
  </section>;
}

/* --- Next game ------------------------------------------------------------ */

export type ConfirmedGame={id:string;startAt:string;endAt:string;venue?:string;opponent:{id:string;name:string;short?:string|null;colour?:string|null;avatar?:string|null}};

/** "Am I playing?" — answered before anything else on the screen, in one card.
 *
 *  Deliberately does *not* also show what needs answering: that is the queue's job, and the previous
 *  design's habit of surfacing the top pending invite here and then repeating it below (with a
 *  「仲有 N 個…全部列於下方」 footnote) made one obligation look like two. This card is only about
 *  what is settled; when nothing is settled it becomes the fastest way to change that. */
export function NextUpCard({game,others,onRecord,onCancel,cancelling,onFreeNow,onEditSlots,slotCount,signedIn}:{
  game:ConfirmedGame|null; others:number;
  onRecord:(opponentId:string,startAt:string)=>void; onCancel:(id:string)=>void; cancelling:boolean;
  onFreeNow:(result:{offers:number;broadcast:boolean})=>void; onEditSlots:()=>void;
  slotCount:number; signedIn:boolean;
}){
  if(!signedIn)return <section className="availability-card mm-card">
    <CardHead title="登入後即可約戰" hint="連結球員檔案，就可以公開時間、收邀請同接受開枱。"/>
  </section>;
  if(game)return <section className="availability-card mm-card is-confirmed">
    <CardHead title="你嘅下一局" aside={others>0?<span className="mm-count">再 +{others}</span>:undefined}/>
    <div className="next-up">
      <PlayerBadge player={game.opponent}/>
      <div className="next-up-copy">
        <b>{game.opponent.name}</b>
        <small>{slotLabel(game)}{game.venue?` · ${game.venue}`:""}</small>
      </div>
      <div className="mm-row-actions">
        <Button onClick={()=>onRecord(game.opponent.id,game.startAt)}>記錄比分</Button>
        <Button variant="secondary" disabled={cancelling} onClick={()=>onCancel(game.id)}>取消</Button>
      </div>
    </div>
  </section>;
  return <section className="availability-card mm-card is-idle">
    <CardHead title="而家得閒？" hint="一撳就公開你嘅時間、開一張全會所睇到嘅枱，同埋問夾得到嘅球友。"
      aside={<Button variant="quiet" onClick={onEditSlots}>{slotCount?`我嘅時段 · ${slotCount}`:"排定期時段"}</Button>}/>
    <FreeNowPanel onDone={onFreeNow}/>
  </section>;
}

/** The low-priority tail: things I have done my part on and am now waiting for somebody else on.
    Collapsed by default because it is information, not work. */
export type WaitingItem={id:string;name:string;label:string;cancellable:boolean};
export function WaitingStrip({items,onCancel,cancellingId}:{items:WaitingItem[];onCancel:(id:string)=>void;cancellingId:string|null}){
  const [open,setOpen]=useState(false);
  if(!items.length)return null;
  return <div className="waiting-strip">
    <Button variant="quiet" className="waiting-strip-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span>等緊 {items.length} 位球友回覆</span><i aria-hidden="true">{open?"▲":"▼"}</i>
    </Button>
    {open&&<ul>{items.map(item=>
      <li key={item.id}><span><b>{item.name}</b><small>{item.label}</small></span>
        {item.cancellable&&<Button variant="secondary" disabled={cancellingId===item.id} onClick={()=>onCancel(item.id)}>取消邀請</Button>}</li>)}
    </ul>}
  </div>;
}


/* --- Reliability ---------------------------------------------------------- */

/** Turn behaviour into words a member can act on.
 *
 *  Only ever positive or neutral, and never a raw percentage: "回覆好快" helps you choose; "接受率
 *  38%" is a public scoreboard of how often someone turns people down, which would make members stop
 *  declining honestly — the opposite of what the data is for. */
export function reliabilityChips(signals?:ReliabilitySignals){
  if(!signals)return [];
  const chips:string[]=[];
  if(signals.responseHours!==undefined&&signals.responseHours<=2)chips.push("回覆好快");
  if(signals.acceptRate!==undefined&&signals.acceptRate>=.6)chips.push("多數會應約");
  if(signals.showRate!==undefined&&signals.showRate>=.8)chips.push("準時出現");
  return chips;
}

/* --- Counter-proposal ----------------------------------------------------- */

const TIMES=Array.from({length:32},(_,index)=>`${String(10+Math.floor(index/2)).padStart(2,"0")}:${index%2?"30":"00"}`);

/** "Not then — how about this instead?"
 *
 *  Presented as the equal of accepting rather than hidden behind 婉拒, because the common truth is
 *  "I want to play, just not at 19:00" and the old UI had no way to say it. */
export function CounterSheet({title,date,onSubmit,onClose,busy}:{title:string;date:string;onSubmit:(input:{date:string;start:string;end:string;venue:string})=>void;onClose:()=>void;busy:boolean}){
  const [when,setWhen]=useState(date);
  const [start,setStart]=useState("19:00");
  const [end,setEnd]=useState("21:00");
  const [venue,setVenue]=useState("");
  return <BackdropSheet onClose={onClose} labelledBy="counter-title">
      <p className="kicker">提議另一個時間</p>
      <h2 id="counter-title">{title}</h2>
      <p className="sub">唔使拒絕 — 直接提議一個就得嘅時間，對方確認就搞掂。</p>
      <div className="composer-times">
        <label><span>日期</span><input type="date" min={hkDate()} value={when} onChange={event=>setWhen(event.target.value)}/></label>
        <label><span>開始</span><select value={start} onChange={event=>setStart(event.target.value)}>{TIMES.map(time=><option key={time}>{time}</option>)}</select></label>
        <label><span>結束</span><select value={end} onChange={event=>setEnd(event.target.value)}>{TIMES.map(time=><option key={time}>{time}{time<=start?" · 次日":""}</option>)}</select></label>
      </div>
      <VenueField value={venue} onChange={setVenue}/>
      <Button variant="primary" className="full" disabled={busy} onClick={()=>onSubmit({date:when,start,end,venue})}>{busy?"送出中…":`提議 ${start}–${end}`}</Button>
  </BackdropSheet>;
}

/* --- Recurring availability ----------------------------------------------- */

export type RecurrenceRule={id:string;weekday:number;startTime:string;endTime:string};
const WEEKDAYS=["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];

/** Weekly rules, so a regular stops falling off the board every seven days.
 *
 *  A club's regulars are its supply, and the one-shot slot model quietly punished them hardest: the
 *  member who plays every Wednesday had to repaint it every week or silently vanish from everyone's
 *  shortlist. */
export function RecurrenceEditor({rules,onAdd,onRemove,onCopyLastWeek,busy}:{
  rules:RecurrenceRule[];onAdd:(input:{weekday:number;startTime:string;endTime:string})=>void;
  onRemove:(id:string)=>void;onCopyLastWeek:()=>void;busy:boolean;
}){
  const [weekday,setWeekday]=useState(3);
  const [startTime,setStartTime]=useState("19:00");
  const [endTime,setEndTime]=useState("22:00");
  const [open,setOpen]=useState(false);
  return <section className="availability-card recurrence-card">
    <header className="availability-grid-head">
      <div><h3>每週固定時段</h3><small>設定一次，之後每個星期自動公開，唔使再畫。</small></div>
      <Button variant="quiet" onClick={()=>onCopyLastWeek()} disabled={busy}>同上星期一樣</Button>
    </header>
    {rules.length>0&&<ul className="recurrence-list">{rules.map(rule=>
      <li key={rule.id}>
        <span><b>逢{WEEKDAYS[rule.weekday]}</b><small>{rule.startTime}–{rule.endTime}</small></span>
        <IconButton className="card-tool danger" label={`刪除逢${WEEKDAYS[rule.weekday]} ${rule.startTime}–${rule.endTime}`} disabled={busy} onClick={()=>onRemove(rule.id)}>✕</IconButton>
      </li>)}</ul>}
    {open
      ?<div className="recurrence-composer availability-slot-form">
        <div className="composer-times">
          <label><span>星期</span><select value={weekday} onChange={event=>setWeekday(Number(event.target.value))}>{WEEKDAYS.map((label,index)=><option key={label} value={index}>{label}</option>)}</select></label>
          <label><span>開始</span><select value={startTime} onChange={event=>setStartTime(event.target.value)}>{TIMES.map(time=><option key={time}>{time}</option>)}</select></label>
          <label><span>結束</span><select value={endTime} onChange={event=>setEndTime(event.target.value)}>{TIMES.map(time=><option key={time}>{time}{time<=startTime?" · 次日":""}</option>)}</select></label>
        </div>
        <p className="availability-form-hint">未來四星期會自動幫你公開。個別一次唔得閒，照樣可以喺上面個板取消嗰次。</p>
        <div className="availability-form-actions">
          <Button disabled={busy} onClick={()=>{onAdd({weekday,startTime,endTime});setOpen(false)}}>加入每週時段</Button>
          <Button variant="secondary" onClick={()=>setOpen(false)}>取消</Button>
        </div>
      </div>
      :<Button variant="secondary" className="recurrence-add" onClick={()=>setOpen(true)}>＋ 加一個每週時段</Button>}
  </section>;
}

/* --- Club activity, outside the matchmaking tab --------------------------- */

export type TonightSummary={free:number;openCalls:number;openSlots:number};

/** What the club looks like right now, on the screen members actually land on.
 *
 *  Matchmaking used to live entirely behind a tab, so the answer to "is anyone playing tonight?" was
 *  invisible unless you already went looking. This is the hook that gets a member who opened the app
 *  to check their rating into a game. */
export function TonightStrip({summary,onOpen,signedIn}:{summary:TonightSummary|null;onOpen:()=>void;signedIn:boolean}){
  if(!summary||(!summary.free&&!summary.openCalls))return null;
  return <button type="button" className="tonight-strip" onClick={onOpen}>
    <span className="tonight-dot" aria-hidden="true"/>
    <span className="tonight-copy">
      <b>{summary.free?`今晚有 ${summary.free} 位球員得閒`:"今晚有人開緊枱"}</b>
      <small>{summary.openCalls?`${summary.openCalls} 張枱等緊人 · ${signedIn?"撳入去接受":"登入即可接受"}`:signedIn?"撳入去搵對手":"登入即可約戰"}</small>
    </span>
    <span className="tonight-go" aria-hidden="true">›</span>
  </button>;
}

/** Shared poller for the app-shell badge. Kept here rather than in the matchmaking tab because the
    entire point is to reach a member who is somewhere else in the app. */
export function useMatchmakingSummary(signedIn:boolean,intervalMs=60000){
  const [summary,setSummary]=useState<{tonight:TonightSummary;counts:{needsResponse:number;awaitingReply:number;upcoming:number;followUps:number;offers:number;openCalls:number}|null;reliability:Record<string,ReliabilitySignals>}|null>(null);
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch("/api/matchmaking/summary");
      if(response.ok)setSummary(await response.json());
    }catch{/* the badge is an enhancement; a failed poll leaves the last known counts */}
  },[]);
  useEffect(()=>{
    void refresh();
    const id=window.setInterval(()=>{if(document.visibilityState==="visible")void refresh()},intervalMs);
    return ()=>window.clearInterval(id);
  },[refresh,intervalMs,signedIn]);
  return {summary,refresh};
}

/** How many things are actually waiting on this member. Only counts what needs *them* — an invite
    they sent is not a badge, it is somebody else's turn. */
export function actionableCount(counts:{needsResponse:number;offers:number;followUps:number}|null|undefined){
  if(!counts)return 0;
  return counts.needsResponse+counts.offers+counts.followUps;
}
