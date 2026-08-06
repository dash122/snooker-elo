"use client";
import { useCallback, useEffect, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { addDaysHongKong, hkClock, hkDate, hkDayLabel, hongKongInstant } from "../lib/availability";
import { conditionChips, handoffMessage, handsLine, shareMessage, slotStatus, sortPostedSlots,
  takeActionLabel, visiblePostedSlots, whatsappShareUrl,
  type FillRule, type HandsView, type SlotConditions } from "../lib/slots";

/* --- 開局卡 -------------------------------------------------------------
 *
 * One primitive, three moments: 開局（後 posting a slot, with a fill rule and conditions decided up
 * front, against an empty screen, at zero social cost）、舉手（raising a hand — non-exclusive,
 * retractable, invisible to everyone but the poster）、and 夾到（the hand-off — the app's job ends
 * the moment two people can reach each other, so the largest button on a filled card opens
 * WhatsApp）.
 *
 * Two rules govern what a card may say. **Counts are public** — every row shows how many hands are
 * up, because 「3 人舉咗手」 and a row saying nothing are different objects to somebody deciding
 * whether to bother, and a board that hides interest manufactures the silence that stops anyone
 * posting. **Names of people still waiting are not** — that is the part that would let somebody work
 * out they were passed over, and it is fetched only for a slot's own poster, by the API, never
 * filtered client-side, so there is no payload to leak in the first place. Accepted names are
 * public: an accepted player is the reason the next member joins.
 *
 * And no card ever prints 「0 人舉手」. See `handsLine`. */

type Player={id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
type PostedSlot={
  id:string;playerId:string;startAt:string;endAt:string;venue:string;note:string;createdAt:string;
  fillRule:FillRule;conditions:SlotConditions;filledBy:string|null;filledAt:string|null;result:"pending"|"played"|"missed";
  cancelledAt?:string|null;closedAt?:string|null;
};
/** Counts and accepted names travel with every board row; `hands` on a MineSlot is the waiting list
    with names, and only ever reaches its own poster. */
type BoardSlot=PostedSlot&{player:Player;mine:boolean;hands:HandsView;acceptedPlayers:Player[];iRaised:boolean;iAccepted:boolean};
type PendingHand={playerId:string;raisedAt:string;state:"raised"|"accepted";player:Player};
type MineSlot=PostedSlot&{mine:true;filler:Player|null;hands:PendingHand[];counts:HandsView;acceptedPlayers:Player[]};
type MyHand={slotId:string;raisedAt:string;accepted:boolean;slot:PostedSlot&{player:Player}};
type Board={
  signedIn:boolean; canAct?:boolean; board:BoardSlot[]; mine:MineSlot[]; hands:MyHand[];
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

      {/* Note what is not asked: how many people. That number cannot be answered honestly before
          anybody has turned up, and once hands can be taken in bulk it never has to be — so there
          is no capacity field, and no 單挑/開枱 mode to pick between. The only switch is whether the
          poster wants to look first. */}
      <div className="sl-field">
        <span className="sl-label">要唔要自己揀</span>
        <div className="seg" role="group" aria-label="要唔要自己揀">
          <span className={fillRule==="first"?"on":""} role="button" tabIndex={0} aria-pressed={fillRule==="first"}
            onClick={()=>setFillRule("first")}>第一個就算</span>
          <span className={fillRule==="review"?"on":""} role="button" tabIndex={0} aria-pressed={fillRule==="review"}
            onClick={()=>setFillRule("review")}>我想睇下先</span>
        </div>
        <p className="sl-hint">{fillRule==="first"
          ?"第一個舉手嘅人就即刻成事。之後仲有人舉手，你想收幾多個都得。"
          :"舉手名單淨係你自己見到。收一個、收幾個、定全部收，到時先算。"}</p>
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

function BoardRow({entry,raisedByMe,canAct,busy,onRaise,onRetract}:{
  entry:BoardSlot; raisedByMe:boolean; canAct:boolean; busy:boolean; onRaise:()=>void; onRetract:()=>void;
}){
  const chips=conditionChips(entry.conditions);
  /* Never "0 人舉手" — that is a verdict, not a status. An empty slot is in fact the best one on the
     board to raise a hand on (no competition, and on a 第一個就算 slot it settles on the spot), so it
     says so. */
  const line=handsLine({hands:entry.hands,mine:false,iRaised:raisedByMe,
    fillRule:entry.fillRule,createdAt:entry.createdAt});
  return <li className="sl-row">
    <PlayerBadge player={entry.player}/>
    <span className="sl-row-copy">
      <b>{entry.player.name}</b>
      <small>ELO {Math.round(entry.player.rating)} · {when(entry)}{entry.venue?` · ${entry.venue}`:""}</small>
      {chips.length>0&&<span className="sl-chips sl-chips-compact">{chips.map(chip=><i key={chip}>{chip}</i>)}</span>}
      <small className="sl-hands-line">{line}</small>
      {/* Who is already coming, named. Nobody still waiting is. */}
      {entry.acceptedPlayers.length>0&&<span className="sl-faces">
        {entry.acceptedPlayers.slice(0,4).map(player=><PlayerBadge key={player.id} player={player}/>)}
      </span>}
    </span>
    {entry.iAccepted
      ? <span className="sl-taken">已經收咗你</span>
      : raisedByMe
        ? <button type="button" className="secondary" disabled={busy} onClick={onRetract}>已舉手 · 收返</button>
        : canAct&&<button type="button" className="primary" disabled={busy} onClick={onRaise}>舉手</button>}
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

function MineCard({item,busyId,onAccept,onAcceptAll,onStopTaking,onCancel,onResult,onShare}:{
  item:MineSlot; busyId:string|null;
  onAccept:(playerId:string)=>void; onAcceptAll:()=>void; onStopTaking:()=>void;
  onCancel:()=>void; onResult:(result:"played"|"missed")=>void; onShare:()=>void;
}){
  const status=slotStatus(item);
  const waiting=item.hands.filter(hand=>hand.state==="raised");
  const accepted=item.hands.filter(hand=>hand.state==="accepted");
  const takeAll=takeActionLabel(item.counts);
  const taking=!item.closedAt&&status!=="expired"&&status!=="done";
  return <article className={`ses-card sl-mine is-${status}`}>
    <header className="ses-head">
      <div><b>{when(item)}</b>{item.venue&&<small>{item.venue}</small>}</div>
      {/* One tap, no reason field. A cancellation that has to be justified is one members avoid
          making, and the dead card they leave up instead is worse for everyone waiting on it. */}
      {taking&&<button type="button" className="ses-drop" aria-label="取消呢張局" onClick={onCancel}>✕</button>}
    </header>
    {conditionChips(item.conditions).length>0&&<div className="sl-chips">{conditionChips(item.conditions).map(chip=><span key={chip} className="sl-chip">{chip}</span>)}</div>}

    {/* Elapsed time, never "0 人舉手" — the number nobody needs to see at the exact moment they are
        most likely to delete the post and never make another one. */}
    {taking&&<p className="sl-hands-line">{handsLine({hands:item.counts,mine:true,iRaised:false,
      fillRule:item.fillRule,createdAt:item.createdAt})}</p>}

    {accepted.length>0&&<div className="sl-hands">
      <p className="sl-kick">已經收咗 · {accepted.length} 人</p>
      {accepted.map(hand=><div className="hand" key={hand.playerId}>
        <PlayerBadge player={hand.player}/>
        <span className="grow"><b>{hand.player.name}</b><small>ELO {Math.round(hand.player.rating)}</small></span>
      </div>)}
    </div>}

    {taking&&waiting.length>0&&<div className="sl-hands">
      <p className="sl-kick">舉緊手 · {waiting.length} 人<small>得你一個見到呢個名單</small></p>
      {waiting.map(hand=><div className="hand" key={hand.playerId}>
        <PlayerBadge player={hand.player}/>
        <span className="grow"><b>{hand.player.name}</b><small>ELO {Math.round(hand.player.rating)}</small></span>
        <button type="button" className="mini" disabled={busyId===hand.playerId} onClick={()=>onAccept(hand.playerId)}>收</button>
      </div>)}
      {/* The one button this whole change exists for. Being made to read three names and confirm one
          is what stops people posting again; taking everybody is not a bulk shortcut, it is the
          default that means nobody was turned down. */}
      {takeAll&&<button type="button" className="primary full" disabled={Boolean(busyId)} onClick={onAcceptAll}>{takeAll}</button>}
    </div>}

    {taking&&<button type="button" className="secondary full" onClick={onShare}>分享落 WhatsApp</button>}
    {/* Distinct from cancelling: the evening still happens, it just stops taking people. Whoever is
        still waiting sees a slot that filled — the same thing they would have seen had the poster
        never opened the list. */}
    {taking&&item.counts.accepted>0&&<button type="button" className="more" disabled={Boolean(busyId)} onClick={onStopTaking}>夠喇 · 唔再收</button>}

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
  /* Split on *my* acceptance, not on the slot's status. A slot that took somebody else is still one
     I am waiting on — showing me a hand-off card for it would tell me I have a game I do not have,
     and showing it as lost would tell me about a competition I am not supposed to see. */
  const open=hands.filter(hand=>!hand.accepted);
  const filled=hands.filter(hand=>hand.accepted);
  return <section className="availability-card mm-card sl-hands-tray" aria-label="你舉咗嘅手">
    <header className="mm-head"><div><h3>你舉咗嘅手</h3><small>{open.length>0?`${open.length} 張 · 舉幾多張都得`:"未過"}</small></div>
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

  /* Loads for everyone, signed in or not. "Is anybody playing tonight" is the question this screen
     is most often opened with, and the one it would be perverse to charge an account for — a club
     that looks empty to a visitor stays empty. */
  useEffect(()=>{
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
    const open=(data?.hands??[]).filter(hand=>!hand.accepted);
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
  const accept=async(id:string,playerId:string)=>{
    setBusyId(playerId);
    try{await patch(id,{action:"accept",playerId});await load();onChanged()}
    finally{setBusyId(null)}
  };
  /** 全部收. Not a bulk convenience — it is the default that means nobody was turned down, so it is
      one request rather than a loop the poster could half-finish. */
  const acceptAll=async(id:string)=>{
    setBusyId(id);
    try{await patch(id,{action:"accept-all"});await load();onChanged()}
    finally{setBusyId(null)}
  };
  const stopTaking=async(id:string)=>{
    setBusyId(id);
    try{await patch(id,{action:"close"});await load();onChanged()}
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

  if(data===null)return <div className="availability-skeleton" aria-hidden="true"/>;

  const canAct=Boolean(data.canAct);
  const myRaisedIds=new Set((data.hands??[]).filter(hand=>!hand.accepted).map(hand=>hand.slotId));
  const mine=visiblePostedSlots(sortPostedSlots(data.mine)) as MineSlot[];

  const board=<section className="availability-card mm-card sl-board" aria-label="大家開緊嘅局">
    <header className="mk-head"><h3>大家開緊嘅局</h3>
      <small>{data.board.length} 張{(()=>{const hands=data.board.reduce((total,slot)=>total+slot.hands.total,0);
        return hands>0?` · ${hands} 人舉咗手`:""})()}</small></header>
    {data.board.length
      ? <ul className="sl-list">{data.board.map(entry=>
          <BoardRow key={entry.id} entry={entry} raisedByMe={myRaisedIds.has(entry.id)} canAct={canAct}
            busy={busyId===entry.id}
            onRaise={()=>void raise(entry.id)} onRetract={()=>void retract(entry.id)}/>)}</ul>
      : <p className="mm-note">而家未有人開局。開一張，等下一個人見到。</p>}
  </section>;

  /* Signed out: the whole board, and nothing pretending to be actionable. No login wall, no blur,
     no modal — the line at the bottom says what signing in *adds*, not what it unlocks. */
  if(!signedIn)return <>
    {board}
    <section className="availability-card mm-card">
      <p className="mm-note">睇邊個開緊局唔使登入。登入之後就可以開局同舉手。</p>
    </section>
  </>;

  return <>
    <section className="availability-card mm-card sl-demand">
      <p>{(data.wantTonight??0)>0
        ? <>今晚 <b>{data.wantTonight}</b> 個人話想打，得 <b>{data.openCount??0}</b> 個開咗局。</>
        : <>而家未有人話想打 — 做第一個。</>}</p>
      <div className="btn-row">
        <button type="button" className="primary" onClick={()=>setComposing(true)}>開一張局</button>
        {/* Was 「我都想打，但未定得幾時」, whose only effect was to increment a counter we look at —
            so nobody pressed it twice. The wording now names what the presser gets. */}
        <button type="button" className="secondary" onClick={()=>void wantTonight()}>有局就 send 我</button>
      </div>
      {(data.waitingForMe??0)>0&&<p className="sl-muted">有 <b>{data.waitingForMe}</b> 個人等緊你開局。</p>}
    </section>

    {/* Pinned above the board, not filed into a section of its own: this club fits its whole
        evening on one screen, and splitting four cards into two lists of two makes both look empty.
        What differs is the card, not the section. */}
    {mine.length>0&&<section className="ses-list" aria-label="你嘅局">
      {mine.map(item=><MineCard key={item.id} item={item} busyId={busyId}
        onAccept={playerId=>void accept(item.id,playerId)}
        onAcceptAll={()=>void acceptAll(item.id)}
        onStopTaking={()=>void stopTaking(item.id)}
        onCancel={()=>void cancel(item.id)}
        onResult={value=>void result(item.id,value,item.filledBy,item.startAt)}
        onShare={()=>share(item.id)}/>)}
    </section>}

    <HandsTray hands={data.hands??[]} busyId={busyId} onRetract={id=>void retract(id)} onRetractAll={()=>void retractAll()}
      onResult={(id,value,opponentId,startAt)=>void result(id,value,opponentId,startAt)}/>

    {board}

    {error&&!composing&&<p className="availability-form-error" role="alert">{error}</p>}
    {toast&&<p key={toast} className="availability-notice" role="status">{toast}</p>}

    {composing&&<Composer busy={busy} error={error} onClose={()=>{setComposing(false);setError("")}} onCreate={create}/>}
  </>;
}
