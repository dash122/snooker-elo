"use client";
import {useEffect,useState} from "react";
import {NavIcon} from "./UiBits";
import type {Destination} from "./components/shell/Navigation";

const DISMISS_KEY="scaa-guest-intro-dismissed";

const FEATURES:{id:Destination;title:string;body:string}[]=[
  {id:"leaderboard",title:"公開排行榜",body:"排名、ELO、走勢、勝率同讓球，賽果一確認即刻更新。"},
  {id:"matches",title:"賽事紀錄同盃賽",body:"每場波嘅局分、讓球同單桿都有紀錄，仲有盃賽賽程。"},
  {id:"availability",title:"約戰配對",body:"一鍵話俾大家知你得閒，系統幫你搵時間夾得到嘅對手。"},
  {id:"players",title:"球員主頁同分享",body:"打開任何球員主頁，一嗒分享去 WhatsApp 或 Instagram。"},
];

/** Guests land straight on the real leaderboard — this card is the only place that explains why the
    ratings can be trusted and what the other tabs unlock, so it carries the whole "why / what / how"
    job that a separate marketing page would otherwise do. Dismissal is remembered locally: once
    someone has read it, repeating it on every visit would just be in the way of the data they came
    to see. */
export default function GuestIntro({onNavigate}:{onNavigate:(id:Destination)=>void}){
  const [dismissed,setDismissed]=useState(true);
  useEffect(()=>{try{setDismissed(localStorage.getItem(DISMISS_KEY)==="1")}catch{setDismissed(false)}},[]);
  if(dismissed)return null;
  const dismiss=()=>{setDismissed(true);try{localStorage.setItem(DISMISS_KEY,"1")}catch{}};
  return <section className="guest-intro" aria-label="關於 SCAA Snooker ELO">
    <button type="button" className="guest-intro-close" aria-label="關閉介紹" onClick={dismiss}>✕</button>
    <p className="guest-intro-kicker">SCAA SNOOKER ELO</p>
    <h2>你而家睇緊嘅，係全會共用嘅正式評分</h2>
    <p className="guest-intro-lead">
      呢個排行榜唔止計輸贏——局分算證據、讓球會封頂、贏出預期越多加分越多，改咗設定舊賽果會自動重算，所以每個評分都對得上紀錄。
    </p>
    <ul className="guest-intro-features">
      {FEATURES.map(item=><li key={item.id}>
        <button type="button" onClick={()=>onNavigate(item.id)}>
          <i><NavIcon id={item.id} active={false}/></i>
          <span><b>{item.title}</b><small>{item.body}</small></span>
        </button>
      </li>)}
    </ul>
    <div className="guest-intro-actions">
      <a className="ds-button ds-button--featured" href="/login?mode=signup"><span>建立帳戶，開始記錄</span></a>
      <a className="ds-button ds-button--secondary" href="/elo-guide"><span>評分點計出嚟？</span></a>
    </div>
  </section>;
}
