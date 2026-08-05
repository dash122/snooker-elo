"use client";
import { useCallback, useEffect, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { addDaysHongKong, hkClock, hkDate, hkDayLabel, hongKongInstant, hongKongWeekday,
  type Interval } from "../lib/availability";
import { nowStart, type SessionStatus } from "../lib/sessions";

/* --- 我嘅場次 --------------------------------------------------------------
 *
 * One slot is one session: a block of time a member set aside to play. 今晚 21:00–23:00 is one,
 * Friday 11:00–14:00 is another, and each has its own card, its own opponent and its own outcome.
 *
 * This is what replaced four controls that all declared the same intent. The old tab asked 想打波?,
 * then asked again with 而家/今晚/呢幾日, then how many hours, then what kind of game — nine
 * decisions before a single name appeared, and three separate ways of saying nobody was free. The
 * member's actual question is smaller than any of that: *I've set aside tonight — who am I playing?*
 *
 * So the recommendation lives inside the session rather than beside it. A shortlist floating above a
 * list of slots leaves the member to work out which evening it refers to, which is precisely the
 * analysis the app exists to do for them.
 *
 * MARKET is the second half of the screen, and it exists for a reason the deck's own persona work
 * does not directly name but the club's size forces on us: with few active members, the single
 * biggest risk is not a bad recommendation, it is a member opening the tab and concluding nobody
 * plays here. So below the session cards — and, critically, on the cold open where there is nothing
 * else to look at — the strip shows everyone else's open time as-is, not ranked, not filtered. It is
 * proof of a live club, and it is deliberately a different object from the recommendation above: the
 * best-match card says "we picked this for you", the strip says "here is what's actually happening". */

export type SessionOption={
  player:{id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
  difference:number; slot:Interval; reasons:string[];
  handicap:{points:number;direction:"give"|"receive"|"level";label:string;evidence:string|null;played:number};
};
export type SessionVM={
  id:string; startAt:string; endAt:string; venue:string; note:string; status:SessionStatus;
  booking:{inviteId:string;opponentId:string;startAt:string;endAt:string;
    opponent:{id:string;name:string;short?:string|null;colour?:string|null;avatar?:string|null}|null}|null;
  options:SessionOption[];
};
export type MarketEntry={
  player:{id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
  slot:Interval; difference:number; levelLabel:string;
  handicap:{points:number;direction:"give"|"receive"|"level";label:string;evidence:string|null;played:number};
};
export type MarketCall={
  id:string; startAt:string; endAt:string; venue:string; message:string; mine:boolean;
  player:{id:string;name:string;short?:string|null;colour?:string|null;avatar?:string|null};
};

const when=(session:{startAt:string;endAt:string})=>{
  const day=hkDate(new Date(session.startAt));
  const label=day===hkDate()?"今晚":day===addDaysHongKong(hkDate(),1)?"聽日":hkDayLabel(day);
  return `${label} ${hkClock(session.startAt)}–${hkClock(session.endAt)}`;
};

/* --- The one card that matters --------------------------------------------
 *
 * Four reasons, not two. They are not decoration competing for the eye — they are the 社交許可: the
 * thing that makes a member willing to press 邀請 on somebody they would never have messaged. Every
 * one answers a question they actually hold: 點解係佢、點解係而家、點解可以放心約.
 *
 * Then the handicap, which is the line no stranger-matching app can cross. Competing 約腳 apps offer
 * 「接受讓分」 — a checkbox saying a handicap is *permitted*, leaving two people to negotiate the
 * number out loud before a game. That negotiation is where the ask dies: nobody wants to be the one
 * who says they need a head start. We have ratings and match history, so the app proposes the terms
 * and neither player has to raise it. */
function BestMatch({option,alternates,expanded,onInvite,onLater,onToggle,busy,busyId}:{
  option:SessionOption; alternates:SessionOption[]; expanded:boolean;
  onInvite:(opponentId:string,slot:Interval)=>void; onLater:()=>void; onToggle:()=>void;
  busy:boolean; busyId:string|null;
}){
  return <div className="ses-match">
    <p className="ses-kick">最佳配對</p>
    <div className="ses-who">
      <PlayerBadge player={option.player}/>
      <span><b>{option.player.name}</b><small>ELO {Math.round(option.player.rating)} · 只差 {option.difference}</small></span>
    </div>
    <ul className="ses-why">{option.reasons.map(reason=>
      <li key={reason}><i aria-hidden="true">✓</i><span>{reason}</span></li>)}
    </ul>
    <div className="ses-hcap">
      <b>{option.handicap.label}</b>
      {option.handicap.evidence&&<small>{option.handicap.evidence}</small>}
    </div>
    <button type="button" className="primary ses-go" disabled={busy} aria-busy={busy} onClick={()=>onInvite(option.player.id,option.slot)}>
      {busy&&<i className="button-spinner" aria-hidden="true"/>}<span>邀請 {option.player.name}</span>
    </button>
    <button type="button" className="secondary ses-alt" onClick={onLater}>改時間／加留言</button>
    {/* Expands within the same card rather than jumping to a separate browse surface — these two are
        already ranked and fetched for this exact evening, so there is nothing a second screen would
        add except a tap. */}
    {alternates.length>0&&<button type="button" className="more ses-more" aria-expanded={expanded} onClick={onToggle}>
      {expanded?"收起":`睇另外 ${alternates.length} 個選擇`}</button>}
    {expanded&&<ul className="ses-alt-list">{alternates.map(alt=>
      <li key={alt.player.id}>
        <PlayerBadge player={alt.player}/>
        <span className="ses-alt-copy">
          <b>{alt.player.name}</b>
          <small>只差 {alt.difference} · {alt.handicap.label}</small>
        </span>
        <button type="button" className="secondary" disabled={busyId===alt.player.id}
          onClick={()=>onInvite(alt.player.id,alt.slot)}>約佢</button>
      </li>)}
    </ul>}
  </div>;
}

function SessionCard({session,onInvite,onCustomise,onCancel,onRecord,onWatch,busyId}:{
  session:SessionVM;
  onInvite:(opponentId:string,slot:Interval)=>void;
  onCustomise:(opponentId:string,slot:Interval)=>void;
  onCancel:(id:string)=>void; onRecord:(opponentId:string,startAt:string)=>void;
  onWatch:()=>void; busyId:string|null;
}){
  const [expanded,setExpanded]=useState(false);
  const best=session.options[0];
  const alternates=session.options.slice(1);
  return <article className={`ses-card is-${session.status}`}>
    <header className="ses-head">
      <div>
        <b>{when(session)}</b>
        {session.venue&&<small>{session.venue}</small>}
      </div>
      {session.status==="looking"&&<button type="button" className="ses-drop" aria-label={`取消 ${when(session)} 呢一節`}
        onClick={()=>onCancel(session.id)}>✕</button>}
    </header>

    {session.status==="looking"&&(best
      ?<BestMatch option={best} alternates={alternates} expanded={expanded} busy={busyId===best.player.id} busyId={busyId}
        onInvite={onInvite} onLater={()=>onCustomise(best.player.id,best.slot)}
        onToggle={()=>setExpanded(value=>!value)}/>
      /* One message and one action. The old screen said this three times in three cards and offered
         four exits, which reads as the club being dead rather than as tonight being quiet. */
      :<div className="ses-empty">
        <p>暫時未有夾得到嘅對手。</p>
        <button type="button" className="primary" onClick={onWatch}>有人得閒就即刻通知我</button>
      </div>)}

    {session.status==="booked"&&session.booking&&<div className="ses-booked">
      <p className="ses-kick">已約實</p>
      <div className="ses-who">
        <PlayerBadge player={session.booking.opponent??{id:session.booking.opponentId,name:"對手"}}/>
        <span><b>{session.booking.opponent?.name??"對手"}</b>
          <small>{hkClock(session.booking.startAt)}–{hkClock(session.booking.endAt)}</small></span>
      </div>
      <button type="button" className="primary ses-go"
        onClick={()=>onRecord(session.booking!.opponentId,session.booking!.startAt)}>記錄比分</button>
    </div>}

    {session.status==="toRecord"&&session.booking&&<div className="ses-booked is-owed">
      <p className="ses-kick">打完喇？</p>
      <div className="ses-who">
        <PlayerBadge player={session.booking.opponent??{id:session.booking.opponentId,name:"對手"}}/>
        <span><b>{session.booking.opponent?.name??"對手"}</b><small>記低分數，ELO 先計得準</small></span>
      </div>
      <button type="button" className="primary ses-go"
        onClick={()=>onRecord(session.booking!.opponentId,session.booking!.startAt)}>記錄比分</button>
    </div>}

    {session.status==="done"&&session.booking&&<p className="ses-missed">
      同 {session.booking.opponent?.name??"對手"} 打咗，分數已記低。</p>}

    {/* Shown once, quietly, then it stops mattering. A permanent 「你冇打成」 is a reproach. */}
    {session.status==="missed"&&<p className="ses-missed">呢一節冇約成。</p>}
  </article>;
}

/* --- Market ------------------------------------------------------------- */

/** One other member's soonest open window, or one open call. Compact by design — this is a glance at
    liveliness, not a second shortlist, so it carries the minimum that still makes the club look
    alive: who, roughly when, roughly how good a game, and the handicap that makes asking safe. */
function MarketCard({entry,busy,onAsk}:{entry:MarketEntry;busy:boolean;onAsk:()=>void}){
  return <li className="mk-card">
    <PlayerBadge player={entry.player}/>
    <b>{entry.player.name}</b>
    <small>{entry.levelLabel}</small>
    <small className="mk-when">{when(entry.slot)}</small>
    <span className="mk-hcap">{entry.handicap.label}</span>
    <button type="button" className="secondary" disabled={busy} onClick={onAsk}>約佢</button>
  </li>;
}

function CallCard({call,busy,onJoin}:{call:MarketCall;busy:boolean;onJoin:()=>void}){
  return <li className="mk-card is-call">
    <PlayerBadge player={call.player}/>
    <b>{call.venue||"開咗枱"}</b>
    <small>{call.player.name} 開嘅</small>
    <small className="mk-when">{when(call)}</small>
    {call.mine
      ?<span className="mk-mine">你開嘅</span>
      :<button type="button" className="primary" disabled={busy} onClick={onJoin}>接受</button>}
  </li>;
}

/** Always visible — on the cold open it is the *only* content, which is the point: a new member's
    first look at an empty-feeling tab should not be a form, it should be evidence that other people
    are already doing this tonight. */
function MarketStrip({market,calls,busyId,claimingId,onAsk,onJoin}:{
  market:MarketEntry[]; calls:MarketCall[]; busyId:string|null; claimingId:string|null;
  onAsk:(playerId:string,slot:Interval)=>void; onJoin:(callId:string)=>void;
}){
  if(!market.length&&!calls.length)return null;
  const people=new Set(market.map(entry=>entry.player.id)).size;
  return <section className="availability-card mm-card mk-strip" aria-label="大家都想打">
    <header className="mk-head">
      <h3>大家都想打</h3>
      <small>{people>0&&`${people} 位得閒`}{people>0&&calls.length>0&&" · "}{calls.length>0&&`${calls.length} 張枱開緊`}</small>
    </header>
    <ul className="mk-row">
      {calls.map(call=><CallCard key={call.id} call={call} busy={claimingId===call.id} onJoin={()=>onJoin(call.id)}/>)}
      {market.map(entry=><MarketCard key={entry.player.id} entry={entry} busy={busyId===entry.player.id}
        onAsk={()=>onAsk(entry.player.id,entry.slot)}/>)}
    </ul>
  </section>;
}

/* --- Opening one ----------------------------------------------------------- */

/** The cold open: one question, two answers, two links. Straight off the deck's slide 18.
 *
 *  Everything the old form asked on top of this — duration, preference, presence — was either
 *  derivable, or belongs on a profile, or should never be asked before a member has been shown a
 *  single opponent. */
function ColdOpen({onQuick,onPick,onWatch,busy}:{
  onQuick:(shape:"tonight"|"weekend")=>void; onPick:()=>void; onWatch:()=>void; busy:boolean;
}){
  return <section className="availability-card mm-card ses-ask">
    <h2>你想幾時打波？</h2>
    <div className="ses-ask-actions">
      <button type="button" className="primary" disabled={busy} onClick={()=>onQuick("tonight")}>
        今晚<small>{hkDayLabel(hkDate())}</small></button>
      <button type="button" className="secondary" disabled={busy} onClick={()=>onQuick("weekend")}>今個週末</button>
    </div>
    <button type="button" className="more ses-ask-link" onClick={onPick}>揀第個時間</button>
    <button type="button" className="more ses-ask-link" onClick={onWatch}>有啱對手就通知我</button>
  </section>;
}

const TIMES=Array.from({length:32},(_,index)=>`${String(10+Math.floor(index/2)).padStart(2,"0")}:${index%2?"30":"00"}`);

function NewSession({onCreate,onClose,busy,error}:{
  onCreate:(input:{date:string;start:string;end:string;venue:string})=>void;
  onClose:()=>void; busy:boolean; error:string;
}){
  const [date,setDate]=useState(hkDate());
  const [start,setStart]=useState("19:00");
  const [end,setEnd]=useState("21:00");
  const [venue,setVenue]=useState("");
  return <div className="backdrop invite-backdrop" onMouseDown={onClose}>
    <section className="sheet invite-sheet" onMouseDown={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-session">
      <button type="button" className="close" aria-label="關閉" onClick={onClose}>×</button>
      <h2 id="new-session">開一節</h2>
      <p className="sub">留一段時間出嚟，我哋幫你搵對手。</p>
      <div className="composer-times">
        <label><span>日期</span><input type="date" min={hkDate()} value={date} onChange={event=>setDate(event.target.value)}/></label>
        <label><span>開始</span><select value={start} onChange={event=>setStart(event.target.value)}>{TIMES.map(time=><option key={time}>{time}</option>)}</select></label>
        <label><span>結束</span><select value={end} onChange={event=>setEnd(event.target.value)}>{TIMES.map(time=><option key={time}>{time}{time<=start?" · 次日":""}</option>)}</select></label>
      </div>
      <label className="invite-message-field"><span>枱位（可省略）</span>
        <input type="text" maxLength={60} value={venue} placeholder="例如：已訂 3 號枱" onChange={event=>setVenue(event.target.value)}/></label>
      {error&&<p className="availability-form-error" role="alert">{error}</p>}
      <button type="button" className="primary full" disabled={busy} onClick={()=>onCreate({date,start,end,venue})}>
        {busy?"開緊…":`開 ${start}–${end}`}</button>
    </section>
  </div>;
}

/* --- The tab ---------------------------------------------------------------- */

export function Sessions({signedIn,onInvite,onCustomise,onRecord,onWatch,onClaim,claimingCallId,onChanged,invitingId}:{
  signedIn:boolean;
  onInvite:(opponentId:string,slot:Interval)=>void;
  onCustomise:(opponentId:string,slot:Interval)=>void;
  onRecord:(opponentId:string,playedOn:string)=>void;
  onWatch:()=>void;
  onClaim:(callId:string)=>void; claimingCallId:string|null;
  onChanged:()=>void;
  invitingId:string|null;
}){
  const [sessions,setSessions]=useState<SessionVM[]|null>(null);
  const [market,setMarket]=useState<MarketEntry[]>([]);
  const [calls,setCalls]=useState<MarketCall[]>([]);
  const [composing,setComposing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/sessions");
      if(!response.ok)return;
      const body=await response.json();
      setSessions(body.sessions??[]);
      setMarket(body.market??[]);
      setCalls(body.calls??[]);
    }catch{/* a failed poll leaves the last cards on screen rather than blanking the tab */}
  },[]);

  useEffect(()=>{
    if(!signedIn){setSessions([]);return}
    void load();
    const id=window.setInterval(()=>{if(document.visibilityState==="visible")void load()},45_000);
    return ()=>window.clearInterval(id);
  },[load,signedIn]);

  const create=async(window:Interval&{venue?:string})=>{
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/sessions",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify(window)});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){setError(body.error??"開唔到，試多次。");return false}
      trackAvailabilityEvent("session_created");
      setComposing(false);
      await load();onChanged();
      return true;
    }catch{setError("網絡連線失敗，請再試一次。");return false}
    finally{setBusy(false)}
  };

  /** 今晚 is "from now until the club's normal closing feel"; 今個週末 is the next Saturday
      afternoon, which is when this club is fullest. Neither asks the member for a duration. */
  const quick=(shape:"tonight"|"weekend")=>{
    if(shape==="tonight"){
      const startAt=nowStart();
      const hour=Number(hkClock(startAt).slice(0,2));
      const endDate=hour>=22||hour<2?addDaysHongKong(hkDate(new Date(startAt)),hour<2?0:1):hkDate(new Date(startAt));
      const endAt=hongKongInstant(endDate,hour>=22||hour<2?"01:00":"23:00");
      return create({startAt,endAt:Date.parse(endAt)<=Date.parse(startAt)
        ?hongKongInstant(addDaysHongKong(endDate,1),"01:00"):endAt});
    }
    const today=hkDate();
    const ahead=(6-hongKongWeekday(today)+7)%7||7;
    const saturday=addDaysHongKong(today,ahead);
    return create({startAt:hongKongInstant(saturday,"14:00"),endAt:hongKongInstant(saturday,"18:00")});
  };

  const cancel=async(id:string)=>{
    setBusy(true);
    try{await fetch(`/api/availability/${id}`,{method:"DELETE"});await load();onChanged()}
    finally{setBusy(false)}
  };

  if(!signedIn)return <section className="availability-card mm-card">
    <h2 className="ses-signin">登入後即可約戰</h2>
    <p className="mm-note">連結球員檔案，就可以開時段、收邀請同約戰。</p>
  </section>;

  if(sessions===null)return <div className="availability-skeleton" aria-hidden="true"/>;

  const marketStrip=<MarketStrip market={market} calls={calls} busyId={invitingId} claimingId={claimingCallId}
    onAsk={onInvite} onJoin={onClaim}/>;

  return <>
    {sessions.length===0
      ?<><ColdOpen busy={busy} onQuick={shape=>void quick(shape)} onPick={()=>setComposing(true)} onWatch={onWatch}/>{marketStrip}</>
      :<section className="ses-list" aria-label="我嘅場次">
        {sessions.map(session=>
          <SessionCard key={session.id} session={session} busyId={invitingId}
            onInvite={onInvite} onCustomise={onCustomise}
            onCancel={id=>void cancel(id)}
            onRecord={(opponentId,startAt)=>onRecord(opponentId,hkDate(new Date(startAt)))}
            onWatch={onWatch}/>)}
        <button type="button" className="secondary ses-add" onClick={()=>setComposing(true)}>＋ 開多一節</button>
      </section>}

    {sessions.length>0&&marketStrip}

    {error&&!composing&&<p className="availability-form-error" role="alert">{error}</p>}

    {composing&&<NewSession busy={busy} error={error} onClose={()=>{setComposing(false);setError("")}}
      onCreate={input=>{
        const endDate=input.end<=input.start?addDaysHongKong(input.date,1):input.date;
        void create({startAt:hongKongInstant(input.date,input.start),endAt:hongKongInstant(endDate,input.end),venue:input.venue});
      }}/>}
  </>;
}
