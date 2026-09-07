"use client";

import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {Button,Chip,EmptyState,FormField,InlineNotice,Skeleton,SlidingToggleGroup,IconButton,Surface} from "./components/ui/Primitives";
import {Sheet} from "./components/ui/Overlay";
import {PlayerBadge} from "./UiBits";
import {addDaysHongKong,availabilityEndTimes,availabilityPeak,availabilityStartTimes,hkClock,hkDate,hkDayLabel} from "../lib/availability";
import {proposeHandicap,suggestedHandicap,type HandicapSettings} from "../lib/handicap";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import {createBoardCache} from "../lib/board-cache";
import {closestOpponent,opponentFit,rankRecommendedCalls,BOARD_PAGE_SIZE} from "../lib/open-board-view";

/* --- 開局板 -----------------------------------------------------------------
 *
 * One object, three states: 等多 1 人 (one participant) → 成局 (two or more) → 已完成. A 局 with one
 * participant *is* what an earlier draft called the pool, so there is no second noun, no second
 * screen, and no "which one am I creating?" decision anywhere in here.
 *
 * Two consequences worth naming, because they look like omissions:
 *
 *   There are no roles. Four members at one table is a normal evening — you rotate — so 正選/後備
 *   would be a distinction the game itself does not make. Everyone is a 參加者, and the redundancy
 *   that protects against a no-show comes free from a 局 having four casual joiners rather than from
 *   ranking them.
 *
 *   Leaving is silent and total. `我去不到` removes the row; the card never renders who left. A card
 *   that says 「已退出 陳嘉朗」 is a small public shaming, and its real cost is the next member
 *   quietly not turning up instead of pressing the button.
 */

type Player={id:string;name:string;short:string|null;rating:number;colour:string|null;avatar:string|null};
type Venue={id:string;name:string;district:string};
type Call={id:string;startAt:string;endAt:string;message:string;venue:Venue|null;venueIntent:string;
  tempo:"sport"|"casual";handicapPref:"even"|"handicap";costSplit:"aa"|"host";smoking:"nonsmoking"|"any";
  maxPlayers:number|null;players:Player[];hostId:string;joined:boolean;fits:boolean};
type Day={date:string;calls:number;fits:boolean};
type Free={player:Player;startAt:string;endAt:string};
type BoardData={date:string;signedIn:boolean;viewerId:string|null;days:Day[];calls:Call[];venues:Venue[];free:Free[];error?:string};

const EMPTY:BoardData={date:"",signedIn:false,viewerId:null,days:[],calls:[],venues:[],free:[]};
const boardCache=createBoardCache<BoardData>();


const clockRange=(call:{startAt:string;endAt:string})=>`${hkClock(call.startAt)}–${hkClock(call.endAt)}`;
const hours=(call:{startAt:string;endAt:string})=>{
  const minutes=Math.round((Date.parse(call.endAt)-Date.parse(call.startAt))/60000);
  return minutes>=120?`${Math.round(minutes/60*10)/10} 小時`:`${minutes} 分鐘`;
};
const durationText=(minutes:number)=>minutes%60===0?`${minutes/60} 小時`:`${Math.floor(minutes/60)} 小時 ${minutes%60} 分`;
const dayNumber=(date:string)=>Number(date.slice(-2));
const monthDay=(date:string)=>`${Number(date.slice(5,7))}月${dayNumber(date)}日`;
/* `hkDayLabel` returns "8/9（週二）" — the calendar cell already shows the day number underneath, so
   the cell wants the weekday alone. Falls back to the full label rather than an empty cell if the
   locale ever stops using the bracketed form. */
const weekday=(date:string)=>hkDayLabel(date).match(/（(.+)）/)?.[1]??hkDayLabel(date);
const tempoLabel=(call:Call)=>call.tempo==="sport"?"競技":"休閒";
const placeLabel=(call:Call)=>call.venue?call.venue.name:"場地未定";
const fitShortLabel=(tier:"unknown"|"very-close"|"similar"|"handicap")=>
  tier==="very-close"?"非常夾":tier==="similar"?"水平相約":tier==="handicap"?"可讓分":"公開招募";

/** Only stated once two participants exist, because before that there is no second rating to compute
    against — an exact handicap cannot be honestly printed on a 局 with one person in it. */
const handicapLine=(call:Call,viewerId:string|null,settings?:HandicapSettings|null)=>{
  if(!settings||call.players.length!==2||!viewerId)return null;
  const me=call.players.find(player=>player.id===viewerId);
  const them=call.players.find(player=>player.id!==viewerId);
  if(!me||!them)return null;
  const proposal=proposeHandicap(me.rating,them.rating,settings);
  return <p className="ob-handicap"><b>{proposal.label}</b><span>依雙方 ELO（{Math.round(me.rating)} 對 {Math.round(them.rating)}）</span></p>;
};

export default function OpenBoard({settings,onPlayer,onRecord,onActivity,viewerId=null,viewerRating=null}:{
  viewerId?:string|null;
  viewerRating?:number|null;
  settings?:HandicapSettings|null;
  onPlayer?:(playerId:string)=>void;
  onRecord?:(opponentId:string)=>void;
  onActivity?:()=>void;
}){
  const today=useMemo(()=>hkDate(),[]);
  const cacheKey=`${viewerId??"guest"}:${today}`;
  const [selectedDate,setSelectedDate]=useState("all");
  const [date,setDate]=useState(today);
  const [data,setData]=useState<BoardData>(()=>boardCache.peek(cacheKey)??EMPTY);
  const [loading,setLoading]=useState(()=>!boardCache.peek(cacheKey)),[refreshing,setRefreshing]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  const [loadError,setLoadError]=useState("");
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  /* Grows by BOARD_PAGE_SIZE on 載入更多 rather than paging back and forth — at 50+ 局 a scan-and-load
     list serves both "just skim" and "hunting for a slot" better than round-tripping through pages,
     and resets (via the `key`) whenever the date filter changes underneath it. */
  const [loadState,setLoadState]=useState({key:"",count:BOARD_PAGE_SIZE});
  /* One key for both the roster popover and the "more actions" menu — only one of either can be
     open at a time, so they share a slot instead of each row carrying its own bit of state. */
  const [openPopup,setOpenPopup]=useState<string|null>(null);
  const [composer,setComposer]=useState<"closed"|"open">("closed");
  /* Set only while the composer is re-opened on the host's own 局 — everything else about the
     composer (fields, validation, submit) is identical between posting and editing, so this is the
     one flag that changes what the submit button does and hides the "who else fits" section, which
     only makes sense the first time a 局 is posted. */
  const [editingId,setEditingId]=useState<string|null>(null);
  const [cancelConfirm,setCancelConfirm]=useState<string|null>(null);
  /* Duration is the state, not the end time. Moving the start earlier should keep the length of the
     game the member asked for — carrying the *end* instead turns "19:00–22:00, actually let's start
     at 10" into a twelve-hour window, which is never what was meant. */
  const [start,setStart]=useState("19:00"),[durationMinutes,setDuration]=useState(180);
  const [venueId,setVenueId]=useState(""),[venuePicked,setVenuePicked]=useState(false);
  const [venueIntent,setVenueIntent]=useState("");
  const [formTempo,setFormTempo]=useState<"sport"|"casual">("sport");
  const [handicapPref,setHandicapPref]=useState<"even"|"handicap">("even");
  const [costSplit,setCostSplit]=useState<"aa"|"host">("aa");
  const [smoking,setSmoking]=useState<"nonsmoking"|"any">("nonsmoking");
  /* Express the choice in the member's language: how many *other* people may join. The database
     stores total players, including the host, so create() adds one only when a limit is chosen. */
  const [maxJoiners,setMaxJoiners]=useState<number|null>(null);
  const [note,setNote]=useState(""),[moreOpen,setMoreOpen]=useState(false);
  const [venueOpen,setVenueOpen]=useState(false);
  const loadRequest=useRef(0);

  /* --- the live window ----------------------------------------------------
   *
   * Three controls that constrain each other, resolved on every render rather than patched by
   * effects: the day decides which start times still exist, the start decides how long a game can
   * run, and an answer a later choice invalidates falls back to the nearest legal one. Nothing here
   * can produce a window the API would reject. */

  /* Offering a start time that has already gone is offering a mistake. Applies to today only — the
     clock is read at render, so a sheet left open across the half hour re-resolves on the next
     interaction rather than holding a stale list. */
  const startOptions=(()=>{
    const all=availabilityStartTimes();
    if(date!==today)return all;
    const now=new Date().toLocaleTimeString("en-GB",{timeZone:"Asia/Hong_Kong",hour12:false,hour:"2-digit",minute:"2-digit"});
    return all.filter(value=>value>now);
  })();
  const effectiveStart=startOptions.includes(start)?start:(startOptions[0]??start);

  /* `availabilityEndTimes` already caps at AVAILABILITY_MAX_MINUTES (12 hours) and at the 02:00
     close, so the duration selector only offers legal choices. */
  const endOptions=availabilityEndTimes(effectiveStart);
  const longestMinutes=endOptions.length*30;
  /* Clamped rather than reset: a late start that cannot fit the chosen length gets the longest
     window still available, so the member loses the tail of their plan instead of the whole of it. */
  const effectiveDuration=Math.max(60,Math.min(durationMinutes,longestMinutes||durationMinutes));
  const endOption=endOptions[Math.round(effectiveDuration/30)-1];
  const effectiveEnd=endOption?.value??effectiveStart;
  const endLabel=endOption?.label??effectiveEnd;
  const durationLabel=durationText(effectiveDuration);

  const load=useCallback(async(force=false)=>{
    const request=++loadRequest.current;
    setNow(Date.now());
    if(force)boardCache.invalidate(cacheKey);
    setRefreshing(true);
    try{
      const body=await boardCache.read(cacheKey,async()=>{
        const response=await fetch("/api/open-board?date=all",{cache:"no-store",signal:AbortSignal.timeout(12000)});
        const result=await response.json() as BoardData;
        if(!response.ok||result.error)throw new Error(result.error??"開局板暫時未能載入。");
        return result;
      });
      if(request===loadRequest.current){setData(body);setLoadError("")}
    }catch(reason){if(request===loadRequest.current)setLoadError(reason instanceof TypeError?"暫時連不上約戰板，請確認網絡後重試。":reason instanceof Error&&reason.name!=="TimeoutError"?reason.message:"載入較慢，請重試。已載入的時段仍可瀏覽。")}
    finally{if(request===loadRequest.current){setLoading(false);setRefreshing(false)}}
  },[cacheKey]);

  /* Deferred by a zero timer, the same shape the rest of this codebase uses for a load-on-mount:
     it keeps the fetch out of the effect body so the render pass never sees a synchronous setState. */
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==="visible")void load()};
    const timer=window.setTimeout(()=>void load(),0);
    const interval=window.setInterval(refresh,30000);
    window.addEventListener("focus",refresh);
    return()=>{window.clearTimeout(timer);window.clearInterval(interval);window.removeEventListener("focus",refresh)};
  },[load]);
  useEffect(()=>{if(!message)return;const timer=window.setTimeout(()=>setMessage(""),4500);return()=>window.clearTimeout(timer)},[message]);
  useEffect(()=>{trackAvailabilityEvent("open_board_view")},[]);

  /* SCAA is the club's own room and where most 局 actually happen, so it is the default rather than
     「稍後一起決定」 — a member who wants somewhere else changes it, which is one tap either way, but
     the common case arrives already answered.
     Derived rather than written by an effect: the venue list arrives with the board, so "which venue
     is selected" is a function of that list plus whether the member has chosen yet, and computing it
     avoids a render that shows the wrong default before an effect corrects it. `venuePicked` keeps
     this a default and not a lock — once the member picks anything, including 稍後一起決定, the
     default stops reaching in. */
  const defaultVenueId=useMemo(()=>
    data.venues.find(venue=>venue.name.toUpperCase().includes("SCAA"))?.id??"",[data.venues]);
  const effectiveVenueId=venuePicked?venueId:(venueId||defaultVenueId);

  const chooseVenue=useCallback((id:string)=>{setVenueId(id);setVenuePicked(true)},[]);

  const mutate=useCallback(async(key:string,url:string,init:RequestInit,success:string)=>{
    if(busy)return false;setBusy(key);setError("");
    try{
      const response=await fetch(url,init);
      const body=await response.json() as {error?:string;call?:Call};
      if(!response.ok)throw new Error(body.error??"操作失敗，請再試一次。");
      setData(current=>{
        const updated=body.call;
        const calls=updated?[...current.calls.filter(call=>call.id!==updated.id),updated].sort((a,b)=>a.startAt.localeCompare(b.startAt))
          :key.startsWith("leave:")?current.calls.flatMap(call=>{
            if(call.id!==key.slice(6))return [call];
            const players=call.players.filter(player=>player.id!==current.viewerId);
            return players.length?[{...call,players,joined:false}]:[];
          }):key.startsWith("cancel:")?current.calls.filter(call=>call.id!==key.slice(7))
          :current.calls;
        return {...current,calls};
      });
      void load(true);setMessage(success);onActivity?.();return true;
    }catch(reason){setError(reason instanceof TypeError?"連線中斷，請重新載入確認操作是否已完成，再重試。":reason instanceof Error?reason.message:"操作失敗，請再試一次。");return false}
    finally{setBusy("")}
  },[busy,load,onActivity]);

  const join=(call:Call)=>{
    trackAvailabilityEvent("open_board_join",{players:call.players.length});
    void mutate(`join:${call.id}`,`/api/open-board/${call.id}`,{method:"POST"},
      call.players.length>=1?"已加入，成局。":"已加入。");
  };
  const leave=(call:Call)=>void mutate(`leave:${call.id}`,`/api/open-board/${call.id}`,{method:"DELETE"},
    "已通知其他參加者你去不到。");

  /* The composer's whole job is to merge rather than to create. Step one takes a window; step two
     shows the 局 that window already reaches, with 加入 as the default and 照開我自己的局 as the way
     out. The second member to enter a Sunday evening therefore cannot accidentally start a second
     game — they see the first one before they are allowed to create anything. */
  const windowStart=Date.parse(`${date}T${effectiveStart}:00+08:00`);
  const windowEnd=windowStart+effectiveDuration*60000;
  const liveCalls=data.calls.filter(call=>Date.parse(call.endAt)>now);
  const overlapping=liveCalls.filter(call=>
    !call.joined&&Math.min(Date.parse(call.endAt),windowEnd)-Math.max(Date.parse(call.startAt),windowStart)>=60*60*1000
  );

  const submitComposer=async()=>{
    const payload=JSON.stringify({startAt:new Date(windowStart).toISOString(),endAt:new Date(windowEnd).toISOString(),
      message:note.trim(),venueId:effectiveVenueId||null,venueIntent:effectiveVenueId?"":venueIntent.trim(),
      tempo:formTempo,handicapPref,costSplit,smoking,maxPlayers:maxJoiners===null?null:maxJoiners+1});
    const ok=editingId
      ?await mutate(`edit:${editingId}`,`/api/open-board/${editingId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:payload},"已更新約戰。")
      :await mutate("create","/api/open-board",{method:"POST",headers:{"content-type":"application/json"},body:payload},"已開局，時間夾到的球友會收到通知。");
    if(ok){
      if(!editingId)trackAvailabilityEvent("open_board_create",{tempo:formTempo,maxJoiners:maxJoiners??"unlimited"});
      setComposer("closed");setEditingId(null);setNote("");setMaxJoiners(null);
      if(selectedDate!=="all")setSelectedDate(date);
    }
  };

  const joinFromComposer=async(call:Call)=>{
    const ok=await mutate(`join:${call.id}`,`/api/open-board/${call.id}`,{method:"POST"},"已加入。");
    if(ok)setComposer("closed");
  };

  /** Re-opens the composer pre-filled with the host's own 局, rather than a second form — the same
      fields, the same validation, only the submit target differs (see `submitComposer`). */
  const openEditor=(call:Call)=>{
    setEditingId(call.id);
    setDate(hkDate(new Date(call.startAt)));
    setStart(hkClock(call.startAt));
    setDuration(Math.max(30,Math.round((Date.parse(call.endAt)-Date.parse(call.startAt))/60000)));
    setNote(call.message);
    setFormTempo(call.tempo);
    setHandicapPref(call.handicapPref);
    setCostSplit(call.costSplit);
    setSmoking(call.smoking);
    setMaxJoiners(call.maxPlayers===null?null:Math.max(1,call.maxPlayers-1));
    setVenueId(call.venue?.id??"");
    setVenuePicked(true);
    setVenueIntent(call.venueIntent);
    setComposer("open");
  };

  const cancelSlot=(call:Call)=>{
    setCancelConfirm(null);
    void mutate(`cancel:${call.id}`,`/api/open-board/${call.id}/cancel`,{method:"POST"},"已取消，其他參加者會收到通知。");
  };

  const dayCalls=liveCalls.filter(call=>selectedDate==="all"||hkDate(new Date(call.startAt))===selectedDate);
  /* No browse-mode toggle or filters beyond date: members almost never narrow further than "what
     date", so the best-fit opponent goes on top by default instead of behind a 推薦 tab. */
  const visible=viewerRating!==null
    ?rankRecommendedCalls(dayCalls,data.viewerId,viewerRating)
    :[...dayCalls].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
  const filterKey=selectedDate;
  const loadCount=loadState.key===filterKey?loadState.count:BOARD_PAGE_SIZE;
  const shownCalls=visible.slice(0,loadCount);
  const hasMore=shownCalls.length<visible.length;

  const days=Array.from({length:14},(_,index)=>{
    const day=addDaysHongKong(today,index),calls=liveCalls.filter(call=>hkDate(new Date(call.startAt))===day);
    return {date:day,calls:calls.length,fits:calls.some(call=>call.fits)};
  });
  const openComposer=()=>{setEditingId(null);setDate(selectedDate==="all"?today:selectedDate);setComposer("open")};

  return <section className="ob-page">
    <section className="hero small">
      <div>
        <p className="kicker">會員專屬</p>
        <h1>搵人打波</h1>
        <p>先搵水平和打法合拍的球友，再揀大家方便的場地與時間。</p>
      </div>
      {(data.signedIn||viewerId)&&<Button variant="primary" onClick={openComposer}>新增時段 <span aria-hidden="true">＋</span></Button>}
    </section>

    <section className="ob-discovery" aria-labelledby="ob-discovery-title">
      <h2 id="ob-discovery-title">選擇日期</h2>
      <DateRail label="約戰日子" className="ob-day-filter">
        <button type="button" aria-label="全部日子" aria-pressed={selectedDate==="all"} onClick={()=>setSelectedDate("all")}>
          <b>{liveCalls.length}</b><small>全部</small>
        </button>
        {days.map(day=>
          <button key={day.date} type="button" aria-label={hkDayLabel(day.date)} aria-pressed={selectedDate===day.date} onClick={()=>setSelectedDate(day.date)}>
            <b>{day.calls||"–"}</b><small>{day.date===today?"今日":monthDay(day.date)}</small>
          </button>)}
      </DateRail>
    </section>

    {message&&<InlineNotice tone="success" title="已更新">{message}</InlineNotice>}
    {loadError&&<InlineNotice tone="warning" title={data.date?"未能更新約戰":"未能載入約戰"}>{loadError}<Button variant="quiet" loading={refreshing} onClick={()=>void load(true)}>重試</Button></InlineNotice>}
    {error&&<InlineNotice tone="warning" title="未能完成"><span>{error}</span><Button variant="quiet" onClick={()=>void load(true)}>重試</Button></InlineNotice>}

    {loading?<div className="ob-loading"><Skeleton height="9rem"/><Skeleton height="9rem"/></div>:!data.date?<EmptyState title="約戰板暫時未能載入" description="稍後重試；你仍可先選擇自己的時段。" action={<Button variant="secondary" loading={refreshing} onClick={()=>void load(true)}>重新載入</Button>}/>:
      !dayCalls.length?<OpenBoardEmpty allDates={selectedDate==="all"} free={data.free.filter(item=>hkDate(new Date(item.startAt))===(selectedDate==="all"?today:selectedDate)).slice(0,12)} signedIn={data.signedIn}
        onOpen={(from,minutes)=>{setStart(from);setDuration(minutes);openComposer()}}/>:
      <>
        <div className="ob-result-line"><span>{selectedDate==="all"?"所有約戰":hkDayLabel(selectedDate)} <b>{visible.length} 個</b></span></div>
        <Surface as="div" padded={false} className="ob-slot-list">
          {shownCalls.map(call=>{
            const callDate=hkDate(new Date(call.startAt));
            const full=call.maxPlayers!==null&&call.players.length>=call.maxPlayers;
            const lead=closestOpponent(call.players,data.viewerId,viewerRating);
            const isHost=Boolean(data.viewerId)&&call.hostId===data.viewerId;
            const fit=opponentFit(lead?.rating,viewerRating);
            const canRecord=call.joined&&call.players.length===2&&Boolean(onRecord);
            const menuKey=`menu:${call.id}`;
            return <article key={call.id} className="ob-slot-row">
              <div className="ob-slot-stamp">
                <b>{hkClock(call.startAt)}<br/>–{hkClock(call.endAt)}</b>
                <small>{callDate===today?"今日":weekday(callDate)}</small>
                {call.joined&&<em className={isHost?"is-host":"is-joined"} aria-hidden="true"/>}
              </div>
              <div className="ob-slot-main">
                <div className="ob-slot-top">
                  <span className="ob-slot-place"><b>{placeLabel(call)}</b>
                    <span>{[call.venue?.district||call.venueIntent,tempoLabel(call),call.costSplit==="aa"?"AA 波鐘":"發起人找數"].filter(Boolean).join(" · ")}</span>
                  </span>
                  {fit.tier!=="unknown"?<Chip tone={fit.tier==="very-close"?"success":fit.tier==="similar"?"accent":"warning"}>{fitShortLabel(fit.tier)}</Chip>
                    :call.fits&&!call.joined?<Chip tone="accent">夾到你</Chip>
                    :<Chip tone="neutral">{fitShortLabel(fit.tier)}</Chip>}
                </div>
                <div className="ob-slot-roster">
                  {call.players.map(player=><RosterChip key={player.id} call={call} player={player} settings={settings} viewerRating={viewerRating} onPlayer={onPlayer} openKey={openPopup} onToggle={setOpenPopup}/>)}
                </div>
                <div className="ob-slot-meta-icons">
                  <span className="ob-meta-item"><ScaleIcon/>{call.handicapPref==="even"?"平手對戰":"可以讓分"}</span>
                  <span className="ob-meta-item"><SmokingOffIcon/>{call.smoking==="nonsmoking"?"要求非吸煙者":"不介意吸煙"}</span>
                  <span className="ob-meta-item"><PeopleIcon/>{call.players.length}{call.maxPlayers?`/${call.maxPlayers}`:""} 人</span>
                </div>
                {handicapLine(call,data.viewerId,settings)}
                {call.message&&<p className="ob-slot-quote"><QuoteIcon/>{call.message}</p>}
                <div className="ob-slot-foot">
                  {isHost?<Chip tone="accent">你是發起人</Chip>:call.joined?<Chip tone="success">已參加</Chip>:data.signedIn?<Button disabled={Boolean(busy)||full} loading={busy===`join:${call.id}`} onClick={()=>join(call)}>{full?"已滿":"加入"}</Button>:<Chip tone={call.players.length===1?"warning":"success"}>{call.players.length===1?"等多 1 人":"已成局"}</Chip>}
                  <span className="card-tools">
                    {isHost?<>
                      <IconButton className="card-tool" label="編輯約戰" disabled={Boolean(busy)} onClick={()=>openEditor(call)}>✎</IconButton>
                      {cancelConfirm===call.id
                        ?<><Button variant="danger" disabled={Boolean(busy)} loading={busy===`cancel:${call.id}`} onClick={()=>cancelSlot(call)}>確定取消？</Button>
                          <Button variant="quiet" disabled={Boolean(busy)} onClick={()=>setCancelConfirm(null)}>算了</Button></>
                        :<IconButton className="card-tool danger" label="取消局" disabled={Boolean(busy)} onClick={()=>setCancelConfirm(call.id)}>✕</IconButton>}
                    </>:call.joined&&<span className="ob-popup-anchor">
                      <IconButton className="card-tool" label="更多動作" onClick={()=>setOpenPopup(openPopup===menuKey?null:menuKey)}>⋯</IconButton>
                      {openPopup===menuKey&&<div className="ob-action-menu" role="menu">
                        <a className="ob-action-menu-item" href={whatsappUrl(call)} target="_blank" rel="noreferrer" onClick={()=>setOpenPopup(null)}><ChatIcon/>WhatsApp 傾偈</a>
                        {canRecord&&<button type="button" className="ob-action-menu-item" onClick={()=>{setOpenPopup(null);onRecord!(call.players.find(player=>player.id!==data.viewerId)!.id)}}><FlagIcon/>記錄賽果</button>}
                        <hr/>
                        <button type="button" className="ob-action-menu-item ob-action-menu-item--danger" disabled={Boolean(busy)} onClick={()=>{setOpenPopup(null);leave(call)}}><ExitIcon/>我去不到</button>
                      </div>}
                    </span>}
                  </span>
                </div>
              </div>
            </article>;
          })}
        </Surface>
        {openPopup&&<button type="button" className="ob-popup-backdrop" aria-label="關閉選單" onClick={()=>setOpenPopup(null)}/>}
        {hasMore&&<div className="ob-load-more"><Button variant="secondary" onClick={()=>setLoadState({key:filterKey,count:loadCount+BOARD_PAGE_SIZE})}>載入更多（餘 {visible.length-shownCalls.length} 個）</Button></div>}
      </>}

    <Sheet open={composer!=="closed"} title={editingId?"編輯約戰":"幾時得閒？"}
      onClose={()=>{if(busy)return;setComposer("closed");setEditingId(null)}} className="ob-sheet">
      <div className="ob-form">
        <p className="ob-form-lede">{editingId?"修改時間、場地或設定，其他參加者不會另外收到通知。":"揀一段時間，夾到的約戰會即時顯示在下面。"}</p>
        <fieldset className="ob-choice"><legend>日期 <span>{hkDayLabel(date)}</span></legend>
          <DateRail label="新增時段日期" className="ob-daypick">
            {Array.from({length:14},(_,index)=>addDaysHongKong(today,index)).map(day=>
              <button key={day} type="button" aria-label={hkDayLabel(day)} aria-pressed={day===date} onClick={()=>setDate(day)}>
                <small>{day===today?"今日":weekday(day)}</small><b>{dayNumber(day)}</b>
              </button>)}
          </DateRail>
        </fieldset>
        {startOptions.length?<div className="ob-time-fields">
          <FormField label="開始時間"><select value={effectiveStart} onChange={event=>setStart(event.target.value)}>{startOptions.map(value=><option key={value}>{value}</option>)}</select></FormField>
          <FormField label="打幾耐"><select value={effectiveDuration} onChange={event=>setDuration(Number(event.target.value))}>{endOptions.slice(1).map((option,index)=><option key={option.value} value={(index+2)*30}>{durationText((index+2)*30)}</option>)}</select></FormField>
        </div>:<InlineNotice tone="warning" title="今日已沒有可選時間">揀另一日，就可以繼續。</InlineNotice>}
        {startOptions.length>0&&<div className="ob-time-summary"><DateStamp date={date}/><div><span>你的時段 · {durationLabel}</span><b>{effectiveStart}–{endLabel}</b><small>香港時間</small></div></div>}

        {!editingId&&<>
        {loadError&&data.date&&<InlineNotice tone="warning" title="顯示上次載入的約戰">{loadError}<Button type="button" variant="quiet" loading={refreshing} onClick={()=>void load(true)}>重試</Button></InlineNotice>}
        {loading?<InlineNotice title="正在找適合你的約戰">你可以先確認時間，也可以直接開局。</InlineNotice>:!data.date?<InlineNotice tone="warning" title="暫時未能查看其他局">{loadError||"請重試載入，再決定加入或開局。"}<Button type="button" variant="quiet" loading={refreshing} onClick={()=>void load(true)}>重新載入</Button></InlineNotice>:overlapping.length>0?<section className="ob-match" aria-label="可能適合你的局">
          <b>有 {overlapping.length} 個約戰時間夾到你，已按對手水平排序</b>
          {rankRecommendedCalls(overlapping,data.viewerId,viewerRating).map(call=>{const opponent=closestOpponent(call.players,data.viewerId,viewerRating);return <div key={call.id} className="ob-match-row">
            <div className="ob-match-detail">{opponent&&<BoardPlayerInfo player={opponent} settings={settings}/>}<MatchVerdict player={opponent} viewerRating={viewerRating} settings={settings} joined={false}/><b>{placeLabel(call)}</b><span>{clockRange(call)}</span><small>{call.players.length} 人參加 · {tempoLabel(call)} · {call.costSplit==="aa"?"AA 波鐘":"發起人找數"}</small></div>
            <Button type="button" disabled={Boolean(busy)} loading={busy===`join:${call.id}`} onClick={()=>void joinFromComposer(call)}>加入</Button>
          </div>})}
        </section>:<p className="ob-form-lede">這段時間暫時未有其他局。開一局，等球友加入。</p>}
        </>}
        <section className="ob-own-game" aria-label={editingId?"約戰設定":"開自己的局"}>
          {!editingId&&overlapping.length>0&&<h3>或者，開自己的局</h3>}
          <div className="ob-setting-row"><div><small>場地</small><b>{data.venues.find(venue=>venue.id===effectiveVenueId)?.name||venueIntent||"稍後一起決定"}</b></div><Button type="button" variant="quiet" disabled={Boolean(busy)} aria-expanded={venueOpen} aria-controls="ob-venue-options" onClick={()=>setVenueOpen(value=>!value)}>{venueOpen?"收起":"更改"}</Button></div>
          <fieldset className="ob-editable" disabled={Boolean(busy)}>
            {venueOpen&&<div id="ob-venue-options" className="ob-more-panel">
              <div className="ob-field-group"><h3>選擇場地</h3>
                <VenuePicker venues={data.venues} value={effectiveVenueId} onChange={chooseVenue}
                  onCreated={venue=>{
                    setData(current=>({...current,venues:[...current.venues,venue].sort((a,b)=>a.name.localeCompare(b.name))}));
                    chooseVenue(venue.id);
                  }}/>
              </div>
              {!effectiveVenueId&&<FormField label="地區意向（可選）">
                <input value={venueIntent} onChange={event=>setVenueIntent(event.target.value)} placeholder="例：葵青區" maxLength={30}/>
              </FormField>}
            </div>}
          </fieldset>
          <div className="ob-setting-row ob-setting-row--intent"><div><small>更多設定</small><p>{formTempo==="sport"?"競技對手":"休閒球友"} · {handicapPref==="even"?"希望平手對戰":"接受讓分平衡"}<br/>{costSplit==="aa"?"AA 波鐘":"發起人找數"} · {smoking==="nonsmoking"?"要求非吸煙者":"不介意吸煙"}{maxJoiners!==null?` · 最多 ${maxJoiners} 人加入`:""}{note?" · 有補充":""}</p></div><Button type="button" variant="quiet" aria-expanded={moreOpen} aria-controls="ob-preferences" onClick={()=>setMoreOpen(value=>!value)}>{moreOpen?"收起":"更改"}</Button></div>
          {moreOpen&&<div id="ob-preferences" className="ob-more-panel">
            <fieldset className="ob-choice"><legend>節奏</legend><SlidingToggleGroup className="ds-toggle-control" role="group" aria-label="節奏">
              <button type="button" aria-pressed={formTempo==="sport"} onClick={()=>setFormTempo("sport")}>競技</button>
              <button type="button" aria-pressed={formTempo==="casual"} onClick={()=>setFormTempo("casual")}>休閒</button>
            </SlidingToggleGroup><p>兩者同樣計算 ELO，只影響讓分與排序</p></fieldset>
            <fieldset className="ob-choice"><legend>對手水平</legend><SlidingToggleGroup className="ds-toggle-control" role="group" aria-label="對手水平">
              <button type="button" aria-pressed={handicapPref==="even"} onClick={()=>setHandicapPref("even")}>希望平手</button>
              <button type="button" aria-pressed={handicapPref==="handicap"} onClick={()=>setHandicapPref("handicap")}>接受讓分</button>
            </SlidingToggleGroup><p>成局後會依雙方 ELO 提供建議讓分</p></fieldset>
            <fieldset className="ob-choice"><legend>分攤</legend><SlidingToggleGroup className="ds-toggle-control" role="group" aria-label="分攤"><button type="button" aria-pressed={costSplit==="aa"} onClick={()=>setCostSplit("aa")}>AA 波鐘</button><button type="button" aria-pressed={costSplit==="host"} onClick={()=>setCostSplit("host")}>發起人找數</button></SlidingToggleGroup></fieldset>
            <fieldset className="ob-choice"><legend>吸煙</legend><SlidingToggleGroup className="ds-toggle-control" role="group" aria-label="吸煙"><button type="button" aria-pressed={smoking==="nonsmoking"} onClick={()=>setSmoking("nonsmoking")}>要求非吸煙者</button><button type="button" aria-pressed={smoking==="any"} onClick={()=>setSmoking("any")}>不介意</button></SlidingToggleGroup></fieldset>
            <fieldset className="ob-capacity-choice" disabled={Boolean(busy)}>
              <legend>接受加入人數 <span>預設不設上限，減低有人甩底的影響</span></legend>
              <div className="ob-capacity-options">
                <button type="button" aria-pressed={maxJoiners===null} onClick={()=>setMaxJoiners(null)}><b>不設上限</b><small>球友可以繼續加入</small></button>
                <button type="button" aria-pressed={maxJoiners!==null} onClick={()=>setMaxJoiners(value=>value??1)}><b>設定人數</b><small>到額即停止加入</small></button>
              </div>
              {maxJoiners!==null&&<FormField label="最多接受多少位球友加入"><select value={maxJoiners} onChange={event=>setMaxJoiners(Number(event.target.value))}>{Array.from({length:7},(_,index)=>index+1).map(value=><option key={value} value={value}>{value} 人</option>)}</select></FormField>}
            </fieldset>
            <FormField label="補充（可選）"><textarea value={note} onChange={event=>setNote(event.target.value)} rows={2} maxLength={300} placeholder="例：想搵水平相約的球友，新手歡迎。"/></FormField>
          </div>}
        </section>
        <div className="ob-composer-footer">{!editingId&&<p>開局後會列在約戰板，等球友加入。</p>}<Button type="button" variant={!editingId&&overlapping.length?"secondary":"primary"} disabled={Boolean(busy)||!startOptions.length||!data.date} loading={busy===(editingId?`edit:${editingId}`:"create")} onClick={()=>void submitComposer()}>{editingId?"儲存修改":"確認開局"}</Button></div>
        {error&&<InlineNotice tone="danger" title="未能完成">{error}<Button type="button" variant="quiet" disabled={Boolean(busy)} onClick={()=>void load(true)}>重新載入</Button></InlineNotice>}
      </div>
    </Sheet>
  </section>;
}

/** The WhatsApp hand-off. Not an exit — the app keeps the roster, the timing and the result — but the
    place members will actually settle which table and who brings what, so pretending otherwise would
    only mean they do it somewhere we did not link to. */
const whatsappUrl=(call:Call)=>`https://wa.me/?text=${encodeURIComponent(
  `${hkDayLabel(call.startAt.slice(0,10))} ${clockRange(call)}`+
  `\n${call.venue?call.venue.name:call.venueIntent||"場地未定"}`+
  `\n${call.players.map(player=>player.name).join("、")}`)}`;

/** The empty state earns its place only when it carries evidence. 「今日未有局」 alone is a dead end;
    the members who said they were free that day are a reason to open one, and the button below them
    is prefilled with the window that reaches the most of them. */
function OpenBoardEmpty({free,signedIn,onOpen,allDates=false}:{free:Free[];signedIn:boolean;allDates?:boolean;onOpen:(start:string,minutes:number)=>void}){
  if(!free.length)return <EmptyState title={allDates?"未來十四日還未有人開局":"這日還未有人開局"}
    description={signedIn?"說出你何時得閒，就會成為當日第一個局。":"登入後就可以開局或加入。"}
    action={signedIn?<Button onClick={()=>onOpen("19:00",180)}>我得閒</Button>:undefined}/>;

  /* The window covered by the most published times — the same arithmetic the old algorithmic matcher
     ran privately, now shown as the reason to press the button. `availabilityPeak` takes one entry
     per member, so each free window is its own group here; it already resolves ties toward the wider
     run, which is what makes the suggestion playable rather than merely optimal. */
  const peak=availabilityPeak(free.map(item=>[{startAt:item.startAt,endAt:item.endAt}]));
  const suggested=peak
    ?{start:hkClock(peak.startAt),minutes:Math.round((Date.parse(peak.endAt)-Date.parse(peak.startAt))/60000)}
    :{start:"19:00",minutes:180};

  return <div className="ob-empty-free">
    <div className="ob-empty-head">
      <b>這日還未有人開局</b>
      <span>但這 {free.length} 位球友說過當日得閒。</span>
    </div>
    <ul className="ob-free-list">
      {free.map(item=><li key={`${item.player.id}:${item.startAt}`}>
        <PlayerBadge player={item.player}/>
        <span>{item.player.name}</span>
        <b>{clockRange(item)}</b>
      </li>)}
    </ul>
    {signedIn&&<Button onClick={()=>onOpen(suggested.start,Math.max(60,suggested.minutes))}>
      用 {suggested.start} 開局
    </Button>}
    <p className="ob-note">開局後，這幾位會收到通知。</p>
  </div>;
}

/** Pick a venue, or add one that is not in the directory yet.
 *
 *  The directory started as one club's room, and the board is meant to work across Hong Kong — so a
 *  member standing in a poolroom in 荃灣 has to be able to name it without waiting for an admin.
 *  Search filters as you type; when nothing matches exactly, the same typed text becomes the offer
 *  to add it, so adding a venue costs one extra tap rather than a separate flow. */
function VenuePicker({venues,value,onChange,onCreated}:{
  venues:Venue[]; value:string; onChange:(id:string)=>void; onCreated:(venue:Venue)=>void;
}){
  const [query,setQuery]=useState(""),[district,setDistrict]=useState("");
  const [adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const trimmed=query.trim();
  const matches=trimmed
    ?venues.filter(venue=>venue.name.toLowerCase().includes(trimmed.toLowerCase())||venue.district.includes(trimmed))
    :venues;
  const exact=venues.some(venue=>venue.name.trim().toLowerCase()===trimmed.toLowerCase());

  const create=async()=>{
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/open-board/venues",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({name:trimmed,district:district.trim()})});
      const body=await response.json() as {venue?:Venue;error?:string};
      if(!response.ok||!body.venue)throw new Error(body.error??"未能新增場地。");
      onCreated(body.venue);setAdding(false);setQuery("");setDistrict("");
    }catch(reason){setError(reason instanceof TypeError?"暫時連不上伺服器，請稍後重試。":reason instanceof Error?reason.message:"未能新增場地。")}
    finally{setBusy(false)}
  };

  return <div className="ob-venue">
    <input type="search" value={query} onChange={event=>{setQuery(event.target.value);setAdding(false)}}
      placeholder="搜尋場地，或輸入新場地名稱" aria-label="搜尋場地"/>

    <div className="ob-venue-list" role="group" aria-label="場地">
      {matches.map(venue=>
        <button key={venue.id} type="button" aria-pressed={venue.id===value} onClick={()=>onChange(venue.id)}>
          {/* A tick as well as the fill: colour alone was not carrying the selected state, and it is
              the one thing on this list a member must be able to read at a glance. */}
          <i aria-hidden="true">{venue.id===value?"✓":""}</i>
          <b>{venue.name}</b>{venue.district&&<small>{venue.district}</small>}
        </button>)}
      <button type="button" aria-pressed={!value} onClick={()=>onChange("")}>
        <i aria-hidden="true">{!value?"✓":""}</i>
        <b>稍後一起決定</b><small>成局之後再夾</small>
      </button>
    </div>

    {trimmed&&!exact&&!adding&&
      <button type="button" className="ob-venue-add" onClick={()=>setAdding(true)}>
        ＋ 新增場地「{trimmed}」
      </button>}

    {adding&&<div className="ob-venue-new">
      <FormField label={`新增「${trimmed}」`} hint="地區可留空，但填了其他人更容易判斷距離">
        <input value={district} onChange={event=>setDistrict(event.target.value)}
          placeholder="地區，例：荃灣區" maxLength={30}/>
      </FormField>
      {error&&<p className="ob-venue-error">{error}</p>}
      <div className="ob-venue-new-actions">
        <Button variant="secondary" onClick={()=>{setAdding(false);setError("")}}>取消</Button>
        <Button loading={busy} onClick={()=>void create()}>新增並選用</Button>
      </div>
    </div>}
  </div>;
}

function DateStamp({date}:{date:string}){
  return <span className="ob-date-stamp" aria-label={hkDayLabel(date)}><small>{Number(date.slice(5,7))} 月</small><strong>{dayNumber(date)}</strong></span>;
}

function DateRail({label,className,children}:{label:string;className:string;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  const [edges,setEdges]=useState({start:true,end:false});
  useEffect(()=>{
    const rail=ref.current;if(!rail)return;
    const measure=()=>setEdges({start:rail.scrollLeft<=1,end:rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-1});
    const selected=rail.querySelector<HTMLElement>('[aria-pressed="true"]');
    if(selected)rail.scrollLeft=Math.max(0,selected.offsetLeft-rail.offsetLeft-rail.clientWidth/2+selected.offsetWidth/2);
    const observer=new ResizeObserver(measure);observer.observe(rail);measure();
    rail.addEventListener("scroll",measure,{passive:true});
    return()=>{observer.disconnect();rail.removeEventListener("scroll",measure)};
  },[]);
  const move=(direction:number)=>ref.current?.scrollBy({left:direction*(ref.current.clientWidth*.75),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  return <div className="ob-date-nav">
    <IconButton type="button" label={label+"：向前捲動"} disabled={edges.start} onClick={()=>move(-1)}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m14 6-6 6 6 6"/></svg></IconButton>
    <div ref={ref} className={className} role="group" aria-label={label}>{children}</div>
    <IconButton type="button" label={label+"：向後捲動"} disabled={edges.end} onClick={()=>move(1)}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m10 6 6 6-6 6"/></svg></IconButton>
  </div>;
}

/* Meta-row icons stay small inline SVGs (informational, not buttons); edit/delete/more use the
   app's existing `.card-tool` glyph-button pattern (see globals.css) instead of drawn icons, to
   match how every other card in the app — match, cup, player — renders its own edit/delete. */
const ScaleIcon=()=><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M5 7h14M5 7l-2 5a3 3 0 0 0 6 0L5 7Zm14 0l-2 5a3 3 0 0 0 6 0l-2-5"/></svg>;
const SmokingOffIcon=()=><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/></svg>;
const PeopleIcon=()=><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.6"/><path d="M3.5 19v-1a4.5 4.5 0 0 1 4.5-4.5h0a4.5 4.5 0 0 1 4.5 4.5v1"/><circle cx="17" cy="9" r="2"/><path d="M15.3 19v-.6a3.7 3.7 0 0 1 2.8-3.6"/></svg>;
const QuoteIcon=()=><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 8c-2 0-3 1.5-3 3.5S5 15 7 15c.3 2-1 3.5-3 4M17 8c-2 0-3 1.5-3 3.5s1 3.5 3 3.5c.3 2-1 3.5-3 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const ChatIcon=()=><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L4 20l1.1-4.6A8.4 8.4 0 1 1 21 11.5Z"/></svg>;
const FlagIcon=()=><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4M6 4h12l-1 8a5 5 0 0 1-10 0L6 4Z"/></svg>;
const ExitIcon=()=><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 15 3 12l6-3M3 12h13a5 5 0 0 1 0 10h-1"/></svg>;

function BoardPlayerInfo({player,settings,onPlayer}:{player:Player;settings?:HandicapSettings|null;onPlayer?:(id:string)=>void}){
  const score=settings?suggestedHandicap(player,[],{...settings,start:settings.start??1500}):null;
  const content=<><PlayerBadge player={player}/><span><b>{player.name}</b><small>ELO <strong>{Math.round(player.rating)}</strong> · 建議評分 <strong>{score??"—"}</strong></small></span></>;
  return onPlayer?<button type="button" className="ob-player-info" onClick={()=>onPlayer(player.id)}>{content}</button>:<span className="ob-player-info">{content}</span>;
}

/** Ratings only earn a permanent line on the card once a fit is being compared; the roster itself
    stays name-first, and ELO/suggested-handicap/fit live one tap away in this popover instead. */
function RosterChip({call,player,settings,viewerRating,onPlayer,openKey,onToggle}:{
  call:Call;player:Player;settings?:HandicapSettings|null;viewerRating:number|null;
  onPlayer?:(id:string)=>void;openKey:string|null;onToggle:(key:string|null)=>void;
}){
  const popKey=`player:${call.id}:${player.id}`;
  const open=openKey===popKey;
  const score=settings?suggestedHandicap(player,[],{...settings,start:settings.start??1500}):null;
  const fit=opponentFit(player.rating,viewerRating);
  return <span className="ob-popup-anchor">
    <button type="button" className="ob-roster-chip" aria-expanded={open} onClick={()=>onToggle(open?null:popKey)}>
      <PlayerBadge player={player}/><span><b>{player.name}</b><small>ELO {Math.round(player.rating)}</small></span>
    </button>
    {open&&<div className="ob-roster-popover" role="dialog" aria-label={`${player.name}的資料`}>
      <b className="ob-popover-name">{player.name}</b>
      <span className="ob-popover-sub">ELO {Math.round(player.rating)}</span>
      <div className="ob-popover-rows">
        <span>建議評分<b>{score??"—"}</b></span>
        {fit.tier!=="unknown"&&<span>同你合拍度<b className={`ob-fit-${fit.tier}`}>{fitShortLabel(fit.tier)}</b></span>}
      </div>
      {onPlayer&&<button type="button" className="ob-popover-link" onClick={()=>onPlayer(player.id)}>睇完整球員資料 →</button>}
    </div>}
  </span>;
}

function MatchVerdict({player,viewerRating,settings,joined}:{player:Player|null;viewerRating:number|null;settings?:HandicapSettings|null;joined:boolean}){
  const fit=opponentFit(player?.rating,viewerRating);
  if(!player)return <div className="ob-match-verdict ob-match-verdict--waiting"><b>{joined?"等緊對手":"公開招募"}</b><span>{joined?"有球友加入後會顯示合拍度":"登入後可比較對手水平"}</span></div>;
  if(fit.tier==="unknown")return <div className="ob-match-verdict"><b>公開招募</b><span>查看球友、場地與時段</span></div>;
  const proposal=settings&&viewerRating!==null?proposeHandicap(viewerRating,player.rating,settings):null;
  const label=fit.tier==="very-close"?"水平非常接近":fit.tier==="similar"?"水平相約":"可用讓分平衡";
  const reason=fit.tier==="very-close"?`ELO 相差 ${fit.difference} · 適合平手對戰`
    :`ELO 相差 ${fit.difference}${proposal?` · ${proposal.label}`:""}`;
  return <div className={`ob-match-verdict ob-match-verdict--${fit.tier}`}><b>{label}</b><span>{reason}</span></div>;
}
