"use client";
import "../lib/legacy-storage";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {NavIcon} from "./UiBits";
import {Button, ButtonLink, IconButton} from "./components/ui/Primitives";
import type {Destination} from "./components/shell/Navigation";
import { useT } from "./components/I18nProvider";
import { msg } from "../lib/i18n/translate";

/** `targets` are tried in order: the element each step points at, then progressively coarser stand-ins
    for when the ideal one is absent (an empty club has no podium, a guest has no 而家得閒 button). */
const TOUR:{tab:Destination;title:string;body:string;targets:string[]}[]=[
  {tab:"leaderboard",title:msg("排行榜"),body:msg("所有球員按 ELO 評分排名。點選任何球員，即可查看其評分走勢、勝率及建議讓分。"),targets:[".table-card .row.top",".table-card"]},
  {tab:"matches",title:msg("賽事紀錄"),body:msg("每場比賽的局分、讓分及單桿紀錄均公開存檔，盃賽賽程亦可在此查看。"),targets:[".match-list .match",".match-list"]},
  {tab:"play",title:msg("約戰"),body:msg("話畀大家知你想打波，或者開一張檯，邀請球友一齊打。"),targets:[".play-actions--top",".play-days",".play-page"]},
  {tab:"players",title:msg("球員資料"),body:msg("瀏覽每位球員的個人主頁，並可一鍵分享至 WhatsApp 或 Instagram。"),targets:[".players-rows .players-row",".players-view"]},
];

const TOP_INSET=24,CARD_GAP=16;
const SPOT_PAD=6;
/** Scrolls so the target sits centred in the part of the viewport the coach card does not cover.
    Measures the card rather than assuming its height, since it grows with the step's copy and switches
    between a corner card and a full-width one at the tablet breakpoint. */
function focusTarget(target:HTMLElement,card:HTMLElement|null){
  const rect=target.getBoundingClientRect();
  const floor=(card?card.getBoundingClientRect().top:window.innerHeight)-CARD_GAP;
  const room=floor-TOP_INSET;
  const desired=rect.height<room?TOP_INSET+(room-rect.height)/2:TOP_INSET;
  const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({top:Math.max(0,window.scrollY+rect.top-desired),behavior:reduce?"auto":"smooth"});
}

/** The guided tour. It walks the real tabs rather than screenshots of them, so it sits as a small
    card above the bottom navigation instead of a modal that would hide the very page it describes.
    Every step can go back, and the browser's back gesture (which changes the tab) moves the tour with
    it, so there is no way to strand someone halfway through. */
export function IntroTour({tab,signedIn,onShow,onClose}:{tab:string;signedIn:boolean;onShow:(tab:Destination)=>void;onClose:()=>void}){
  const t = useT();
  const [step,setStep]=useState(0);
  const last=TOUR.length;
  const titleRef=useRef<HTMLHeadingElement>(null);
  // Follow a tab change the tour did not make (back gesture, nav tap) instead of contradicting it.
  const [seenTab,setSeenTab]=useState(tab);
  if(tab!==seenTab){
    setSeenTab(tab);
    const match=TOUR.findIndex(item=>item.tab===tab);
    if(match>=0&&step<last&&TOUR[step].tab!==tab)setStep(match);
  }
  const cardRef=useRef<HTMLElement>(null);
  const spotRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{titleRef.current?.focus({preventScroll:true})},[step]);
  // Runs once the step's own tab is showing. The tab swaps a render after the tap, so the target is
  // polled for rather than assumed present.
  useEffect(()=>{
    const item=TOUR[step];
    if(!item||item.tab!==tab)return;
    let frame=0,tries=0,found:HTMLElement|null=null,cancelled=false;
    const spot=spotRef.current;
    const seek=()=>{
      if(cancelled)return;
      for(const selector of item.targets){
        // Skip matches that exist but are not laid out (legacy hidden sections, collapsed panels).
        found=Array.from(document.querySelectorAll<HTMLElement>(selector)).find(el=>el.getClientRects().length>0)??null;
        if(found)break;
      }
      if(found)return spotlight(found);
      if(++tries<90)frame=requestAnimationFrame(seek);
    };
    // The spotlight is a fixed box that follows the target every frame, so it stays locked on while the
    // smooth scroll (or a late layout shift) moves the target underneath it.
    const spotlight=(target:HTMLElement)=>{
      focusTarget(target,cardRef.current);
      if(!spot)return;
      spot.style.borderRadius=`${(parseFloat(getComputedStyle(target).borderTopLeftRadius)||0)+SPOT_PAD}px`;
      spot.hidden=false;
      let last="";
      const track=()=>{
        if(cancelled)return;
        const rect=target.getBoundingClientRect();
        const box=`${rect.left}|${rect.top}|${rect.width}|${rect.height}`;
        if(box!==last){
          last=box;
          spot.style.transform=`translate(${rect.left-SPOT_PAD}px,${rect.top-SPOT_PAD}px)`;
          spot.style.width=`${rect.width+2*SPOT_PAD}px`;
          spot.style.height=`${rect.height+2*SPOT_PAD}px`;
        }
        frame=requestAnimationFrame(track);
      };
      track();
    };
    seek();
    return()=>{cancelled=true;cancelAnimationFrame(frame);if(spot)spot.hidden=true};
  },[step,tab]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>event.key==="Escape"&&onClose();document.addEventListener("keydown",onKey);return()=>document.removeEventListener("keydown",onKey)},[onClose]);
  const go=(next:number)=>{setStep(next);if(next<last)onShow(TOUR[next].tab)};
  const current=step<last?TOUR[step]:null;
  return <>
  <div ref={spotRef} className="intro-tour-spotlight" hidden aria-hidden="true"/>
  <section ref={cardRef} className="intro-tour" role="dialog" aria-modal="false" aria-labelledby="intro-tour-title">
    <div className="intro-tour-head">
      <p className="intro-tour-progress">{t("第 {current} 步，共 {total} 步",{current:step+1,total:last+1})}</p>
      <IconButton type="button" className="intro-tour-close" label={t("結束導覽")} onClick={onClose}><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></IconButton>
    </div>
    <div className="intro-tour-body">
      {current&&<i className="intro-tour-icon" aria-hidden="true"><NavIcon id={current.tab} active={false}/></i>}
      <div>
        <h2 id="intro-tour-title" ref={titleRef} tabIndex={-1}>{current?t(current.title):signedIn?t("準備就緒"):t("準備好了嗎？")}</h2>
        <p>{current?t(current.body):signedIn?t("你可以隨時記錄賽果或登記有空時段，評分會隨每場比賽自動更新。"):t("建立帳戶後即可記錄賽果，你的評分會隨每場比賽自動更新。")}</p>
        {!current&&<a className="intro-tour-link" href="/elo-guide">{t("評分如何計算？")}</a>}
      </div>
    </div>
    <ol className="intro-tour-dots" aria-hidden="true">{Array.from({length:last+1},(_,index)=><li key={index} className={index===step?"is-current":index<step?"is-done":undefined}/>)}</ol>
    <div className="intro-tour-actions">
      <Button type="button" variant="secondary" disabled={step===0} onClick={()=>go(step-1)}>{t("上一步")}</Button>
      {current
        ?<Button type="button" variant="featured" onClick={()=>go(step+1)}>{t("下一步")}</Button>
        :signedIn
          ?<Button type="button" variant="featured" onClick={onClose}>{t("完成")}</Button>
          :<ButtonLink variant="featured" href="/login?mode=signup">{t("建立帳戶")}</ButtonLink>}
    </div>
  </section>
  </>;
}

const CHECKLIST_KEY="elo-first-steps";
type Progress={match?:boolean;hidden?:boolean};
const listeners=new Set<()=>void>();
const subscribeProgress=(notify:()=>void)=>{listeners.add(notify);window.addEventListener("storage",notify);return ()=>{listeners.delete(notify);window.removeEventListener("storage",notify)}};
const readProgressRaw=()=>{try{return localStorage.getItem(CHECKLIST_KEY)??""}catch{return ""}};
const serverProgress=()=>JSON.stringify({hidden:true});
function writeProgress(next:Progress){try{localStorage.setItem(CHECKLIST_KEY,JSON.stringify(next))}catch{}listeners.forEach(notify=>notify())}

/** A new member's next moves, on the screen they land on after onboarding. Each item is ticked from
    real activity (a recorded match) and remembered locally, so a finished step stays finished.
    The card removes itself once everything is done, or when the member dismisses it. */
export function FirstStepsChecklist({hasMatch,onRecord,onTour}:{hasMatch:boolean;onRecord:()=>void;onTour:()=>void}){
  const t = useT();
  const raw=useSyncExternalStore(subscribeProgress,readProgressRaw,serverProgress);
  let stored:Progress={};try{stored=raw?JSON.parse(raw) as Progress:{}}catch{}
  const progress={match:Boolean(stored.match||hasMatch),hidden:Boolean(stored.hidden)};
  useEffect(()=>{if(hasMatch&&!stored.match)writeProgress({...stored,match:progress.match})});
  if(progress.hidden||progress.match)return null;
  const done=1+Number(progress.match);
  const items=[
    {id:"profile",done:true,title:msg("完成個人設定"),body:msg("頭像及初始評級已設定。"),action:null},
    {id:"match",done:progress.match,title:msg("記錄第一場比賽"),body:msg("登記局分後，雙方評分即會更新。"),action:{label:msg("記錄賽果"),run:onRecord}},
  ];
  return <section className="first-steps" aria-labelledby="first-steps-title">
    <div className="first-steps-head">
      <div>
        <p className="first-steps-kicker">{t("已完成 {done}／{total}",{done,total:items.length})}</p>
        <h2 id="first-steps-title">{t("新會員起步")}</h2>
      </div>
      <Button type="button" variant="quiet" onClick={()=>writeProgress({...stored,hidden:true})}>{t("隱藏")}</Button>
    </div>
    <div className="first-steps-meter" aria-hidden="true"><i style={{width:`${done/items.length*100}%`}}/></div>
    <ol className="first-steps-list">
      {items.map(item=><li key={item.id} className={item.done?"is-done":undefined}>
        <span className="first-steps-check" aria-hidden="true">{item.done&&<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12 5 5 9-10"/></svg>}</span>
        <span className="first-steps-text"><b>{t(item.title)}</b><small>{item.done?t("已完成"):t(item.body)}</small></span>
        {!item.done&&item.action&&<Button type="button" variant="secondary" onClick={item.action.run}>{t(item.action.label)}</Button>}
      </li>)}
    </ol>
    <button type="button" className="first-steps-tour" onClick={onTour}>{t("重溫功能導覽")}</button>
  </section>;
}
