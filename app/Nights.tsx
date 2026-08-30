"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { Button } from "./components/ui/Primitives";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { hkDate, hkDayLabel } from "../lib/availability";
import { BAND_LABELS, CONFIDENCE_HINTS, CONFIDENCE_LABELS, QUORUM_CHOICES,
  forecastHeadline, stillNeeded, type Confidence, type NightForecast } from "../lib/nights";

/* --- 場次 · 今晚有無人 ------------------------------------------------------
 *
 * The one question the club actually asks before leaving home, answered above everything else.
 *
 * Every other matchmaking surface in this app asks a member to *author* something — paint a slot,
 * post a 開局卡, compose an invite — and each of those is a decision made in the dark, before any
 * evidence that it is worth making. This screen inverts that: it shows the evidence first, and the
 * only thing it ever asks for is one tap saying how likely you are to turn up.
 *
 * Three rules hold the design together, and each is load-bearing rather than decorative:
 *
 *   The floor is printed before the estimate. 「2 人確定 · 估 3–5 人」, never a single confident
 *   number. A member who travels on a figure that did not hold never trusts the figure again, so
 *   the reliable half leads and the optimistic half is explicitly labelled an estimate.
 *
 *   Only 一定去 is named. Faces are the strongest pull on the screen — 「阿明會去」 moves people in
 *   a way 「4 人」 cannot — but naming a hedge re-introduces the exposure that stops people hedging
 *   at all. Naming the already-public commitment and aggregating the rest gets both.
 *
 *   Nobody is ever chased. There is no follow-up, no 「你話咗會嚟」, no attendance record. The
 *   forecast already expects a share of 應該去 not to arrive — that is what the weighting is for —
 *   and the moment declining costs face, members stop signalling rather than decline. */

type NightPlayer={id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
type NightBoard={
  date:string; startAt:string; endAt:string;
  forecast:NightForecast;
  confirmed:NightPlayer[];
  mine:{confidence:Confidence;upgradeAt:number|null;promoted:boolean}|null;
};

const LEVELS:Confidence[]=["high","mid","low","out"];

/** 今日／聽日／週三 — the same shorthand the rest of the app uses, so a date means the same thing
    on every screen a member moves between. */
function dayLabel(date:string,today:string,tomorrow:string):string{
  if(date===today)return "今晚";
  if(date===tomorrow)return "聽晚";
  return hkDayLabel(date);
}

/** The bar reads left to right as certainty decaying: solid for people who committed, hatched for
    the estimate on top, empty for the rest of the club who have not answered. Deliberately not a
    percentage — a member is judging whether to travel, not reading a dashboard. */
function ForecastBar({forecast}:{forecast:NightForecast}){
  const maybe=Math.max(0,forecast.hi-forecast.floor);
  const unanswered=Math.max(1,forecast.counts.mid+forecast.counts.low);
  return <div className="nt-bar" role="img"
    aria-label={`${forecast.floor} 人確定，估計 ${forecast.lo} 至 ${forecast.hi} 人`}>
    {forecast.floor>0&&<i className="nt-bar-sure" style={{flexGrow:forecast.floor}}/>}
    {maybe>0&&<i className="nt-bar-maybe" style={{flexGrow:maybe}}/>}
    <i className="nt-bar-gap" style={{flexGrow:Math.max(1,unanswered-maybe)}}/>
  </div>;
}

/** The confidence dial. One tap is the whole interaction: no sheet, no form, no time window.
    Pressing a level you already hold clears it, so backing out costs exactly as much as opting in. */
function Dial({value,busy,onPick}:{value:Confidence|null;busy:boolean;onPick:(level:Confidence|null)=>void}){
  return <div className="nt-dial" role="group" aria-label="今晚去唔去">
    {LEVELS.map(level=>{
      const active=value===level;
      return <button key={level} type="button" className={`nt-lv nt-lv-${level}${active?" active":""}`}
        disabled={busy} aria-pressed={active} title={CONFIDENCE_HINTS[level]}
        onClick={()=>onPick(active?null:level)}>
        <b>{CONFIDENCE_LABELS[level]}</b>
      </button>;
    })}
  </div>;
}

/** 夠人就去 — the threshold, offered only once a member has hedged.
 *
 *  It is meaningless on 一定去 (already committed) and contradictory on 唔得, so it appears only
 *  where it means something. The number is the member's own: what counts as 「夠人」 is a personal
 *  judgement, and picking it for them would be the product deciding what a good evening is. */
function QuorumPicker({value,busy,floor,onPick}:{value:number|null;busy:boolean;floor:number;onPick:(n:number|null)=>void}){
  const gap=stillNeeded(value,floor);
  return <div className="nt-quorum">
    <div className="nt-quorum-head">
      <span>夠人就去</span>
      <small>{value?gap?`再多 ${gap} 個就自動轉「一定去」`:"已經夠人，會自動轉「一定去」":"揀個數，夠人我哋幫你轉"}</small>
    </div>
    <div className="nt-chips">
      {QUORUM_CHOICES.map(choice=>
        <button key={choice} type="button" className={`nt-chip${value===choice?" active":""}`}
          disabled={busy} aria-pressed={value===choice}
          onClick={()=>onPick(value===choice?null:choice)}>{choice} 個</button>)}
    </div>
  </div>;
}

/** The week, as seven floors and ranges rather than a grid of half-hour cells.
 *  This is what answers 「邊晚最多人」 in one glance — the question the 14-day availability board
 *  made members answer by scanning it themselves. */
function WeekStrip({board,selected,today,tomorrow,onSelect}:{
  board:NightBoard[];selected:string;today:string;tomorrow:string;onSelect:(date:string)=>void;
}){
  return <div className="nt-week" role="tablist" aria-label="揀日子">
    {board.map(night=>{
      const active=night.date===selected;
      const {floor,hi,band}=night.forecast;
      return <button key={night.date} type="button" role="tab" aria-selected={active}
        className={`nt-day${active?" active":""} nt-band-${band}`} onClick={()=>onSelect(night.date)}
        aria-label={`${dayLabel(night.date,today,tomorrow)}，${floor} 人確定，估計最多 ${hi} 人`}>
        <small>{dayLabel(night.date,today,tomorrow)}</small>
        <strong>{hi||"—"}</strong>
        <span>{floor>0?`${floor} 實`:"未有人"}</span>
      </button>;
    })}
  </div>;
}

export function Nights({signedIn,onChanged}:{signedIn:boolean;onChanged?:()=>void}){
  const today=useMemo(()=>hkDate(),[]);
  const tomorrow=useMemo(()=>{
    const d=new Date(`${today}T12:00:00+08:00`);d.setDate(d.getDate()+1);return hkDate(d);
  },[today]);
  const [board,setBoard]=useState<NightBoard[]>([]);
  const [selected,setSelected]=useState(today);
  const [state,setState]=useState<"loading"|"ready"|"error">("loading");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/nights?days=7",{cache:"no-store"});
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error??"場次資料暫時未能載入");
      setBoard(body.board??[]);setState("ready");
    }catch{setState("error")}
  },[]);

  useEffect(()=>{void load();trackAvailabilityEvent("nights_view")},[load]);

  const night=board.find(item=>item.date===selected)??board[0]??null;

  /** One write, and the response is the whole board — so the number moves under the member's thumb
      in the same interaction. The payback for signalling has to be instant and visible; a spinner
      followed by a toast is exactly the void that taught people to stop bothering. */
  const submit=useCallback(async(confidence:Confidence|null,upgradeAt?:number|null)=>{
    if(!night||busy)return;
    setBusy(true);setMessage("");
    try{
      const response=confidence===null
        ?await fetch(`/api/nights?date=${night.date}`,{method:"DELETE"})
        :await fetch("/api/nights",{method:"POST",headers:{"content-type":"application/json"},
            body:JSON.stringify({date:night.date,confidence,
              upgradeAt:upgradeAt===undefined?night.mine?.upgradeAt??null:upgradeAt})});
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error??"暫時儲存唔到");
      setBoard(body.board??[]);
      if(body.youWerePromoted)setMessage("夠人喇 — 你已經轉咗「一定去」。");
      else if(confidence)setMessage(confidence==="out"?"知道喇，今晚唔會再提你。":"收到，隨時可以改。");
      trackAvailabilityEvent(confidence===null?"night_signal_cleared":"night_signal_set");
      onChanged?.();
    }catch(error){setMessage(error instanceof Error?error.message:"網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  },[night,busy,onChanged]);

  if(state==="error")return <section className="nt-card nt-error">
    <p>場次資料暫時載入唔到。</p>
    <Button variant="secondary" onClick={()=>{setState("loading");void load()}}>重試</Button>
  </section>;

  if(state==="loading"||!night)return <section className="nt-card nt-skeleton" aria-busy="true">
    <span className="nt-kicker">今晚</span><div className="nt-skeleton-bar"/>
  </section>;

  const {forecast}=night;
  const gap=stillNeeded(night.mine?.upgradeAt??null,forecast.floor);

  return <section className="nt-card">
    <header className="nt-head">
      <div>
        <span className="nt-kicker">{dayLabel(night.date,today,tomorrow)} · 會所</span>
        <p className="nt-headline">{forecastHeadline(forecast)}</p>
      </div>
      <div className="nt-band">
        <span className="nt-kicker">開到檯機會</span>
        <b className={`nt-band-${forecast.band}`}>{BAND_LABELS[forecast.band]}</b>
      </div>
    </header>

    <ForecastBar forecast={forecast}/>

    <div className="nt-key">
      <span><i className="nt-key-sure"/>一定去 {forecast.counts.high}</span>
      <span><i className="nt-key-maybe"/>應該／睇下先 {forecast.counts.mid+forecast.counts.low}</span>
      {forecast.conditional>0&&<span><i className="nt-key-cond"/>夠人就去 {forecast.conditional}</span>}
    </div>

    {/* Faces, not a roster. Only the members who committed — a hedge is counted and never named. */}
    {night.confirmed.length>0&&<div className="nt-faces">
      {night.confirmed.map(player=><PlayerBadge key={player.id} player={player}/>)}
    </div>}

    {signedIn?<>
      <Dial value={night.mine?.confidence??null} busy={busy} onPick={level=>void submit(level)}/>
      {night.mine&&night.mine.confidence!=="high"&&night.mine.confidence!=="out"&&
        <QuorumPicker value={night.mine.upgradeAt} busy={busy} floor={forecast.floor}
          onPick={n=>void submit(night.mine!.confidence,n)}/>}
      {night.mine?.promoted&&<p className="nt-promoted" role="status">夠人喇 — 你設咗嘅條件已經達到，所以你而家係「一定去」。</p>}
      {gap!==null&&!night.mine?.promoted&&<p className="nt-note">再多 {gap} 個人確定，你就會自動轉「一定去」。</p>}
    </>:<p className="nt-note">登入之後就可以話畀大家知你今晚去唔去。</p>}

    {message&&<p key={message} className="nt-message" role="status">{message}</p>}

    <WeekStrip board={board} selected={selected} today={today} tomorrow={tomorrow} onSelect={date=>{
      setSelected(date);setMessage("");trackAvailabilityEvent("nights_date_select");
    }}/>
  </section>;
}
