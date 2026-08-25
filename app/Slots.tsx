"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { Button, ChipRow, IconButton, SegmentedControl, Skeleton } from "./components/ui/Primitives";
import { BackdropSheet } from "./components/ui/Overlay";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { addDaysHongKong, hkClock, hkDate, hkDayLabel, hongKongInstant } from "../lib/availability";
import { DAY_BUCKETS, bucketCounts, conditionChips, dayBucketLabel, dayBucketOf, handoffMessage,
  handsLine, openingBucket, shareMessage, slotStatus, slotTakingHands, sortPostedSlots,
  takeActionLabel, visiblePostedSlots, weekendDates, whatsappShareUrl,
  type DayBucket, type FillRule, type HandsView, type SlotConditions } from "../lib/slots";

/* --- 約戰 · one timeline ----------------------------------------------------
 *
 * The tab used to run three matchmaking mechanisms side by side — publish availability, post a slot
 * and raise hands, send an invite and counter it — for a single job: *get a game this week*. Only
 * the middle one produces games; the other two mostly produce screens. And on top of that a member
 * chose a mode (找球局／我的招募), a day, a filter, a fill rule and a time window before seeing one
 * name: five decisions ahead of any value.
 *
 * This screen collapses them into the one primitive that was already doing the work: **a game is a
 * published block of time**. 「我今晚 19:30 得閒」 is simultaneously the card, the thing to raise a
 * hand on, and the signal that notifies the club — not three features that have to agree with each
 * other. What follows from that is the whole layout:
 *
 *   one primary action    — 我得閒，開一場
 *   one timeline          — every slot in clock order, mine inline among them, best fit pinned
 *   one banner            — whatever is waiting on me, above the feed rather than instead of it
 *   everything else quiet — the roster grid, weekly rules and notification prefs go one level down
 *
 * What is deliberately NOT here: a mode switch (my own slots are cards in the same list, not a
 * second tab), a filter panel (the rail's buckets are disjoint, so nothing is unreachable without
 * one), and a capacity field. */

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
type AvailabilityWindow={startAt:string;endAt:string};

/** One row of the timeline, from either side of the API's split.
 *
 *  `/api/slots` deliberately keeps two lists: `board` is everyone else's slots (the query excludes
 *  the reader's own by player id) and `mine` carries the waiting list that only its poster may see.
 *  That split is right for the payload — the waiting names must not be derivable from the public
 *  board — and wrong for the screen, which is one list in clock order. So they are merged here, at
 *  the last possible moment, rather than the API being loosened to do it. */
type Entry={
  id:string;startAt:string;endAt:string;venue:string;createdAt:string;
  fillRule:FillRule;conditions:SlotConditions;filledBy:string|null;result:"pending"|"played"|"missed";
  cancelledAt?:string|null;closedAt?:string|null;
  /** The poster. Absent on my own rows: the card says 你開嘅局 rather than naming me to myself. */
  player:Player|null;
  mine:boolean;hands:HandsView;iRaised:boolean;iAccepted:boolean;
  /** Hands still waiting on a decision. Only ever non-zero on my own rows. */
  waiting:number;
};

const fromBoard=(slot:BoardSlot):Entry=>({...slot,player:slot.player,mine:false,waiting:0});
const fromMine=(slot:MineSlot):Entry=>({...slot,player:null,mine:true,hands:slot.counts,
  iRaised:false,iAccepted:false,waiting:slot.counts.waiting});

const dateOf=(iso:string)=>hkDate(new Date(iso));
const dayWord=(slot:{startAt:string})=>{
  const day=dateOf(slot.startAt);
  return day===hkDate()?"今晚":day===addDaysHongKong(hkDate(),1)?"聽日":hkDayLabel(day);
};
const when=(slot:{startAt:string;endAt:string})=>`${dayWord(slot)} ${hkClock(slot.startAt)}–${hkClock(slot.endAt)}`;
const durationLabel=(minutes:number)=>{
  const rounded=Math.max(0,Math.round(minutes));
  const hours=Math.floor(rounded/60),rest=rounded%60;
  return hours?`${hours} 小時${rest?` ${rest} 分鐘`:""}`:`${rest} 分鐘`;
};
const spanHours=(slot:{startAt:string;endAt:string})=>Math.round((Date.parse(slot.endAt)-Date.parse(slot.startAt))/360000)/10;
const overlapMinutes=(slot:AvailabilityWindow,windows:AvailabilityWindow[])=>windows.reduce((total,window)=>{
  const start=Math.max(Date.parse(slot.startAt),Date.parse(window.startAt));
  const end=Math.min(Date.parse(slot.endAt),Date.parse(window.endAt));
  return total+(end>start?(end-start)/60_000:0);
},0);

/* --- Composer ----------------------------------------------------------------
 *
 * Two decisions, not six. The old sheet asked for date, start, end, venue, four condition chips and
 * a fill rule before a member could say the one thing they came to say — that they are free. Day and
 * time are the only questions whose answer the app cannot guess; everything else has an honest
 * default (第一個就算, no stated conditions, no table named) and lives behind one disclosure. */

/* 10:00 to 23:30. The old list ran to 32 entries and so offered "25:30" as a *start* time — a
   leftover from a list that was shared with the end-time select, where hours past midnight are
   spelled that way on purpose. A start time cannot be past midnight, so it stops at 23:30. */
const TIMES=Array.from({length:28},(_,index)=>`${String(10+Math.floor(index/2)).padStart(2,"0")}:${index%2?"30":"00"}`);
/** The three times this club actually starts at. A preset that lands on the right hour is one tap;
    a dropdown of 32 half-hours is a scroll, a squint and a mis-tap — for the same answer. */
const TIME_PRESETS:[string,string][]=[["18:00","放工"],["19:30","最多人"],["21:00","夜場"]];
const DURATIONS=[1,1.5,2,2.5,3,4];

function Composer({onCreate,onClose,busy,error}:{
  onCreate:(input:{startAt:string;endAt:string;venue:string;fillRule:FillRule;conditions:SlotConditions})=>void;
  onClose:()=>void; busy:boolean; error:string;
}){
  const today=hkDate();
  const saturday=weekendDates(today)[0];
  const [date,setDate]=useState(today);
  const [customDate,setCustomDate]=useState(false);
  const [start,setStart]=useState("19:30");
  const [customTime,setCustomTime]=useState(false);
  const [hours,setHours]=useState(2);
  const [venue,setVenue]=useState("");
  const [fillRule,setFillRule]=useState<FillRule>("first");
  const [conditions,setConditions]=useState<SlotConditions>({});
  const [more,setMore]=useState(false);
  const toggle=(key:keyof SlotConditions)=>setConditions(value=>({...value,[key]:!value[key]}));

  /* Days offered as presets are the days a club is actually asked about. 週六 drops off the row when
     it is already today or tomorrow — it would be a second button for a day the row already has. */
  const dayPresets:[string,string][]=[[today,"今晚"],[addDaysHongKong(today,1),"聽日"],
    ...(saturday>addDaysHongKong(today,1)?[[saturday,"週六"] as [string,string]]:[])];
  const pickDay=(value:string)=>{setDate(value);setCustomDate(false)};
  const endTime=(()=>{
    const [h,m]=start.split(":").map(Number);
    const total=h*60+m+hours*60;
    return `${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
  })();
  const dayLabel=dayPresets.find(([value])=>value===date)?.[1]??hkDayLabel(date);

  return <BackdropSheet onClose={onClose} labelledBy="new-slot" className="sl-composer" shellClassName="match-entry-sheet">
      <p className="kicker">開一場</p>
      <h2 id="new-slot">你幾時得閒？</h2>
      <p className="sub">揀個時間就得，其他嘢我哋幫你搞掂。</p>

      <div className="mm-field">
        <span className="mm-field-label">邊日</span>
        <div className="mm-choice-row">
          {dayPresets.map(([value,label])=><button type="button" key={value} aria-pressed={!customDate&&date===value}
            className={!customDate&&date===value?"mm-choice is-on":"mm-choice"} onClick={()=>pickDay(value)}>{label}</button>)}
          <button type="button" aria-pressed={customDate} className={customDate?"mm-choice is-on":"mm-choice"}
            onClick={()=>setCustomDate(true)}>其他</button>
        </div>
        {customDate&&<label className="mm-inline-field"><span>揀日期</span>
          <input type="date" min={today} value={date} onChange={event=>setDate(event.target.value)}/></label>}
      </div>

      <div className="mm-field">
        <span className="mm-field-label">幾點</span>
        <div className="mm-choice-row">
          {TIME_PRESETS.map(([value,note])=><button type="button" key={value} aria-pressed={!customTime&&start===value}
            className={!customTime&&start===value?"mm-choice is-time is-on":"mm-choice is-time"}
            onClick={()=>{setStart(value);setCustomTime(false)}}><b>{value}</b><small>{note}</small></button>)}
          <button type="button" aria-pressed={customTime} className={customTime?"mm-choice is-on":"mm-choice"}
            onClick={()=>setCustomTime(true)}>其他</button>
        </div>
        {customTime&&<label className="mm-inline-field"><span>開始時間</span>
          <select value={start} onChange={event=>setStart(event.target.value)}>{TIMES.map(time=><option key={time}>{time}</option>)}</select></label>}
        <div className="mm-stepper">
          <span>打幾耐</span>
          <span className="mm-stepper-controls">
            <IconButton label="減 30 分鐘" disabled={hours<=DURATIONS[0]}
              onClick={()=>setHours(value=>DURATIONS[Math.max(0,DURATIONS.indexOf(value)-1)]??value)}>−</IconButton>
            <b>{durationLabel(hours*60)}</b>
            <IconButton label="加 30 分鐘" disabled={hours>=DURATIONS[DURATIONS.length-1]}
              onClick={()=>setHours(value=>DURATIONS[Math.min(DURATIONS.length-1,DURATIONS.indexOf(value)+1)]??value)}>＋</IconButton>
          </span>
        </div>
      </div>

      {/* Everything the app can answer for them, folded away — with the defaults stated, so folding
          it is not the same as hiding it. Note what is still not asked anywhere: how many people. */}
      <button type="button" className="mm-disclosure" aria-expanded={more} onClick={()=>setMore(value=>!value)}>
        <span className="mm-disclosure-copy"><b>枱位、讓分、想自己揀人</b>
          <small>唔揀都得 · 預設第一個舉手就成事</small></span>
        <span className="mm-disclosure-mark" aria-hidden="true">{more?"−":"＋"}</span>
      </button>
      {more&&<div className="mm-more">
        <label className="invite-message-field"><span>枱位（可省略）</span>
          <input type="text" maxLength={60} value={venue} placeholder="例如：已訂 3 號枱" onChange={event=>setVenue(event.target.value)}/></label>
        <div className="mm-field">
          <span className="mm-field-label">想打一場點樣嘅局</span>
          <div className="sl-chips">
            <button type="button" className={conditions.handicap?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.handicap)} onClick={()=>toggle("handicap")}>要讓分</button>
            <button type="button" className={conditions.noSmoking?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.noSmoking)} onClick={()=>toggle("noSmoking")}>無煙</button>
            <button type="button" className={conditions.levelOnly?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.levelOnly)} onClick={()=>toggle("levelOnly")}>水平接近</button>
            <button type="button" className={conditions.tableBooked?"sl-chip on":"sl-chip"} aria-pressed={Boolean(conditions.tableBooked)} onClick={()=>toggle("tableBooked")}>已訂枱</button>
          </div>
        </div>
        <div className="mm-field">
          <span className="mm-field-label">要唔要自己揀</span>
          <SegmentedControl label="要唔要自己揀" value={fillRule} onChange={value=>setFillRule(value as FillRule)}
            items={[{value:"first",label:"第一個就算"},{value:"review",label:"我想睇下先"}]}/>
          <p className="sl-hint">{fillRule==="first"
            ?"第一個舉手嘅人就即刻成事。之後仲有人舉手，你想收幾多個都得。"
            :"舉手名單淨係你自己見到。收一個、收幾個、定全部收，到時先算。"}</p>
        </div>
      </div>}

      {error&&<p className="availability-form-error" role="alert">{error}</p>}
      <Button variant="primary" className="sl-primary" disabled={busy} onClick={()=>{
        const endDate=endTime<=start?addDaysHongKong(date,1):date;
        onCreate({startAt:hongKongInstant(date,start),endAt:hongKongInstant(endDate,endTime),venue,fillRule,conditions});
      }}>{busy?"開緊…":`開 ${dayLabel} ${start}–${endTime}`}</Button>
      <p className="mm-fineprint">會即刻俾成個會所見到 · 隨時可以取消</p>
  </BackdropSheet>;
}

/* --- Hand-off --------------------------------------------------------------- */

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

/* --- The banner -------------------------------------------------------------
 *
 * At most one, and it never replaces the feed. The old screen went further than it needed to: an
 * unanswered obligation blanked the whole tab, so a member who owed somebody a score could not look
 * at tonight's games at all. Ranking it above the feed says the same thing — this first — without
 * taking the rest of the club away while it is unresolved. */

type BannerItem=
  |{kind:"handoff";slot:PostedSlot;opponent:Player|null}
  |{kind:"record";slotId:string;slot:PostedSlot;opponent:Player|null}
  |{kind:"hands";slot:MineSlot;waiting:number};

function ActionBanner({item,busy,onOpen,onResult}:{
  item:BannerItem; busy:boolean; onOpen:(slotId:string)=>void; onResult:(result:"played"|"missed")=>void;
}){
  if(item.kind==="hands")return <div className="mm-banner is-attention">
    <span className="mm-banner-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.6a5 5 0 0 1-3.7-1.7L5 15.5a1.6 1.6 0 0 1 2.3-2.2L8 14"/></svg>
    </span>
    <span className="mm-banner-copy"><b>{item.waiting} 人舉咗手，等你收</b>
      <small>{when(item.slot)}{item.slot.venue?` · ${item.slot.venue}`:""}</small></span>
    <Button variant="primary" disabled={busy} onClick={()=>onOpen(item.slot.id)}>睇下</Button>
  </div>;
  if(item.kind==="record")return <div className="mm-banner is-attention">
    <span className="mm-banner-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg>
    </span>
    <span className="mm-banner-copy"><b>{when(item.slot)} 打咗未？</b>
      <small>記錄咗先計 ELO{item.opponent?` · 同 ${item.opponent.name}`:""}</small></span>
    <span className="mm-banner-actions">
      <Button variant="secondary" disabled={busy} onClick={()=>onResult("missed")}>冇打成</Button>
      <Button variant="primary" disabled={busy} onClick={()=>onResult("played")}>打咗</Button>
    </span>
  </div>;
  const text=item.opponent?handoffMessage({venue:item.slot.venue,whenLabel:when(item.slot)}):"";
  return <div className="mm-banner is-confirmed">
    {item.opponent?<PlayerBadge player={item.opponent}/>:<span className="mm-banner-mark" aria-hidden="true">✓</span>}
    <span className="mm-banner-copy"><b>{item.opponent?`${item.opponent.name} 收咗你`:"已經夾好"}</b>
      <small>{when(item.slot)}{item.slot.venue?` · ${item.slot.venue}`:""}</small></span>
    <a className="mm-banner-primary" href={whatsappShareUrl(text)} target="_blank" rel="noreferrer">WhatsApp</a>
  </div>;
}

/* --- The timeline ----------------------------------------------------------- */

function FeaturedCard({entry,overlap,canAct,busy,onRaise,onRetract}:{
  entry:Entry; overlap:number; canAct:boolean; busy:boolean; onRaise:()=>void; onRetract:()=>void;
}){
  const chips=[...(entry.venue?[entry.venue]:["SCAA 會所"]),
    ...(entry.hands.total>0?[`${entry.hands.total} 人有興趣`]:[]),...conditionChips(entry.conditions)];
  return <article className="mm-featured">
    <p className="mm-featured-kicker"><i aria-hidden="true"/>最啱你</p>
    <div className="mm-featured-when"><b>{hkClock(entry.startAt)}–{hkClock(entry.endAt)}</b><span>{dayWord(entry)}</span></div>
    <div className="mm-featured-who">
      {entry.player&&<PlayerBadge player={entry.player}/>}
      <span><b>{entry.player?.name??"球友"} 開嘅局</b>
        <small>{Math.round(entry.player?.rating??0)} ELO{overlap>0?` · 同你重疊 ${durationLabel(overlap)}`:""}</small></span>
    </div>
    <div className="mm-featured-chips">{chips.map(chip=><span key={chip}>{chip}</span>)}</div>
    {entry.iAccepted
      ? <p className="mm-featured-state">已經收咗你，準備開波</p>
      : entry.iRaised
        ? <Button variant="secondary" className="sl-primary" disabled={busy} onClick={onRetract}>已舉手 · 收返</Button>
        : canAct
          ? <Button variant="primary" className="sl-primary" disabled={busy} onClick={onRaise}>加入</Button>
          : <a className="primary sl-primary" href="/login">登入後加入</a>}
  </article>;
}

/** One row of the timeline. My own slot is the same row with a different right-hand affordance —
    not a second list, because splitting an evening's four cards into two lists of two makes both
    look like a dead club. */
function TimelineRow({entry,canAct,busy,onRaise,onRetract,onOpenMine}:{
  entry:Entry; canAct:boolean; busy:boolean;
  onRaise:()=>void; onRetract:()=>void; onOpenMine:()=>void;
}){
  const status=slotStatus(entry);
  const closed=Boolean(entry.closedAt)||status!=="open";
  const meta=entry.mine
    ? entry.waiting>0?`${entry.waiting} 人舉手 · 等你回覆`:handsLine({hands:entry.hands,mine:true,iRaised:false,fillRule:entry.fillRule,createdAt:entry.createdAt})
    : [entry.venue||"SCAA 會所",entry.hands.total>0?`${entry.hands.total} 人有興趣`:null].filter(Boolean).join(" · ");
  return <article className={`mm-slot${entry.mine?" is-mine":""}${entry.iAccepted?" is-confirmed":""}${closed&&!entry.mine?" is-closed":""}`}>
    <span className="mm-slot-when"><b>{hkClock(entry.startAt)}</b><small>{spanHours(entry)} 個鐘</small></span>
    <span className="mm-slot-rule" aria-hidden="true"/>
    <span className="mm-row-copy">
      <b>{entry.mine?"你開嘅局":entry.player?.name??"球友"}</b>
      <small className={entry.mine&&entry.waiting>0?"is-attention":undefined}>{meta}</small>
    </span>
    <span className="mm-slot-action">
      {entry.mine
        ? <Button variant={entry.waiting>0?"primary":"secondary"} disabled={busy} onClick={onOpenMine}>睇下</Button>
        /* Already in: the banner above carries the WhatsApp hand-off, so the row states the fact
           rather than growing a second control for the same game. */
        : entry.iAccepted
          ? <span className="mm-slot-done">已加入</span>
          : closed
            ? <span className="mm-slot-done">已滿</span>
            : entry.iRaised
              ? <Button variant="secondary" disabled={busy} onClick={onRetract}>收返</Button>
              : canAct
                ? <Button disabled={busy} onClick={onRaise}>加入</Button>
                : <a className="mm-slot-login" href="/login">登入</a>}
    </span>
  </article>;
}

/* --- My own slot, on demand --------------------------------------------------
 *
 * A poster looks at their own waiting list when somebody is on it, and never otherwise — so it is a
 * sheet reached from the row (and from the banner), not a permanent second section competing with
 * the board for the same screen. */

function MineSheet({item,busyId,onAccept,onAcceptAll,onStopTaking,onCancel,onResult,onShare,onClose}:{
  item:MineSlot; busyId:string|null;
  onAccept:(playerId:string)=>void; onAcceptAll:()=>void; onStopTaking:()=>void;
  onCancel:()=>void; onResult:(result:"played"|"missed")=>void; onShare:()=>void; onClose:()=>void;
}){
  const status=slotStatus(item);
  const waiting=item.hands.filter(hand=>hand.state==="raised");
  const accepted=item.hands.filter(hand=>hand.state==="accepted");
  const takeAll=takeActionLabel(item.counts);
  const taking=!item.closedAt&&status!=="expired"&&status!=="done";
  return <BackdropSheet onClose={onClose} labelledBy="mine-sheet" className="sl-mine-sheet" shellClassName="match-entry-sheet">
    <p className="kicker">你開嘅局</p>
    <h2 id="mine-sheet">{when(item)}</h2>
    <p className="sub">{item.venue||"未講枱位"}{item.closedAt?" · 已經唔收人":""}</p>
    <ChipRow items={conditionChips(item.conditions)}/>

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
            <Button variant="secondary" disabled={busyId===hand.playerId} onClick={()=>onAccept(hand.playerId)}>收</Button>
          </span>
        </li>)}
      </ul>
      {/* Taking everybody is not a bulk shortcut, it is the default that means nobody was turned
          down — so it keeps the sheet's primary weight. */}
      {takeAll&&<Button variant="primary" className="sl-primary" disabled={Boolean(busyId)} onClick={onAcceptAll}>{takeAll}</Button>}
    </>}

    {(status==="filled"||status==="toRecord"||status==="done")&&
      <HandoffCard slot={item} opponent={item.filler} onResult={onResult} busy={busyId===item.id}
        showWho={accepted.length===0}/>}

    {taking&&<div className="sl-card-foot">
      <Button variant="secondary" className="sl-wide" onClick={onShare}>分享落 WhatsApp</Button>
      {item.counts.accepted>0&&<Button variant="quiet" disabled={Boolean(busyId)} onClick={onStopTaking}>夠喇 · 唔再收</Button>}
    </div>}
    {taking&&<Button variant="quiet" className="mm-cancel-link" onClick={onCancel}>取消呢場</Button>}
  </BackdropSheet>;
}

/* --- Cold open ---------------------------------------------------------------
 *
 * The screen a member sees most often in a small club, and the one the old design spent least on: it
 * printed an instruction ("用上面「開局約人」…") pointing at a button already on screen. What is
 * actually missing at that moment is a reason to believe posting will work, so the club's pulse —
 * how many people are free, as faces — is the card, and the button follows it. */

function ColdOpen({signedIn,wantTonight,onCreate,onManageAvailability}:{
  signedIn:boolean; wantTonight:number; onCreate:()=>void; onManageAvailability?:()=>void;
}){
  return <section className="mm-cold">
    <div className="mm-cold-copy">
      <p className="kicker">今晚嘅會所</p>
      <h3>{wantTonight>0?"未有人開局":"今晚未有人開局"}</h3>
      <p>{wantTonight>0
        ?"做第一個開局嘅人，得閒嘅球友會即刻收到通知。"
        :"做第一個開局嘅人，其他球友先有局可以加入。"}</p>
    </div>
    {wantTonight>0&&<div className="mm-pulse">
      <span className="mm-pulse-count"><b>{wantTonight}</b><small>位球友今晚得閒</small></span>
    </div>}
    {signedIn
      ? <Button variant="primary" className="sl-primary" onClick={onCreate}>我得閒，開一場</Button>
      : <a className="primary sl-primary" href="/login">登入後開局</a>}
    {signedIn&&onManageAvailability&&<Button variant="quiet" className="mm-quiet-row" onClick={onManageAvailability}>
      睇成個星期邊個得閒<span aria-hidden="true">›</span></Button>}
  </section>;
}

/* --- The tab ----------------------------------------------------------------- */

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
  const [bucket,setBucket]=useState<DayBucket|null>(null);
  const [openMine,setOpenMine]=useState<string|null>(null);
  const [handsOpen,setHandsOpen]=useState(false);

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
    try{await patch(id,{action:"cancel"});setOpenMine(null);await load();onChanged()}
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
      slot is "the opponent" depends on whether this was one of my own posts or a hand I raised. */
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

  const today=hkDate();
  const mine=useMemo(()=>visiblePostedSlots(sortPostedSlots(data?.mine??[])) as MineSlot[],[data]);
  const mineById=useMemo(()=>new Map(mine.map(item=>[item.id,item])),[mine]);
  /* The two lists the API keeps apart, in one clock order. */
  const entries=useMemo(()=>[...(data?.board??[]).map(fromBoard),...mine.map(fromMine)]
    .sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.id.localeCompare(b.id)),[data,mine]);
  const live=useMemo(()=>entries.filter(entry=>slotStatus(entry)==="open"&&!entry.closedAt),[entries]);
  /* Counted over the whole timeline rather than the visible bucket, so a tab can honestly say how
     many games sit behind it before it is opened. */
  const counts=useMemo(()=>bucketCounts(live.map(entry=>dateOf(entry.startAt)),today),[live,today]);
  const active=bucket??openingBucket(counts);
  const visible=useMemo(()=>entries.filter(entry=>dayBucketOf(dateOf(entry.startAt),today)===active),[entries,active,today]);
  /* The pinned card is the best *overlap* with what I already said I am free for — the one ranking
     in this tab a member cannot do for themselves by reading the list. Without published
     availability there is no honest "best", so nothing is pinned and the list simply runs. */
  const featured=useMemo(()=>{
    if(!availability.length)return null;
    const [best]=visible
      .filter(entry=>!entry.mine&&!entry.iRaised&&!entry.iAccepted&&slotStatus(entry)==="open"&&!entry.closedAt
        &&overlapMinutes(entry,availability)>0)
      .sort((a,b)=>overlapMinutes(b,availability)-overlapMinutes(a,availability)||a.startAt.localeCompare(b.startAt));
    return best??null;
  },[visible,availability]);
  const rows=featured?visible.filter(entry=>entry.id!==featured.id):visible;

  const openHands=(data?.hands??[]).filter(hand=>!hand.accepted);

  /* One banner, chosen in the order a member would rank these themselves: a game that is on beats a
     score that is owed beats a list that needs reading. */
  const banner=useMemo<BannerItem|null>(()=>{
    const toRecord=mine.find(item=>slotStatus(item)==="toRecord");
    const handRecord=(data?.hands??[]).find(hand=>hand.accepted&&slotStatus(hand.slot)==="toRecord");
    const filledHand=(data?.hands??[]).find(hand=>hand.accepted&&slotStatus(hand.slot)==="filled");
    const filledMine=mine.find(item=>slotStatus(item)==="filled");
    if(filledHand)return {kind:"handoff",slot:filledHand.slot,opponent:filledHand.slot.player};
    if(filledMine)return {kind:"handoff",slot:filledMine,opponent:filledMine.acceptedPlayers[0]??filledMine.filler};
    if(handRecord)return {kind:"record",slotId:handRecord.slotId,slot:handRecord.slot,opponent:handRecord.slot.player};
    if(toRecord)return {kind:"record",slotId:toRecord.id,slot:toRecord,opponent:toRecord.acceptedPlayers[0]??toRecord.filler};
    const needsReading=mine.find(item=>item.counts.waiting>0&&slotTakingHands(item));
    if(needsReading)return {kind:"hands",slot:needsReading,waiting:needsReading.counts.waiting};
    return null;
  },[mine,data]);

  if(data===null)return <Skeleton height="300px" className="availability-skeleton"/>;

  const canAct=Boolean(data.canAct);
  const createSession=()=>{setError("");setComposing(true)};
  const sheet=openMine?mineById.get(openMine)??null:null;
  const bannerBusy=Boolean(busyId);
  const empty=live.length===0;

  return <div className="mm-tab">
    {banner&&<ActionBanner item={banner} busy={bannerBusy}
      onOpen={id=>setOpenMine(id)}
      onResult={value=>{
        if(banner.kind!=="record")return;
        const opponent=banner.opponent?.id??null;
        void result(banner.slotId,value,opponent,banner.slot.startAt);
      }}/>}

    {signedIn&&<Button variant="primary" className="mm-primary" onClick={createSession}>
      <span className="mm-primary-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </span>
      我得閒，開一場
    </Button>}

    {empty
      ? <ColdOpen signedIn={signedIn} wantTonight={data.wantTonight??0} onCreate={createSession} onManageAvailability={onManageAvailability}/>
      : <>
        {/* A filter row, not a tablist: the old chips claimed `role="tab"` without any tabpanel to
            control, which tells a screen reader to expect a widget that is not there. */}
        <div className="mm-rail" role="group" aria-label="揀日子">
          {DAY_BUCKETS.map(value=><button type="button" key={value} aria-pressed={active===value}
            aria-label={`${dayBucketLabel(value)}，${counts[value]} 場`}
            className={active===value?"is-on":""} onClick={()=>setBucket(value)}>
            <b>{dayBucketLabel(value)}</b><small>{counts[value]} 場</small></button>)}
        </div>

        {featured&&<FeaturedCard entry={featured} overlap={overlapMinutes(featured,availability)} canAct={canAct}
          busy={busyId===featured.id} onRaise={()=>void raise(featured.id)} onRetract={()=>void retract(featured.id)}/>}

        <div className="mm-timeline">
          {rows.length>0
            ? rows.map(entry=><TimelineRow key={entry.id} entry={entry} canAct={canAct} busy={busyId===entry.id}
                onRaise={()=>void raise(entry.id)} onRetract={()=>void retract(entry.id)}
                onOpenMine={()=>setOpenMine(entry.id)}/>)
            : !featured&&<p className="mm-note">{dayBucketLabel(active)}未有人開局。{signedIn?"你可以做第一個。":""}</p>}
        </div>
      </>}

    {/* Work I have already done my part on: information, not a task, so it collapses to one line. */}
    {signedIn&&openHands.length>0&&<div className="mm-waiting">
      <button type="button" className="mm-waiting-head" aria-expanded={handsOpen} onClick={()=>setHandsOpen(value=>!value)}>
        <span className="mm-waiting-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg>
        </span>
        <span>你舉咗手 {openHands.length} 場，等緊人回覆</span>
        <span className="mm-waiting-mark" aria-hidden="true">{handsOpen?"−":"›"}</span>
      </button>
      {handsOpen&&<ul className="mm-rows">
        {openHands.map(hand=><li className="mm-row" key={hand.slotId}>
          <PlayerBadge player={hand.slot.player}/>
          <span className="mm-row-copy"><b>{hand.slot.player.name}</b>
            <small>{when(hand.slot)}{hand.slot.venue?` · ${hand.slot.venue}`:""}</small></span>
          <span className="mm-row-actions">
            <Button variant="secondary" disabled={busyId===hand.slotId} onClick={()=>void retract(hand.slotId)}>收返</Button>
          </span>
        </li>)}
        {openHands.length>1&&<li className="mm-row is-quiet">
          <Button variant="quiet" onClick={()=>void retractAll()}>全部收返</Button></li>}
      </ul>}
    </div>}

    {/* The roster grid, the weekly rules and the notification prefs all live one level down now. This
        row is the only thing that survives on the main screen, and only as a line. */}
    {signedIn&&!empty&&onManageAvailability&&<Button variant="quiet" className="mm-quiet-row" onClick={onManageAvailability}>
      {availabilityCount?`你公開咗 ${availabilityCount} 個空檔`:"公開你嘅空檔，其他人先知幾時可以約你"}<span aria-hidden="true">›</span></Button>}

    {error&&!composing&&<p className="availability-form-error" role="alert">{error}</p>}
    {toast&&<p key={toast} className="availability-notice" role="status">{toast}</p>}

    {composing&&<Composer busy={busy} error={error} onClose={()=>{setComposing(false);setError("")}} onCreate={create}/>}
    {sheet&&<MineSheet item={sheet} busyId={busyId} onClose={()=>setOpenMine(null)}
      onAccept={playerId=>void accept(sheet.id,playerId)}
      onAcceptAll={()=>void acceptAll(sheet.id)}
      onStopTaking={()=>void stopTaking(sheet.id)}
      onCancel={()=>void cancel(sheet.id)}
      onResult={value=>void result(sheet.id,value,sheet.filledBy,sheet.startAt)}
      onShare={()=>share(sheet.id)}/>}
  </div>;
}
