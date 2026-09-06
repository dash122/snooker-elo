"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlayerBadge } from "./UiBits";
import { Button, InlineNotice } from "./components/ui/Primitives";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { addDaysHongKong, hkDate } from "../lib/availability";
import { BAND_COLUMNS, TAP_COLUMNS, clampColumn, columnClock, columnInstant, density,
  normaliseWindow, overlapping, peakOf, peakWindow, sharedWindow,
  type Window } from "../lib/week-band";

/* --- 時段軸 · 一個手勢，同時是查詢，也是宣告 ---------------------------------
 *
 * 舊版把「公開時段」與「尋找對手」拆成兩段旅程：會員在另一個分頁畫好時段，再回到這裡查看有誰。宣告
 * 之後才知道值不值得宣告，於是多數人兩件事都不做。
 *
 * 這裡只有一個控制項。會員拖出的那一格，同一時間是：
 *   查詢 — 名單與人數即時跟著改，公開之前已經看得見；
 *   宣告 — 按下確認，同一格寫入 `availability_slots`，姓名同時解鎖。
 *
 * 所以沒有先後次序，因為只有一個動作。畫面上每一處「重疊 N 人」都由同一個 window 算出來，這也是唯一
 * 能保證兩邊答案一致的做法。
 *
 * 互惠是柔性的：未公開時人數、密度、頭像位置、ELO 區間照樣可見（這些正是誘因），只有姓名、頭像、確實
 * 時段與邀請按鈕上鎖。上鎖由伺服器執行 — 見 `app/api/matchmaking/week/route.ts` — 客戶端的模糊只是
 * 表現層，後面沒有藏著任何身分。 */

type Person = {
  playerId:string; name:string|null; short:string|null; colour:string|null; avatar:string|null;
  rating:number|null; ratingBand:string; atClub:boolean; slots:{from:number;to:number}[];
};
type Day = { date:string; people:Person[]; mine:{id:string;from:number;to:number}[] };
type Gate = { locked:boolean; anonymous:boolean; inGrace:boolean; hasPublished:boolean };
type Stats = { streakWeeks:number; publishedThisWeek:boolean; clubPublishedThisWeek:number };
type WeekData = { start:string; days:Day[]; gate:Gate; stats:Stats; atClub:boolean; me:string|null };

const dayLabel=(date:string,today:string)=>{
  if(date===today)return "今日";
  if(date===addDaysHongKong(today,1))return "明日";
  return new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${date}T00:00:00+08:00`));
};

/** 半小時一格的下拉選單，作為拖曳的後備。拖曳在觸控上快，但需要精細動作；下拉選單則對任何人、任何輸入
    方式都可用，兩者寫入同一個 window，因此不會產生第二種資料。 */
const COLUMN_OPTIONS=Array.from({length:BAND_COLUMNS+1},(_,index)=>({index,label:columnClock(index)}));

function OwnWindowFields({window:current,onChange}:{window:Window;onChange:(next:Window)=>void}){
  return <div className="wb-fields">
    <label><span>開始</span>
      <select value={current.from} onChange={event=>{
        const from=Number(event.target.value);
        onChange(normaliseWindow({from,to:Math.max(current.to,from+1)}));
      }}>
        {COLUMN_OPTIONS.slice(0,BAND_COLUMNS).map(option=>
          <option key={option.index} value={option.index}>{option.label}</option>)}
      </select>
    </label>
    <label><span>結束</span>
      <select value={current.to} onChange={event=>{
        const to=Number(event.target.value);
        onChange(normaliseWindow({from:Math.min(current.from,to-1),to}));
      }}>
        {COLUMN_OPTIONS.slice(1).map(option=>
          <option key={option.index} value={option.index}>{option.label}</option>)}
      </select>
    </label>
  </div>;
}

export function WeekBand({signedIn,onInvite,onOpenPlayer,onChanged,refreshKey}:{
  signedIn:boolean;
  /** 邀請已預填時段軸這一格 — 會員不會被問第二次時間。 */
  onInvite?:(playerId:string,slot:{startAt:string;endAt:string})=>void;
  onOpenPlayer?:(playerId:string)=>void;
  onChanged?:()=>void;
  refreshKey?:number;
}){
  const today=useMemo(()=>hkDate(),[]);
  const [data,setData]=useState<WeekData|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"error">("loading");
  const [selected,setSelected]=useState(0);
  /* 會員動過的時段，連同它屬於哪一天。以日期而非 boolean 記住，是因為換日要回到那一晚的預設，而重新
     載入（例如公開之後）不應該把手上的那一格彈回去 — 兩者在只用一個 flag 時是同一件事。 */
  const [override,setOverride]=useState<{date:string;window:Window}|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [showFields,setShowFields]=useState(false);
  const [applying,setApplying]=useState<number|null>(null);
  const [nonce,setNonce]=useState(0);
  const bandRef=useRef<HTMLDivElement>(null);
  const dragRef=useRef<{mode:"new"|"start"|"end";anchor:number}|null>(null);

  const [reloadToken,setReloadToken]=useState(0);
  useEffect(()=>{
    let live=true;
    (async()=>{
      try{
        const response=await fetch(`/api/matchmaking/week?start=${today}`,{cache:"no-store"});
        const body=await response.json();
        if(!live)return;
        if(!response.ok)throw new Error(body?.error);
        setData(body);setState("ready");
      }catch{if(live)setState("error")}
    })();
    trackAvailabilityEvent("week_band_view");
    return ()=>{live=false};
  },[today,refreshKey,nonce,reloadToken]);

  const day=data?.days[selected]??null;
  const columns=useMemo(()=>day?density(day.people):[],[day]);
  const peak=peakOf(columns);

  /* 預設落在當晚會所的峰值，所以即使會員什麼都不做就按下確認，時段也落在最有機會遇到人的地方。已經公開
     的那一晚則回到自己寫過的時段。兩者都是推導出來的，不是同步出來的 — 會員動過之後 `override` 才蓋
     過它。 */
  const derived=useMemo<Window>(()=>{
    if(!day)return {from:4,to:8};
    const own=day.mine[0];
    return own?normaliseWindow({from:own.from,to:own.to}):peakWindow(density(day.people));
  },[day]);
  const touched=Boolean(override&&day&&override.date===day.date);
  const window=touched&&override?override.window:derived;

  const published=Boolean(day?.mine.length);
  const overlap=useMemo(()=>{
    if(!day)return [];
    return overlapping(day.people,window)
      .slice()
      .sort((a,b)=>(b.atClub?1:0)-(a.atClub?1:0)||(a.rating&&b.rating?Math.abs(a.rating-1500)-Math.abs(b.rating-1500):0));
  },[day,window]);

  const setChecked=useCallback((next:Window)=>{
    if(!day)return;
    setOverride({date:day.date,window:normaliseWindow(next)});
  },[day]);

  /* --- 拖曳 ---------------------------------------------------------------- */
  const columnAt=(clientX:number)=>{
    const element=bandRef.current;
    if(!element)return 0;
    const rect=element.getBoundingClientRect();
    return clampColumn((clientX-rect.left)/rect.width*BAND_COLUMNS);
  };
  const onPointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(!signedIn)return;
    const column=columnAt(event.clientX);
    const mode=Math.abs(column-window.from)<=1?"start":Math.abs(column-window.to)<=1?"end":"new";
    dragRef.current={mode,anchor:column};
    if(mode==="new")setChecked({from:column,to:column+1});
    bandRef.current?.setPointerCapture(event.pointerId);
  };
  const onPointerMove=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const drag=dragRef.current;
    if(!drag)return;
    const column=columnAt(event.clientX);
    if(drag.mode==="new")setChecked({from:Math.min(drag.anchor,column),to:Math.max(drag.anchor,column)});
    else if(drag.mode==="start")setChecked({from:column,to:window.to});
    else setChecked({from:window.from,to:column});
  };
  const onPointerUp=()=>{
    const drag=dragRef.current;
    dragRef.current=null;
    /* 輕按一下 ＝ 兩小時，而非零。手指離開時才展開，好讓拖曳途中的窄窗不會忽然彈開。 */
    if(drag?.mode==="new"&&window.to-window.from<=1)setChecked({from:window.from,to:window.from+TAP_COLUMNS});
  };
  const onKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    const shift=event.shiftKey;
    if(event.key==="ArrowLeft"){
      event.preventDefault();
      setChecked(shift?{from:window.from,to:window.to-1}:{from:window.from-1,to:window.to-1});
    }else if(event.key==="ArrowRight"){
      event.preventDefault();
      setChecked(shift?{from:window.from,to:window.to+1}:{from:window.from+1,to:window.to+1});
    }
  };

  /* --- 確認：同一格寫入時段，姓名同時解鎖 ---------------------------------- */
  const publish=useCallback(async(date:string,value:Window,label:string)=>{
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/availability",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({slots:[{startAt:columnInstant(date,value.from),endAt:columnInstant(date,value.to)}]})});
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error??"未能公開時段，請再試一次。");
      trackAvailabilityEvent("week_band_publish");
      setMessage(`已公開 ${label} ${columnClock(value.from)}–${columnClock(value.to)}。`);
      setNonce(value=>value+1);setOverride(null);onChanged?.();
    }catch(error){setMessage(error instanceof Error?error.message:"網絡連線失敗，請再試一次。")}
    finally{setBusy(false);setApplying(null)}
  },[onChanged]);

  /* 到咗會所 — 現正在會所是名單上排第一的標記，所以這個開關必須就在同一張卡上，而不是另一個畫面。 */
  const togglePresence=useCallback(async(here:boolean)=>{
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/presence",{method:here?"POST":"DELETE"});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body?.error??"未能更新狀態，請再試一次。")}
      setMessage(here?"已標示你現正在會所，90 分鐘後自動失效。":"已取消會所狀態。");
      setNonce(value=>value+1);onChanged?.();
    }catch(error){setMessage(error instanceof Error?error.message:"網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  },[onChanged]);

  const withdraw=useCallback(async()=>{
    const slot=day?.mine[0];
    if(!slot)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`/api/availability/${slot.id}`,{method:"DELETE"});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body?.error??"未能取消，請再試一次。")}
      trackAvailabilityEvent("week_band_withdraw");
      setMessage("已取消公開。");
      setNonce(value=>value+1);setOverride(null);onChanged?.();
    }catch(error){setMessage(error instanceof Error?error.message:"網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  },[day,onChanged]);

  if(state==="error")return <section className="wb-card wb-error">
    <InlineNotice tone="warning" title="未能載入約戰資料">
      請檢查網絡後再試一次。
      <Button variant="secondary" onClick={()=>{setState("loading");setReloadToken(value=>value+1)}}>重試</Button>
    </InlineNotice>
  </section>;
  if(state==="loading"||!data||!day)return <section className="wb-card" aria-busy="true"><div className="wb-skeleton"/></section>;

  const {gate,stats}=data;
  const locked=gate.locked||gate.anonymous;
  const maxPeak=Math.max(1,...data.days.map(item=>peakOf(density(item.people))));
  const label=dayLabel(day.date,today);

  return <section className="wb-card">
    <header className="wb-head">
      <p className="wb-kicker">SCAA · 約戰</p>
      <h2>{published?"你已公開時段":"本週哪一晚最多人？"}</h2>
      <p>{published
        ? "名單已解鎖，可直接發出邀請。拖動時段軸即可修改。"
        : "選一晚，再拖出你有空的時間 — 立即知道有誰重疊。"}</p>
    </header>

    {/* 七晚密度。數字是同時在場人數，不是全日人次：八個人分散在六小時，誰也碰不上。 */}
    <div className="wb-week" role="tablist" aria-label="未來七晚">
      {data.days.map((item,index)=>{
        const nightPeak=peakOf(density(item.people));
        const height=Math.max(9,Math.round(nightPeak/maxPeak*46));
        const tone=nightPeak>=maxPeak&&nightPeak>0?" hot":nightPeak<=1?" cold":"";
        return <button key={item.date} type="button" role="tab" aria-selected={index===selected}
          className={`wb-day${index===selected?" active":""}`}
          aria-label={`${dayLabel(item.date,today)}，最多 ${nightPeak} 位球員同時在場`}
          onClick={()=>{setSelected(index);setMessage("")}}>
          <b>{nightPeak}</b>
          {item.mine.length>0&&<i className="wb-day-mark" aria-hidden="true"/>}
          <i className={`wb-day-bar${tone}`} style={{height:`${height}px`}}/>
          <small>{dayLabel(item.date,today)}</small>
        </button>;
      })}
    </div>
    <p className="wb-week-foot"><span>數字＝同時在場人數</span><span>本週峰值 {maxPeak} 人</span></p>

    {/* 時段軸本身。背景是全會所的半小時密度，前景那一格是會員自己的時段。 */}
    <div className="wb-band-wrap">
      <div className={`wb-band${signedIn?"":" is-readonly"}`} ref={bandRef}
        role="slider" tabIndex={signedIn?0:-1}
        aria-label="你的時段，方向鍵每次移動 30 分鐘，按住 Shift 調整長度"
        aria-valuemin={0} aria-valuemax={BAND_COLUMNS} aria-valuenow={window.from}
        aria-valuetext={`${columnClock(window.from)} 至 ${columnClock(window.to)}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
        <p className="wb-band-head"><span>{label}</span><b>{published?"已公開":"未公開"}</b></p>
        <div className="wb-cols">
          {columns.map((value,index)=><span className="wb-col" key={index}>
            <i className={value>0&&value===peak?"is-peak":""}
              style={{height:value?`${Math.round(value/Math.max(1,peak)*84)}%`:"3px"}}/>
          </span>)}
          <span className={`wb-mine${published&&!touched?"":" is-draft"}`}
            style={{left:`${window.from/BAND_COLUMNS*100}%`,width:`${(window.to-window.from)/BAND_COLUMNS*100}%`}}>
            <b>{columnClock(window.from)}–{columnClock(window.to)}</b>
            <i className="wb-grip start" aria-hidden="true"/><i className="wb-grip end" aria-hidden="true"/>
          </span>
        </div>
        <p className="wb-axis"><span>17:00</span><span>20:00</span><span>23:00</span><span>01:00</span></p>
      </div>
      <p className="wb-band-note">{signedIn
        ? published&&!touched?"拖動即可修改已公開的時段。":"拖出你有空的時間。深色柱是會所人最多的時候。"
        : "登入之後即可公開你的時段。"}</p>
      {signedIn&&<>
        <Button variant="quiet" className="wb-fields-toggle" aria-expanded={showFields}
          onClick={()=>setShowFields(value=>!value)}>
          {showFields?"收起時間選單":"改用時間選單"}</Button>
        {showFields&&<OwnWindowFields window={window} onChange={setChecked}/>}
      </>}
    </div>

    {/* 這一格的答案。公開之前就看得見，這正是接縫被拿掉的地方。 */}
    <div className="wb-readout" aria-live="polite">
      <p className="wb-readout-n"><b>{overlap.length}</b><span>位球員與你這段時間重疊</span></p>
      {overlap.length>0&&<span className="wb-faces">
        {overlap.slice(0,6).map(person=><PlayerBadge key={person.playerId}
          player={{short:person.short??"？",colour:person.colour,avatar:person.avatar}}/>)}
      </span>}
      <small>{overlap.length
        ? locked?"公開你的時段後，即可看到姓名並發出邀請。":"可直接發出邀請，時間已預先填好。"
        : "這段時間暫時沒有人。試試拖到柱最高的位置。"}</small>
    </div>

    {overlap.length>0&&<div className="wb-list">
      <div className="wb-list-head">
        <h3>{columnClock(window.from)}–{columnClock(window.to)} 有空的球員</h3>
        <span>{overlap.length} 位</span>
      </div>
      {overlap.map(person=>{
        const shared=sharedWindow(person,window);
        const slot=person.slots[0];
        return <div className={`wb-row${locked?" is-locked":""}`} key={person.playerId}>
          <PlayerBadge player={{short:person.short??"？",colour:person.colour,avatar:person.avatar}}/>
          <span className="wb-who">
            {locked||!onOpenPlayer
              ? <b>{person.name??"●●●"}</b>
              : <button type="button" className="wb-who-link" onClick={()=>onOpenPlayer(person.playerId)}>{person.name}</button>}
            <small>{person.rating!==null?`${person.rating} ELO`:`${person.ratingBand} ELO`}</small>
            <span className="wb-chips">
              {person.atClub&&<span className="wb-chip live">現正在會所</span>}
              <span className="wb-chip">{locked?"🔒 時段":`${columnClock(Math.round(slot.from))}–${columnClock(Math.round(slot.to))}`}</span>
            </span>
          </span>
          {locked
            ? <button type="button" className="wb-ask is-locked" onClick={()=>setShowFields(true)}
                aria-label="公開你的時段後即可發出邀請">🔒</button>
            : <Button className="wb-ask" disabled={!shared}
                onClick={()=>shared&&onInvite?.(person.playerId,
                  {startAt:columnInstant(day.date,shared.from),endAt:columnInstant(day.date,shared.to)})}>邀請</Button>}
        </div>;
      })}
      {locked&&<p className="wb-gate-line">公開你的時段後，即可看到姓名並發出邀請。</p>}
    </div>}

    {signedIn&&<div className="wb-presence">
      <Button variant={data.atClub?"secondary":"quiet"} disabled={busy}
        aria-pressed={data.atClub} onClick={()=>void togglePresence(!data.atClub)}>
        {data.atClub?"✓ 現正在會所":"我在會所"}</Button>
      <small>{data.atClub?"其他球員會在名單最上方看到你。90 分鐘後自動失效。":"標示之後，你會排在今晚名單的最上方。"}</small>
    </div>}

    {message&&<p key={message} className="wb-message" role="status">{message}</p>}

    {signedIn&&<div className="wb-commit">
      {published&&!touched
        ? <Button variant="secondary" className="wb-commit-button" disabled={busy} aria-busy={busy}
            onClick={()=>void withdraw()}>
            已公開 · {label} {columnClock(window.from)}–{columnClock(window.to)}｜取消公開</Button>
        : <Button className="wb-commit-button is-primary" disabled={busy} aria-busy={busy}
            onClick={()=>void publish(day.date,window,label)}>
            公開 {label} {columnClock(window.from)}–{columnClock(window.to)}
            <small>{overlap.length?`同時解鎖 ${overlap.length} 位重疊球員的姓名`:"暫時沒有人重疊，仍可公開等人"}</small>
          </Button>}
    </div>}

    {/* 多晚公開不需要另一個介面：同一格，其餘各晚各按一下。 */}
    {published&&signedIn&&<div className="wb-apply">
      <p>套用至其他晚上</p>
      <div className="wb-apply-row">
        {data.days.map((item,index)=>index===selected?null:{item,index})
          .filter((entry): entry is {item:Day;index:number}=>entry!==null)
          .map(({item,index})=>{
            const done=item.mine.length>0;
            return <button key={item.date} type="button" className={done?"is-done":""}
              disabled={busy||done} aria-pressed={done}
              onClick={()=>{setApplying(index);void publish(item.date,window,dayLabel(item.date,today))}}>
              {dayLabel(item.date,today)} {done?"✓":applying===index?"…":"＋"}
            </button>;
          })}
      </div>
    </div>}

    {published&&stats.streakWeeks>0&&<div className="wb-streak">
      <span className="wb-streak-n">{stats.streakWeeks}</span>
      <div>
        <b>連續 {stats.streakWeeks} 週公開時段</b>
        <small>本週已有 {stats.clubPublishedThisWeek} 位球員公開時段。</small>
      </div>
    </div>}
  </section>;
}
