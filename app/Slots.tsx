"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayerBadge } from "./UiBits";
import { Button, ChipRow, IconButton, Skeleton } from "./components/ui/Primitives";
import { BackdropSheet } from "./components/ui/Overlay";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { addDaysHongKong, hkClock, hkDate, hkDayLabel, hongKongInstant } from "../lib/availability";
import { conditionChips, handoffMessage, handsLine, shareMessage, slotStatus, slotTakingHands,
  sortPostedSlots, takeActionLabel, visiblePostedSlots, whatsappShareUrl,
  type FillRule, type HandsView, type SlotConditions } from "../lib/slots";
import type { HandicapProposal } from "../lib/handicap";

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
 *   one primary action    — 立即約局
 *   one date picker        — the same 14-day scroller the roster grid uses, not a bespoke filter
 *   one timeline          — every slot in clock order, mine inline among them, best fit pinned
 *   one banner            — whatever is waiting on me, above the feed rather than instead of it
 *   everything else quiet — the roster grid, weekly rules and notification prefs go one level down
 *
 * What is deliberately NOT here: a mode switch (my own slots are cards in the same list, not a
 * second tab), a filter panel, and a capacity field. */

/** `handicap` is this viewer's own proposal against that player -- computed server-side, since it
    takes the viewer's own rating and the club's settings to work out, and absent for a viewer
    looking at their own name (a proposal against yourself is not a thing). */
type Player={id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null;handicap?:HandicapProposal|null};

/** The short form for a name line: an uneven game says who gives and how much -- "你讓" from the
    viewer's own side, in the same arithmetic the leaderboard's 建議讓分 column already uses. Own
    rows also show the level recommendation explicitly so their stats match every other row. */
const handicapNote=(handicap:HandicapProposal|null|undefined,showLevel=false):string|null=>
  !handicap||(handicap.direction==="level"&&!showLevel)?null
    :handicap.direction==="level"?"平手"
    :handicap.direction==="give"?`你讓 ${handicap.points} 分`:`佢讓 ${Math.abs(handicap.points)} 分`;

/** What pressing 加入 actually does, said before the tap rather than only after -- a row that reads
    "第一個就算" costs the reader nothing to check and saves them wondering whether they now have to
    wait on the poster. */
const fillHint=(fillRule:FillRule):string=>fillRule==="first"?"第一個就算":"主人揀人";
type PostedSlot={
  id:string;playerId:string;startAt:string;endAt:string;venue:string;note:string;createdAt:string;
  fillRule:FillRule;conditions:SlotConditions;filledBy:string|null;filledAt:string|null;result:"pending"|"played"|"missed";
  cancelledAt?:string|null;closedAt?:string|null;
};
/** Counts and accepted names travel with every board row; `hands` on a MineSlot is the waiting list
    with names, and only ever reaches its own poster. */
type BoardSlot=PostedSlot&{player:Player;mine:boolean;hands:HandsView;acceptedPlayers:Player[];iRaised:boolean;iAccepted:boolean};
type PendingHand={playerId:string;raisedAt:string;state:"raised"|"accepted";player:Player};
type MineSlot=PostedSlot&{mine:true;player:Player|null;filler:Player|null;hands:PendingHand[];counts:HandsView;acceptedPlayers:Player[]};
type MyHand={slotId:string;raisedAt:string;accepted:boolean;slot:PostedSlot&{player:Player}};
export type Board={
  signedIn:boolean; canAct?:boolean; board:BoardSlot[]; mine:MineSlot[]; hands:MyHand[];
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
  /** The poster, on every row including my own -- a member's own face is what tells their row
      apart from everyone else's, alongside the green treatment `mine` earns it. */
  player:Player|null;
  mine:boolean;hands:HandsView;iRaised:boolean;iAccepted:boolean;
  /** Hands still waiting on a decision. Only ever non-zero on my own rows. */
  waiting:number;
  /** Public on both sides of the API split -- who is already in matters more to a reader deciding
      whether to join than how many, so the row can put faces on it rather than just a count. */
  acceptedPlayers:Player[];
};

const fromBoard=(slot:BoardSlot):Entry=>({...slot,player:slot.player,mine:false,waiting:0,acceptedPlayers:slot.acceptedPlayers});
const fromMine=(slot:MineSlot):Entry=>({...slot,player:slot.player,mine:true,hands:slot.counts,
  iRaised:false,iAccepted:false,waiting:slot.counts.waiting,acceptedPlayers:slot.acceptedPlayers});

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
/** The three times this club actually starts at — surfaced as a note under their own button in the
    slide strip, not a separate preset row: one selector, one visual language, for both day and time. */
const TIME_PRESETS:[string,string][]=[["18:00","放工"],["19:30","最多人"],["21:00","夜場"]];
/** 30 minutes to 8 hours, in the same 30-minute steps the times themselves use. */
const DURATIONS=Array.from({length:16},(_,index)=>(index+1)/2);
/** How many days ahead the composer's own date strip offers — the same horizon as the tab's date
    rail (`HORIZON` in `DateRail`), so "which day" is answered the same way whether a member is
    filtering the board or posting to it. */
const DATE_HORIZON=14;

/** The composer's own slidable day strip — the same visual language as the tab's `DateRail` (a
    scrollable row of snap-to buttons flanked by prev/next arrows), reused here rather than
    reinvented as a second date-picking pattern. Unlike the tab's rail, the count riding under each
    button is not "how many games are already posted" but "how many members already said they are
    free that day" -- the reason to pick this day over another before a single hand has been raised. */
function ComposerDateStrip({value,onSelect,demand}:{value:string;onSelect:(date:string)=>void;demand:Record<string,number>}){
  const scrollRef=useRef<HTMLDivElement>(null);
  const today=hkDate();
  const dates=useMemo(()=>Array.from({length:DATE_HORIZON},(_,index)=>addDaysHongKong(today,index)),[today]);
  const move=(direction:-1|1)=>scrollRef.current?.scrollBy({left:direction*Math.max(200,scrollRef.current.clientWidth*.72),behavior:"smooth"});
  useEffect(()=>{scrollRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"})},[value]);
  return <div className="mm-slide-strip-wrap">
    <IconButton className="availability-date-scroll-button previous" label="向前捲動日期" onClick={()=>move(-1)}>‹</IconButton>
    <div className="availability-date-strip" role="tablist" aria-label={`選擇日期，左右滑動查看未來 ${DATE_HORIZON} 日`} ref={scrollRef}>
      {dates.map(date=>{
        const active=date===value,count=demand[date]??0;
        const weekday=new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${date}T00:00:00+08:00`));
        const label=date===today?"今天":date===addDaysHongKong(today,1)?"明天":weekday;
        return <button type="button" key={date} role="tab" aria-selected={active}
          aria-label={`${label}，${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日${count>0?`，${count} 人得閒`:""}`}
          className={active?"active":""} onClick={()=>onSelect(date)}>
          <small>{label}</small><span>{Number(date.slice(5,7))}/{Number(date.slice(8,10))}</span>
          {count>0&&<strong>{count} 人得閒</strong>}
        </button>;
      })}
    </div>
    <IconButton className="availability-date-scroll-button next" label="向後捲動日期" onClick={()=>move(1)}>›</IconButton>
  </div>;
}

/** Same slide-strip language as `ComposerDateStrip`, for the start time. Demand replaces the three
    hardcoded club-preset labels this used to carry: real counts for the day actually picked beat a
    guess about which times "usually" work, and the busiest one is called out the way the peak day
    is on the tab's own rail. */
function ComposerTimeStrip({value,onSelect,demand}:{value:string;onSelect:(time:string)=>void;demand:Record<string,number>}){
  const scrollRef=useRef<HTMLDivElement>(null);
  const move=(direction:-1|1)=>scrollRef.current?.scrollBy({left:direction*Math.max(180,scrollRef.current.clientWidth*.72),behavior:"smooth"});
  useEffect(()=>{scrollRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"})},[value]);
  const peak=Math.max(0,...Object.values(demand));
  return <div className="mm-slide-strip-wrap">
    <IconButton className="availability-date-scroll-button previous" label="向前捲動時間" onClick={()=>move(-1)}>‹</IconButton>
    <div className="availability-date-strip mm-time-strip" role="tablist" aria-label="選擇開始時間，左右滑動查看更多" ref={scrollRef}>
      {TIMES.map(time=>{
        const active=time===value,count=demand[time]??0,isPeak=peak>0&&count===peak;
        const preset=count>0?null:TIME_PRESETS.find(([presetTime])=>presetTime===time)?.[1];
        return <button type="button" key={time} role="tab" aria-selected={active} onClick={()=>onSelect(time)}
          className={`${active?"active":""}${isPeak&&!active?" is-peak":""}`}
          aria-label={count>0?`${time}，${count} 人得閒${isPeak?"，最多人":""}`:preset?`${time}，${preset}`:time}>
          <span>{time}</span>
          {count>0?<small>{isPeak?`${count} 人得閒 · 最多`:`${count} 人得閒`}</small>:preset&&<small>{preset}</small>}
        </button>;
      })}
    </div>
    <IconButton className="availability-date-scroll-button next" label="向後捲動時間" onClick={()=>move(1)}>›</IconButton>
  </div>;
}

/** Shared by the composer (blank) and the edit sheet (seeded from the slot being changed) — the
    fields are identical, only the starting values and the verb on the primary button differ. */
type ComposerInitial={startAt:string;endAt:string;venue:string;fillRule:FillRule;conditions:SlotConditions};

/** Quick durations members actually pick, alongside the +/- stepper -- a tap on one is the common
    case, the stepper is for everything else. */
const DURATION_PRESETS=[1.5,2,3];

function Composer({onCreate,onClose,busy,error,initial,editing}:{
  onCreate:(input:{startAt:string;endAt:string;venue:string;fillRule:FillRule;conditions:SlotConditions})=>void;
  onClose:()=>void; busy:boolean; error:string; initial?:ComposerInitial; editing?:boolean;
}){
  const today=hkDate();
  const [date,setDate]=useState(()=>initial?dateOf(initial.startAt):today);
  const [start,setStart]=useState(()=>initial?hkClock(initial.startAt):"19:30");
  const [hours,setHours]=useState(()=>initial?spanHours(initial):2);
  const [venue,setVenue]=useState(()=>initial?.venue??"");
  /* Open to whoever raises a hand, reviewed and accepted at the poster's own pace, is the club's
     normal night — a poster who wants the old first-come-first-served 1:1 lock still can, from the
     "要唔要自己揀" cards below, but it is no longer the thing every new slot silently opts into. */
  const [fillRule,setFillRule]=useState<FillRule>(()=>initial?.fillRule??"review");
  const [conditions,setConditions]=useState<SlotConditions>(()=>initial?.conditions??{});
  const [more,setMore]=useState(()=>Boolean(initial?.venue||Object.values(initial?.conditions??{}).some(Boolean)));
  const toggle=(key:keyof SlotConditions)=>setConditions(value=>({...value,[key]:!value[key]}));

  /* Demand under the day strip: how many members published availability on each of the next
     `DATE_HORIZON` days. One fetch, reused for every day the strip scrolls past -- it never depends
     on which day is currently picked. */
  const [dayDemand,setDayDemand]=useState<Record<string,number>>({});
  useEffect(()=>{
    let cancelled=false;
    fetch(`/api/availability?week=${today}&days=${DATE_HORIZON}`).then(r=>r.ok?r.json():null)
      .then(body=>{if(!cancelled&&body?.counts)setDayDemand(body.counts)}).catch(()=>{});
    return ()=>{cancelled=true};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` is stable for the component's life
  },[]);

  /* Demand under the time strip: how many members' published windows cover each 30-minute button,
     for the day currently picked -- refetched whenever that day changes, since a Tuesday and a
     Saturday do not share a shape. */
  const [timeDemand,setTimeDemand]=useState<Record<string,number>>({});
  useEffect(()=>{
    let cancelled=false;
    fetch(`/api/availability?date=${date}`).then(r=>r.ok?r.json():null).then(body=>{
      if(cancelled||!body?.members)return;
      const buckets:Record<string,number>={};
      for(const time of TIMES){
        const bucketStart=Date.parse(hongKongInstant(date,time)),bucketEnd=bucketStart+30*60_000;
        let count=0;
        for(const member of body.members as {slots:{startAt:string;endAt:string}[]}[])
          if(member.slots.some(slot=>Date.parse(slot.startAt)<bucketEnd&&Date.parse(slot.endAt)>bucketStart))count+=1;
        if(count>0)buckets[time]=count;
      }
      setTimeDemand(buckets);
    }).catch(()=>{});
    return ()=>{cancelled=true};
  },[date]);

  const endTime=(()=>{
    const [h,m]=start.split(":").map(Number);
    const total=h*60+m+hours*60;
    return `${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
  })();
  const dayLabel=date===today?"今晚":date===addDaysHongKong(today,1)?"聽日":hkDayLabel(date);

  return <BackdropSheet onClose={onClose} labelledBy="new-slot" className="sl-composer" shellClassName="match-entry-sheet">
      <p className="kicker">{editing?"編輯呢場":"開一場"}</p>
      <h2 id="new-slot">{editing?"改幾時":"你幾時得閒？"}</h2>
      <p className="sub">{editing?"未收人之前，隨時可以改。":"揀個時間就得，其他嘢我哋幫你搞掂。"}</p>

      {/* The running answer, always on screen -- not only in the submit button at the very bottom
          of a sheet that can grow past one screenful once the disclosure opens. */}
      <div className="mm-composer-summary">
        <span className="mm-composer-summary-copy">
          <b>{dayLabel} {start} → {endTime}</b>
          <small>{venue||"SCAA 會所"} · {fillRule==="first"?"開畀大家，第一個就算":"開畀大家，你揀邊個"}</small>
        </span>
        <span className="mm-composer-summary-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </span>
      </div>

      <div className="mm-field">
        <span className="mm-field-label">邊日</span>
        <ComposerDateStrip value={date} onSelect={setDate} demand={dayDemand}/>
      </div>

      <div className="mm-field">
        <span className="mm-field-label">幾點開波</span>
        <ComposerTimeStrip value={start} onSelect={setStart} demand={timeDemand}/>
        <div className="mm-stepper">
          <span>打到幾點</span>
          <span className="mm-stepper-controls">
            <IconButton label="減 30 分鐘" disabled={hours<=DURATIONS[0]}
              onClick={()=>setHours(value=>DURATIONS[Math.max(0,DURATIONS.indexOf(value)-1)]??value)}>−</IconButton>
            <b>{endTime}<small>{durationLabel(hours*60)}</small></b>
            <IconButton label="加 30 分鐘" disabled={hours>=DURATIONS[DURATIONS.length-1]}
              onClick={()=>setHours(value=>DURATIONS[Math.min(DURATIONS.length-1,DURATIONS.indexOf(value)+1)]??value)}>＋</IconButton>
          </span>
        </div>
        <div className="mm-duration-presets">
          {DURATION_PRESETS.map(preset=><button key={preset} type="button"
            className={hours===preset?"mm-duration-chip active":"mm-duration-chip"} onClick={()=>setHours(preset)}>
            {durationLabel(preset*60)}
          </button>)}
        </div>
      </div>

      {/* 收人方式 has real consequences -- whether "加入" on the board finishes the deal or just
          raises a hand -- so it gets two cards on the composer's face, not a row inside a drawer
          that also holds venue and condition chips. */}
      <div className="mm-field">
        <span className="mm-field-label">收人方式</span>
        <div className="mm-fillrule-cards">
          <button type="button" className={`mm-fillrule-card${fillRule==="review"?" active":""}`}
            aria-pressed={fillRule==="review"} onClick={()=>setFillRule("review")}>
            <b>開畀大家</b>
            <small>舉手名單淨係你見到，你揀收邊個。</small>
          </button>
          <button type="button" className={`mm-fillrule-card${fillRule==="first"?" active":""}`}
            aria-pressed={fillRule==="first"} onClick={()=>setFillRule("first")}>
            <b>第一個就算</b>
            <small>第一個舉手即刻成事，唔使你再覆。</small>
          </button>
        </div>
      </div>

      {/* Everything the app can answer for them, folded away — with the defaults stated, so folding
          it is not the same as hiding it. Note what is still not asked anywhere: how many people. */}
      <button type="button" className="mm-disclosure" aria-expanded={more} onClick={()=>setMore(value=>!value)}>
        <span className="mm-disclosure-copy"><b>枱位同條件</b>
          <small>讓分 · 無煙 · 水平接近 · 已訂枱 -- 唔揀都得</small></span>
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
      </div>}

      {error&&<p className="availability-form-error" role="alert">{error}</p>}
      <Button variant="primary" className="sl-primary" disabled={busy} onClick={()=>{
        const endDate=endTime<=start?addDaysHongKong(date,1):date;
        onCreate({startAt:hongKongInstant(date,start),endAt:hongKongInstant(endDate,endTime),venue,fillRule,conditions});
      }}>{busy?(editing?"儲存緊…":"開緊…"):editing?`儲存 ${dayLabel} ${start}–${endTime}`:`開 ${dayLabel} ${start}–${endTime}`}</Button>
      <p className="mm-fineprint">{editing?"改咗會即刻更新畀成個會所睇到":"會即刻俾成個會所見到 · 隨時可以取消"}</p>
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
        <small>ELO {Math.round(opponent.rating)}{handicapNote(opponent.handicap)?` · ${handicapNote(opponent.handicap)}`:""} · {when(slot)}{slot.venue?` · ${slot.venue}`:""}</small></span>
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

/** The board's own quick filters, all derivable from data the payload already carries -- no new
    endpoint, just a second pass over what `/api/slots` already returned. */
type RowFilter="all"|"level"|"handicap"|"tableBooked";

/** What the confirmation screen needs after a successful post: the slot itself, plus how many
    people the composer could already see were free around that time -- captured at submit time
    from the demand the composer had already fetched, rather than a second round trip. */
type PostedConfirmation={id:string;startAt:string;endAt:string;venue:string;reach:number};

type BannerItem=
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
  return null;
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
        <small>{Math.round(entry.player?.rating??0)} ELO{handicapNote(entry.player?.handicap)?` · ${handicapNote(entry.player?.handicap)}`:""}{overlap>0?` · 同你重疊 ${durationLabel(overlap)}`:""}</small></span>
    </div>
    <div className="mm-featured-chips">{chips.map(chip=><span key={chip}>{chip}</span>)}</div>
    {entry.iRaised
        ? <Button variant="secondary" className="sl-primary" disabled={busy} onClick={onRetract}>已舉手 · 收返</Button>
        : canAct
          ? <Button variant="primary" className="sl-primary" disabled={busy} onClick={onRaise}>加入</Button>
          : <a className="primary sl-primary" href="/login">登入後加入</a>}
  </article>;
}

/** Up to three faces, then a "+N" chip -- who is already in matters more to a reader deciding
    whether to join than how many, and stacking faces reads at a glance the way a bare count never
    does. */
function AcceptedFaces({players}:{players:Player[]}){
  if(!players.length)return null;
  const shown=players.slice(0,3),rest=players.length-shown.length;
  return <span className="mm-row-faces">
    {shown.map(player=><PlayerBadge key={player.id} player={player} className="mm-row-face"/>)}
    {rest>0&&<i className="mm-row-face mm-row-face-more" aria-hidden="true">+{rest}</i>}
  </span>;
}

/** One row of the timeline. My own slot is the same row with a different right-hand affordance —
    not a second list, because splitting an evening's four cards into two lists of two makes both
    look like a dead club. Day is carried by the section heading above the row now, not repeated on
    every card, so the row itself only ever has to say the clock. */
function TimelineRow({entry,canAct,busy,onRaise,onRetract,onOpenMine,onOpenDetail}:{
  entry:Entry; canAct:boolean; busy:boolean;
  onRaise:()=>void; onRetract:()=>void; onOpenMine:()=>void; onOpenDetail:()=>void;
}){
  const status=slotStatus(entry);
  const closed=Boolean(entry.closedAt)||status!=="open";
  const meta=entry.mine
    ? entry.waiting>0?`${entry.waiting} 人舉手 · 等你回覆`:`${entry.hands.total} 人已報名`
    : entry.venue||"SCAA 會所";
  const openRow=()=>{if(entry.mine)onOpenMine();else onOpenDetail()};
  return <article className={`mm-slot${entry.mine?" is-mine":""}${entry.iAccepted?" is-confirmed":""}${closed&&!entry.mine?" is-closed":""}`}
    role="button" tabIndex={0} onClick={openRow} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openRow()}}}>
    <span className="mm-slot-when">
      <b>{hkClock(entry.startAt)}</b><small>→ {hkClock(entry.endAt)}</small>
    </span>
    <span className="mm-slot-rule" aria-hidden="true"/>
    {entry.player&&<PlayerBadge player={entry.player}/>}
    <span className="mm-row-copy">
      <b>{entry.mine?entry.player?.name??"你":entry.player?.name??"球友"}
        {entry.player&&<span className="mm-row-elo">{Math.round(entry.player.rating)}</span>}
        {entry.player&&handicapNote(entry.player.handicap,entry.mine)&&<span className="mm-row-handicap">{handicapNote(entry.player.handicap,entry.mine)}</span>}</b>
      <span className="mm-row-sub">
        <small className={entry.mine&&entry.waiting>0?"is-attention":undefined}>{meta}</small>
        <AcceptedFaces players={entry.acceptedPlayers}/>
        {entry.acceptedPlayers.length>0&&<small className="mm-row-faces-count">{entry.acceptedPlayers.length} 人已加入</small>}
        <ChipRow items={conditionChips(entry.conditions)}/>
      </span>
    </span>
    <span className="mm-slot-action" onClick={event=>event.stopPropagation()}>
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
                ? <>
                    <Button disabled={busy} onClick={onRaise}>加入</Button>
                    <small className="mm-slot-fillhint">{fillHint(entry.fillRule)}</small>
                  </>
                : <a className="mm-slot-login" href="/login">登入</a>}
    </span>
  </article>;
}

/* --- My own slot, on demand --------------------------------------------------
 *
 * A poster looks at their own waiting list when somebody is on it, and never otherwise — so it is a
 * sheet reached from the row (and from the banner), not a permanent second section competing with
 * the board for the same screen. */

function MineSheet({item,busyId,onAccept,onAcceptAll,onStopTaking,onCancel,onResult,onShare,onEdit,onClose}:{
  item:MineSlot; busyId:string|null;
  onAccept:(playerId:string)=>void; onAcceptAll:()=>void; onStopTaking:()=>void;
  onCancel:()=>void; onResult:(result:"played"|"missed")=>void; onShare:()=>void; onEdit:()=>void; onClose:()=>void;
}){
  const status=slotStatus(item);
  const waiting=item.hands.filter(hand=>hand.state==="raised");
  const accepted=item.hands.filter(hand=>hand.state==="accepted");
  const takeAll=takeActionLabel(item.counts);
  const taking=!item.closedAt&&status!=="expired"&&status!=="done";
  /* Editing the time or place is only safe while nothing here is a promise yet — once somebody is
     accepted, changing the plan out from under them belongs to 取消, not a silent rewrite. */
  const canEdit=taking&&status==="open"&&accepted.length===0;
  return <BackdropSheet onClose={onClose} labelledBy="mine-sheet" className="sl-mine-sheet" shellClassName="match-entry-sheet">
    <p className="kicker">你開嘅局</p>
    <div className="mm-mine-head">
      <h2 id="mine-sheet">{when(item)}</h2>
      {canEdit&&<Button variant="quiet" className="mm-edit-link" onClick={onEdit}>編輯</Button>}
    </div>
    <p className="sub">{item.venue||"未講枱位"}{item.closedAt?" · 已經唔收人":""}</p>
    <ChipRow items={conditionChips(item.conditions)}/>

    {taking&&<p className="sl-status">{handsLine({hands:item.counts,mine:true,iRaised:false,
      fillRule:item.fillRule,createdAt:item.createdAt})}</p>}

    {accepted.length>0&&<>
      <p className="sl-kick">已經收咗 · {accepted.length} 人</p>
      <ul className="mm-rows">
        {accepted.map(hand=><li className="mm-row is-offer" key={hand.playerId}>
          <PlayerBadge player={hand.player}/>
          <span className="mm-row-copy"><b>{hand.player.name}</b>
            <small>ELO {Math.round(hand.player.rating)}{handicapNote(hand.player.handicap)?` · ${handicapNote(hand.player.handicap)}`:""}</small></span>
        </li>)}
      </ul>
    </>}

    {taking&&waiting.length>0&&<>
      <p className="sl-kick">舉緊手 · {waiting.length} 人<small>得你一個見到</small></p>
      <ul className="mm-rows">
        {waiting.map(hand=><li className="mm-row" key={hand.playerId}>
          <PlayerBadge player={hand.player}/>
          <span className="mm-row-copy"><b>{hand.player.name}</b>
            <small>ELO {Math.round(hand.player.rating)}{handicapNote(hand.player.handicap)?` · ${handicapNote(hand.player.handicap)}`:""}</small></span>
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

/* --- Slot detail, for everyone else's row -----------------------------------
 *
 * The board used to give a non-owner nothing to tap but 加入 itself -- no route to "who is this,
 * what's the handicap, is anyone else already in" before committing. This sheet is that missing
 * stop: reachable from anywhere the row appears, read-only except for the same action the row's own
 * button already offers, so opening it can never do anything a plain tap on 加入 could not undo. */
function BoardDetailSheet({entry,canAct,busy,onRaise,onRetract,onShare,onClose}:{
  entry:Entry; canAct:boolean; busy:boolean;
  onRaise:()=>void; onRetract:()=>void; onShare:()=>void; onClose:()=>void;
}){
  const status=slotStatus(entry);
  const closed=Boolean(entry.closedAt)||status!=="open";
  const player=entry.player;
  return <BackdropSheet onClose={onClose} labelledBy="slot-detail" className="sl-mine-sheet" shellClassName="match-entry-sheet">
    <p className="kicker">{player?.name??"球友"}開嘅局</p>
    <h2 id="slot-detail">{when(entry)}</h2>
    <p className="sub">{entry.venue||"未講枱位"}</p>

    {player&&<div className="mm-detail-who">
      <PlayerBadge player={player}/>
      <span className="mm-row-copy">
        <b>{player.name} <span className="mm-row-elo">{Math.round(player.rating)} ELO</span></b>
        <small>{player.handicap?.label??"未有讓分建議"}</small>
      </span>
    </div>}

    <ChipRow items={conditionChips(entry.conditions)}/>

    {entry.acceptedPlayers.length>0&&<>
      <p className="sl-kick">已經加入 · {entry.acceptedPlayers.length} 人</p>
      <ul className="mm-rows">
        {entry.acceptedPlayers.map(accepted=><li className="mm-row" key={accepted.id}>
          <PlayerBadge player={accepted}/>
          <span className="mm-row-copy"><b>{accepted.name}</b>
            <small>ELO {Math.round(accepted.rating)}{handicapNote(accepted.handicap)?` · ${handicapNote(accepted.handicap)}`:""}</small></span>
        </li>)}
      </ul>
    </>}

    <div className="mm-detail-fillnote">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span>{entry.fillRule==="first"
        ?"呢場係「第一個就算」，撳加入即刻成事，唔使等回覆。"
        :"呢場由主人揀人。撳加入即係舉手，等主人回覆。"}</span>
    </div>

    {entry.iAccepted
      ? <p className="sl-status is-quiet">已經加入，準備開波</p>
      : closed
        ? <p className="sl-status is-quiet">已滿或已過</p>
        : entry.iRaised
          ? <Button variant="secondary" className="sl-primary" disabled={busy} onClick={onRetract}>已舉手 · 收返</Button>
          : canAct
            ? <Button variant="primary" className="sl-primary" disabled={busy} onClick={onRaise}>加入呢場</Button>
            : <a className="primary sl-primary" href="/login">登入後加入</a>}
    <Button variant="quiet" className="sl-wide-link" onClick={onShare}>分享畀朋友</Button>
  </BackdropSheet>;
}

/* --- Post-submit confirmation -------------------------------------------------
 *
 * Submitting used to just close the sheet -- a member who just posted had no way to tell it worked
 * short of finding their own row on the board. This states it plainly and hands over the one thing
 * worth doing next: telling people directly, while the moment is still warm. */
function PostedSheet({posted,onShare,onClose}:{posted:PostedConfirmation; onShare:()=>void; onClose:()=>void}){
  return <BackdropSheet onClose={onClose} labelledBy="posted-slot" className="sl-mine-sheet" shellClassName="match-entry-sheet">
    <div className="mm-posted-head">
      <span className="mm-posted-mark" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </span>
      <h2 id="posted-slot">開咗喇</h2>
      <p className="sub">{when(posted)}{posted.venue?` · ${posted.venue}`:""}</p>
    </div>
    {posted.reach>0&&<p className="mm-posted-reach">已經通知咗 {posted.reach} 位話咗嗰陣得閒嘅球友</p>}
    <Button variant="primary" className="sl-primary" onClick={onShare}>分享落 WhatsApp</Button>
    <Button variant="quiet" className="mm-cancel-link" onClick={onClose}>睇返個板</Button>
  </BackdropSheet>;
}

/* --- Cold open ---------------------------------------------------------------
 *
 * The screen a member sees most often in a small club, and the one the old design spent least on: it
 * printed an instruction ("用上面「開局約人」…") pointing at a button already on screen. What is
 * actually missing at that moment is a reason to believe posting will work, so the club's pulse —
 * how many people are free, as faces — is the card, and the button follows it. */

/** Nothing on the board yet. One button, and nothing beside it competing for the tap: the old
    version stacked its own CTA under the club-pulse count and a second link down to the roster, so
    an empty screen offered three things to press before a member had done the one that matters. The
    tab-level primary button is suppressed while this renders (see `empty` below), so this is never
    a second 約局 button next to the first — it is the only one on screen. */
function ColdOpen({signedIn,onCreate}:{signedIn:boolean; onCreate:()=>void}){
  return <section className="mm-cold">
    <div className="mm-cold-copy">
      <p className="kicker">今晚嘅會所</p>
      <h3>今晚未有人開局</h3>
      <p>做第一個開局嘅人，其他球友先有局可以加入。</p>
    </div>
    {signedIn
      ? <Button variant="primary" className="mm-primary" onClick={onCreate}>
          <span className="mm-primary-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </span>
          立即約局
        </Button>
      : <a className="primary sl-primary" href="/login">登入後開局</a>}
  </section>;
}

/* --- The date rail -----------------------------------------------------------
 *
 * The same 14-day scroller the roster grid uses (`DateScroller` in Availability.tsx) rather than a
 * second, bespoke picker: 今晚／聽日／週末／之後 read as a filter, distinct from the 開局卡 board
 * they sat above, and disagreed with the exact-day picker one tab over that answers the same
 * question ("which day"). One picker, one visual language, reused rather than re-invented — counts
 * read in slots (場) here, where the roster grid's reads in people (位). */
const HORIZON=14;
/** The value `active` takes when no single day is picked — every slot across the whole horizon,
    in one clock order. It is the rail's first option and its default, so a member sees the whole
    club's pulse before narrowing to one day. */
export const ALL_DATES="all";
function DateRail({dates,selected,counts,total,onSelect}:{dates:string[];selected:string;counts:Record<string,number>;total:number;onSelect:(date:string)=>void}){
  const scrollRef=useRef<HTMLDivElement>(null);
  const move=(direction:-1|1)=>scrollRef.current?.scrollBy({left:direction*Math.max(220,scrollRef.current.clientWidth*.72),behavior:"smooth"});
  useEffect(()=>{scrollRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"})},[selected]);
  const today=hkDate();
  return <section className="availability-date-selector mm-date-rail" aria-label={`未來 ${HORIZON} 日`}>
    <div className="availability-date-selector-head"><b>選擇日期</b><span aria-hidden="true">左右滑動查看未來 {HORIZON} 日 <i>↔</i></span></div>
    <div className="availability-date-strip-wrap">
      <IconButton className="availability-date-scroll-button previous" label="向前捲動日期" onClick={()=>move(-1)}>‹</IconButton>
      <div className="availability-date-strip" role="tablist" aria-label="選擇日期，左右滑動查看更多" ref={scrollRef}>
        <button type="button" role="tab" aria-selected={selected===ALL_DATES}
          aria-label={`全部日子，${total} 場`}
          className={selected===ALL_DATES?"active":""} onClick={()=>onSelect(ALL_DATES)}>
          <small>全部</small><span>日子</span><strong>{total} 場</strong>
        </button>
        {dates.map(value=>{
          const active=value===selected,count=counts[value]??0;
          const weekday=new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${value}T00:00:00+08:00`));
          const label=value===today?"今天":value===addDaysHongKong(today,1)?"明天":weekday;
          return <button type="button" key={value} role="tab" aria-selected={active}
            aria-label={`${label}，${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日，${count} 場`}
            className={active?"active":""} onClick={()=>onSelect(value)}>
            <small>{label}</small><span>{Number(value.slice(5,7))}/{Number(value.slice(8,10))}</span><strong>{count} 場</strong>
          </button>;
        })}
      </div>
      <IconButton className="availability-date-scroll-button next" label="向後捲動日期" onClick={()=>move(1)}>›</IconButton>
    </div>
  </section>;
}

/* --- The tab ----------------------------------------------------------------- */

export function Slots({signedIn,onRecord,onChanged,availabilityCount=0,availability=[],onManageAvailability,initialData}: {
  signedIn:boolean; onRecord:(opponentId:string,playedOn:string)=>void; onChanged:()=>void;
  availabilityCount?:number; availability?:AvailabilityWindow[]; onManageAvailability?:()=>void;
  initialData?:Board|null;
}){
  const [data,setData]=useState<Board|null>(initialData??null);
  const [composing,setComposing]=useState(false);
  const [editing,setEditing]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [toast,setToast]=useState("");
  const [date,setDate]=useState<string|null>(null);
  const [openMine,setOpenMine]=useState<string|null>(null);
  const [openDetail,setOpenDetail]=useState<string|null>(null);
  const [handsOpen,setHandsOpen]=useState(false);
  const [filter,setFilter]=useState<RowFilter>("all");
  const [closedOpen,setClosedOpen]=useState(false);
  const [posted,setPosted]=useState<PostedConfirmation|null>(null);

  const load=useCallback(async()=>{
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),15000);
    const fallback:Board={signedIn,canAct:false,board:[],mine:[],hands:[]};
    try{
      const response=await fetch("/api/slots",{signal:controller.signal});
      const body=await response.json().catch(()=>null) as Partial<Board>&{error?:string}|null;
      if(!response.ok){setError(body?.error??"約戰資料暫時未能載入");setData(current=>current??fallback);return}
      setData(body as Board);setError("");
    }catch(error){
      setError(error instanceof Error&&error.name==="AbortError"?"約戰資料載入較慢，請再試一次。":"網絡連線失敗，請再試一次。");
      setData(current=>current??fallback);
    }finally{window.clearTimeout(timeout)}
  },[signedIn]);

  useEffect(()=>{if(initialData!==undefined)setData(initialData)},[initialData]);

  /* Loads for everyone, signed in or not. "Is anybody playing tonight" is the question this screen
     is most often opened with, and the one it would be perverse to charge an account for — a club
     that looks empty to a visitor stays empty. */
  useEffect(()=>{
    /* `undefined` means the parent bootstrap is still in flight. `null` means it failed, so fall
       back to the standalone route; a board value means first paint is already hydrated. */
    if(initialData===undefined)return;
    if(initialData===null||initialData.signedIn!==signedIn)void load();
    const id=window.setInterval(()=>{if(document.visibilityState==="visible")void load()},45_000);
    return ()=>window.clearInterval(id);
  },[initialData,load,signedIn]);

  const create=async(input:{startAt:string;endAt:string;venue:string;fillRule:FillRule;conditions:SlotConditions})=>{
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/slots",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){setError(body.error??"開唔到，試多次。");return}
      trackAvailabilityEvent("session_created");
      setComposing(false);
      /* The old flow just closed the sheet -- a member who just posted had no way to tell whether
         it worked short of scrolling the board to find their own row. `notified` is the real count
         of watchers the server just messaged (`announceSlotPosted`), not a guess dressed up as one. */
      setPosted({id:body.slot?.id??input.startAt,startAt:input.startAt,endAt:input.endAt,venue:input.venue,
        reach:typeof body.notified==="number"?body.notified:0});
      await load();onChanged();
    }catch{setError("網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  };

  const saveEdit=async(id:string,input:{startAt:string;endAt:string;venue:string;fillRule:FillRule;conditions:SlotConditions})=>{
    setBusy(true);setError("");
    try{
      const response=await fetch(`/api/slots/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"edit",...input})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){setError(body.error??"改唔到，試多次。");return}
      setEditing(null);
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
  /* Shares any slot by id, not only the caller's own -- the detail sheet on someone else's row
     offers 分享畀朋友 too, and looking it up only in `mine`/`hands` left that share silently empty. */
  const share=(id:string)=>{
    const slot=[...(data?.mine??[]),...(data?.hands??[]).map(hand=>hand.slot),...(data?.board??[])].find(item=>item.id===id);
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
  const dates=useMemo(()=>Array.from({length:HORIZON},(_,i)=>addDaysHongKong(today,i)),[today]);
  /* Counted over the whole timeline rather than the visible day, so the rail can honestly say how
     many games sit behind each date before it is opened. */
  const dateCounts=useMemo(()=>{
    const counts:Record<string,number>={};
    for(const d of dates)counts[d]=0;
    for(const entry of live){const d=dateOf(entry.startAt);if(d in counts)counts[d]+=1}
    return counts;
  },[live,dates]);
  /* Absent a member's own pick, the rail opens on 全部 — every slot across the horizon, so a member
     sees the whole club's pulse before narrowing to one day. */
  const active=date??ALL_DATES;
  const visible=useMemo(()=>active===ALL_DATES?entries:entries.filter(entry=>dateOf(entry.startAt)===active),[entries,active]);
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

  /* Closed rows -- filled, expired, cancelled from a reader's point of view -- stop being anything
     anybody can act on, so they no longer take a seat in the middle of the live run at reduced
     opacity; they collapse to one line below it. My own slot never counts as closed here: its
     owner still has work to do on it (record a result, share it again) regardless of status. */
  const isClosedRow=(entry:Entry)=>!entry.mine&&(Boolean(entry.closedAt)||slotStatus(entry)!=="open");
  const openRows=useMemo(()=>rows.filter(entry=>!isClosedRow(entry)),[rows]);
  const closedRows=useMemo(()=>rows.filter(isClosedRow),[rows]);
  const matchesFilter=useCallback((entry:Entry,key:RowFilter)=>{
    if(key==="level")return Math.abs(entry.player?.handicap?.points??0)<=5;
    if(key==="handicap")return Boolean(entry.conditions.handicap);
    if(key==="tableBooked")return Boolean(entry.conditions.tableBooked);
    return true;
  },[]);
  const filterCounts=useMemo(()=>({
    all:openRows.length,
    level:openRows.filter(entry=>matchesFilter(entry,"level")).length,
    handicap:openRows.filter(entry=>matchesFilter(entry,"handicap")).length,
    tableBooked:openRows.filter(entry=>matchesFilter(entry,"tableBooked")).length,
  }),[openRows,matchesFilter]);
  const filteredOpenRows=useMemo(()=>filter==="all"?openRows:openRows.filter(entry=>matchesFilter(entry,filter)),
    [openRows,filter,matchesFilter]);
  /* Section headings only make sense across a mixed run of days -- picking one day on the rail
     already answers "which day", so headings would just repeat it. `filteredOpenRows` is already in
     clock order, so consecutive same-date entries fall into the same group for free. */
  const dayGroups=useMemo(()=>{
    if(active!==ALL_DATES)return null;
    const groups:{date:string;entries:Entry[]}[]=[];
    for(const entry of filteredOpenRows){
      const entryDate=dateOf(entry.startAt);
      const last=groups[groups.length-1];
      if(last&&last.date===entryDate)last.entries.push(entry);
      else groups.push({date:entryDate,entries:[entry]});
    }
    return groups;
  },[filteredOpenRows,active]);
  const sectionLabel=(entryDate:string)=>
    entryDate===today?"今晚":entryDate===addDaysHongKong(today,1)?"聽日":hkDayLabel(entryDate).replace(/[（）()]/g,"");

  const openHands=(data?.hands??[]).filter(hand=>!hand.accepted);

  /* One banner, chosen in the order a member would rank these themselves: a game that is on beats a
     score that is owed beats a list that needs reading. */
  const banner=useMemo<BannerItem|null>(()=>{
    const toRecord=mine.find(item=>slotStatus(item)==="toRecord");
    const handRecord=(data?.hands??[]).find(hand=>hand.accepted&&slotStatus(hand.slot)==="toRecord");
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
  const editingSlot=editing?mineById.get(editing)??null:null;
  const detailEntry=openDetail?entries.find(entry=>entry.id===openDetail)??null:null;
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

    {/* Suppressed while the board is empty: `ColdOpen` below carries the only 約局 button on
        screen then, rather than sitting one above the other saying the same thing twice. */}
    {signedIn&&!empty&&<Button variant="primary" className="mm-primary" onClick={createSession}>
      <span className="mm-primary-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </span>
      立即約局
    </Button>}

    {empty
      ? <ColdOpen signedIn={signedIn} onCreate={createSession}/>
      : <>
        <DateRail dates={dates} selected={active} counts={dateCounts} total={live.length} onSelect={setDate}/>

        {featured
          ? <FeaturedCard entry={featured} overlap={overlapMinutes(featured,availability)} canAct={canAct}
              busy={busyId===featured.id} onRaise={()=>void raise(featured.id)} onRetract={()=>void retract(featured.id)}/>
          /* Without published availability there is no honest "best fit" to pin -- but leaving the
             gap unexplained reads as a bug, not a boundary. A signed-in member with somewhere to fix
             it gets a one-line reason instead of silence; nobody else sees anything here at all. */
          : signedIn&&onManageAvailability&&<div className="mm-invite">
              <span className="mm-invite-copy"><b>話你幾時得閒，我哋幫你揀啱嘅局</b>
                <small>公開空檔之後，最啱你嘅局就會釘喺呢度</small></span>
              <Button variant="secondary" onClick={onManageAvailability}>宜家講</Button>
            </div>}

        {openRows.length>0&&<div className="mm-filter-row" role="tablist" aria-label="篩選開緊嘅局">
          {([
            ["all","全部"],["level","啱我水平"],["handicap","有讓分"],["tableBooked","已訂枱"],
          ] as [RowFilter,string][]).filter(([key])=>key==="all"||filterCounts[key]>0).map(([key,label])=>
            <button key={key} type="button" role="tab" aria-selected={filter===key}
              className={`mm-filter-chip${filter===key?" active":""}`} onClick={()=>setFilter(key)}>
              {label} {filterCounts[key]}
            </button>)}
        </div>}

        <div className="mm-timeline">
          {filteredOpenRows.length>0
            ? dayGroups
              ? dayGroups.map(group=><div className="mm-day-group" key={group.date}>
                  <div className="mm-day-heading"><b>{sectionLabel(group.date)}</b><i aria-hidden="true"/>
                    <small>{group.entries.length} 場</small></div>
                  {group.entries.map(entry=><TimelineRow key={entry.id} entry={entry} canAct={canAct} busy={busyId===entry.id}
                    onRaise={()=>void raise(entry.id)} onRetract={()=>void retract(entry.id)}
                    onOpenMine={()=>setOpenMine(entry.id)} onOpenDetail={()=>setOpenDetail(entry.id)}/>)}
                </div>)
              : filteredOpenRows.map(entry=><TimelineRow key={entry.id} entry={entry} canAct={canAct} busy={busyId===entry.id}
                  onRaise={()=>void raise(entry.id)} onRetract={()=>void retract(entry.id)}
                  onOpenMine={()=>setOpenMine(entry.id)} onOpenDetail={()=>setOpenDetail(entry.id)}/>)
            : !featured&&<p className="mm-note">{filter==="all"
                ?`${active===ALL_DATES?"":hkDayLabel(active)}未有人開局。${signedIn?"你可以做第一個。":""}`
                :"呢個篩選暫時冇符合嘅局。"}</p>}

          {closedRows.length>0&&<div className="mm-closed">
            <button type="button" className="mm-closed-head" aria-expanded={closedOpen} onClick={()=>setClosedOpen(value=>!value)}>
              <span>已滿或已過 · {closedRows.length} 場</span>
              <span aria-hidden="true">{closedOpen?"−":"›"}</span>
            </button>
            {closedOpen&&closedRows.map(entry=><TimelineRow key={entry.id} entry={entry} canAct={canAct} busy={busyId===entry.id}
              onRaise={()=>void raise(entry.id)} onRetract={()=>void retract(entry.id)}
              onOpenMine={()=>setOpenMine(entry.id)} onOpenDetail={()=>setOpenDetail(entry.id)}/>)}
          </div>}
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

    {error&&!composing&&!editingSlot&&<p className="availability-form-error" role="alert">{error}</p>}
    {toast&&<p key={toast} className="availability-notice" role="status">{toast}</p>}

    {composing&&<Composer busy={busy} error={error} onClose={()=>{setComposing(false);setError("")}} onCreate={create}/>}
    {editingSlot&&<Composer busy={busy} error={error} editing
      initial={{startAt:editingSlot.startAt,endAt:editingSlot.endAt,venue:editingSlot.venue,fillRule:editingSlot.fillRule,conditions:editingSlot.conditions}}
      onClose={()=>{setEditing(null);setError("")}} onCreate={input=>void saveEdit(editingSlot.id,input)}/>}
    {sheet&&!editingSlot&&<MineSheet item={sheet} busyId={busyId} onClose={()=>setOpenMine(null)}
      onAccept={playerId=>void accept(sheet.id,playerId)}
      onAcceptAll={()=>void acceptAll(sheet.id)}
      onStopTaking={()=>void stopTaking(sheet.id)}
      onCancel={()=>void cancel(sheet.id)}
      onResult={value=>void result(sheet.id,value,sheet.filledBy,sheet.startAt)}
      onShare={()=>share(sheet.id)}
      onEdit={()=>{setError("");setEditing(sheet.id)}}/>}
    {detailEntry&&!sheet&&<BoardDetailSheet entry={detailEntry} canAct={canAct} busy={busyId===detailEntry.id}
      onRaise={()=>void raise(detailEntry.id)} onRetract={()=>void retract(detailEntry.id)}
      onShare={()=>share(detailEntry.id)} onClose={()=>setOpenDetail(null)}/>}
    {posted&&<PostedSheet posted={posted} onShare={()=>share(posted.id)} onClose={()=>setPosted(null)}/>}
  </div>;
}
