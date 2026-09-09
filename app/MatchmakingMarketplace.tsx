"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {Button,ButtonLink,Chip,EmptyState,FormField,InlineNotice,Skeleton,Surface} from "./components/ui/Primitives";
import {Sheet} from "./components/ui/Overlay";
import {addDaysHongKong,availabilityEndTimes,availabilityStartTimes,composeAvailabilityInterval,hkClock,hkDate,hkDayLabel,nextAvailabilityStart} from "../lib/availability";
import {GROUP_PRESETS,type MarketplaceDashboard,type SessionView,type Supply,type MatchConditions} from "../lib/matchmaking-marketplace";
import {trackAvailabilityEvent} from "../lib/availability-analytics";

type Props={onPlayer?:(id:string)=>void;onRecord?:(id:string)=>void;onActivity?:()=>void;target?:{id:string;name:string;rating:number|null}|null;onTargetConsumed?:()=>void;onRecordSession?:(opponentId:string,sessionId:string,date:string)=>void};
const endpoint="/api/matchmaking/marketplace";
const presets=[{id:"singles",label:"認真對打"},{id:"small",label:"細局"},{id:"rotation",label:"多人輪流"},{id:"flexible",label:"有波打就得"}] as const;
const START_TIMES=availabilityStartTimes();
const formatHours=(minutes:number)=>{const h=minutes/60;return Number.isInteger(h)?`${h}`:h.toFixed(1);};
const statusLabel={forming:"正在成局",playable:"已成局",full:"已滿員",cancelled:"已取消",completed:"已結束"};
const rangeLabel=(s:{minPlayers:number;maxPlayers:number})=>s.maxPlayers===2?"認真對打 · 2 人":`${s.minPlayers>=4?"多人輪流":"細局／彈性"} · ${s.minPlayers}–${s.maxPlayers} 人`;
const timeLabel=(s:{startAt:string;endAt:string})=>`${hkClock(s.startAt)}–${hkClock(s.endAt)}${hkDate(new Date(s.endAt))>hkDate(new Date(s.startAt))?" · 次日":""}`;

export default function MatchmakingMarketplace(props:Props){
  const {target,onTargetConsumed}=props;
  const [lastTarget,setLastTarget]=useState(target);
  const [now,setNow]=useState(()=>Date.now());
  const [date,setDate]=useState(hkDate),[data,setData]=useState<MarketplaceDashboard|null>(null);
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [composer,setComposer]=useState<{slot?:Supply;active:boolean}|null>(null),[inviting,setInviting]=useState<Supply|null>(null);
  const [filter,setFilter]=useState(""),[targetId,setTargetId]=useState<string|null>(null),[undoAvoid,setUndoAvoid]=useState<string|null>(null);
  const [inviteSession,setInviteSession]=useState<SessionView|null>(null);
  const sequence=useRef(0),writePending=useRef(false),mounted=useRef(true);
  const refresh=useCallback(async()=>{
    const seq=++sequence.current;
    try{
      const response=await fetch(`${endpoint}?date=${date}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??"未能載入約戰。");
      if(seq!==sequence.current||!mounted.current)return;
      if(!body.ready)throw new Error("約戰暫時未能使用，請稍後再試。");
      setData(body);setNow(Date.now());setError("");
    }catch(e){if(seq===sequence.current&&mounted.current)setError(e instanceof Error?e.message:"未能載入約戰。");}
    finally{if(seq===sequence.current&&mounted.current)setLoading(false);}
  },[date]);
  useEffect(()=>{mounted.current=true;const first=setTimeout(()=>void refresh(),0);const onFocus=()=>void refresh();
    const requestSequence=sequence;
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);
    window.addEventListener("focus",onFocus);return()=>{mounted.current=false;requestSequence.current++;clearTimeout(first);clearInterval(timer);window.removeEventListener("focus",onFocus);};
  },[refresh]);
  useEffect(()=>{trackAvailabilityEvent("matchmaking_marketplace_view");},[]);
  useEffect(()=>{if(data?.opportunities.length)trackAvailabilityEvent("matchmaking_opportunity_shown",{count:data.opportunities.length});},[data?.opportunities.length,date]);
  if(target&&target!==lastTarget){setLastTarget(target);setTargetId(target.id);setDate(hkDate());}
  useEffect(()=>{if(target)onTargetConsumed?.();},[target,onTargetConsumed]);

  async function act(action:string,values:Record<string,unknown>,success="已更新安排。"){
    if(writePending.current||data?.date!==date)return false;
    writePending.current=true;setBusy(true);setError("");sequence.current++;
    try{
      const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...values})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??"未能更新約戰。");
      setMessage(success);await refresh();props.onActivity?.();return true;
    }catch(e){setError(e instanceof Error?e.message:"未能更新約戰。");return false;}
    finally{writePending.current=false;setBusy(false);}
  }
  if(!data)return <section className="mp-page" aria-busy={loading}>{error?<InlineNotice tone="danger" title="未能載入約戰">{error}<Button onClick={()=>void refresh()}>重試</Button></InlineNotice>:<><Skeleton/><Skeleton/><p>正在搵合適球友…</p></>}</section>;
  const venue=(id:string|null)=>data.venues.find(v=>v.id===id)?.name??"場地待定";
  const visible=data.availability.filter(a=>(!targetId||a.playerId===targetId)&&(!filter||a.venueId===filter||data.venues.find(v=>v.id===a.venueId)?.district===filter));
  const mine=data.mine.filter(a=>hkDate(new Date(a.startAt))===date);
  function needSlot(){if(!mine.length){setComposer({active:true});setMessage("先公開你的空檔，再選擇加入或邀請球友。");return true;}return false;}
  return <section className="mp-page" aria-label="約戰">
    <Surface tone="featured" className="mp-hero"><div><h1>搵球友，約場波。</h1><p>公開空檔，搵合適球友。一齊加入，就可以成局。</p></div>
      {data.viewerId?<div className="mp-actions"><Button variant="featured" onClick={()=>setComposer({active:true})}>開始找波</Button><Button variant="secondary" onClick={()=>setComposer({active:false})}>公開其他空檔</Button></div>
        :<ButtonLink href={data.signedIn?"/account":"/login"}>{data.signedIn?"連結球員檔案":"登入約戰"}</ButtonLink>}
    </Surface>
    <nav className="mp-dates" aria-label="未來七日">{data.dates.map(d=><Button disabled={busy} key={d.date} variant="quiet" aria-pressed={d.date===date} onClick={()=>{setDate(d.date);setTargetId(null);}}>
      <span className="mp-weekday">{d.date===hkDate()?"今日":hkDayLabel(d.date).match(/（(.+)）/)?.[1]??hkDayLabel(d.date)}</span><b className="mp-day-number">{Number(d.date.slice(-2))}</b><span>{d.publicPlayers} 人有空</span><small>{d.formingGroups?`${d.formingGroups} 組正在成局`:"未有組局"}</small></Button>)}</nav>
    {error&&<InlineNotice tone="danger" title="未能完成">{error}<Button variant="quiet" onClick={()=>void refresh()}>重新載入</Button></InlineNotice>}
    {message&&<InlineNotice tone="success" title="約戰更新">{message}{undoAvoid&&<Button variant="quiet" disabled={busy} onClick={async()=>{if(await act("unavoid",{playerId:undoAvoid},"已恢復推薦。"))setUndoAvoid(null);}}>復原不再推薦</Button>}</InlineNotice>}
    {data.date!==date?<p role="status">正在載入所選日期…</p>:!data.signedIn?<EmptyState title="登入後睇有空的球友" description="公開空檔只供已登入會員瀏覽。你可以先睇未來七日有幾多人想打波。"/>:<>
      {data.opportunities.length>0&&<section className="mp-section" aria-labelledby="mp-opportunities"><div className="mp-section-head"><div><h2 id="mp-opportunities">為你推薦</h2><p>按共同時間、場地及偏好，搵到啱你的局。</p></div></div>
        <div className="mp-opportunities">{data.opportunities.map(o=><Surface key={o.key} as="article" className="mp-opportunity">
            <Chip tone={o.sessionId?"success":"neutral"}>{o.sessionId?"已有球友加入":"可以約成"}</Chip>
            <h3>{timeLabel(o)}</h3><p>{venue(o.venueId)} · {rangeLabel(o)}</p>
            <p>{o.acceptedPlayers.length?`${o.acceptedPlayers.map(p=>p.name).join("、")} · ${o.acceptedPlayers.length} 人已加入`:`${o.compatibleCount} 位球友時間合適，尚未答應`}</p>
            <p className="mp-hints">{o.hints.join(" · ")}</p>
            <Button disabled={busy} onClick={()=>void act(o.sessionId?"join":"create",o.sessionId?{id:o.sessionId,slotId:o.slotId}:{key:o.key,slotId:o.slotId},"你已加入，其他球友可稍後回覆。")}>{o.sessionId?"加入":"有興趣"}</Button>
          </Surface>)}</div>
      </section>}
      <section className="mp-section" aria-labelledby="mp-people"><div className="mp-section-head"><h2 id="mp-people">{hkDayLabel(date)}有空的人</h2>
        <FormField label="場地／地區"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部</option>{[...new Set(data.venues.map(v=>v.district).filter(Boolean))].map(d=><option key={d}>{d}</option>)}{data.venues.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></FormField></div>
        {targetId&&<Button variant="quiet" onClick={()=>setTargetId(null)}>返回所有球友</Button>}
        {!visible.length?<EmptyState title="未有球友公開空檔" description="試試另一日，或者先公開你的時間。"/>:<div className="mp-opportunities">{visible.map(a=>{
          const isSelf=a.playerId===data.viewerId;
          return <Surface as="article" key={a.id} className={`mp-opportunity mp-player-card${isSelf?" mp-player-card-self":""}`}>
          <Chip tone={a.commitment==="going"?"success":"neutral"}>{a.commitment==="going"?"找緊波":"可以約我"}</Chip>
          <h3>{isSelf?a.player.name:<Button variant="quiet" className="mp-player-name" onClick={()=>props.onPlayer?.(a.playerId)}>{a.player.name}</Button>}{isSelf&&<Chip tone="accent">你自己</Chip>}</h3>
          <p>ELO {Math.round(a.player.rating)} · {timeLabel(a)}</p>
          <p>{venue(a.venueId)} · {rangeLabel(a)}</p>
          <p className="mp-hints">{a.venueScope==="district"?"同區都可以":a.venueScope==="any_hk"?"全港都可以":"指定波房"}</p>
          {isSelf?<Button variant="quiet" disabled={busy} onClick={()=>setComposer({slot:a,active:a.commitment==="going"})}>修改</Button>
            :data.viewerId&&<div className="mp-actions"><Button disabled={busy} onClick={()=>{if(!needSlot())setInviting(a);}}>約 {a.player.name}</Button>
            <Button variant="quiet" disabled={busy} onClick={async()=>{if(await act("avoid",{playerId:a.playerId},"已停止推薦這位球員；對方不會收到通知。"))setUndoAvoid(a.playerId);}}>不再推薦</Button></div>}
          </Surface>;})}</div>}
      </section>
      {data.viewerId&&<section className="mp-section" aria-labelledby="mp-mine"><div className="mp-section-head"><div><h2 id="mp-mine">我的安排</h2><p>回覆邀請、管理空檔，準備下一場對局。</p></div></div>
        {!data.mine.length&&!data.sessions.length&&<EmptyState title="未有安排" description="公開空檔，開始搵球友。"/>}
        {data.sessions.length>0&&<div className="mp-mine-group"><h3 className="mp-mine-subhead">組局</h3>
          {data.sessions.map(s=><Surface as="article" key={s.id} className="mp-arrangement" id={`formation-${s.id}`}>
          <div><Chip tone={s.myStatus==="pending"?"warning":s.status==="forming"?"neutral":"success"}>{s.myStatus==="pending"?"有球友邀請你":statusLabel[s.status]}</Chip>
            <h3>{hkDayLabel(hkDate(new Date(s.startAt)))} · {timeLabel(s)}</h3><p>{venue(s.venueId)} · {rangeLabel(s)}</p>
            <p>{s.acceptedPlayers.map(p=>p.name).join("、")} · {s.acceptedPlayers.length}／最少 {s.minPlayers} 人</p>
            {s.pendingInvitees.length>0&&<small>{s.pendingInvitees.map(p=>p.name).join("、")} · 等待回覆</small>}</div>
          <div className="mp-actions">{s.myStatus==="pending"?<><Button disabled={busy} onClick={()=>void act("accept",{id:s.id},"已接受邀請。")}>接受邀請</Button><Button variant="quiet" disabled={busy} onClick={()=>void act("decline",{id:s.id},"已回覆今次未能約成。")}>今次唔得</Button></>:<>
            {s.status!=="completed"&&<><Button variant="secondary" disabled={busy||s.status==="full"} onClick={()=>setInviteSession(s)}>邀請球友</Button><Button variant="quiet" disabled={busy} onClick={()=>void act("leave",{id:s.id},"你已退出，其他球友的安排保留。")}>{s.status==="forming"?"退出":"我去不到"}</Button></>}
            {Date.parse(s.startAt)<=now&&s.acceptedPlayers.filter(p=>p.id!==data.viewerId).map(p=><Button key={p.id} variant="secondary" onClick={()=>props.onRecordSession?props.onRecordSession(p.id,s.id,hkDate(new Date(s.startAt))):props.onRecord?.(p.id)}>記錄對 {p.name} 賽果</Button>)}
          </>}</div>
          </Surface>)}</div>}
        {data.mine.length>0&&<div className="mp-mine-group"><h3 className="mp-mine-subhead">你公開的空檔</h3>
          {data.mine.map(a=><Surface as="article" className="mp-own-slot" key={a.id}>
          <div><Chip tone={a.commitment==="going"?"success":"neutral"}>{a.commitment==="going"?"找緊波":"可以約我"}</Chip>
            <h3>{hkDayLabel(hkDate(new Date(a.startAt)))} · {timeLabel(a)}</h3><p>{venue(a.venueId)} · {rangeLabel(a)}</p></div>
          {a.source==="marketplace"?<div className="mp-actions">{a.commitment==="interested"&&<Button disabled={busy} onClick={()=>void act("activate",{id:a.id},"已開始找波。")}>找緊波</Button>}<Button variant="quiet" disabled={busy} onClick={()=>setComposer({slot:a,active:a.commitment==="going"})}>修改</Button><Button variant="quiet" disabled={busy} onClick={()=>void act("withdraw",{id:a.id},"已停止公開空檔；已加入的安排仍然保留。")}>停止公開</Button></div>:<Chip>原有空檔</Chip>}
          </Surface>)}</div>}
      </section>}
    </>}
    {composer&&<AvailabilityComposer key={composer.slot?.id??"new"} initialDate={date} slot={composer.slot} active={composer.active} venues={data.venues} busy={busy} error={error} onClose={()=>{if(!busy)setComposer(null);}} onSave={async body=>{if(await act(composer.slot?"edit":"publish",body,"已公開空檔，球友可以約你。"))setComposer(null);}}/>}
    {inviting&&<Sheet open title={`約 ${inviting.player.name}`} onClose={()=>{if(!busy)setInviting(null);}}><div className="mp-composer"><p>{timeLabel(inviting)} · {rangeLabel(inviting)}</p><p>選擇你的空檔。系統會核對共同時間；對方可以稍後接受邀請。</p>{error&&<InlineNotice tone="danger" title="未能邀請">{error}</InlineNotice>}
      {mine.map(a=><Button key={a.id} disabled={busy} onClick={async()=>{if(await act("invite",{ownSlotId:a.id,slotId:inviting.id,playerId:inviting.playerId},"已送出邀請，等球友回覆。"))setInviting(null);}}>{timeLabel(a)} · {rangeLabel(a)}</Button>)}</div></Sheet>}
    {inviteSession&&<Sheet open title="邀請球友加入" onClose={()=>{if(!busy)setInviteSession(null);}}><div className="mp-composer"><p>只會邀請符合這個安排的球友；系統會在送出前核對。</p>{error&&<InlineNotice tone="danger" title="未能邀請">{error}</InlineNotice>}
      {data.availability.filter(a=>!inviteSession.acceptedPlayers.some(p=>p.id===a.playerId)).map(a=><Button key={a.id} disabled={busy} onClick={async()=>{if(await act("invite",{id:inviteSession.id,slotId:a.id,playerId:a.playerId},"已送出邀請。"))setInviteSession(null);}}>{a.player.name} · {timeLabel(a)}</Button>)}</div></Sheet>}
  </section>;
}

function AvailabilityComposer({initialDate,slot,active,venues,busy,error,onClose,onSave}:{initialDate:string;slot?:Supply;active:boolean;venues:MarketplaceDashboard["venues"];busy:boolean;error:string;onClose:()=>void;onSave:(body:Record<string,unknown>)=>Promise<void>}){
  const soon=nextAvailabilityStart();
  const initialStart=slot?hkClock(slot.startAt):initialDate===soon.date?START_TIMES.find(t=>t>=soon.time)??"19:00":"19:00";
  const [date,setDate]=useState(slot?hkDate(new Date(slot.startAt)):initialDate);
  const [start,setStart]=useState(initialStart);
  const [end,setEnd]=useState(()=>{
    if(slot)return hkClock(slot.endAt);
    const [h,m]=initialStart.split(":").map(Number),target=h*60+m+4*60;
    const options=availabilityEndTimes(initialStart);
    return options.find(o=>o.minutes>=target)?.value??options.at(-1)?.value??"23:00";
  });
  const [venueId,setVenueId]=useState(slot?.venueId??venues[0]?.id??""),[scope,setScope]=useState(slot?.venueScope??"exact");
  const [preset,setPreset]=useState<keyof typeof GROUP_PRESETS>(()=>presets.find(p=>GROUP_PRESETS[p.id].minPlayers===slot?.minPlayers&&GROUP_PRESETS[p.id].targetSize===slot?.targetSize&&GROUP_PRESETS[p.id].maxPlayers===slot?.maxPlayers)?.id??"singles");
  const [commitment,setCommitment]=useState(active?"going":"interested");
  const [conditions,setConditions]=useState<MatchConditions>(slot?.conditions??{levelPreference:"similar",handicap:true,feePreference:"aa",tempo:"any"});
  const [localError,setLocalError]=useState("");
  const dayOptions=Array.from({length:7},(_,i)=>addDaysHongKong(hkDate(),i));
  const endOptions=availabilityEndTimes(start);
  function changeStart(value:string){setStart(value);if(!availabilityEndTimes(value).some(o=>o.value===end))setEnd(availabilityEndTimes(value).at(-1)?.value??"");}
  const selectedEnd=endOptions.find(o=>o.value===end);
  const startMinutes=(()=>{const [h,m]=start.split(":").map(Number);return h*60+m;})();
  const venueName=venues.find(v=>v.id===venueId)?.name??"場地待定";
  const groupLabel=presets.find(p=>p.id===preset)?.label??"";
  async function submit(event:FormEvent){event.preventDefault();setLocalError("");try{await onSave({id:slot?.id,...composeAvailabilityInterval(date,start,end),...GROUP_PRESETS[preset],venueId:venueId||null,venueScope:venueId?scope:"any_hk",commitment,conditions});}catch(e){setLocalError(e instanceof Error?e.message:"請檢查日期和時間。");}}
  return <Sheet open title={slot?"修改空檔":"公開空檔"} onClose={onClose}><form className="mp-composer" onSubmit={submit} aria-busy={busy}>
    {(localError||error)&&<InlineNotice tone="danger" title="未能儲存">{localError||error}</InlineNotice>}
    <fieldset disabled={busy}><FormField label="日期"><div className="mp-day-select" role="group" aria-label="日期，未來七日">{dayOptions.map(d=><Button key={d} type="button" variant="secondary" aria-pressed={date===d} onClick={()=>setDate(d)}>
        <span>{d===hkDate()?"今日":hkDayLabel(d).match(/（(.+)）/)?.[1]??hkDayLabel(d)}</span><b>{Number(d.slice(-2))}</b></Button>)}</div></FormField>
      <fieldset><legend>狀態</legend><div className="mp-choices"><Button type="button" variant="secondary" aria-pressed={commitment==="going"} onClick={()=>setCommitment("going")}>找緊波</Button><Button type="button" variant="secondary" aria-pressed={commitment==="interested"} onClick={()=>setCommitment("interested")}>可以約我</Button></div></fieldset>
      <div className="mp-time-fields"><FormField label="開始"><select value={start} onChange={e=>changeStart(e.target.value)}>{START_TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select></FormField>
        <FormField label="結束"><select value={end} onChange={e=>setEnd(e.target.value)}>{endOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></FormField></div>
      {selectedEnd&&<p className="mp-duration-hint">共 {formatHours(selectedEnd.minutes-startMinutes)} 小時{selectedEnd.minutes>=24*60?"，去到次日":""} · 最長 12 小時，最遲 02:00</p>}
      <FormField label="波房"><select value={venueId} onChange={e=>setVenueId(e.target.value)}><option value="">場地待定</option>{venues.map(v=><option key={v.id} value={v.id}>{v.name} · {v.district}</option>)}</select></FormField>
      {venueId&&<FormField label="場地彈性"><select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="exact">只去這間波房</option><option value="district">同區都可以</option><option value="any_hk">全港都可以</option></select></FormField>}
      <fieldset><legend>{date===hkDate()?"今晚":"嗰日"}想點打？</legend><div className="mp-choices">{presets.map(p=><Button key={p.id} type="button" variant="secondary" aria-pressed={preset===p.id} onClick={()=>setPreset(p.id)}>{p.label}<small>{GROUP_PRESETS[p.id].minPlayers}–{GROUP_PRESETS[p.id].maxPlayers} 人</small></Button>)}</div></fieldset>
      <fieldset><legend>更多偏好</legend><div className="mp-advanced"><FormField label="水平"><select value={conditions.levelPreference??"similar"} onChange={e=>setConditions({...conditions,levelPreference:e.target.value as "similar"|"any",levelStrict:false})}><option value="similar">相近優先，自動擴闊</option><option value="any">都可以</option></select></FormField>
        {conditions.levelPreference!=="any"&&<label className="mp-checkbox"><input type="checkbox" checked={conditions.levelStrict??false} onChange={e=>setConditions({...conditions,levelStrict:e.target.checked})}/>只接受相差 100 ELO 內</label>}
        <label className="mp-checkbox"><input type="checkbox" checked={conditions.handicap??false} onChange={e=>setConditions({...conditions,handicap:e.target.checked})}/>接受讓分</label><label className="mp-checkbox"><input type="checkbox" checked={conditions.noSmoking??false} onChange={e=>setConditions({...conditions,noSmoking:e.target.checked})}/>需要禁煙</label>
        <FormField label="費用"><select value={conditions.feePreference??"any"} onChange={e=>setConditions({...conditions,feePreference:e.target.value as "aa"|"any"})}><option value="aa">AA</option><option value="any">都可以</option></select></FormField>
        <FormField label="節奏"><select value={conditions.tempo??"any"} onChange={e=>setConditions({...conditions,tempo:e.target.value as "sport"|"casual"|"any"})}><option value="sport">競技</option><option value="casual">休閒</option><option value="any">都可以</option></select></FormField></div></fieldset>
    </fieldset>
    <div className="mp-summary"><b>{hkDayLabel(date)} · {start}–{end}{selectedEnd&&selectedEnd.minutes>=24*60?"（次日）":""}</b><span>{venueName} · {groupLabel} · {commitment==="going"?"找緊波":"可以約我"}</span></div>
    <p>停止公開空檔不會退出已加入的安排。去不到時，請在「我的安排」退出。</p><Button type="submit" loading={busy}>{slot?"儲存修改":"開始找球友"}</Button>
  </form></Sheet>;
}
