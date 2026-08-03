"use client";
import { useCallback, useEffect, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { disablePush, enablePush, pushState, registerServiceWorker, type PushState } from "./push-client";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { hkClock, hkDate, hkDayLabel, type Interval, type ReliabilitySignals } from "../lib/availability";

const range=(x:Interval)=>`${hkClock(x.startAt)}–${hkClock(x.endAt)}`;
const day=(iso:string)=>hkDayLabel(hkDate(new Date(iso)));
export const slotLabel=(x:Interval)=>`${day(x.startAt)} · ${range(x)}`;

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

/* --- Notifications -------------------------------------------------------- */

/** The permission ask, deliberately not fired on page load.
 *
 *  A browser prompt that appears before a member understands why is the fastest way to a permanent
 *  "block", and a blocked member cannot be asked again — the club would lose them from every future
 *  invite. So the ask is a card they choose to tap, it states the exact benefit, and it only appears
 *  once the member has a reason to care. Dismissal is remembered locally so it is an ask, not a nag. */
const DISMISS_KEY="snooker.push.dismissed";

export function PushOptIn({compact}:{compact?:boolean}){
  const [state,setState]=useState<PushState|null>(null);
  const [busy,setBusy]=useState(false);
  const [dismissed,setDismissed]=useState(true);
  useEffect(()=>{
    void registerServiceWorker();
    void pushState().then(setState);
    setDismissed(window.localStorage.getItem(DISMISS_KEY)==="1");
  },[]);
  useEffect(()=>{if(state==="default"&&!dismissed)trackAvailabilityEvent("matchmaking_push_prompt_shown")},[state,dismissed]);
  const dismiss=()=>{window.localStorage.setItem(DISMISS_KEY,"1");setDismissed(true);trackAvailabilityEvent("matchmaking_push_dismissed")};
  const turnOn=async()=>{
    setBusy(true);
    try{const next=await enablePush();setState(next);if(next==="subscribed")trackAvailabilityEvent("matchmaking_push_enabled")}
    finally{setBusy(false)}
  };
  if(state===null||state==="unsupported")return null;
  if(state==="subscribed")return compact?null:<p className="push-status" role="status">
    <span aria-hidden="true">🔔</span> 已開啟通知 · 有人約你會即時話你知
    <button type="button" className="more" onClick={()=>void disablePush().then(setState)}>關閉</button>
  </p>;
  /* A member who has actively blocked notifications cannot be re-prompted by any amount of UI, so
     saying so plainly beats a button that would silently do nothing. */
  if(state==="denied")return compact?null:<p className="push-status is-denied">通知已被瀏覽器封鎖 — 需要喺瀏覽器設定入面重新允許，先收到約波提示。</p>;
  if(dismissed)return null;
  /* A strip, not a card. Turning on notifications is setup, not matchmaking — it earns one line at
     the edge of the member's attention, not a block competing with the game they came here to
     arrange. It disappears for good once answered either way. */
  return <div className="push-strip">
    <span className="push-strip-copy"><b>開啟通知</b><small>有人約你打波即刻知，唔使開住個 App。</small></span>
    <span className="push-strip-actions">
      <button type="button" className="primary" disabled={busy} onClick={()=>void turnOn()}>{busy?"設定中…":"開啟"}</button>
      <button type="button" className="secondary" onClick={dismiss}>唔使</button>
    </span>
  </div>;
}

export type NotificationPrefs={invites:boolean;openCalls:boolean;offers:boolean;results:boolean;emailFallback:boolean;quietFrom:number|null;quietTo:number|null};
const PREF_LABELS:[keyof NotificationPrefs,string,string][]=[
  ["invites","有人約我打波","邀請、接受、婉拒同改期"],
  ["offers","夾到時間嘅配對","兩邊都答應先會確認"],
  ["openCalls","有人開枱","只會通知嗰段時間得閒嘅你"],
  ["results","賽果提醒","打完之後提你記低分數"],
  ["emailFallback","收唔到推送時用電郵","例如冇裝 App 或者關咗推送"],
];

/** Per-channel control, because "turn it all off" should never be the only way to stop one kind of
 *  message. A member who finds open-call pushes noisy but still wants to know when somebody asks
 *  them directly has to be able to say exactly that — otherwise they switch everything off and the
 *  club loses them from the one channel that mattered.
 *
 *  Quiet hours default to off: this club plays until 02:00, so a late notification is normal here
 *  rather than a mistake, and imposing a night-time window would suppress the most useful messages. */
export function NotificationPrefsPanel(){
  const [prefs,setPrefs]=useState<NotificationPrefs|null>(null);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{void fetch("/api/push/prefs").then(response=>response.ok?response.json():null).then(body=>{if(body?.prefs)setPrefs(body.prefs)}).catch(()=>{})},[]);
  if(!prefs)return null;
  const update=async(patch:Partial<NotificationPrefs>)=>{
    const next={...prefs,...patch};
    setPrefs(next);setBusy(true);
    try{
      const response=await fetch("/api/push/prefs",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(patch)});
      const body=await response.json();
      if(body?.prefs)setPrefs(body.prefs);
    }catch{/* the optimistic value stands; the next load reconciles it */}
    finally{setBusy(false)}
  };
  const quiet=prefs.quietFrom!==null&&prefs.quietTo!==null;
  return <section className="availability-card notification-prefs">
    <header className="availability-grid-head">
      <div><h3>通知設定</h3><small>揀你想收邊啲提示。</small></div>
      <button type="button" className="more" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?"收起":"調整"}</button>
    </header>
    {open&&<>
      <ul className="pref-list">{PREF_LABELS.map(([key,label,hint])=>
        <li key={key}>
          <label>
            <input type="checkbox" checked={Boolean(prefs[key])} disabled={busy} onChange={event=>void update({[key]:event.target.checked})}/>
            <span><b>{label}</b><small>{hint}</small></span>
          </label>
        </li>)}
      </ul>
      <div className="pref-quiet">
        <label>
          <input type="checkbox" checked={quiet} disabled={busy} onChange={event=>void update(event.target.checked?{quietFrom:2,quietTo:10}:{quietFrom:null,quietTo:null})}/>
          <span><b>免打擾時間</b><small>呢段時間唔會推送（球會開到凌晨兩點，預設唔開）</small></span>
        </label>
        {quiet&&<div className="pref-quiet-times">
          <label><span>由</span><select value={prefs.quietFrom??2} disabled={busy} onChange={event=>void update({quietFrom:Number(event.target.value)})}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{String(hour).padStart(2,"0")}:00</option>)}</select></label>
          <label><span>到</span><select value={prefs.quietTo??10} disabled={busy} onChange={event=>void update({quietTo:Number(event.target.value)})}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{String(hour).padStart(2,"0")}:00</option>)}</select></label>
        </div>}
      </div>
    </>}
  </section>;
}

/* --- "I'm free now" ------------------------------------------------------- */

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
    <div className="free-now-durations" role="group" aria-label="打幾耐">
      {DURATIONS.map(item=><button type="button" key={item.minutes} className={minutes===item.minutes?"active":""} aria-pressed={minutes===item.minutes} onClick={()=>setMinutes(item.minutes)}>{item.label}</button>)}
    </div>
    <button type="button" className="primary free-now-button" disabled={busy||disabled} aria-busy={busy} onClick={()=>void go()}>
      {busy&&<i className="button-spinner" aria-hidden="true"/>}
      <span>{busy?"發緊…":`我而家得閒 · ${minutes/60} 小時`}</span>
    </button>
    <button type="button" className="free-now-toggle more" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?"收起":"加枱位或留言"}</button>
    {open&&<div className="free-now-details">
      <VenueField value={venue} onChange={setVenue}/>
      <label className="invite-message-field"><span>留言（可省略）</span>
        <textarea rows={2} maxLength={300} value={message} placeholder="例如：訂咗枱，隨時開波" onChange={event=>setMessage(event.target.value)}/></label>
    </div>}
    {error&&<p className="availability-form-error" role="alert">{error}</p>}
  </div>;
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
          <button type="button" key={action.label} className={action.tone} disabled={item.busy} onClick={action.onClick}>{action.label}</button>)}
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
        <button type="button" className="primary" onClick={()=>onRecord(game.opponent.id,game.startAt)}>記錄比分</button>
        <button type="button" className="secondary" disabled={cancelling} onClick={()=>onCancel(game.id)}>取消</button>
      </div>
    </div>
  </section>;
  return <section className="availability-card mm-card is-idle">
    <CardHead title="而家得閒？" hint="一撳就公開你嘅時間、開一張全會所睇到嘅枱，同埋問夾得到嘅球友。"
      aside={<button type="button" className="more" onClick={onEditSlots}>{slotCount?`我嘅時段 · ${slotCount}`:"排定期時段"}</button>}/>
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
    <button type="button" className="waiting-strip-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span>等緊 {items.length} 位球友回覆</span><i aria-hidden="true">{open?"▲":"▼"}</i>
    </button>
    {open&&<ul>{items.map(item=>
      <li key={item.id}><span><b>{item.name}</b><small>{item.label}</small></span>
        {item.cancellable&&<button type="button" className="secondary" disabled={cancellingId===item.id} onClick={()=>onCancel(item.id)}>取消邀請</button>}</li>)}
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
  return <div className="backdrop invite-backdrop" onMouseDown={onClose}>
    <section className="sheet invite-sheet" onMouseDown={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="counter-title">
      <button type="button" className="close" aria-label="關閉" onClick={onClose}>×</button>
      <p className="kicker">提議另一個時間</p>
      <h2 id="counter-title">{title}</h2>
      <p className="sub">唔使拒絕 — 直接提議一個就得嘅時間，對方確認就搞掂。</p>
      <div className="composer-times">
        <label><span>日期</span><input type="date" min={hkDate()} value={when} onChange={event=>setWhen(event.target.value)}/></label>
        <label><span>開始</span><select value={start} onChange={event=>setStart(event.target.value)}>{TIMES.map(time=><option key={time}>{time}</option>)}</select></label>
        <label><span>結束</span><select value={end} onChange={event=>setEnd(event.target.value)}>{TIMES.map(time=><option key={time}>{time}{time<=start?" · 次日":""}</option>)}</select></label>
      </div>
      <VenueField value={venue} onChange={setVenue}/>
      <button type="button" className="primary full" disabled={busy} onClick={()=>onSubmit({date:when,start,end,venue})}>{busy?"送出中…":`提議 ${start}–${end}`}</button>
    </section>
  </div>;
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
      <button type="button" className="more" onClick={()=>onCopyLastWeek()} disabled={busy}>同上星期一樣</button>
    </header>
    {rules.length>0&&<ul className="recurrence-list">{rules.map(rule=>
      <li key={rule.id}>
        <span><b>逢{WEEKDAYS[rule.weekday]}</b><small>{rule.startTime}–{rule.endTime}</small></span>
        <button type="button" className="card-tool danger" aria-label={`刪除逢${WEEKDAYS[rule.weekday]} ${rule.startTime}–${rule.endTime}`} disabled={busy} onClick={()=>onRemove(rule.id)}>✕</button>
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
          <button type="button" className="primary" disabled={busy} onClick={()=>{onAdd({weekday,startTime,endTime});setOpen(false)}}>加入每週時段</button>
          <button type="button" className="secondary" onClick={()=>setOpen(false)}>取消</button>
        </div>
      </div>
      :<button type="button" className="secondary recurrence-add" onClick={()=>setOpen(true)}>＋ 加一個每週時段</button>}
  </section>;
}

/* --- Club activity, outside the matchmaking tab --------------------------- */

export type TonightSummary={free:number;openCalls:number};

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
