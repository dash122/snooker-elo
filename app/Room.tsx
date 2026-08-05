"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { CardHead } from "./MatchmakingBits";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { hkClock, hkDate, type Interval } from "../lib/availability";
import { NOW_DURATIONS, PREFERENCE_HINTS, PREFERENCE_LABELS, TONIGHT_ENDS,
  remainingLabel, type Licence, type MatchPreference, type RoomGroup } from "../lib/room";

/* --- The Room --------------------------------------------------------------
 *
 * Everybody looking for a game, on one screen, ordered by how well they fit the reader.
 *
 * This is the answer to a question the shortlist could not take: "who is actually around tonight?"
 * Three ranked cards are the app's opinion with the market it came from hidden behind them, and in a
 * club this size that reads as a dead room even on a busy evening. Showing everyone costs nothing —
 * ranking decides the order here, never the membership of the list.
 *
 * Two things on every row do the real work. The countdown, because a member is choosing between
 * people whose evenings end at different times and 「得閒到 23:30」 is the difference between a game
 * and a wasted trip. And the preference tag, because this club publishes an ELO board and the
 * reliable consequence of a public ELO board is that a weaker player never asks a stronger one —
 * 「佢歡迎水平低啲嘅球友」 is a licence to ask, granted before the ask has to be composed. */

export type RoomPlayer={id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
export type RoomEntryVM={
  id:string; group:RoomGroup; tier:"live"|"unconfirmed"; score:number;
  gap:number; levelLabel:string; preference:MatchPreference;
  licence:Licence; licenceNote:string|null;
  window:Interval|null; atClub:boolean; player:RoomPlayer;
};
export type RoomCall={id:string;startAt:string;endAt:string;venue:string;message:string;player:RoomPlayer};
export type MyRoomState={
  playerId:string; rating:number; atClub:boolean; presenceUntil:string|null;
  intent:{id:string;kind:"tonight"|"window"|"standby";startAt:string|null;endAt:string|null;preference:MatchPreference}|null;
};
export type RoomData={today:string;me:MyRoomState|null;entries:RoomEntryVM[];atClubCount:number;calls:RoomCall[]};

const GROUP_TITLES:Record<RoomGroup,string>={
  "at-club":"而家喺會所","free-now":"而家得閒",later:"今晚／稍後得閒",unconfirmed:"可能得閒 — 未確認",
};
const GROUP_HINTS:Partial<Record<RoomGroup,string>>={
  /* Said plainly, because the honesty is the feature. These members published time at some point and
     have not confirmed anything since; presenting them as available would be the app inventing
     supply, and an invitation built on invented supply is the kind that never gets answered. */
  unconfirmed:"佢哋之前公開過時間，但未講今晚得唔得閒 — 問一問先知。",
};

/* --- The member's own status ----------------------------------------------- */

/** The band at the top: what I told the club, and how long it stands for.
 *
 *  Not in settings and not collapsed. A status the member cannot see the end of is exactly the stale
 *  data this whole design exists to avoid — and having the clock visible is what makes 「+1 小時」 a
 *  thing they reach for, which is the cheapest confirmation signal in the product. */
function MyStatus({me,onExtend,onStop,onArrive,onLeave,busy}:{
  me:MyRoomState; onExtend:()=>void; onStop:()=>void; onArrive:()=>void; onLeave:()=>void; busy:boolean;
}){
  /* Ticks locally so the countdown stays honest between polls — a number that only moves when the
     board refreshes reads as broken long before it reads as stale. */
  const [,tick]=useState(0);
  useEffect(()=>{const id=window.setInterval(()=>tick(value=>value+1),30_000);return ()=>window.clearInterval(id)},[]);
  const endAt=me.intent?.endAt??null;
  return <div className={`room-me${me.atClub?" is-here":""}`}>
    <span className="room-me-dot" aria-hidden="true"/>
    <span className="room-me-copy">
      {me.intent
        ?<>
          <b>{endAt?`你得閒到 ${hkClock(endAt)}`:"你話咗想搵局"}</b>
          <small>{endAt?remainingLabel(endAt):"有啱嘅局我哋會搵你"} · {PREFERENCE_LABELS[me.intent.preference]}</small>
        </>
        :<><b>全會所睇唔到你</b><small>撳下面話畀人知你得閒，先會出現喺呢個名單。</small></>}
    </span>
    <span className="room-me-actions">
      {me.intent&&endAt&&<button type="button" className="secondary" disabled={busy} onClick={onExtend}>+1 小時</button>}
      <button type="button" className={me.atClub?"secondary is-on":"secondary"} disabled={busy}
        onClick={me.atClub?onLeave:onArrive}>{me.atClub?"離開會所":"我喺會所"}</button>
      {me.intent&&<button type="button" className="more" disabled={busy} onClick={onStop}>收工</button>}
    </span>
  </div>;
}

/* --- Going live ------------------------------------------------------------ */

/** 「得閒到幾點」 — the end time is the point, not a detail.
 *
 *  Without an end a declaration cannot expire, and a declaration that cannot expire becomes the stale
 *  data that poisons everyone else's board. So it is asked once, up front, in the unit that matches
 *  the shape of the answer: a duration for "right now", a clock time for "tonight", and — for 呢幾日
 *  都得 — nothing at all, because that one is honestly not a window and inventing one for it would
 *  manufacture availability the member never offered. */
function GoLive({onPost,busy}:{onPost:(input:{shape:"now"|"tonight"|"soon";minutes?:number;end?:string;preference:MatchPreference})=>void;busy:boolean}){
  const [shape,setShape]=useState<"now"|"tonight"|"soon">("now");
  const [minutes,setMinutes]=useState(120);
  const [end,setEnd]=useState("23:00");
  const [preference,setPreference]=useState<MatchPreference>("any");
  const label=shape==="now"?`我而家得閒 · ${minutes/60} 小時`:shape==="tonight"?`今晚得閒到 ${end}`:"呢幾日都得，有啱搵我";
  return <div className="room-live">
    <div className="room-live-shape" role="group" aria-label="幾時得閒">
      {([["now","而家"],["tonight","今晚"],["soon","呢幾日"]] as const).map(([value,text])=>
        <button type="button" key={value} className={shape===value?"active":""} aria-pressed={shape===value}
          onClick={()=>setShape(value)}>{text}</button>)}
    </div>

    {shape==="now"&&<div className="room-live-until" role="group" aria-label="打幾耐">
      {NOW_DURATIONS.map(value=><button type="button" key={value} className={minutes===value?"active":""}
        aria-pressed={minutes===value} onClick={()=>setMinutes(value)}>{value/60} 小時</button>)}
    </div>}

    {shape==="tonight"&&<div className="room-live-until" role="group" aria-label="得閒到幾點">
      {TONIGHT_ENDS.map(value=><button type="button" key={value} className={end===value?"active":""}
        aria-pressed={end===value} onClick={()=>setEnd(value)}>到 {value}</button>)}
    </div>}

    {shape==="soon"&&<p className="room-live-note">唔使揀時間 — 有夾到嘅局我哋直接問你。</p>}

    <div className="room-live-pref">
      <span className="room-live-lbl">想打邊種？</span>
      <div role="group" aria-label="想打邊種">
        {(Object.keys(PREFERENCE_LABELS) as MatchPreference[]).map(value=>
          <button type="button" key={value} className={preference===value?"active":""} aria-pressed={preference===value}
            title={PREFERENCE_HINTS[value]} onClick={()=>setPreference(value)}>{PREFERENCE_LABELS[value]}</button>)}
      </div>
      <small>{PREFERENCE_HINTS[preference]}</small>
    </div>

    <button type="button" className="primary room-live-go" disabled={busy} aria-busy={busy}
      onClick={()=>onPost({shape,minutes,end,preference})}>
      {busy&&<i className="button-spinner" aria-hidden="true"/>}<span>{busy?"發緊…":label}</span>
    </button>
  </div>;
}

/* --- One row --------------------------------------------------------------- */

function windowLabel(entry:RoomEntryVM,now:number){
  if(entry.tier==="unconfirmed")return "之前公開過時間";
  if(!entry.window)return "有啱就搵佢";
  const startAt=Date.parse(entry.window.startAt);
  return startAt<=now?`得閒到 ${hkClock(entry.window.endAt)}`:`${hkClock(entry.window.startAt)} 之後`;
}

function RoomRow({entry,now,onAsk,onOpen,busy}:{
  entry:RoomEntryVM; now:number; onAsk:()=>void; onOpen?:(playerId:string)=>void; busy:boolean;
}){
  return <li className={`room-row is-${entry.group}`}>
    <button type="button" className="room-row-person" onClick={()=>onOpen?.(entry.player.id)} disabled={!onOpen}>
      <PlayerBadge player={entry.player}/>
      <span className="room-row-copy">
        <b>{entry.player.name}</b>
        <small>
          {entry.licenceNote&&<i className="room-tag">{PREFERENCE_LABELS[entry.preference]}</i>}
          {entry.levelLabel} · {windowLabel(entry,now)}
        </small>
        {entry.licenceNote&&<em className="room-licence">{entry.licenceNote}</em>}
      </span>
    </button>
    <button type="button" className={entry.tier==="unconfirmed"?"secondary room-row-ask":"primary room-row-ask"}
      disabled={busy} onClick={onAsk}>
      {entry.tier==="unconfirmed"?"問佢":"約佢"}
    </button>
  </li>;
}

/* --- The board -------------------------------------------------------------- */

const GROUPS:RoomGroup[]=["at-club","free-now","later","unconfirmed"];

export function Room({signedIn,onAsk,onOpen,onClaim,claimingCallId,onChanged}:{
  signedIn:boolean;
  /** Asking somebody opens the existing invite flow — The Room decides *who is worth asking*, it does
      not reinvent the ask. */
  onAsk:(playerId:string,slot:Interval|null)=>void;
  onOpen?:(playerId:string)=>void;
  onClaim:(callId:string)=>void;
  claimingCallId:string|null;
  /** Fired after anything that changes the club's state, so the tab around this can refresh too. */
  onChanged?:()=>void;
}){
  const [data,setData]=useState<RoomData|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [now,setNow]=useState(()=>Date.now());

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/room");
      if(!response.ok)return;
      setData(await response.json());
      setNow(Date.now());
    }catch{/* the board is a read; a failed poll leaves the last one on screen rather than blanking it */}
  },[]);

  useEffect(()=>{
    void load();
    const id=window.setInterval(()=>{if(document.visibilityState==="visible")void load()},60_000);
    return ()=>window.clearInterval(id);
  },[load]);

  const act=async(run:()=>Promise<Response>)=>{
    if(busy)return;
    setBusy(true);setError("");
    try{
      const response=await run();
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){setError(payload.error??"暫時做唔到，請再試一次。");return}
      await load();
      onChanged?.();
    }catch{setError("網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  };

  const post=(body:unknown)=>fetch("/api/intents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});

  const goLive=(input:{shape:"now"|"tonight"|"soon";minutes?:number;end?:string;preference:MatchPreference})=>{
    trackAvailabilityEvent("room_go_live",{shape:input.shape});
    if(input.shape==="soon")return act(()=>post({kind:"standby",preference:input.preference}));
    if(input.shape==="now"){
      /* Same rounding as the free-now button: at 19:42 a member is free now, not at 20:00, and the
         publish path's grace window is exactly wide enough to accept the earlier start. */
      const step=30*60_000,startAt=Math.floor(Date.now()/step)*step;
      return act(()=>post({kind:"tonight",preference:input.preference,
        startAt:new Date(startAt).toISOString(),
        endAt:new Date(startAt+(input.minutes??120)*60_000).toISOString()}));
    }
    /* An end at or before "now" belongs to tomorrow morning — the club plays past midnight, so
       「到 01:00」 is an ordinary answer here rather than a mistake to reject. */
    const today=hkDate();
    const endAt=Date.parse(`${today}T${input.end}:00+08:00`);
    const step=30*60_000,startAt=Math.floor(Date.now()/step)*step;
    return act(()=>post({kind:"tonight",preference:input.preference,
      startAt:new Date(startAt).toISOString(),
      endAt:new Date(endAt<=startAt?endAt+86_400_000:endAt).toISOString()}));
  };

  const grouped=useMemo(()=>{
    const map=new Map<RoomGroup,RoomEntryVM[]>();
    for(const entry of data?.entries??[]){
      const list=map.get(entry.group)??[];
      list.push(entry);map.set(entry.group,list);
    }
    return map;
  },[data]);

  if(!signedIn)return null;
  const me=data?.me??null;
  const liveCount=(grouped.get("at-club")?.length??0)+(grouped.get("free-now")?.length??0)+(grouped.get("later")?.length??0);

  return <section className="availability-card mm-card room-card" aria-label="而家搵緊局嘅人">
    <CardHead title="而家喺場"
      hint={data?`${liveCount} 位搵緊局${data.atClubCount?` · ${data.atClubCount} 位喺會所`:""}${data.calls.length?` · ${data.calls.length} 張枱開緊`:""}`:undefined}/>

    {me&&<MyStatus me={me} busy={busy}
      onExtend={()=>{trackAvailabilityEvent("room_extend");return void act(()=>fetch(`/api/intents/${me.intent?.id}`,{method:"PATCH"}))}}
      onStop={()=>void act(()=>fetch(`/api/intents/${me.intent?.id}`,{method:"DELETE"}))}
      onArrive={()=>{trackAvailabilityEvent("room_presence_on");return void act(()=>fetch("/api/presence",{method:"POST"}))}}
      onLeave={()=>void act(()=>fetch("/api/presence",{method:"DELETE"}))}/>}

    {me&&!me.intent&&<GoLive busy={busy} onPost={input=>void goLive(input)}/>}

    {error&&<p className="availability-form-error" role="alert">{error}</p>}

    {data&&data.calls.length>0&&<div className="room-calls">
      <p className="room-group-head">開咗枱 · 等緊人</p>
      <ul className="room-call-list">{data.calls.map(call=>
        <li key={call.id} className="room-call">
          <div>
            <b>{call.venue||"開咗枱"} · {hkClock(call.startAt)}–{hkClock(call.endAt)}</b>
            <small>{call.player.name} 開嘅{call.message?` · ${call.message}`:""}</small>
          </div>
          {call.player.id!==me?.playerId
            ?<button type="button" className="primary" disabled={claimingCallId===call.id} onClick={()=>onClaim(call.id)}>接受</button>
            :<span className="room-call-mine">你開嘅</span>}
        </li>)}
      </ul>
    </div>}

    {GROUPS.map(group=>{
      const entries=grouped.get(group);
      if(!entries?.length)return null;
      return <div key={group} className={`room-group is-${group}`}>
        <p className="room-group-head">{GROUP_TITLES[group]}{GROUP_HINTS[group]&&<small>{GROUP_HINTS[group]}</small>}</p>
        <ul className="room-rows">{entries.map(entry=>
          <RoomRow key={entry.id} entry={entry} now={now} busy={busy} onOpen={onOpen}
            onAsk={()=>{trackAvailabilityEvent("room_ask",{tier:entry.tier});onAsk(entry.player.id,entry.window)}}/>)}
        </ul>
      </div>;
    })}

    {data&&!data.entries.length&&<p className="mm-note">
      而家未有人話想打波。{me?.intent?"有人上線我哋即刻通知你。":"你可以做第一個 — 上面話一聲，全會所就見到。"}
    </p>}
  </section>;
}
