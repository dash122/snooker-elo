"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {Button,Chip,EmptyState,FormField,InlineNotice,Skeleton,Surface} from "./components/ui/Primitives";
import {Sheet} from "./components/ui/Overlay";
import {PlayerBadge} from "./UiBits";
import {WeekBand} from "./WeekBand";
import {addDaysHongKong,availabilityEndTimes,availabilityStartTimes,hkClock,hkDate,hkDayLabel} from "../lib/availability";
import {trackAvailabilityEvent} from "../lib/availability-analytics";

type Player={id:string;name:string;short:string;rating:number;colour:string|null;avatar:string|null};
type Venue={id:string;name:string;district?:string};
type Availability={id:string;playerId:string;startAt:string;endAt:string;venue:Venue|null};
type Opportunity={anchorSlotId:string;player:Player;startAt:string;endAt:string;proposedStartAt:string;proposedEndAt:string;venue:Venue|null;overlapMinutes:number;compatiblePlayers:number;eloDifference:number;newOpponent:boolean;score:number};
type SessionPlayer={id:string;name:string;short:string;rating:number;avatar:string|null;colour:string|null};
type FormationSession={id:string;hostPlayerId:string;anchorSlotId:string;startAt:string;endAt:string;status:"forming"|"playable"|"full"|"cancelled"|"completed";venue:Venue|null;acceptedCount:number;isHost:boolean;myStatus:string|null;acceptedPlayers:SessionPlayer[];opponent:SessionPlayer|null;pendingRequests:SessionPlayer[]};
type Dashboard={signedIn:boolean;own:Availability[];opportunities:Opportunity[];sessions:FormationSession[];venues:Venue[];publicDays:Record<string,number>;error?:string};

const EMPTY:Dashboard={signedIn:false,own:[],opportunities:[],sessions:[],venues:[],publicDays:{}};
const dateOf=(iso:string)=>hkDate(new Date(iso));
const duration=(minutes:number)=>minutes>=120?`${Math.round(minutes/60*10)/10} 小時`:`${minutes} 分鐘`;
const sessionStatus=(session:FormationSession)=>session.status==="full"||session.status==="playable"?"對局已確認":session.myStatus==="pending"?"等待對方回覆":session.myStatus==="declined"?"這次未能約成":session.myStatus==="withdrawn"?"已退出":"等待對方回覆";
const statusTone=(session:FormationSession)=>session.status==="full"||session.status==="playable"?"success":session.myStatus==="pending"?"warning":session.myStatus==="declined"?"danger":"neutral";
const sessionHint=(session:FormationSession)=>session.status==="full"||session.status==="playable"?"兩位球員已確認":session.myStatus==="declined"?"可以再試其他球友":session.myStatus==="withdrawn"?"你已退出這次約戰":"等待對方回覆";
const canLeaveSession=(session:FormationSession)=>session.isHost||session.myStatus==="pending"||session.myStatus==="accepted";

export default function MatchmakingFormation({onPlayer,onActivity,onRecord}:{onPlayer?:(playerId:string)=>void;onActivity?:()=>void;onRecord?:(opponentId:string)=>void}){
  const dates=useMemo(()=>Array.from({length:7},(_,index)=>addDaysHongKong(hkDate(),index)),[]);
  const [data,setData]=useState<Dashboard>(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [selectedDate,setSelectedDate]=useState(dates[0]),[publishOpen,setPublishOpen]=useState(false),[requesting,setRequesting]=useState<Opportunity|null>(null);
  const [busy,setBusy]=useState(""),[message,setMessage]=useState("");
  const [publishDates,setPublishDates]=useState<string[]>([dates[0]]),[start,setStart]=useState("19:00"),[end,setEnd]=useState("22:00"),[venueId,setVenueId]=useState("");
  const endOptions=useMemo(()=>availabilityEndTimes(start),[start]);
  const effectiveEnd=endOptions.some(option=>option.value===end)?end:(endOptions[0]?.value??end);

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/matchmaking/formation",{cache:"no-store"}),body=await response.json() as Dashboard;
      if(!response.ok||body.error)throw new Error(body.error??"約戰資料暫時未能載入。");
      setData(body);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"約戰資料暫時未能載入。")}finally{setLoading(false)}
  },[]);

  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  useEffect(()=>{if(!message)return;const timer=window.setTimeout(()=>setMessage(""),4500);return()=>window.clearTimeout(timer)},[message]);
  useEffect(()=>{trackAvailabilityEvent("matchmaking_mvp_view")},[]);
  useEffect(()=>{if(!loading)trackAvailabilityEvent("matchmaking_mvp_opportunity_shown",{count:data.opportunities.length})},[loading,data.opportunities.length]);

  const mutate=useCallback(async(key:string,url:string,init:RequestInit,success:string)=>{
    if(busy)return false;setBusy(key);setError("");
    try{
      const response=await fetch(url,init),body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error??"操作失敗，請再試一次。");
      await load();setMessage(success);onActivity?.();return true;
    }catch(reason){setError(reason instanceof Error?reason.message:"操作失敗，請再試一次。");return false}
    finally{setBusy("")}
  },[busy,load,onActivity]);

  const publish=async()=>{
    const ok=await mutate("publish","/api/matchmaking/formation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dates:publishDates,start,end:effectiveEnd,venueId:venueId||null})},"空檔已公開；有合適球友時我們會通知你。");
    if(ok){trackAvailabilityEvent("matchmaking_mvp_publish",{days:publishDates.length,start,end:effectiveEnd});setPublishOpen(false);setSelectedDate(publishDates[0]??dates[0])}
  };
  /* 時段軸寫入時段用的是這條路徑，而不是 /api/availability：formation 的端點會一併處理場地與
     時段衝突，而兩者寫的都是同一張 availability_slots，所以時段軸讀到的仍然是同一份資料。 */
  const publishWindow=useCallback(async(date:string,startClock:string,endClock:string)=>{
    const ok=await mutate("publish","/api/matchmaking/formation",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({dates:[date],start:startClock,end:endClock,venueId:venueId||null})},"已公開你的時段。");
    if(ok)trackAvailabilityEvent("matchmaking_mvp_publish",{days:1,start:startClock,end:endClock});
    return ok;
  },[mutate,venueId]);

  const request=async()=>{
    if(!requesting)return;
    const ok=await mutate(`request:${requesting.anchorSlotId}`,"/api/matchmaking/formation/sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchorSlotId:requesting.anchorSlotId,startAt:requesting.proposedStartAt,endAt:requesting.proposedEndAt})},`已向 ${requesting.player.name} 送出約戰，等對方回覆。`);
    if(ok){trackAvailabilityEvent("matchmaking_mvp_request_send",{overlapMinutes:requesting.overlapMinutes,eloDifference:requesting.eloDifference});setRequesting(null)}
  };
  const respond=async(sessionId:string,playerId:string,action:"accept"|"decline")=>{
    const ok=await mutate(`${action}:${sessionId}:${playerId}`,`/api/matchmaking/formation/sessions/${sessionId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action,playerId})},action==="accept"?"已接受約戰，對局已確認。":"已處理約戰申請。");
    if(ok)trackAvailabilityEvent(action==="accept"?"matchmaking_mvp_request_accept":"matchmaking_mvp_request_decline");
    if(ok&&action==="accept")trackAvailabilityEvent("matchmaking_mvp_game_confirmed");
  };
  const leave=async(session:FormationSession)=>{
    const ok=await mutate(`leave:${session.id}`,`/api/matchmaking/formation/sessions/${session.id}`,{method:"DELETE"},session.isHost?"約戰已取消。":"已退出約戰。");
    if(ok&&!session.isHost)trackAvailabilityEvent("matchmaking_mvp_request_withdraw");
  };

  const own=data.own.filter(item=>dateOf(item.startAt)===selectedDate);
  const opportunities=data.opportunities.filter(item=>dateOf(item.startAt)===selectedDate);
  const sessions=data.sessions.filter(item=>dateOf(item.startAt)===selectedDate);
  const hasOwnAny=data.own.length>0;

  return <section className="mf-page">
    <div className="mf-header">
      <div><p className="mf-kicker">SCAA MATCHMAKING</p><h1>想打一場球？</h1><p>公開你有空的時間，我們為你找一位時間重疊、水平接近的球友。</p></div>
      {data.signedIn&&<Button onClick={()=>setPublishOpen(true)}>＋ 公開空檔</Button>}
    </div>

    {/* 原本的日期列已由時段軸的週密度條取代 — 兩個日期選擇器操作同一個 selectedDate，
        正是這次改版要消滅的重複。密度條還多答一件事：那一晚同時在場的人數，而非全日人次。 */}

    {/* 一個手勢，同時是查詢，也是宣告。舊版要先公開時段才看得到任何人（「先公開你的時間」），
        回報永遠在承諾之後；時段軸把「這段時間有誰重疊」放到公開之前回答。名單留給下面那張
        真的可以送出邀請的清單，時段軸只負責密度、重疊人數與寫入。 */}
    <WeekBand signedIn={data.signedIn} showList={false} refreshKey={data.own.length}
      onPublish={publishWindow} onSelectDate={setSelectedDate} onOpenPlayer={onPlayer}
      onChanged={()=>{void load();onActivity?.()}}/>

    {message&&<InlineNotice tone="success" title="已更新">{message}</InlineNotice>}
    {error&&<InlineNotice tone="warning" title="未能完成"><span>{error}</span><Button variant="quiet" onClick={()=>void load()}>重試</Button></InlineNotice>}
    {loading?<div className="mf-loading"><Skeleton height="8rem"/><Skeleton height="12rem"/><Skeleton height="12rem"/></div>:!data.signedIn?
      <Surface tone="featured" className="mf-signin"><p className="mf-kicker">MEMBERS ONLY</p><h2>登入後才可以找到和你時間重疊的球友</h2><p>目前未來七日已有 {Object.values(data.publicDays).reduce((sum,value)=>sum+value,0)} 個公開空檔。</p><a className="ds-button ds-button--featured" href="/login"><span>登入開始約戰</span></a></Surface>
    :<>
      <section className="mf-section mf-my-activity">
        <div className="mf-section-head"><div><p className="mf-kicker">MY ACTIVITY</p><h2>我的安排</h2></div></div>
        {sessions.map(session=><Surface key={session.id} className="mf-session-card">
          <div className="mf-card-top"><div><Chip tone={statusTone(session)}>{sessionStatus(session)}</Chip><h3>{hkClock(session.startAt)}–{hkClock(session.endAt)}</h3><p>{session.venue?.name||"場地稍後決定"} · {sessionHint(session)}</p></div><div className="mf-avatar-stack">{session.acceptedPlayers.slice(0,2).map(player=><PlayerBadge key={player.id} player={player}/>)}</div></div>
          {session.pendingRequests.length>0&&<div className="mf-requests"><b>{session.pendingRequests.length} 個約戰申請</b>{session.pendingRequests.map(player=><div key={player.id} className="mf-request-row"><button type="button" className="mf-player-link" onClick={()=>onPlayer?.(player.id)}><PlayerBadge player={player}/><span>{player.name}<small>ELO {Math.round(player.rating)}</small></span></button><span><Button variant="secondary" loading={busy===`decline:${session.id}:${player.id}`} onClick={()=>void respond(session.id,player.id,"decline")}>婉拒</Button><Button loading={busy===`accept:${session.id}:${player.id}`} onClick={()=>void respond(session.id,player.id,"accept")}>接受</Button></span></div>)}</div>}
          {(session.status==="full"||session.status==="playable")&&session.opponent&&onRecord&&<Button onClick={()=>onRecord(session.opponent!.id)}>記錄賽果</Button>}
          {canLeaveSession(session)&&<Button variant="quiet" loading={busy===`leave:${session.id}`} onClick={()=>void leave(session)}>{session.isHost?"取消約戰":"撤回／退出"}</Button>}
        </Surface>)}
        {own.map(item=><Surface key={item.id} className="mf-session-card">
          <div className="mf-card-top"><div><Chip tone="neutral">已公開，等待配對</Chip><h3>{hkClock(item.startAt)}–{hkClock(item.endAt)}</h3><p>{item.venue?.name||"場地未定"}</p></div></div>
          <Button variant="quiet" loading={busy===`cancel:${item.id}`} onClick={()=>void mutate(`cancel:${item.id}`,`/api/matchmaking/formation/availability/${item.id}`,{method:"DELETE"},"空檔已取消。")}>取消</Button>
        </Surface>)}
        {!sessions.length&&!own.length&&(
          <EmptyState title="這日你還未公開時間" description="選擇開始和結束時間，就可以讓合適球友找到你。" action={<Button onClick={()=>setPublishOpen(true)}>公開空檔</Button>}/>
        )}
      </section>

      <section className="mf-section">
        <div className="mf-section-head"><div><p className="mf-kicker">BEST OPPORTUNITIES</p><h2>最適合你的球友</h2></div><span>{opportunities.length?`${opportunities.length} 個選擇`:"等待重疊"}</span></div>
        {!hasOwnAny?<EmptyState title="先公開你的時間" description="有了你的空檔，我們才能計算真正重疊至少一小時的球友。" action={<Button onClick={()=>setPublishOpen(true)}>公開空檔</Button>}/>
        :!opportunities.length?<EmptyState title="這日暫時沒有合適球友" description="你的空檔仍然公開；有人新增重疊時間後，機會會自動出現在這裡。" action={<Button variant="secondary" onClick={()=>setPublishOpen(true)}>新增其他日子</Button>}/>
        :<div className="mf-opportunity-list">{opportunities.map((item,index)=><Surface key={item.anchorSlotId} tone={index===0?"raised":"primary"} className="mf-opportunity-card">
          <div className="mf-card-top"><button type="button" className="mf-player-link" onClick={()=>onPlayer?.(item.player.id)}><PlayerBadge player={item.player}/><span><b>{item.player.name}</b><small>ELO {Math.round(item.player.rating)}</small></span></button>{index===0&&<Chip tone="accent">最佳選擇</Chip>}</div>
          <div className="mf-overlap"><strong>{duration(item.overlapMinutes)}</strong><span>可重疊時間</span><b>建議 {hkClock(item.proposedStartAt)}–{hkClock(item.proposedEndAt)}</b></div>
          <div className="mf-card-meta"><span>{item.venue?.name||"場地稍後決定"}</span><span>相差 {Math.round(item.eloDifference)} ELO</span></div>
          <div className="mf-chips">{item.newOpponent&&<Chip tone="success">未交手過</Chip>}<Chip tone="success">時間重疊</Chip></div>
          <Button className="mf-card-action" onClick={()=>setRequesting(item)}>邀請對局 <span aria-hidden="true">→</span></Button>
        </Surface>)}</div>}
      </section>
    </>}

    <Sheet open={publishOpen} title="公開你的空檔" onClose={()=>!busy&&setPublishOpen(false)} className="mf-sheet">
      <div className="mf-form">
        <FormField label="選擇日子" hint="可以一次公開多日"><div className="mf-date-picker">{dates.map(date=><button key={date} type="button" aria-pressed={publishDates.includes(date)} onClick={()=>setPublishDates(current=>current.includes(date)?current.filter(item=>item!==date):[...current,date].sort())}><b>{date===dates[0]?"今日":hkDayLabel(date).split(" ").at(-1)}</b><span>{Number(date.slice(-2))}</span></button>)}</div></FormField>
        <div className="mf-time-fields"><FormField label="開始時間"><select value={start} onChange={event=>setStart(event.target.value)}>{availabilityStartTimes().map(value=><option key={value}>{value}</option>)}</select></FormField><FormField label="結束時間"><select value={effectiveEnd} onChange={event=>setEnd(event.target.value)}>{endOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></FormField></div>
        <FormField label="場地（可選）" hint="未決定也不會阻擋配對"><select value={venueId} onChange={event=>setVenueId(event.target.value)}><option value="">稍後一起決定</option>{data.venues.map(venue=><option key={venue.id} value={venue.id}>{venue.name}{venue.district?` · ${venue.district}`:""}</option>)}</select></FormField>
        <Button loading={busy==="publish"} disabled={!publishDates.length} onClick={()=>void publish()}>公開 {publishDates.length||0} 日空檔</Button>
      </div>
    </Sheet>

    <Sheet open={Boolean(requesting)} title="約戰確認" onClose={()=>!busy&&setRequesting(null)} className="mf-sheet">
      {requesting&&<div className="mf-request-confirm"><div className="mf-request-person"><PlayerBadge player={requesting.player}/><div><b>{requesting.player.name}</b><span>ELO {Math.round(requesting.player.rating)}</span></div></div><Surface><small>建議共同時間</small><h3>{hkDayLabel(dateOf(requesting.proposedStartAt))}</h3><b>{hkClock(requesting.proposedStartAt)}–{hkClock(requesting.proposedEndAt)}</b><p>{requesting.venue?.name||"場地稍後一起決定"}</p></Surface><InlineNotice tone="info" title="送出後等對方確認">對方接受後，這場對局就會正式確認。</InlineNotice><Button loading={busy===`request:${requesting.anchorSlotId}`} onClick={()=>void request()}>送出約戰</Button></div>}
    </Sheet>
  </section>;
}
