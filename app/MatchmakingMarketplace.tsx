"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {Button,ButtonLink,Chip,EmptyState,FormField,IconButton,InlineNotice,Skeleton,Surface} from "./components/ui/Primitives";
import {Sheet} from "./components/ui/Overlay";
import {addDaysHongKong,availabilityEndTimes,availabilityStartTimes,composeAvailabilityInterval,hkClock,hkDate,hkDayLabel,hkWeekdayLabel,nextAvailabilityStart,nowInterval} from "../lib/availability";
import {GROUP_PRESETS,type MarketplaceDashboard,type SessionView,type Supply,type MatchConditions} from "../lib/matchmaking-marketplace";
import {trackAvailabilityEvent} from "../lib/availability-analytics";
import { useT } from "./components/I18nProvider";
import { msg } from "../lib/i18n/translate";
import type { Translator } from "../lib/i18n/translate";

/* Avatars stand in for photos we don't have: initials on a colour picked deterministically from the
   player id, so the same person always reads the same colour across a session without a lookup. */
const AVATAR_TONES=[{bg:"var(--ds-accent-action)",fg:"var(--ds-text-on-danger)"},{bg:"var(--ds-accent-primary)",fg:"var(--ds-text-on-accent)"},{bg:"var(--ds-info)",fg:"var(--ds-text-on-danger)"},{bg:"var(--ds-chart-primary)",fg:"var(--ds-text-on-danger)"}] as const;
function avatarTone(id:string){let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return AVATAR_TONES[h%AVATAR_TONES.length];}
function initials(name:string){return [...name.trim()][0]?.toUpperCase()??"?";}
function Avatar({id,name,size=42,dot}:{id:string;name:string;size?:number;dot?:"going"|"open"|"pending"}){
  const tone=avatarTone(id);
  return <span className="mp-avatar" style={{width:size,height:size,fontSize:size*.34,background:tone.bg,color:tone.fg}}>{initials(name)}{dot&&<i className={`mp-avatar-dot ${dot}`} aria-hidden="true"/>}</span>;
}
const ArrowIcon=()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M13 5l7 7-7 7"/></svg>;
const CheckIcon=()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>;

type Props={onPlayer?:(id:string)=>void;onRecord?:(id:string)=>void;onActivity?:()=>void;target?:{id:string;name:string;rating:number|null}|null;onTargetConsumed?:()=>void;onRecordSession?:(opponentId:string,sessionId:string,date:string)=>void};
const endpoint="/api/matchmaking/marketplace";
const presets=[{id:"singles",label:msg("認真對打")},{id:"small",label:msg("細局")},{id:"rotation",label:msg("多人輪流")},{id:"flexible",label:msg("有波打就得")}] as const;
const START_TIMES=availabilityStartTimes();
const formatHours=(minutes:number)=>{const h=minutes/60;return Number.isInteger(h)?`${h}`:h.toFixed(1);};
const statusLabel={forming:msg("正在成局"),playable:msg("已成局"),full:msg("已滿員"),cancelled:msg("已取消"),completed:msg("已結束")};
const rangeLabel=(t: Translator, s:{minPlayers:number;maxPlayers:number})=>s.maxPlayers===2?t("認真對打 · 2 人"):t("{v} · {minPlayers}–{maxPlayers} 人", {v: s.minPlayers>=4?t("多人輪流"):t("細局／彈性"), minPlayers: s.minPlayers, maxPlayers: s.maxPlayers});
const timeLabel=(t: Translator, s:{startAt:string;endAt:string})=>`${hkClock(s.startAt)}–${hkClock(s.endAt)}${hkDate(new Date(s.endAt))>hkDate(new Date(s.startAt))?t(" · 次日"):""}`;

export default function MatchmakingMarketplace(props:Props){
  const t = useT();
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
      if(!response.ok)throw new Error(body.error??t("未能載入約戰。"));
      if(seq!==sequence.current||!mounted.current)return;
      if(!body.ready)throw new Error(t("約戰暫時未能使用，請稍後再試。"));
      setData(body);setNow(Date.now());setError("");
    }catch(e){if(seq===sequence.current&&mounted.current)setError(e instanceof Error?e.message:t("未能載入約戰。"));}
    finally{if(seq===sequence.current&&mounted.current)setLoading(false);}
  },[date, t]);
  useEffect(()=>{mounted.current=true;const first=setTimeout(()=>void refresh(),0);const onFocus=()=>void refresh();
    const requestSequence=sequence;
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);
    window.addEventListener("focus",onFocus);return()=>{mounted.current=false;requestSequence.current++;clearTimeout(first);clearInterval(timer);window.removeEventListener("focus",onFocus);};
  },[refresh]);
  useEffect(()=>{trackAvailabilityEvent("matchmaking_marketplace_view");},[]);
  useEffect(()=>{if(data?.opportunities.length)trackAvailabilityEvent("matchmaking_opportunity_shown",{count:data.opportunities.length});},[data?.opportunities.length,date]);
  if(target&&target!==lastTarget){setLastTarget(target);setTargetId(target.id);setDate(hkDate());}
  useEffect(()=>{if(target)onTargetConsumed?.();},[target,onTargetConsumed]);

  async function act(action:string,values:Record<string,unknown>,success=t("已更新安排。")){
    if(writePending.current||data?.date!==date)return false;
    writePending.current=true;setBusy(true);setError("");sequence.current++;
    try{
      const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...values})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??t("未能更新約戰。"));
      setMessage(success);await refresh();props.onActivity?.();return true;
    }catch(e){setError(e instanceof Error?e.message:t("未能更新約戰。"));return false;}
    finally{writePending.current=false;setBusy(false);}
  }
  if(!data)return <section className="mp-page" aria-busy={loading}>{error?<InlineNotice tone="danger" title={t("未能載入約戰")}>{error}<Button onClick={()=>void refresh()}>{t("重試")}</Button></InlineNotice>:<><Skeleton/><Skeleton/><p>{t("正在搵合適球友…")}</p></>}</section>;
  const venue=(id:string|null)=>data.venues.find(v=>v.id===id)?.name??t("場地待定");
  const visible=data.availability.filter(a=>(!targetId||a.playerId===targetId)&&(!filter||a.venueId===filter||data.venues.find(v=>v.id===a.venueId)?.district===filter));
  const mine=data.mine.filter(a=>hkDate(new Date(a.startAt))===date);
  function needSlot(){if(!mine.length){setComposer({active:true});setMessage(t("先公開你的空檔，再選擇加入或邀請球友。"));return true;}return false;}
  async function quickFreeNow(){
    setDate(hkDate());
    await act("publish",{...nowInterval(240),...GROUP_PRESETS.singles,venueId:null,venueScope:"any_hk",commitment:"going",
      conditions:{levelPreference:"similar",handicap:true,feePreference:"aa",tempo:"any"}},t("已公開，球友宜家可以搵到你。"));
  }
  return <section className="mp-page" aria-label={t("約戰")}>
    <Surface tone="featured" className="mp-hero"><div><h1>{t("搵球友，約場波。")}</h1><p>{t("而家得閒？一鍵公開，球友即刻搵到你。")}</p></div>
      {data.viewerId?<div className="mp-actions"><Button variant="featured" disabled={busy} onClick={()=>void quickFreeNow()}>{t("而家得閒")}</Button><Button variant="secondary" onClick={()=>setComposer({active:true})}>{t("揀時間同場地")}</Button></div>
        :<ButtonLink href={data.signedIn?"/account":"/login"}>{data.signedIn?t("連結球員檔案"):t("登入約戰")}</ButtonLink>}
    </Surface>
    <nav className="mp-dates" aria-label={t("未來七日")}>{data.dates.map(d=><Button disabled={busy} key={d.date} variant="quiet" aria-pressed={d.date===date} onClick={()=>{setDate(d.date);setTargetId(null);}}>
      <span className="mp-weekday">{d.date===hkDate()?t("今日"):hkWeekdayLabel(d.date,t.locale)}</span><b className="mp-day-number">{Number(d.date.slice(-2))}</b><span>{t("{publicPlayers} 人有空", {publicPlayers: d.publicPlayers})}</span><small>{d.formingGroups?t("{formingGroups} 組正在成局", {formingGroups: d.formingGroups}):t("未有組局")}</small></Button>)}</nav>
    {error&&<InlineNotice tone="danger" title={t("未能完成")}>{error}<Button variant="quiet" onClick={()=>void refresh()}>{t("重新載入")}</Button></InlineNotice>}
    {message&&<InlineNotice tone="success" title={t("約戰更新")}>{message}{undoAvoid&&<Button variant="quiet" disabled={busy} onClick={async()=>{if(await act("unavoid",{playerId:undoAvoid},t("已恢復推薦。")))setUndoAvoid(null);}}>{t("復原不再推薦")}</Button>}</InlineNotice>}
    {data.date!==date?<p role="status">{t("正在載入所選日期…")}</p>:!data.signedIn?<EmptyState title={t("登入後睇有空的球友")} description={t("公開空檔只供已登入會員瀏覽。你可以先睇未來七日有幾多人想打波。")}/>:<>
      {data.opportunities.length>0&&<section className="mp-section" aria-labelledby="mp-opportunities"><div className="mp-section-head"><div><h2 id="mp-opportunities">{t("為你推薦")}</h2><p>{t("按共同時間、場地及偏好，搵到啱你的局。")}</p></div></div>
        <div className="mp-list">{data.opportunities.map(o=><div key={o.key} className="mp-group">
            <div className="mp-item">
              {o.acceptedPlayers.length
                ?<div className="mp-stack">{o.acceptedPlayers.slice(0,3).map(p=><Avatar key={p.id} id={p.id} name={p.name} size={40}/>)}</div>
                :<Avatar id={o.key} name="?" size={40}/>}
              <div className="mp-item-main">
                <div className="mp-item-top"><b>{o.sessionId?t("已有球友加入"):t("可以約成")}</b><span className="mp-item-time">{timeLabel(t, o)}</span></div>
                <div className="mp-item-sub"><span>{venue(o.venueId)} · {rangeLabel(t, o)}</span></div>
              </div>
            </div>
            <p className="mp-compat"><CheckIcon/>{o.acceptedPlayers.length?t("{v} 已加入", {v: o.acceptedPlayers.map(p=>p.name).join(t("、"))}):t("{compatibleCount} 位球友時間合適，尚未答應", {compatibleCount: o.compatibleCount})}</p>
            <div className="mp-cta-row"><Button disabled={busy} onClick={()=>void act(o.sessionId?"join":"create",o.sessionId?{id:o.sessionId,slotId:o.slotId}:{key:o.key,slotId:o.slotId},t("你已加入，其他球友可稍後回覆。"))}>{o.sessionId?t("加入"):t("有興趣")}</Button></div>
          </div>)}</div>
      </section>}
      <section className="mp-section" aria-labelledby="mp-people"><div className="mp-section-head"><h2 id="mp-people">{t("{v}有空的人", {v: hkDayLabel(date,t.locale)})}</h2>
        <FormField label={t("場地／地區")}><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">{t("全部")}</option>{[...new Set(data.venues.map(v=>v.district).filter(Boolean))].map(d=><option key={d}>{d}</option>)}{data.venues.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></FormField></div>
        {targetId&&<Button variant="quiet" onClick={()=>setTargetId(null)}>{t("返回所有球友")}</Button>}
        {!visible.length?<EmptyState title={t("未有球友公開空檔")} description={t("試試另一日，或者先公開你的時間。")}/>:<div className="mp-group">{visible.map(a=>{
          const isSelf=a.playerId===data.viewerId;
          return <div className={`mp-item${isSelf?" mp-item-self":""}`} key={a.id}>
          <Avatar id={a.playerId} name={a.player.name} dot={a.commitment==="going"?"going":"open"}/>
          <div className="mp-item-main">
            <div className="mp-item-top">
              <b>{isSelf?t("{name}（你自己）", {name: a.player.name}):<Button variant="quiet" className="mp-player-name" onClick={()=>props.onPlayer?.(a.playerId)}>{a.player.name}</Button>}</b>
              <span className="mp-item-time">{timeLabel(t, a)}</span>
            </div>
            <div className="mp-item-sub">
              <span className={`mp-status-word${a.commitment==="going"?" going":""}`}>{a.commitment==="going"?t("找緊波"):t("可以約我")}</span>
              <span>· <span className="mp-rating">{Math.round(a.player.rating)}<small>ELO</small></span> · {venue(a.venueId)}</span>
            </div>
          </div>
          {isSelf?<Button variant="quiet" disabled={busy} onClick={()=>setComposer({slot:a,active:a.commitment==="going"})}>{t("修改")}</Button>
            :data.viewerId&&<div className="mp-item-actions">
              <IconButton label={t("約 {name}", {name: a.player.name})} className="mp-icon-btn primary" disabled={busy} onClick={()=>{if(!needSlot())setInviting(a);}}><ArrowIcon/></IconButton>
              <Button variant="quiet" disabled={busy} onClick={async()=>{if(await act("avoid",{playerId:a.playerId},t("已停止推薦這位球員；對方不會收到通知。")))setUndoAvoid(a.playerId);}}>{t("不再推薦")}</Button>
            </div>}
          </div>;})}</div>}
      </section>
      {data.viewerId&&<section className="mp-section" aria-labelledby="mp-mine"><div className="mp-section-head"><div><h2 id="mp-mine">{t("我的安排")}</h2><p>{t("回覆邀請、管理空檔，準備下一場對局。")}</p></div></div>
        {!data.mine.length&&!data.sessions.length&&<EmptyState title={t("未有安排")} description={t("公開空檔，開始搵球友。")}/>}
        {data.sessions.length>0&&<div className="mp-list"><h3 className="mp-mine-subhead">{t("組局")}</h3>
          {data.sessions.map(s=><div className="mp-group" key={s.id} id={`formation-${s.id}`}>
          <div className="mp-item">
            <div className="mp-stack">{s.acceptedPlayers.slice(0,3).map(p=><Avatar key={p.id} id={p.id} name={p.name} size={38}
              dot={p.id===data.viewerId?(s.myStatus==="pending"?"pending":"going"):undefined}/>)}</div>
            <div className="mp-item-main">
              <div className="mp-item-top"><b>{s.acceptedPlayers.map(p=>p.name).join(t("、"))}</b><span className="mp-item-time">{timeLabel(t, s)}</span></div>
              <div className="mp-item-sub">
                <span className={`mp-status-word${s.myStatus==="pending"?" pending":""}`}>{s.myStatus==="pending"?t("有球友邀請你"):t(statusLabel[s.status])}</span>
                <span>{t("· {v} · {v2} · {acceptedPlayers}／最少 {minPlayers} 人", {v: hkDayLabel(hkDate(new Date(s.startAt)),t.locale), v2: venue(s.venueId), acceptedPlayers: s.acceptedPlayers.length, minPlayers: s.minPlayers})}</span>
              </div>
              {s.pendingInvitees.length>0&&<div className="mp-item-sub"><span>{s.pendingInvitees.map(p=>p.name).join(t("、"))}  {t("· 等待回覆")}</span></div>}
            </div>
          </div>
          <div className="mp-cta-row">{s.myStatus==="pending"?<><Button className="mp-cta-quiet" variant="quiet" disabled={busy} onClick={()=>void act("decline",{id:s.id},t("已回覆今次未能約成。"))}>{t("今次唔得")}</Button><Button disabled={busy} onClick={()=>void act("accept",{id:s.id},t("已接受邀請。"))}>{t("接受邀請")}</Button></>:<>
            {s.status!=="completed"&&<><Button className="mp-cta-quiet" variant="quiet" disabled={busy} onClick={()=>void act("leave",{id:s.id},t("你已退出，其他球友的安排保留。"))}>{s.status==="forming"?t("退出"):t("我去不到")}</Button><Button variant="secondary" disabled={busy||s.status==="full"} onClick={()=>setInviteSession(s)}>{t("邀請球友")}</Button></>}
            {Date.parse(s.startAt)<=now&&s.acceptedPlayers.filter(p=>p.id!==data.viewerId).map(p=><Button key={p.id} variant="secondary" onClick={()=>props.onRecordSession?props.onRecordSession(p.id,s.id,hkDate(new Date(s.startAt))):props.onRecord?.(p.id)}>{t("記錄對 {name} 賽果", {name: p.name})}</Button>)}
          </>}</div>
          </div>)}</div>}
        {data.mine.length>0&&<div className="mp-list"><h3 className="mp-mine-subhead">{t("你公開的空檔")}</h3>
          <div className="mp-group">{data.mine.map(a=><div className="mp-item" key={a.id}>
          <Avatar id={a.playerId} name={a.player.name} dot={a.commitment==="going"?"going":"open"}/>
          <div className="mp-item-main">
            <div className="mp-item-top"><b>{hkDayLabel(hkDate(new Date(a.startAt)),t.locale)}</b><span className="mp-item-time">{timeLabel(t, a)}</span></div>
            <div className="mp-item-sub"><span className={`mp-status-word${a.commitment==="going"?" going":""}`}>{a.commitment==="going"?t("找緊波"):t("可以約我")}</span><span>· {venue(a.venueId)} · {rangeLabel(t, a)}</span></div>
          </div>
          {a.source==="marketplace"?<div className="mp-item-actions">{a.commitment==="interested"&&<Button disabled={busy} onClick={()=>void act("activate",{id:a.id},t("已開始找波。"))}>{t("找緊波")}</Button>}<Button variant="quiet" disabled={busy} onClick={()=>setComposer({slot:a,active:a.commitment==="going"})}>{t("修改")}</Button><Button variant="quiet" disabled={busy} onClick={()=>void act("withdraw",{id:a.id},t("已停止公開空檔；已加入的安排仍然保留。"))}>{t("停止公開")}</Button></div>:<Chip>{t("原有空檔")}</Chip>}
          </div>)}</div></div>}
      </section>}
    </>}
    {composer&&<AvailabilityComposer key={composer.slot?.id??"new"} initialDate={date} slot={composer.slot} active={composer.active} venues={data.venues} busy={busy} error={error} onClose={()=>{if(!busy)setComposer(null);}} onSave={async body=>{if(await act(composer.slot?"edit":"publish",body,t("已公開空檔，球友可以約你。")))setComposer(null);}}/>}
    {inviting&&<Sheet open title={t("約 {name}", {name: inviting.player.name})} onClose={()=>{if(!busy)setInviting(null);}}><div className="mp-composer"><p>{timeLabel(t, inviting)} · {rangeLabel(t, inviting)}</p><p>{t("選擇你的空檔。系統會核對共同時間；對方可以稍後接受邀請。")}</p>{error&&<InlineNotice tone="danger" title={t("未能邀請")}>{error}</InlineNotice>}
      {mine.map(a=><Button key={a.id} disabled={busy} onClick={async()=>{if(await act("invite",{ownSlotId:a.id,slotId:inviting.id,playerId:inviting.playerId},t("已送出邀請，等球友回覆。")))setInviting(null);}}>{timeLabel(t, a)} · {rangeLabel(t, a)}</Button>)}</div></Sheet>}
    {inviteSession&&<Sheet open title={t("邀請球友加入")} onClose={()=>{if(!busy)setInviteSession(null);}}><div className="mp-composer"><p>{t("只會邀請符合這個安排的球友；系統會在送出前核對。")}</p>{error&&<InlineNotice tone="danger" title={t("未能邀請")}>{error}</InlineNotice>}
      {data.availability.filter(a=>!inviteSession.acceptedPlayers.some(p=>p.id===a.playerId)).map(a=><Button key={a.id} disabled={busy} onClick={async()=>{if(await act("invite",{id:inviteSession.id,slotId:a.id,playerId:a.playerId},t("已送出邀請。")))setInviteSession(null);}}>{a.player.name} · {timeLabel(t, a)}</Button>)}</div></Sheet>}
  </section>;
}

function AvailabilityComposer({initialDate,slot,active,venues,busy,error,onClose,onSave}:{initialDate:string;slot?:Supply;active:boolean;venues:MarketplaceDashboard["venues"];busy:boolean;error:string;onClose:()=>void;onSave:(body:Record<string,unknown>)=>Promise<void>}){
  const t = useT();
  const soon=nextAvailabilityStart();
  const initialStart=slot?hkClock(slot.startAt):initialDate===soon.date?START_TIMES.find(t=>t>=soon.time)??"19:00":"19:00";
  const [date,setDate]=useState(slot?hkDate(new Date(slot.startAt)):initialDate);
  const [start,setStart]=useState(initialStart);
  const [end,setEnd]=useState(()=>{
    if(slot)return hkClock(slot.endAt);
    const [h,m]=initialStart.split(":").map(Number),target=h*60+m+4*60;
    const options=availabilityEndTimes(initialStart, t);
    return options.find(o=>o.minutes>=target)?.value??options.at(-1)?.value??"23:00";
  });
  const [venueId,setVenueId]=useState(slot?.venueId??venues[0]?.id??""),[scope,setScope]=useState(slot?.venueScope??"exact");
  const [preset,setPreset]=useState<keyof typeof GROUP_PRESETS>(()=>presets.find(p=>GROUP_PRESETS[p.id].minPlayers===slot?.minPlayers&&GROUP_PRESETS[p.id].targetSize===slot?.targetSize&&GROUP_PRESETS[p.id].maxPlayers===slot?.maxPlayers)?.id??"singles");
  const [commitment,setCommitment]=useState(active?"going":"interested");
  const [conditions,setConditions]=useState<MatchConditions>(slot?.conditions??{levelPreference:"similar",handicap:true,feePreference:"aa",tempo:"any"});
  const [localError,setLocalError]=useState("");
  const dayOptions=Array.from({length:7},(_,i)=>addDaysHongKong(hkDate(),i));
  const endOptions=availabilityEndTimes(start, t);
  function changeStart(value:string){setStart(value);if(!availabilityEndTimes(value, t).some(o=>o.value===end))setEnd(availabilityEndTimes(value, t).at(-1)?.value??"");}
  const selectedEnd=endOptions.find(o=>o.value===end);
  const startMinutes=(()=>{const [h,m]=start.split(":").map(Number);return h*60+m;})();
  const venueName=venues.find(v=>v.id===venueId)?.name??t("場地待定");
  const groupLabel=t(presets.find(p=>p.id===preset)?.label??"");
  async function submit(event:FormEvent){event.preventDefault();setLocalError("");try{await onSave({id:slot?.id,...composeAvailabilityInterval(date,start,end),...GROUP_PRESETS[preset],venueId:venueId||null,venueScope:venueId?scope:"any_hk",commitment,conditions});}catch(e){setLocalError(e instanceof Error?e.message:t("請檢查日期和時間。"));}}
  return <Sheet open title={slot?t("修改空檔"):t("公開空檔")} onClose={onClose}><form className="mp-composer" onSubmit={submit} aria-busy={busy}>
    {(localError||error)&&<InlineNotice tone="danger" title={t("未能儲存")}>{localError||error}</InlineNotice>}
    <fieldset disabled={busy}><FormField label={t("日期")}><div className="mp-day-select" role="group" aria-label={t("日期，未來七日")}>{dayOptions.map(d=><Button key={d} type="button" variant="secondary" aria-pressed={date===d} onClick={()=>setDate(d)}>
        <span>{d===hkDate()?t("今日"):hkWeekdayLabel(d,t.locale)}</span><b>{Number(d.slice(-2))}</b></Button>)}</div></FormField>
      <fieldset><legend>{t("狀態")}</legend><div className="mp-choices"><Button type="button" variant="secondary" aria-pressed={commitment==="going"} onClick={()=>setCommitment("going")}>{t("找緊波")}</Button><Button type="button" variant="secondary" aria-pressed={commitment==="interested"} onClick={()=>setCommitment("interested")}>{t("可以約我")}</Button></div></fieldset>
      <div className="mp-time-fields"><FormField label={t("開始")}><select value={start} onChange={e=>changeStart(e.target.value)}>{START_TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select></FormField>
        <FormField label={t("結束")}><select value={end} onChange={e=>setEnd(e.target.value)}>{endOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></FormField></div>
      {selectedEnd&&<p className="mp-duration-hint">{t("共 {v} 小時", {v: formatHours(selectedEnd.minutes-startMinutes)})}{selectedEnd.minutes>=24*60?t("，去到次日"):""}  {t("· 最長 12 小時，最遲 02:00")}</p>}
      <FormField label={t("波房")}><select value={venueId} onChange={e=>setVenueId(e.target.value)}><option value="">{t("場地待定")}</option>{venues.map(v=><option key={v.id} value={v.id}>{v.name} · {v.district}</option>)}</select></FormField>
      {venueId&&<FormField label={t("場地彈性")}><select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="exact">{t("只去這間波房")}</option><option value="district">{t("同區都可以")}</option><option value="any_hk">{t("全港都可以")}</option></select></FormField>}
      <fieldset><legend>{date===hkDate()?t("今晚想點打？"):t("嗰日想點打？")}</legend><div className="mp-choices">{presets.map(p=><Button key={p.id} type="button" variant="secondary" aria-pressed={preset===p.id} onClick={()=>setPreset(p.id)}>{t(p.label)}<small>{t("{minPlayers}–{maxPlayers} 人", {minPlayers: GROUP_PRESETS[p.id].minPlayers, maxPlayers: GROUP_PRESETS[p.id].maxPlayers})}</small></Button>)}</div></fieldset>
      <details><summary className="mp-advanced-toggle">{t("更多偏好（水平、讓分、費用）")}</summary><div className="mp-advanced"><FormField label={t("水平")}><select value={conditions.levelPreference??"similar"} onChange={e=>setConditions({...conditions,levelPreference:e.target.value as "similar"|"any",levelStrict:false})}><option value="similar">{t("相近優先，自動擴闊")}</option><option value="any">{t("都可以")}</option></select></FormField>
        {conditions.levelPreference!=="any"&&<label className="mp-checkbox"><input type="checkbox" checked={conditions.levelStrict??false} onChange={e=>setConditions({...conditions,levelStrict:e.target.checked})}/>{t("只接受相差 100 ELO 內")}</label>}
        <label className="mp-checkbox"><input type="checkbox" checked={conditions.handicap??false} onChange={e=>setConditions({...conditions,handicap:e.target.checked})}/>{t("接受讓分")}</label><label className="mp-checkbox"><input type="checkbox" checked={conditions.noSmoking??false} onChange={e=>setConditions({...conditions,noSmoking:e.target.checked})}/>{t("需要禁煙")}</label>
        <FormField label={t("費用")}><select value={conditions.feePreference??"any"} onChange={e=>setConditions({...conditions,feePreference:e.target.value as "aa"|"any"})}><option value="aa">AA</option><option value="any">{t("都可以")}</option></select></FormField>
        <FormField label={t("節奏")}><select value={conditions.tempo??"any"} onChange={e=>setConditions({...conditions,tempo:e.target.value as "sport"|"casual"|"any"})}><option value="sport">{t("競技")}</option><option value="casual">{t("休閒")}</option><option value="any">{t("都可以")}</option></select></FormField></div></details>
    </fieldset>
    <div className="mp-summary"><b>{hkDayLabel(date,t.locale)} · {start}–{end}{selectedEnd&&selectedEnd.minutes>=24*60?t("（次日）"):""}</b><span>{venueName} · {groupLabel} · {commitment==="going"?t("找緊波"):t("可以約我")}</span></div>
    <p>{t("停止公開空檔不會退出已加入的安排。去不到時，請在「我的安排」退出。")}</p><Button type="submit" loading={busy}>{slot?t("儲存修改"):t("開始找球友")}</Button>
  </form></Sheet>;
}
