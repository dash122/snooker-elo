"use client";
import "../lib/legacy-storage";
import {useState,useSyncExternalStore} from "react";
import {Button, IconButton} from "./components/ui/Primitives";
import { useT } from "./components/I18nProvider";

const COLLAPSE_KEY="elo-guest-intro-dismissed";
const subscribeCollapse=(notify:()=>void)=>{window.addEventListener("storage",notify);return ()=>window.removeEventListener("storage",notify)};
const readCollapse=()=>{try{return localStorage.getItem(COLLAPSE_KEY)==="1"}catch{return false}};
const serverCollapse=()=>true;

/** Guests land straight on the real leaderboard, so this banner is the only explanation they get. It is
    one line and one action — the guided tour carries the detail — so the leaderboard stays in the first
    screenful. Closing it only shrinks it to a chip; it can always be reopened, since a first visit is
    rarely the moment someone is ready to read it. Sign-up already lives in the header. */
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
    <span className="guest-intro-text">
      <b id="guest-intro-title">{t("第一次使用？")}</b>
      <small>{t("一分鐘了解評分如何運作。")}</small>
    </span>
    <Button variant="featured" className="guest-intro-tour" onClick={onStartTour}>{t("開始導覽")}</Button>
    <IconButton className="guest-intro-close" label={t("稍後再看")} onClick={()=>setCollapsed(true)}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
    </IconButton>
  </section>;
}
