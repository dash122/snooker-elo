"use client";
import { useCallback, useEffect, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { Button, ChipRow, IconButton, SegmentedControl, Skeleton, SlidingToggleGroup } from "./components/ui/Primitives";
import { BackdropSheet } from "./components/ui/Overlay";
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

  return <BackdropSheet onClose={onClose} labelledBy="new-slot" className="sl-composer" shellClassName="match-entry-sheet">
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
        <span className="sl-label">想打一場點樣嘅局 <em>可以唔揀</em></span>
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
        {/* Real buttons rather than click-handled spans: keyboard, screen readers and a proper
            44px tap target all come free, and none of them did before. */}
        <SegmentedControl label="要唔要自己揀" value={fillRule} onChange={value=>setFillRule(value as FillRule)}
          items={[{value:"first",label:"第一個就算"},{value:"review",label:"我想睇下先"}]}/>
        <p className="sl-hint">{fillRule==="first"
          ?"第一個舉手嘅人就即刻成事。之後仲有人舉手，你想收幾多個都得。"
          :"舉手名單淨係你自己見到。收一個、收幾個、定全部收，到時先算。"}</p>
      </div>

      {error&&<p className="availability-form-error" role="alert">{error}</p>}
      <Button variant="primary" className="sl-primary" disabled={busy} onClick={()=>{
        const endDate=end<=start?addDaysHongKong(date,1):date;
        onCreate({startAt:hongKongInstant(date,start),endAt:hongKongInstant(endDate,end),venue,fillRule,conditions});
      }}>{busy?"開緊…":`開 ${start}–${end}`}</Button>
  </BackdropSheet>;
}

/* --- Hand-off card --------------------------------------------------------- */

function HandoffCard({slot,opponent,onResult,busy,showWho=true}:{
  slot:PostedSlot; opponent:Player|null; onResult:(result:"played"|"missed")=>void; busy:boolean;
  /** Suppressed when the card already lists the accepted players directly above — naming the same
      person twice in one card reads as two different people until you look twice. */
  showWho?:boolean;
}){
  const status=slotStatus(slot);
  const text=opponent?handoffMessage({venue:slot.venue,whenLabel:when(slot)}):"";
  /* The app's job ends here, so the WhatsApp link is the one thing with primary weight — bigger than
     anything above it, and the only full-width control in the card. */
  return <div className="sl-handoff">
    {showWho&&opponent&&<div className="next-up">
      <PlayerBadge player={opponent}/>
      <span className="next-up-copy"><b>{opponent.name}</b>
        <small>ELO {Math.round(opponent.rating)} · {when(slot)}{slot.venue?` · ${slot.venue}`:""}</small></span>
    </div>}
    <ChipRow items={conditionChips(slot.conditions)}/>
    {(status==="filled")&&<>
      <a className="primary sl-primary" href={whatsappShareUrl(text)} target="_blank" rel="noreferrer">WhatsApp {opponent?.name??"佢"}</a>
      <Button variant="quiet" className="sl-wide-link" onClick={()=>void navigator.clipboard?.writeText(text)}>複製聯絡文字</Button>
    </>}
    {status==="toRecord"&&<>
      <p className="sl-kick">打完喇？</p>
      <div className="sl-two">
        <Button disabled={busy} onClick={()=>onResult("played")}>打咗</Button>
        <Button variant="secondary" disabled={busy} onClick={()=>onResult("missed")}>冇打成</Button>
      </div>
    </>}
    {status==="done"&&<p className="sl-status is-quiet">{slot.result==="played"?"打咗喇，記得去記分。":"呢一節冇約成。"}</p>}
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
  /* Accent follows the app's rule — amber only when the member has something to do (hands waiting
     on their own slot), green only once somebody is confirmed. Neutral otherwise. An accent spent on
     every card is decoration pretending to be information. */
  const tone=taking&&waiting.length>0?" is-attention":accepted.length>0?" is-confirmed":"";
  return <article className={`availability-card mm-card sl-mine is-${status}${tone}`}>
    <header className="mm-head">
      <div>
        <h3>{when(item)}</h3>
        <small>{item.venue||"未講枱位"}{item.closedAt?" · 已經唔收人":""}</small>
      </div>
      <div className="mm-head-aside">
        {item.counts.total>0&&<span className="mm-count">{item.counts.total}</span>}
        {/* One tap, no reason field. A cancellation that has to be justified is one members avoid
            making, and the dead card they leave up instead is worse for everyone waiting on it. */}
        {taking&&<IconButton className="sl-drop" label="取消呢張局" onClick={onCancel}>✕</IconButton>}
      </div>
    </header>
    <ChipRow items={conditionChips(item.conditions)}/>

    {/* Elapsed time, never "0 人舉手" — the number nobody needs to see at the exact moment they are
        most likely to delete the post and never make another one. */}
    {taking&&<p className="sl-status">{handsLine({hands:item.counts,mine:true,iRaised:false,
      fillRule:item.fillRule,createdAt:item.createdAt})}</p>}

    {accepted.length>0&&<>
      <p className="sl-kick">已經收咗 · {accepted.length} 人</p>
      <ul className="mm-rows">
        {accepted.map(hand=><li className="mm-row is-offer" key={hand.playerId}>
          <PlayerBadge player={hand.player}/>
          <span className="mm-row-copy"><b>{hand.player.name}</b><small>ELO {Math.round(hand.player.rating)}</small></span>
        </li>)}
      </ul>
    </>}

    {taking&&waiting.length>0&&<>
      <p className="sl-kick">舉緊手 · {waiting.length} 人<small>得你一個見到</small></p>
      <ul className="mm-rows">
        {waiting.map(hand=><li className="mm-row" key={hand.playerId}>
          <PlayerBadge player={hand.player}/>
          <span className="mm-row-copy"><b>{hand.player.name}</b><small>ELO {Math.round(hand.player.rating)}</small></span>
          <span className="mm-row-actions">
            <Button variant="secondary" disabled={busyId===hand.playerId}
              onClick={()=>onAccept(hand.playerId)}>收</Button>
          </span>
        </li>)}
      </ul>
      {/* The one button this whole change exists for. Being made to read three names and confirm one
          is what stops people posting again; taking everybody is not a bulk shortcut, it is the
          default that means nobody was turned down — so it gets the zone's primary weight. */}
      {takeAll&&<Button variant="primary" className="sl-primary" disabled={Boolean(busyId)} onClick={onAcceptAll}>{takeAll}</Button>}
    </>}

    {(status==="filled"||status==="toRecord"||status==="done")&&
      <HandoffCard slot={item} opponent={item.filler} onResult={onResult} busy={busyId===item.id}
        showWho={accepted.length===0}/>}

    {taking&&<div className="sl-card-foot">
      <Button variant="secondary" className="sl-wide" onClick={onShare}>分享落 WhatsApp</Button>
      {/* Distinct from cancelling: the evening still happens, it just stops taking people. Whoever is
          still waiting sees a slot that filled — the same thing they would have seen had the poster
          never opened the list. */}
      {item.counts.accepted>0&&<Button variant="quiet" disabled={Boolean(busyId)} onClick={onStopTaking}>夠喇 · 唔再收</Button>}
    </div>}
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
    <header className="mm-head">
      <div><h3>你舉咗嘅手</h3><small>舉幾多張都得，隨時可以收返</small></div>
      <div className="mm-head-aside">
        {open.length>0&&<span className="mm-count">{open.length}</span>}
        {open.length>1&&<Button variant="quiet" onClick={onRetractAll}>全部收返</Button>}
      </div>
    </header>
    <ul className="mm-rows">
      {open.map(hand=><li className="mm-row" key={hand.slotId}>
        <PlayerBadge player={hand.slot.player}/>
        <span className="mm-row-copy"><b>{hand.slot.player.name}</b>
          <small>{when(hand.slot)}{hand.slot.venue?` · ${hand.slot.venue}`:""}</small></span>
        <span className="mm-row-actions">
          <Button variant="secondary" disabled={busyId===hand.slotId} onClick={()=>onRetract(hand.slotId)}>收返</Button>
        </span>
      </li>)}
    </ul>
    {filled.map(hand=><div className="sl-mine-hand" key={hand.slotId}>
      <HandoffCard slot={hand.slot} opponent={hand.slot.player}
        onResult={result=>onResult(hand.slotId,result,hand.slot.player.id,hand.slot.startAt)}
        busy={busyId===hand.slotId}/>
    </div>)}
  </section>;
}

/* --- The redesigned marketplace -------------------------------------------- */

type SlotMode="find"|"mine";
type DayFilter="tonight"|"tomorrow"|"weekend";
type SessionFilter="all"|"handicap"|"levelOnly"|"tableBooked";
type AvailabilityWindow={startAt:string;endAt:string};

const dateOf=(iso:string)=>hkDate(new Date(iso));
const weekendDates=(today=hkDate())=>{
  const weekday=new Date(`${today}T12:00:00+08:00`).getUTCDay();
  const daysUntilSaturday=weekday===0?6:6-weekday;
  const saturday=addDaysHongKong(today,daysUntilSaturday);
  return [saturday,addDaysHongKong(saturday,1)];
};
const dayMatches=(iso:string,filter:DayFilter)=>{
  const today=hkDate(),value=dateOf(iso);
  if(filter==="tonight")return value===today;
  if(filter==="tomorrow")return value===addDaysHongKong(today,1);
  return weekendDates(today).includes(value);
};
const durationLabel=(minutes:number)=>{
  const rounded=Math.max(0,Math.round(minutes));
  const hours=Math.floor(rounded/60),rest=rounded%60;
  return hours?`${hours} 小時${rest?` ${rest} 分鐘`:""}`:`${rest} 分鐘`;
};
const overlapMinutes=(slot:AvailabilityWindow,windows:AvailabilityWindow[])=>windows.reduce((total,window)=>{
  const start=Math.max(Date.parse(slot.startAt),Date.parse(window.startAt));
  const end=Math.min(Date.parse(slot.endAt),Date.parse(window.endAt));
  return total+(end>start?(end-start)/60_000:0);
},0);

function AvailabilityStatus({count,onManage}:{count:number;onManage?:()=>void}){
  return <div className={`sl-availability-status${count?" is-live":""}`}>
    <span className="sl-live-dot" aria-hidden="true"/>
    <span className="sl-availability-copy"><b>{count?"你的空檔已公開":"未公開你的空檔"}</b>
      <small>{count?`其他球手可以喺 ${count} 個時段搵到你` : "公開時間，別人先知道幾時可以約你"}</small></span>
    {onManage&&<Button variant="quiet" onClick={onManage}>{count?"查看":"公開"}<span className="sl-availability-arrow" aria-hidden="true">›</span></Button>}
  </div>;
}

function SessionCard({entry,featured,overlap,canAct,busy,onRaise,onRetract,onResult}: {
  entry:BoardSlot; featured?:boolean; overlap:number; canAct:boolean; busy:boolean;
  onRaise:()=>void; onRetract:()=>void; onResult:(result:"played"|"missed")=>void;
}){
  const chips=conditionChips(entry.conditions);
  const accepted=entry.acceptedPlayers;
  const status=slotStatus(entry);
  const interest=entry.hands.total===0
    ? "等緊第一位球友"
    : accepted.length>0
      ? `${accepted.length} 位已加入${entry.hands.waiting>0?` · ${entry.hands.waiting} 人有興趣`:""}`
      : `${entry.hands.total} 人有興趣`;
  const fit=overlap>0?`與你的空檔重疊 ${durationLabel(overlap)}`:"公開球局 · 有位就加入";
  return <article className={`sl-session-card${featured?" is-featured":""}${entry.iAccepted?" is-accepted":""}`}>
    {featured&&<div className="sl-session-art" aria-hidden="true">
      <span className="sl-art-star">✦</span><span className="sl-art-ball sl-art-ball-red"/><span className="sl-art-ball sl-art-ball-white"/>
      <span className="sl-art-line"/>
    </div>}
    <div className="sl-session-body">
      <div className="sl-session-topline"><span className="sl-session-label">{featured?"最適合你":"公開球局"}</span>
        {entry.iAccepted&&<span className="sl-session-state is-confirmed">已收你</span>}
      </div>
      <h4>{when(entry)}</h4>
      <p className="sl-session-place"><span aria-hidden="true">⌖</span>{entry.venue||"SCAA 會所"}<i>·</i>{entry.player.name} 發起</p>
      <div className="sl-session-people">
        <span className="sl-session-avatars" aria-hidden="true">
          {accepted.slice(0,3).map(player=><PlayerBadge key={player.id} player={player}/>)}
          {!accepted.length&&<PlayerBadge player={entry.player}/>}
        </span>
        <span>{accepted.length?accepted.map(player=>player.name).join("、"):interest}</span>
      </div>
      <div className={`sl-session-fit${overlap>0?" is-match":""}`}><span aria-hidden="true">◷</span><b>{fit}</b></div>
      {chips.length>0&&<div className="sl-session-chips">{chips.map(chip=><span key={chip}>{chip}</span>)}</div>}
      <div className="sl-session-action">
        {entry.iAccepted
          ? <span className="sl-session-confirmed">已經收咗你，準備開波</span>
          : entry.iRaised
            ? <Button variant="secondary" disabled={busy} onClick={onRetract}>已申請 · 收回</Button>
            : canAct
              ? <Button disabled={busy} onClick={onRaise}>申請加入 <span aria-hidden="true">→</span></Button>
              : <a className="sl-session-login" href="/login">登入後申請加入 <span aria-hidden="true">→</span></a>}
      </div>
      {entry.iAccepted&&(status==="filled"||status==="toRecord"||status==="done")&&<HandoffCard
        slot={entry} opponent={entry.player} onResult={onResult} busy={busy} showWho={false}/>}
    </div>
  </article>;
}

function MatchmakingEmpty({signedIn,tonightCount,onManage}:{signedIn:boolean;tonightCount:number;onManage?:()=>void}){
  return <section className="sl-cold-start">
    <div className="sl-cold-start-mark" aria-hidden="true"><span>＋</span></div>
    <div className="sl-cold-start-copy"><p className="sl-eyebrow">今晚的球會</p>
      <h3>暫時未有適合你的球局</h3>
      {/* The only 開局約人 button on the page lives in the toolbar above, so this state points at it
          rather than growing a second one — two buttons for one job is what made this screen busy. */}
      <p>{tonightCount>0?`今晚有 ${tonightCount} 位球友想打。用上面「開局約人」開一場，其他人就可以加入。`:"用上面「開局約人」做第一個開局的人，讓其他球手有局可以加入。"}</p>
    </div>
    {signedIn&&onManage&&<div className="sl-cold-start-actions">
      <Button variant="secondary" onClick={onManage}>公開我的空檔 <span aria-hidden="true">→</span></Button>
    </div>}
    {!signedIn&&<a className="sl-session-login" href="/login">登入後開局 <span aria-hidden="true">→</span></a>}
  </section>;
}

export function Slots({signedIn,onRecord,onChanged,availabilityCount=0,availability=[],onManageAvailability}: {
  signedIn:boolean; onRecord:(opponentId:string,playedOn:string)=>void; onChanged:()=>void;
  availabilityCount?:number; availability?:AvailabilityWindow[]; onManageAvailability?:()=>void;
}){
  const [data,setData]=useState<Board|null>(null);
  const [composing,setComposing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [toast,setToast]=useState("");
  const [mode,setMode]=useState<SlotMode>("find");
  const [dayFilter,setDayFilter]=useState<DayFilter>("tonight");
  const [sessionFilter,setSessionFilter]=useState<SessionFilter>("all");
  const [filterOpen,setFilterOpen]=useState(false);

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

  if(data===null)return <Skeleton height="300px" className="availability-skeleton"/>;

  const canAct=Boolean(data.canAct);
  const mine=visiblePostedSlots(sortPostedSlots(data.mine)) as MineSlot[];

  const dayOptions:[DayFilter,string][]=[["tonight","今晚"],["tomorrow","明天"],["weekend","週末"]];
  const filteredBoard=data.board.filter(entry=>{
    const matchesDate=dayMatches(entry.startAt,dayFilter);
    const matchesFilter=sessionFilter==="all"||Boolean(entry.conditions[sessionFilter]);
    return matchesDate&&matchesFilter;
  }).sort((a,b)=>{
    const aOverlap=overlapMinutes(a,availability),bOverlap=overlapMinutes(b,availability);
    return bOverlap-aOverlap||a.startAt.localeCompare(b.startAt);
  });
  const matchedBoard=availability.length?filteredBoard.filter(entry=>overlapMinutes(entry,availability)>0):[];
  const featured=matchedBoard[0]??null;
  const otherBoard=featured?filteredBoard.filter(entry=>entry.id!==featured.id):filteredBoard;
  const countFor=(filter:DayFilter)=>data.board.filter(entry=>dayMatches(entry.startAt,filter)).length;
  const changeMode=(next:SlotMode)=>{setMode(next);setFilterOpen(false)};
  const createSession=()=>{setError("");setComposing(true)};
  const renderSession=(entry:BoardSlot,featuredCard=false)=><SessionCard key={entry.id} entry={entry}
    featured={featuredCard} overlap={overlapMinutes(entry,availability)} canAct={canAct} busy={busyId===entry.id}
    onRaise={()=>void raise(entry.id)} onRetract={()=>void retract(entry.id)}
    onResult={value=>void result(entry.id,value,entry.player.id,entry.startAt)}/>;
  const mineCards=mine.map(item=><MineCard key={item.id} item={item} busyId={busyId}
    onAccept={playerId=>void accept(item.id,playerId)}
    onAcceptAll={()=>void acceptAll(item.id)}
    onStopTaking={()=>void stopTaking(item.id)}
    onCancel={()=>void cancel(item.id)}
    onResult={value=>void result(item.id,value,item.filledBy,item.startAt)}
    onShare={()=>share(item.id)}/>);

  return <div className="sl-marketplace">
    {/* One toolbar, one primary action. 開局約人 used to appear in the cold start, the bottom CTA, the
        recruitment header, the demand banner and the personal empty state at once — five buttons for
        one job. It now lives here only, above both modes, so it is always in the same place. */}
    {signedIn&&<div className="sl-toolbar">
      <SlidingToggleGroup className="sl-mode-switch" role="tablist" aria-label="約戰模式">
        <button type="button" role="tab" aria-selected={mode==="find"} className={mode==="find"?"active":""} onClick={()=>changeMode("find")}>找球局{data.board.length>0&&<i>{data.board.length}</i>}</button>
        <button type="button" role="tab" aria-selected={mode==="mine"} className={mode==="mine"?"active":""} onClick={()=>changeMode("mine")}>我的招募{mine.length>0&&<i>{mine.length}</i>}</button>
      </SlidingToggleGroup>
      <Button variant="primary" className="sl-new-session" onClick={createSession}>＋ 開局約人</Button>
    </div>}
    {signedIn&&<AvailabilityStatus count={availabilityCount} onManage={onManageAvailability}/>}

    {mode==="find"&&<>
      <div className="sl-date-filter-row">
        <div className="sl-day-chips" role="tablist" aria-label="選擇日期">
          {dayOptions.map(([value,label])=><button key={value} type="button" role="tab" aria-selected={dayFilter===value}
            className={dayFilter===value?"active":""} onClick={()=>setDayFilter(value)}><b>{label}</b><small>{countFor(value)} 場</small></button>)}
        </div>
        <Button variant="quiet" className={`sl-filter-button${filterOpen?" is-open":""}`} aria-expanded={filterOpen} onClick={()=>setFilterOpen(value=>!value)}><span className="sl-filter-icon" aria-hidden="true">☷</span>篩選</Button>
      </div>
      {filterOpen&&<div className="sl-filter-panel" role="group" aria-label="球局篩選">
        <span>我想搵</span>
        {([["all","全部"],["levelOnly","程度相近"],["handicap","接受讓分"],["tableBooked","已訂枱"]] as [SessionFilter,string][]).map(([value,label])=><button key={value} type="button" aria-pressed={sessionFilter===value} className={sessionFilter===value?"active":""} onClick={()=>setSessionFilter(value)}>{label}</button>)}
      </div>}
      {featured&&<section className="sl-market-section" aria-labelledby="best-session-title">
        <header className="sl-market-section-head"><div><p className="sl-eyebrow">MATCH FOR YOU</p><h3 id="best-session-title">最適合你</h3></div><span>{matchedBoard.length} 場</span></header>
        {renderSession(featured,true)}
      </section>}
      <section className="sl-market-section" aria-labelledby="public-sessions-title">
        <header className="sl-market-section-head"><div><p className="sl-eyebrow">OPEN SESSIONS</p><h3 id="public-sessions-title">{featured?"其他公開球局":"公開球局"}</h3></div><span>{otherBoard.length} 場</span></header>
        {otherBoard.length>0
          ? <div className="sl-session-list">{otherBoard.map(entry=>renderSession(entry))}</div>
          : !featured&&<MatchmakingEmpty signedIn={signedIn} tonightCount={data.wantTonight??0} onManage={onManageAvailability}/>}
      </section>
      {signedIn&&<HandsTray hands={data.hands??[]} busyId={busyId} onRetract={id=>void retract(id)} onRetractAll={()=>void retractAll()}
        onResult={(id,value,opponentId,startAt)=>void result(id,value,opponentId,startAt)}/>}
    </>}

    {mode==="mine"&&signedIn&&<>
      {(data.waitingForMe??0)>0&&<section className="sl-demand-card"><span className="sl-live-dot" aria-hidden="true"/><div><b>有 {data.waitingForMe} 位球友等緊你開局</b><small>開一場具體時間，佢哋就可以申請加入。</small></div></section>}
      <section className="sl-market-section sl-my-sessions" aria-labelledby="my-sessions-title">
        <header className="sl-market-section-head"><div><p className="sl-eyebrow">YOUR SESSIONS</p><h3 id="my-sessions-title">我的公開球局</h3></div><span>{mine.length} 場</span></header>
        {mine.length>0?<div className="sl-mine-list">{mineCards}</div>:<div className="sl-personal-empty"><b>你仲未開局</b><span>選一段具體時間，其他球手先知道可以加入你。</span></div>}
      </section>
      <section className="sl-tonight-summary"><div><p className="sl-eyebrow">CLUB PULSE</p><b>今晚有人想打嗎？</b><small>{(data.wantTonight??0)>0?`有 ${data.wantTonight} 位球友已表示想打`:"而家未有人表示今晚想打"}</small></div><span><strong>{data.openCount??0}</strong><small>公開中</small></span></section>
    </>}

    {error&&!composing&&<p className="availability-form-error" role="alert">{error}</p>}
    {toast&&<p key={toast} className="availability-notice" role="status">{toast}</p>}

    {composing&&<Composer busy={busy} error={error} onClose={()=>{setComposing(false);setError("")}} onCreate={create}/>}
  </div>;
}
