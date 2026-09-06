"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {Button,Chip,EmptyState,FormField,InlineNotice,Skeleton} from "./components/ui/Primitives";
import {Sheet} from "./components/ui/Overlay";
import {PlayerBadge} from "./UiBits";
import {addDaysHongKong,availabilityEndTimes,availabilityPeak,availabilityStartTimes,hkClock,hkDate,hkDayLabel} from "../lib/availability";
import {proposeHandicap,type HandicapSettings} from "../lib/handicap";
import {trackAvailabilityEvent} from "../lib/availability-analytics";

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

const clockRange=(call:{startAt:string;endAt:string})=>`${hkClock(call.startAt)}–${hkClock(call.endAt)}`;
const hours=(call:{startAt:string;endAt:string})=>{
  const minutes=Math.round((Date.parse(call.endAt)-Date.parse(call.startAt))/60000);
  return minutes>=120?`${Math.round(minutes/60*10)/10} 小時`:`${minutes} 分鐘`;
};
const durationText=(minutes:number)=>minutes%60===0?`${minutes/60} 小時`:`${Math.floor(minutes/60)} 小時 ${minutes%60} 分`;
const dayNumber=(date:string)=>Number(date.slice(-2));
/* `hkDayLabel` returns "8/9（週二）" — the calendar cell already shows the day number underneath, so
   the cell wants the weekday alone. Falls back to the full label rather than an empty cell if the
   locale ever stops using the bracketed form. */
const weekday=(date:string)=>hkDayLabel(date).match(/（(.+)）/)?.[1]??hkDayLabel(date);
const tempoLabel=(call:Call)=>call.tempo==="sport"?"競技":"休閒";
const placeLabel=(call:Call)=>call.venue?call.venue.name:"場地未定";

/* Two participants is the only threshold in the product, so it is the only thing the status chip has
   to say. Everything above two is stated as a plain count — more people is a better evening, not a
   different state. */
function statusOf(call:Call){
  const count=call.players.length;
  if(count<2)return {tone:"warning" as const,label:"等多 1 人"};
  return {tone:"success" as const,label:"成局"};
}

export default function OpenBoard({settings,onPlayer,onRecord,onActivity}:{
  settings?:HandicapSettings|null;
  onPlayer?:(playerId:string)=>void;
  onRecord?:(opponentId:string)=>void;
  onActivity?:()=>void;
}){
  const today=useMemo(()=>hkDate(),[]);
  const [date,setDate]=useState(today);
  const [data,setData]=useState<BoardData>(EMPTY),[loading,setLoading]=useState(true);
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  const [fitOnly,setFitOnly]=useState(false),[tempo,setTempo]=useState<""|"sport"|"casual">("");
  const [composer,setComposer]=useState<"closed"|"window"|"match">("closed");
  /* Duration is the state, not the end time. Moving the start earlier should keep the length of the
     game the member asked for — carrying the *end* instead turns "19:00–22:00, actually let's start
     at 10" into a twelve-hour window, which is never what was meant. */
  const [start,setStart]=useState("19:00"),[durationMinutes,setDuration]=useState(180);
  const [venueId,setVenueId]=useState(""),[venueIntent,setVenueIntent]=useState("");
  const [formTempo,setFormTempo]=useState<"sport"|"casual">("sport");
  const [handicapPref,setHandicapPref]=useState<"even"|"handicap">("even");
  const [costSplit,setCostSplit]=useState<"aa"|"host">("aa");
  const [smoking,setSmoking]=useState<"nonsmoking"|"any">("nonsmoking");
  const [note,setNote]=useState(""),[moreOpen,setMoreOpen]=useState(false);

  /* --- the live window ----------------------------------------------------
   *
   * Three controls that constrain each other, resolved on every render rather than patched by
   * effects: the day decides which start times still exist, the start decides which durations fit,
   * and an answer that a later choice invalidates falls back to the nearest legal one instead of
   * being silently kept. Nothing here can produce a window the API would reject. */

  /* Offering a start time that has already gone is offering a mistake. Applies to today only — the
     clock is read at render, so a sheet left open across the half hour re-resolves on the next
     keystroke rather than holding a stale list. */
  const startOptions=useMemo(()=>{
    const all=availabilityStartTimes();
    if(date!==today)return all;
    const now=new Date().toLocaleTimeString("en-GB",{timeZone:"Asia/Hong_Kong",hour12:false,hour:"2-digit",minute:"2-digit"});
    return all.filter(value=>value>now);
  },[date,today]);
  const effectiveStart=startOptions.includes(start)?start:(startOptions[0]??start);

  /* `availabilityEndTimes` already caps at AVAILABILITY_MAX_MINUTES (12 hours) and at the 02:00
     close, so the ceiling is enforced by the helper; these chips only have to *say* so. Durations
     are offered as a curated ladder rather than every half hour — nobody scans 24 chips to pick two
     hours — and the ladder is filtered against what the helper actually allows, so the last chip is
     always a real option rather than a promise the API breaks. */
  const endOptions=useMemo(()=>availabilityEndTimes(effectiveStart),[effectiveStart]);
  const durationChoices=useMemo(()=>{
    const ladder=[60,90,120,150,180,240,360,480,720];
    return endOptions
      .map((option,index)=>({minutes:(index+1)*30,value:option.value,endLabel:option.label}))
      .filter(option=>ladder.includes(option.minutes))
      .map(option=>({...option,label:durationText(option.minutes)}));
  },[endOptions]);
  /* Clamped rather than reset: a late start that cannot fit the chosen length gets the longest
     window still available, so the member loses the tail of their plan instead of the whole of it. */
  const longest=durationChoices.length?durationChoices[durationChoices.length-1].minutes:0;
  const effectiveDuration=Math.min(durationMinutes,longest||durationMinutes);
  const selected=durationChoices.find(option=>option.minutes===effectiveDuration)??durationChoices[durationChoices.length-1];
  const effectiveEnd=selected?.value??endOptions[endOptions.length-1]?.value??"";
  const endLabel=selected?.endLabel??effectiveEnd;
  const durationLabel=selected?selected.label:"";

  const load=useCallback(async(target:string)=>{
    try{
      const response=await fetch(`/api/open-board?date=${target}`,{cache:"no-store"});
      const body=await response.json() as BoardData;
      if(!response.ok||body.error)throw new Error(body.error??"開局板暫時未能載入。");
      setData(body);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"開局板暫時未能載入。")}
    finally{setLoading(false)}
  },[]);

  /* Deferred by a zero timer, the same shape the rest of this codebase uses for a load-on-mount:
     it keeps the fetch out of the effect body so the render pass never sees a synchronous setState. */
  useEffect(()=>{const timer=window.setTimeout(()=>void load(date),0);return()=>window.clearTimeout(timer)},[load,date]);
  useEffect(()=>{if(!message)return;const timer=window.setTimeout(()=>setMessage(""),4500);return()=>window.clearTimeout(timer)},[message]);
  useEffect(()=>{trackAvailabilityEvent("open_board_view")},[]);

  const mutate=useCallback(async(key:string,url:string,init:RequestInit,success:string)=>{
    if(busy)return false;setBusy(key);setError("");
    try{
      const response=await fetch(url,init);
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error??"操作失敗，請再試一次。");
      await load(date);setMessage(success);onActivity?.();return true;
    }catch(reason){setError(reason instanceof Error?reason.message:"操作失敗，請再試一次。");return false}
    finally{setBusy("")}
  },[busy,date,load,onActivity]);

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
  const windowStart=useMemo(()=>Date.parse(`${date}T${effectiveStart}:00+08:00`),[date,effectiveStart]);
  const windowEnd=useMemo(()=>Date.parse(`${date}T${effectiveEnd}:00+08:00`),[date,effectiveEnd]);
  const overlapping=useMemo(()=>data.calls.filter(call=>
    !call.joined&&Math.min(Date.parse(call.endAt),windowEnd)-Math.max(Date.parse(call.startAt),windowStart)>=60*60*1000
  ),[data.calls,windowStart,windowEnd]);

  const create=async()=>{
    const ok=await mutate("create","/api/open-board",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({startAt:new Date(windowStart).toISOString(),endAt:new Date(windowEnd).toISOString(),
        message:note.trim(),venueId:venueId||null,venueIntent:venueId?"":venueIntent.trim(),
        tempo:formTempo,handicapPref,costSplit,smoking,maxPlayers:null})},"已開局，時間夾到的球友會收到通知。");
    if(ok){trackAvailabilityEvent("open_board_create",{tempo:formTempo});setComposer("closed");setNote("")}
  };

  const joinFromComposer=async(call:Call)=>{
    const ok=await mutate(`join:${call.id}`,`/api/open-board/${call.id}`,{method:"POST"},"已加入。");
    if(ok)setComposer("closed");
  };

  const visible=data.calls.filter(call=>(!fitOnly||call.fits)&&(!tempo||call.tempo===tempo));
  const fitCount=data.calls.filter(call=>call.fits).length;

  /* Only stated once two participants exist, because before that there is no second rating to
     compute against — an exact handicap cannot be honestly printed on a 局 with one person in it. */
  const handicapLine=(call:Call)=>{
    if(!settings||call.players.length!==2||!data.viewerId)return null;
    const me=call.players.find(player=>player.id===data.viewerId);
    const them=call.players.find(player=>player.id!==data.viewerId);
    if(!me||!them)return null;
    const proposal=proposeHandicap(me.rating,them.rating,settings);
    return <p className="ob-handicap"><b>{proposal.label}</b><span>依雙方 ELO（{Math.round(me.rating)} 對 {Math.round(them.rating)}）</span></p>;
  };

  return <section className="ob-page">
    <div className="ob-head">
      <div>
        <p className="ob-kicker">約戰</p>
        <h1>哪日有人打球</h1>
        <p>說出你何時得閒，就會看見同日時間夾得到的人。兩個人就打得成。</p>
      </div>
      {data.signedIn&&<Button onClick={()=>setComposer("window")}>＋ 我得閒</Button>}
    </div>

    <nav className="ob-cal" aria-label="未來十四日">
      <div className="ob-cal-head"><b>未來十四日</b><span>數字為當日局數 · 金點為配合你已公開的時段</span></div>
      <div className="ob-cal-grid">
        {(data.days.length?data.days:Array.from({length:14},(_,index)=>({date:addDaysHongKong(today,index),calls:0,fits:false}))).map(day=>
          <button key={day.date} type="button" aria-pressed={day.date===date} onClick={()=>setDate(day.date)}
            aria-label={`${hkDayLabel(day.date)}，${day.calls} 個局${day.fits?"，配合你的時段":""}`}>
            <small>{day.date===today?"今日":weekday(day.date)}</small>
            <b>{String(dayNumber(day.date)).padStart(2,"0")}</b>
            <span className={day.calls?"ob-cal-n":"ob-cal-n ob-cal-n--zero"}>{day.calls?`${day.calls} 局`:"—"}</span>
            {day.fits&&<i aria-hidden="true"/>}
          </button>)}
      </div>
    </nav>

    {message&&<InlineNotice tone="success" title="已更新">{message}</InlineNotice>}
    {error&&<InlineNotice tone="warning" title="未能完成"><span>{error}</span><Button variant="quiet" onClick={()=>void load(date)}>重試</Button></InlineNotice>}

    {data.signedIn&&<div className="ob-filters" role="group" aria-label="篩選">
      <button type="button" className={`ob-chip${fitOnly?" ob-chip--on":""}`} aria-pressed={fitOnly}
        onClick={()=>setFitOnly(value=>!value)}>配合我的時間{fitCount?` · ${fitCount}`:""}</button>
      <span className="ob-filter-divider" aria-hidden="true"/>
      <button type="button" className={`ob-chip${tempo==="sport"?" ob-chip--on":""}`} aria-pressed={tempo==="sport"}
        onClick={()=>setTempo(value=>value==="sport"?"":"sport")}>競技</button>
      <button type="button" className={`ob-chip${tempo==="casual"?" ob-chip--on":""}`} aria-pressed={tempo==="casual"}
        onClick={()=>setTempo(value=>value==="casual"?"":"casual")}>休閒</button>
    </div>}

    {loading?<div className="ob-loading"><Skeleton height="9rem"/><Skeleton height="9rem"/></div>:
      !data.calls.length?<OpenBoardEmpty free={data.free} signedIn={data.signedIn}
        onOpen={(from,to)=>{setStart(from);setDuration(Math.max(60,(Number(to.slice(0,2))*60+Number(to.slice(3))-Number(from.slice(0,2))*60-Number(from.slice(3))+1440)%1440));setComposer("window")}}/>:
      !visible.length?<EmptyState title="沒有符合篩選的局"
        description="放寬篩選，或看看其他日子。"
        action={<Button variant="secondary" onClick={()=>{setFitOnly(false);setTempo("")}}>清除篩選</Button>}/>:
      <>
        <p className="ob-result-line">{hkDayLabel(date)} · <b>{visible.length} 個局</b></p>
        <div className="ob-list">
          {visible.map(call=>{
            const status=statusOf(call);
            return <article key={call.id} className={`ob-card${call.joined?" ob-card--mine":""}${call.players.length<2?" ob-card--waiting":""}${call.fits&&!call.joined?" ob-card--fits":""}`}>
              <div className="ob-card-flags">
                <Chip tone={status.tone}>{status.label}</Chip>
                {call.joined&&<Chip tone="accent">你有參加</Chip>}
                {call.fits&&!call.joined&&<Chip tone="success">配合你的時段</Chip>}
                <Chip tone="neutral">{tempoLabel(call)}</Chip>
              </div>

              <p className="ob-when"><b>{clockRange(call)}</b><small>{hkDayLabel(call.startAt.slice(0,10))} · {hours(call)}</small></p>

              <p className="ob-where">
                <span className={call.venue?"":"ob-where-undecided"}>{placeLabel(call)}</span>
                {call.venue?.district&&<span className="ob-where-meta">· {call.venue.district}</span>}
                {!call.venue&&call.venueIntent&&<span className="ob-where-meta">· 意向：{call.venueIntent}</span>}
              </p>

              <div className="ob-people">
                <small>{call.players.length} 人參加</small>
                {call.players.map(player=>
                  <button key={player.id} type="button" className="ob-person" onClick={()=>onPlayer?.(player.id)}>
                    <PlayerBadge player={player}/><span>{player.name}</span>
                  </button>)}
                {call.players.length<2&&<span className="ob-person ob-person--empty">兩個人就打得成</span>}
              </div>

              {handicapLine(call)}
              {call.message&&<p className="ob-note">{call.message}</p>}

              <div className="ob-facts">
                <Chip tone="accent">{call.costSplit==="aa"?"AA 波鐘":"主揪找數"}</Chip>
                <Chip tone="neutral">{call.handicapPref==="even"?"平手對戰":"可以讓分"}</Chip>
                <Chip tone="neutral">{call.smoking==="nonsmoking"?"要求非吸煙者":"不介意吸煙"}</Chip>
              </div>

              {data.signedIn&&<div className="ob-actions">
                {call.joined?<>
                  <Button variant="quiet" loading={busy===`leave:${call.id}`} onClick={()=>leave(call)}>我去不到</Button>
                  <WhatsAppButton call={call}/>
                  {call.players.length===2&&onRecord&&
                    <Button variant="secondary" onClick={()=>onRecord(call.players.find(player=>player.id!==data.viewerId)!.id)}>記錄賽果</Button>}
                </>:<Button loading={busy===`join:${call.id}`} onClick={()=>join(call)}>加入</Button>}
              </div>}
            </article>;
          })}
        </div>
      </>}

    <Sheet open={composer==="window"} title="約戰" onClose={()=>!busy&&setComposer("closed")} className="ob-sheet">
      <div className="ob-form">
        <p className="ob-form-lede">說出時段就算數，兩個人就打得成。</p>

        {/* Live summary of the three answers below it. A member scanning back up the sheet should be
            able to read their own window as a sentence, not reassemble it from three controls. */}
        <p className="ob-window-echo">
          <b>{hkDayLabel(date)}</b>
          <span>{effectiveStart}–{endLabel}</span>
          <small>{durationLabel}</small>
        </p>

        <FormField label="日期">
          <div className="ob-daypick" role="group" aria-label="日期">
            {Array.from({length:14},(_,index)=>addDaysHongKong(today,index)).map(day=>
              <button key={day} type="button" aria-pressed={day===date} onClick={()=>setDate(day)}>
                <small>{day===today?"今日":weekday(day)}</small>
                <b>{String(dayNumber(day)).padStart(2,"0")}</b>
              </button>)}
          </div>
        </FormField>

        <FormField label="開始時間"
          hint={date===today?"今日已過去的時間不會顯示":"每半小時一格"}>
          <div className="ob-timepick" role="group" aria-label="開始時間">
            {startOptions.length
              ?startOptions.map(value=>
                <button key={value} type="button" aria-pressed={value===effectiveStart} onClick={()=>setStart(value)}>{value}</button>)
              :<p className="ob-timepick-empty">今日已經太夜，揀第二日吧。</p>}
          </div>
        </FormField>

        <FormField label="打多久" hint="最長 12 小時">
          <div className="ob-durations" role="group" aria-label="時長">
            {durationChoices.map(option=>
              <button key={option.minutes} type="button" aria-pressed={option.minutes===effectiveDuration}
                onClick={()=>setDuration(option.minutes)}>
                <b>{option.label}</b><small>至 {option.endLabel}</small>
              </button>)}
          </div>
        </FormField>

        <FormField label="場地" hint="未決定也可以開局，其他人會看到你的地區意向">
          <VenuePicker venues={data.venues} value={venueId} onChange={setVenueId}
            onCreated={venue=>{setData(current=>({...current,venues:[...current.venues,venue].sort((a,b)=>a.name.localeCompare(b.name))}));setVenueId(venue.id)}}/>
        </FormField>
        {!venueId&&<FormField label="地區意向（可選）">
          <input value={venueIntent} onChange={event=>setVenueIntent(event.target.value)} placeholder="例：葵青區" maxLength={30}/>
        </FormField>}
        <FormField label="節奏" hint="兩者同樣計算 ELO，只影響讓分與排序">
          <div className="ob-seg" role="group">
            <button type="button" aria-pressed={formTempo==="sport"} onClick={()=>setFormTempo("sport")}>競技</button>
            <button type="button" aria-pressed={formTempo==="casual"} onClick={()=>setFormTempo("casual")}>休閒</button>
          </div>
        </FormField>
        <FormField label="讓分" hint="成局後會依雙方 ELO 提供建議讓分">
          <div className="ob-seg" role="group">
            <button type="button" aria-pressed={handicapPref==="even"} onClick={()=>setHandicapPref("even")}>平手對戰</button>
            <button type="button" aria-pressed={handicapPref==="handicap"} onClick={()=>setHandicapPref("handicap")}>可以讓分</button>
          </div>
        </FormField>

        <button type="button" className="ob-more" aria-expanded={moreOpen} onClick={()=>setMoreOpen(value=>!value)}>
          更多設定<span>{costSplit==="aa"?"AA 波鐘":"主揪找數"} · {smoking==="nonsmoking"?"要求非吸煙者":"不介意吸煙"}{note?" · 有補充":""}</span>
        </button>
        {moreOpen&&<div className="ob-more-panel">
          <FormField label="分攤">
            <div className="ob-seg" role="group">
              <button type="button" aria-pressed={costSplit==="aa"} onClick={()=>setCostSplit("aa")}>AA 波鐘</button>
              <button type="button" aria-pressed={costSplit==="host"} onClick={()=>setCostSplit("host")}>主揪找數</button>
            </div>
          </FormField>
          <FormField label="吸煙">
            <div className="ob-seg" role="group">
              <button type="button" aria-pressed={smoking==="nonsmoking"} onClick={()=>setSmoking("nonsmoking")}>要求非吸煙者</button>
              <button type="button" aria-pressed={smoking==="any"} onClick={()=>setSmoking("any")}>不介意</button>
            </div>
          </FormField>
          <FormField label="補充（可選）">
            <textarea value={note} onChange={event=>setNote(event.target.value)} rows={2} maxLength={300}
              placeholder="例：打 plan 性質，新手歡迎。"/>
          </FormField>
        </div>}

        <Button onClick={()=>setComposer("match")}>下一步</Button>
      </div>
    </Sheet>

    <Sheet open={composer==="match"} title={overlapping.length?`當日有 ${overlapping.length} 個局夾得到你`:"開你自己的局"}
      onClose={()=>!busy&&setComposer("closed")} className="ob-sheet">
      <div className="ob-form">
        {overlapping.length>0&&<>
          <div className="ob-match">
            <b>加入現有的局，即刻夠人</b>
            {overlapping.map(call=>
              <div key={call.id} className="ob-match-row">
                <span className="ob-match-time">{hkClock(call.startAt)}</span>
                <span className="ob-match-detail">
                  <b>{placeLabel(call)}{call.venue?.district?` · ${call.venue.district}`:""}</b>
                  <small>{call.players.length} 人參加 · {hours(call)}</small>
                </span>
                <Button variant={call.players.length>=2?"secondary":"primary"} loading={busy===`join:${call.id}`}
                  onClick={()=>void joinFromComposer(call)}>加入</Button>
              </div>)}
          </div>
          <p className="ob-or"><span>或者</span></p>
        </>}
        <Button variant={overlapping.length?"secondary":"primary"} loading={busy==="create"} onClick={()=>void create()}>
          照開我自己的局
        </Button>
        <p className="ob-note">開了之後同樣會顯示在當日清單，狀態是「等多 1 人」。</p>
      </div>
    </Sheet>
  </section>;
}

/** The WhatsApp hand-off. Not an exit — the app keeps the roster, the timing and the result — but the
    place members will actually settle which table and who brings what, so pretending otherwise would
    only mean they do it somewhere we did not link to. */
function WhatsAppButton({call}:{call:Call}){
  const text=encodeURIComponent(
    `${hkDayLabel(call.startAt.slice(0,10))} ${clockRange(call)}`+
    `\n${call.venue?call.venue.name:call.venueIntent||"場地未定"}`+
    `\n${call.players.map(player=>player.name).join("、")}`);
  return <a className="ds-button ds-button--secondary" href={`https://wa.me/?text=${text}`}
    target="_blank" rel="noreferrer"><span>WhatsApp</span></a>;
}

/** The empty state earns its place only when it carries evidence. 「今日未有局」 alone is a dead end;
    the members who said they were free that day are a reason to open one, and the button below them
    is prefilled with the window that reaches the most of them. */
function OpenBoardEmpty({free,signedIn,onOpen}:{free:Free[];signedIn:boolean;onOpen:(start:string,end:string)=>void}){
  if(!free.length)return <EmptyState title="這日還未有人開局"
    description={signedIn?"說出你何時得閒，就會成為當日第一個局。":"登入後就可以開局或加入。"}
    action={signedIn?<Button onClick={()=>onOpen("19:00","22:00")}>我得閒</Button>:undefined}/>;

  /* The window covered by the most published times — the same arithmetic the old algorithmic matcher
     ran privately, now shown as the reason to press the button. `availabilityPeak` takes one entry
     per member, so each free window is its own group here; it already resolves ties toward the wider
     run, which is what makes the suggestion playable rather than merely optimal. */
  const peak=availabilityPeak(free.map(item=>[{startAt:item.startAt,endAt:item.endAt}]));
  const suggested=peak
    ?{start:hkClock(peak.startAt),end:hkClock(peak.endAt)}
    :{start:"19:00",end:"22:00"};
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
    {signedIn&&<Button onClick={()=>onOpen(suggested.start,suggested.end)}>
      用 {suggested.start}–{suggested.end} 開局
    </Button>}
    <p className="ob-note">開局後，這幾位會收到通知。</p>
  </div>;
}


/** Pick a venue, or add one that is not in the directory yet.
 *
 *  The directory started as one club's room, and the board is meant to work across Hong Kong — so a
 *  member standing in a poolroom in 荃灣 has to be able to name it without waiting for an admin.
 *  Search filters as you type; when nothing matches exactly, the same typed text becomes the offer
 *  to add it, which means adding a venue costs one extra tap rather than a separate flow.
 *
 *  「稍後一起決定」 stays first and is the default, because most 局 are posted before anyone has
 *  agreed on a room, and forcing a venue at that moment is what produces wrong ones. */
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
  const chosen=venues.find(venue=>venue.id===value);

  const create=async()=>{
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/open-board/venues",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({name:trimmed,district:district.trim()})});
      const body=await response.json() as {venue?:Venue;error?:string};
      if(!response.ok||!body.venue)throw new Error(body.error??"未能新增場地。");
      onCreated(body.venue);setAdding(false);setQuery("");setDistrict("");
    }catch(reason){setError(reason instanceof Error?reason.message:"未能新增場地。")}
    finally{setBusy(false)}
  };

  return <div className="ob-venue">
    <input type="search" value={query} onChange={event=>{setQuery(event.target.value);setAdding(false)}}
      placeholder={chosen?chosen.name:"搜尋場地，或輸入新場地名稱"} aria-label="搜尋場地"/>

    <div className="ob-venue-list" role="group" aria-label="場地">
      <button type="button" aria-pressed={!value} onClick={()=>onChange("")}>
        <b>稍後一起決定</b><small>成局之後再夾</small>
      </button>
      {matches.map(venue=>
        <button key={venue.id} type="button" aria-pressed={venue.id===value} onClick={()=>onChange(venue.id)}>
          <b>{venue.name}</b>{venue.district&&<small>{venue.district}</small>}
        </button>)}
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
