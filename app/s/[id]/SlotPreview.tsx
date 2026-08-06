"use client";
import { useState } from "react";
import { PlayerBadge } from "../../UiBits";
import { hkClock, hkDate, hkDayLabel, addDaysHongKong } from "../../../lib/availability";
import { conditionChips, type SlotConditions } from "../../../lib/slots";

type SharedSlot = {
  id:string; startAt:string; endAt:string; venue:string;
  conditions:SlotConditions;
  player:{id:string;name:string;short?:string|null;rating:number;colour?:string|null;avatar?:string|null};
};

function when(slot:{startAt:string;endAt:string}){
  const day=hkDate(new Date(slot.startAt));
  const label=day===hkDate()?"今晚":day===addDaysHongKong(hkDate(),1)?"聽日":hkDayLabel(day);
  return `${label} ${hkClock(slot.startAt)}–${hkClock(slot.endAt)}`;
}

/** The card a guest sees before they have ever opened the app: readable without an account, exactly
    like an open call always was. Raising a hand is the one action that requires signing in — and it
    is asked for at the moment the guest actually wants it, not before. */
export default function SlotPreview({id,slot,signedIn}:{id:string;slot:SharedSlot|null;signedIn:boolean}){
  const [raised,setRaised]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);

  const raise=async()=>{
    setBusy(true);setError("");
    try{
      const response=await fetch(`/api/slots/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"raise"})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){setError(body.error??"舉唔到手，試多次。");return}
      setRaised(true);
    }catch{setError("網絡連線失敗，請再試一次。")}
    finally{setBusy(false)}
  };

  return <main className="share-page">
    <div className="share-card">
      <p className="share-kicker">SCAA Snooker · 開局卡</p>
      {!slot
        ? <>
            <h1>呢張局搵唔到</h1>
            <p className="share-note">可能已經夾咗，或者已經過期。</p>
          </>
        : <>
            <div className="share-who">
              <PlayerBadge player={slot.player}/>
              <span><b>{slot.player.name}</b><small>ELO {Math.round(slot.player.rating)}</small></span>
            </div>
            <h1>{when(slot)}{slot.venue?` · ${slot.venue}`:""}</h1>
            {conditionChips(slot.conditions).length>0&&<div className="share-chips">
              {conditionChips(slot.conditions).map(chip=><span key={chip} className="share-chip">{chip}</span>)}
            </div>}
            {raised
              ? <p className="share-done">已經舉手！開局嗰個確認咗會即刻話你知。</p>
              : signedIn
                ? <>
                    <button type="button" className="primary full" disabled={busy} onClick={()=>void raise()}>
                      {busy?"舉緊手…":"我舉手"}</button>
                    <p className="share-note">舉手唔會即刻鎖死你 — 隨時可以收返。</p>
                  </>
                : <>
                    <a className="primary full share-cta" href={`/login?mode=login`}>登入或註冊先舉手</a>
                    <p className="share-note">未係會員？登入完可以直接註冊，然後返嚟呢頁再撳一次。</p>
                  </>}
            {error&&<p className="share-error" role="alert">{error}</p>}
          </>}
      <p className="share-foot">未係會員都睇到呢頁 — SCAA App 嘅約戰連結。</p>
    </div>
  </main>;
}
