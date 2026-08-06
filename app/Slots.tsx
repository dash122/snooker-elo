"use client";
import { useCallback, useEffect, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { addDaysHongKong, hkClock, hkDate, hkDayLabel, hongKongInstant } from "../lib/availability";
import { conditionChips, handoffMessage, shareMessage, slotStatus, sortPostedSlots, visiblePostedSlots,
  whatsappShareUrl, type FillRule, type SlotConditions } from "../lib/slots";

/* --- 開局卡 -------------------------------------------------------------
 *
 * One primitive, three moments: 開局（後 posting a slot, with a fill rule and conditions decided up
 * front, against an empty screen, at zero social cost）、舉手（raising a hand — non-exclusive,
 * retractable, invisible to everyone but the poster）、and 夾到（the hand-off — the app's job ends
 * the moment two people can reach each other, so the largest button on a filled card opens
 * WhatsApp）.
 *
 * Nothing here reads a name off a public list before a slot is filled. The board carries no hand
 * count. A `review`-rule slot's pending hands are fetched only for its own poster, by the API, not
 * filtered client-side — there is no payload to leak in the first place. */

type Player={id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
type PostedSlot={
  id:string;playerId:string;startAt:string;endAt:string;venue:string;note:string;
  fillRule:FillRule;conditions:SlotConditions;filledBy:string|null;filledAt:string|null;result:"pending"|"played"|"missed";
  cancelledAt?:string|null;
};
type BoardSlot=PostedSlot&{player:Player};
type PendingHand={playerId:string;raisedAt:string;player:Player};
type MineSlot=PostedSlot&{filler:Player|null;hands:PendingHand[]};
type MyHand={slotId:string;raisedAt:string;slot:PostedSlot&{player:Player}};
type Board={
  signedIn:boolean; board:BoardSlot[]; mine:MineSlot[]; hands:MyHand[];
  waitingForMe?:number; wantTonight?:number; openCount?:number;
};

const when=(slot:{startAt:string;endAt:string})=>{
  const day=hkDate(new Date(slot.startAt));
  const label=day===hkDate()?"今晚":day===addDaysHongKong(hkDate(),1)?"聽日":hkDayLabel(day);
  return `${label} ${hkClock(slot.startAt)}–${hkClock(slot.endAt)}`;
};

const TIMES=Array.from({length:32},(_,index)=>`${String(10+Math.floor(index/2)).padStart(2,"0")}:${index%2?"30":"00"}`);

/* --- Composer ---------------------------------------------------------- */

function Composer({onCreate,onClose,busy,error}:{
  onCreate:(input:{startAt:string;endAt:string;venue:string;fillRule:FillRule;conditions:SlotConditions})=>void;
  onClose:()=>void; busy:boolean; error:string;
}){
  const [date,setDate]=useState(hkDate());
  const [start,setStart]=useState("19:00");
  const [end,setEnd]=useState("21:00");
  const [venue,setVenue]=useState("");
  const [fillRule,setFillRule]=useState<FillRule>("first");
  const [conditions,setConditions]=useState<SlotConditions>({});
  const toggle=(key:keyof SlotConditions)=>setConditions(value=>({...value,[key]:!value[key]}));

  return <div className="backdrop invite-backdrop" onMouseDown={onClose}>
    <section className="sheet invite-sheet sl-composer" onMouseDown={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-slot">
      <button type="button" className="close" aria-label="關閉" onClick={onClose}>×</button>
      <h2 id="new-slot">開一張局</h2>
      <p className="sub">留一段時間出嚟，我哋將佢公開俾成個會所。</p>

      <div className="composer-times">
        <label><span>日期</span><input type="date" min={hkDate()} value={date} onChange={event=>setDate(event.target.value)}/></label>
        <label><span>開始</span><select value={start} onChange={event=>setStart(event.target.value)}>{TIMES.map(time=><option key={time}>{time}</option>)}</select></label>
        <label><span>結束</span><select value={end} onChange={event=>setEnd(event.target.value)}>{TIMES.map(time=><option key={time}>{time}{time<=start?" · 次日":""}</option>)}</select></label>
      </div>
      <label className="invite-message-field"><span>枱位（可省略）</span>
        <input type="text" maxLength={60} value={venue} placeholder="例如：已訂 3 號枱" onChange={event=>setVenue(event.target.value)}/></label>

      <div className="sl-field">
        <span className="sl-label">想打一場點樣嘅局 · 可以唔揀</span>
        <div className="sl-chips">
          <button type="button" className={conditions.handicap?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.handicap)} onClick={()=>toggle("handicap")}>要讓分</button>
          <button type="button" className={conditions.noSmoking?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.noSmoking)} onClick={()=>toggle("noSmoking")}>無煙</button>
          <button type="button" className={conditions.levelOnly?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.levelOnly)} onClick={()=>toggle("levelOnly")}>水平接近</button>
          <button type="button" className={conditions.tableBooked?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.tableBooked)} onClick={()=>toggle("tableBooked")}>已訂枱</button>
        </div>
      </div>

      <div className="sl-field">
        <span className="sl-label">點填呢張局</span>
        <div className="seg" role="group" aria-label="點填呢張局">
          <span className={fillRule==="first"?"on":""} role="button" tabIndex={0} aria-pressed={fillRule==="first"}
            onClick={()=>setFillRule("first")}>先舉先得</span>
          <span className={fillRule==="review"?"on":""} role="button" tabIndex={0} aria-pressed={fillRule==="review"}
            onClick={()=>setFillRule("review")}>我想睇下先</span>
        </div>
        <p className="sl-hint">{fillRule==="first"?"第一個舉手嘅人就成事，唔使你揀。":"舉手名單淨係你自己見到，你隨時可以揀一個。"}</p>
      </div>

      {error&&<p className="availability-form-error" role="alert">{error}</p>}
      <button type="button" className="primary full" disabled={busy} onClick={()=>{
        const endDate=end<=start?addDaysHongKong(date,1):date;
        onCreate({startAt:hongKongInstant(date,start),endAt:hongKongInstant(endDate,end),venue,fillRule,conditions});
      }}>{busy?"開緊…":`開 ${start}–${end}`}</button>
    </section>
  </div>;
}

/* --- Board row ----------------------------------------------------------- */

function BoardRow({entry,raisedByMe,busy,onRaise,onRetract}:{
  entry:BoardSlot; raisedByMe:boolean; busy:boolean; onRaise:()=>void; onRetract:()=>void;
}){
  const chips=conditionChips(entry.conditions);
  return <li className="sl-row">
    <PlayerBadge player={entry.player}/>
    <span className="sl-row-copy">
      <b>{entry.player.name}</b>
      <small>ELO {Math.round(entry.player.rating)} · {when(entry)}{entry.venue?` · ${entry.venue}`:""}</small>
      {chips.length>0&&<span className="sl-chips sl-chips-compact">{chips.map(chip=><i key={chip}>{chip}</i>)}</span>}
    </span>
    {raisedByMe
      ? <button type="button" className="secondary" disabled={busy} onClick={onRetract}>已舉手 · 收返</button>
      : <button type="button" className="primary" disabled={busy} onClick={onRaise}>舉手</button>}
  </li>;
}

/* --- Hand-off card --------------------------------------------------------- */

function HandoffCard({slot,opponent,onResult,busy}:{
  slot:PostedSlot; opponent:Player|null; onResult:(result:"played"|"missed")=>void; busy:boolean;
}){
  const status=slotStatus(slot);
  const text=opponent?handoffMessage({venue:slot.venue,whenLabel:when(slot)}):"";
  return <div className="sl-handoff">
    {opponent&&<div className="sl-who"><PlayerBadge player={opponent}/><span><b>{opponent.name}</b><small>ELO {Math.round(opponent.rating)}</small></span></div>}
    <div className="sl-meta"><span>{when(slot)}</span>{slot.venue&&<span>{slot.venue}</span>}</div>
    {conditionChips(slot.conditions).length>0&&<div className="sl-chips">{conditionChips(slot.conditions).map(chip=><span key={chip} className="sl-chip">{chip}</span>)}</div>}
    {(status==="filled")&&<>
      <a className="primary full" href={whatsappShareUrl(text)} target="_blank" rel="noreferrer">WhatsApp {opponent?.name??"佢"}</a>
      <button type="button" className="secondary full" onClick={()=>void navigator.clipboard?.writeText(text)}>複製聯絡文字</button>
    </>}
    {status==="toRecord"&&<>
      <p className="sl-kick">打完喇？</p>
      <div className="btn-row"><button type="button" className="primary" disabled={busy} onClick={()=>onResult("played")}>打咗</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>onResult("missed")}>冇打成</button></div>
    </>}
    {status==="done"&&<p className="sl-muted">{slot.result==="played"?"打咗喇，記得去記分。":"呢一節冇約成。"}</p>}
  </div>;
}

/* --- My posted slots ------------------------------------------------------- */

function MineCard({item,busyId,onPick,onCancel,onResult,onShare}:{
  item:MineSlot; busyId:string|null;
  onPick:(playerId:string)=>void; onCancel:()=>void; onResult:(result:"played"|"missed")=>void; onShare:()=>void;
}){
  const status=slotStatus(item);
  return <article className={`ses-card sl-mine is-${status}`}>
    <header className="ses-head">
      <div><b>{when(item)}</b>{item.venue&&<small>{item.venue}</small>}</div>
      {status==="open"&&<button type="button" className="ses-drop" aria-label="取消呢張局" onClick={onCancel}>✕</button>}
    </header>
    {conditionChips(item.conditions).length>0&&<div className="sl-chips">{conditionChips(item.conditions).map(chip=><span key={chip} className="sl-chip">{chip}</span>)}</div>}

    {status==="open"&&item.fillRule==="first"&&<p className="sl-muted">先舉先得 · 第一個舉手嘅人就成事</p>}

    {status==="open"&&item.fillRule==="review"&&(item.hands.length
      ? <div className="sl-hands">
          <p className="sl-kick">得你一個見到 · {item.hands.length} 人舉咗手</p>
          {item.hands.map(hand=><div className="hand" key={hand.playerId}>
            <PlayerBadge player={hand.player}/>
            <span className="grow"><b>{hand.player.name}</b><small>ELO {Math.round(hand.player.rating)}</small></span>
            <button type="button" className="mini" disabled={busyId===hand.playerId} onClick={()=>onPick(hand.playerId)}>確認</button>
          </div>)}
        </div>
      : <p className="sl-muted">仲未有人舉手。</p>)}

    {(status==="open")&&<button type="button" className="secondary full" onClick={onShare}>分享落 WhatsApp</button>}

    {(status==="filled"||status==="toRecord"||status==="done")&&
      <HandoffCard slot={item} opponent={item.filler} onResult={onResult} busy={busyId===item.id}/>}
  </article>;
}

/* --- My hands tray ---------------------------------------------------------- */

function HandsTray({hands,busyId,onRetract,onRetractAll,onResult}:{
  hands:MyHand[]; busyId:string|null;
  onRetract:(slotId:string)=>void; onRetractAll:()=>void;
  onResult:(slotId:string,result:"played"|"missed",opponentId:string,startAt:string)=>void;
}){
  if(!hands.length)return null;
  const open=hands.filter(hand=>slotStatus(hand.slot)==="open");
  const filled=hands.filter(hand=>slotStatus(hand.slot)!=="open");
  return <section className="availability-card mm-card sl-hands-tray" aria-label="你舉咗嘅手">
    <header className="mm-head"><div><h3>你舉咗嘅手</h3><small>{open.length>0?`${open.length} 張 · 最多夾一張`:"未過"}</small></div>
      {open.length>1&&<button type="button" className="more" onClick={onRetractAll}>今晚唔得 · 全部收返</button>}</header>
    {open.map(hand=><div className="sl-row" key={hand.slotId}>
      <PlayerBadge player={hand.slot.player}/>
      <span className="sl-row-copy"><b>{hand.slot.player.name}</b><small>{when(hand.slot)}{hand.slot.venue?` · ${hand.slot.venue}`:""}</small></span>
      <button type="button" className="secondary" disabled={busyId===hand.slotId} onClick={()=>onRetract(hand.slotId)}>收返</button>
    </div>)}
    {filled.map(hand=><div className="sl-mine-hand" key={hand.slotId}>
      <HandoffCard slot={hand.slot} opponent={hand.slot.player}
        onResult={result=>onResult(hand.slotId,result,hand.slot.player.id,hand.slot.startAt)}
        busy={busyId===hand.slotId}/>
    </div>)}
  </section>;
}

/* --- The tab ---------------------------------------------------------------- */

export function Slots({signedIn,onRecord,onChanged}:{
  signedIn:boolean; onRecord:(opponentId:string,playedOn:string)=>void; onChanged:()=>void;
}){
  const [data,setData]=useState<Board|null>(null);
  const [composing,setComposing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [toast,setToast]=useState("");

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/slots");
      if(!response.ok)return;
      setData(await response.json());
    }catch{/* a failed poll leaves the last cards on screen rather than blanking the tab */}
  },[]);

  useEffect(()=>{
    if(!signedIn){setData({signedIn:false,board:[],mine:[],hands:[]});return}
    void load();
    const id=window.setInterval(()=>{if(document.visibilityState==="visible")void load()},45_000);
    return ()=>window.clearInterval(id);
  },[load,signedIn]);

  const wantTonight=async()=>{
    try{await fetch("/api/intents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"standby"})})}
    finally{await load()}
  };

  const create=async(input:{startAt:string;endAt:string;venue:string;fillRule:FillRule;conditions:SlotConditions})=>{
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/slots",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){setError(body.error??"開唔到，試多次。");return}
      trackAvailabilityEvent("session_created");
      setComposing(false);
      await load();onChanged();
    }catch{setError("網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  };

  const patch=async(id:string,body:Record<string,unknown>)=>{
    const response=await fetch(`/api/slots/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const parsed=await response.json().catch(()=>({}));
    if(!response.ok)setToast(parsed.error??"操作唔到，試多次。");
    return {ok:response.ok,body:parsed};
  };

  const raise=async(id:string)=>{
    setBusyId(id);
    try{await patch(id,{action:"raise"});await load()}
    finally{setBusyId(null)}
  };
  const retract=async(id:string)=>{
    setBusyId(id);
    try{await patch(id,{action:"retract"});await load()}
    finally{setBusyId(null)}
  };
  const retractAll=async()=>{
    const open=(data?.hands??[]).filter(hand=>slotStatus(hand.slot)==="open");
    if(!open.length)return;
    const startAt=open.reduce((min,hand)=>hand.slot.startAt<min?hand.slot.startAt:min,open[0].slot.startAt);
    const endAt=open.reduce((max,hand)=>hand.slot.endAt>max?hand.slot.endAt:max,open[0].slot.endAt);
    await patch(open[0].slotId,{action:"retract-window",startAt,endAt});
    await load();
  };
  const cancel=async(id:string)=>{
    setBusyId(id);
    try{await patch(id,{action:"cancel"});await load();onChanged()}
    finally{setBusyId(null)}
  };
  const pick=async(id:string,playerId:string)=>{
    setBusyId(playerId);
    try{await patch(id,{action:"pick",playerId});await load();onChanged()}
    finally{setBusyId(null)}
  };
  /** `opponentId` is supplied by the caller rather than looked up here, because which side of the
      slot is "the opponent" depends on whether this was one of my own posts or a hand I raised —
      `MineCard` and `HandsTray` each already know their own answer. */
  const result=async(id:string,value:"played"|"missed",opponentId:string|null,startAt:string)=>{
    setBusyId(id);
    try{
      await patch(id,{action:"result",result:value});
      if(value==="played"&&opponentId)onRecord(opponentId,hkDate(new Date(startAt)));
      await load();onChanged();
    } finally{setBusyId(null)}
  };
  const share=(id:string)=>{
    const slot=[...(data?.mine??[]),...(data?.hands??[]).map(hand=>hand.slot)].find(item=>item.id===id);
    const url=`${window.location.origin}/s/${id}`;
    const text=shareMessage({whenLabel:slot?when(slot):"",venue:slot?.venue??"",url});
    if(navigator.share)void navigator.share({text,url}).catch(()=>{});
    else{void navigator.clipboard?.writeText(text);setToast("已複製分享文字")}
  };

  if(!signedIn)return <section className="availability-card mm-card">
    <h2 className="ses-signin">登入後即可開局</h2>
    <p className="mm-note">連結球員檔案，就可以開局、舉手同約戰。</p>
  </section>;

  if(data===null)return <div className="availability-skeleton" aria-hidden="true"/>;

  const myRaisedIds=new Set((data.hands??[]).filter(hand=>slotStatus(hand.slot)==="open").map(hand=>hand.slotId));
  const mine=visiblePostedSlots(sortPostedSlots(data.mine));

  return <>
    <section className="availability-card mm-card sl-demand">
      <p>{(data.wantTonight??0)>0
        ? <>今晚 <b>{data.wantTonight}</b> 個人話想打，得 <b>{data.openCount??0}</b> 個開咗局。</>
        : <>而家未有人話想打 — 做第一個。</>}</p>
      <div className="btn-row">
        <button type="button" className="primary" onClick={()=>setComposing(true)}>開一張局</button>
        <button type="button" className="secondary" onClick={()=>void wantTonight()}>我都想打，但未定得幾時</button>
      </div>
      {(data.waitingForMe??0)>0&&<p className="sl-muted">有 <b>{data.waitingForMe}</b> 個人等緊你開局。</p>}
    </section>

    {mine.length>0&&<section className="ses-list" aria-label="你嘅局">
      {mine.map(item=><MineCard key={item.id} item={item} busyId={busyId}
        onPick={playerId=>void pick(item.id,playerId)}
        onCancel={()=>void cancel(item.id)}
        onResult={value=>void result(item.id,value,item.filledBy,item.startAt)}
        onShare={()=>share(item.id)}/>)}
    </section>}

    <HandsTray hands={data.hands??[]} busyId={busyId} onRetract={id=>void retract(id)} onRetractAll={()=>void retractAll()}
      onResult={(id,value,opponentId,startAt)=>void result(id,value,opponentId,startAt)}/>

    <section className="availability-card mm-card sl-board" aria-label="大家開緊嘅局">
      <header className="mk-head"><h3>大家開緊嘅局</h3><small>{data.board.length} 張</small></header>
      {data.board.length
        ? <ul className="sl-list">{data.board.map(entry=>
            <BoardRow key={entry.id} entry={entry} raisedByMe={myRaisedIds.has(entry.id)} busy={busyId===entry.id}
              onRaise={()=>void raise(entry.id)} onRetract={()=>void retract(entry.id)}/>)}</ul>
        : <p className="mm-note">而家未有人開局。開一張，等下一個人見到。</p>}
    </section>

    {error&&!composing&&<p className="availability-form-error" role="alert">{error}</p>}
    {toast&&<p key={toast} className="availability-notice" role="status">{toast}</p>}

    {composing&&<Composer busy={busy} error={error} onClose={()=>{setComposing(false);setError("")}} onCreate={create}/>}
  </>;
}
