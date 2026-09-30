"use client";
import {useState,useSyncExternalStore} from "react";
import {Button, ButtonLink} from "./components/ui/Primitives";
import { useT } from "./components/I18nProvider";
import { msg } from "../lib/i18n/translate";

const COLLAPSE_KEY="scaa-guest-intro-dismissed";
const subscribeCollapse=(notify:()=>void)=>{window.addEventListener("storage",notify);return ()=>window.removeEventListener("storage",notify)};
const readCollapse=()=>{try{return localStorage.getItem(COLLAPSE_KEY)==="1"}catch{return false}};
const serverCollapse=()=>true;

const STEPS=[
  {title:msg("查看排行榜"),body:msg("了解每位球員的評分、近況及建議讓分。")},
  {title:msg("記錄賽果"),body:msg("比賽完成後，登入並登記雙方局分。")},
  {title:msg("評分自動更新"),body:msg("系統按賽果即時調整評分，毋須人手計算。")},
];

/** Guests land straight on the real leaderboard, so this card is the only explanation they get. It
    stays open by default and answers "what do I do here?" in three steps; the detail lives in the
    guided tour it launches. Closing it only shrinks it to a chip — it can always be reopened, since
    a first visit is rarely the moment someone is ready to read it. */
export default function GuestIntro({onStartTour}:{onStartTour:()=>void}){
  const t = useT();
  const [override,setOverride]=useState<boolean|null>(null);
  const storedCollapse=useSyncExternalStore(subscribeCollapse,readCollapse,serverCollapse);
  const collapsed=override??storedCollapse;
  const setCollapsed=(next:boolean)=>{setOverride(next);try{if(next)localStorage.setItem(COLLAPSE_KEY,"1");else localStorage.removeItem(COLLAPSE_KEY)}catch{}};
  if(collapsed)return <div className="guest-intro-chip-row">
    <button type="button" className="guest-intro-chip" onClick={()=>setCollapsed(false)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14M12 17h.01"/></svg>
      <span>{t("新手指南")}</span>
    </button>
  </div>;
  return <section className="guest-intro" aria-labelledby="guest-intro-title">
    <p className="guest-intro-kicker">{t("新手指南")}</p>
    <h2 id="guest-intro-title">{t("三步了解球會評分")}</h2>
    <ol className="guest-intro-steps">
      {STEPS.map((step,index)=><li key={step.title}>
        <span className="guest-intro-step-number" aria-hidden="true">{index+1}</span>
        <span><b>{t(step.title)}</b><small>{t(step.body)}</small></span>
      </li>)}
    </ol>
    <div className="guest-intro-actions">
      <Button variant="featured" onClick={onStartTour}>{t("開始導覽")}</Button>
      <ButtonLink variant="secondary" href="/login?mode=signup">{t("建立帳戶")}</ButtonLink>
      <Button variant="quiet" className="guest-intro-later" onClick={()=>setCollapsed(true)}>{t("稍後再看")}</Button>
    </div>
  </section>;
}
