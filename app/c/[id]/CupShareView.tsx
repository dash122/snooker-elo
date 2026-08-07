"use client";
import Link from "next/link";
import { useState } from "react";
import CupBracketChart, { type BracketChartData } from "../../CupBracketChart";
import { PlayerBadge } from "../../UiBits";
import { cupShareMessage, whatsappLink, type CupShareState } from "../../../lib/cup-share";

type Badge = { id:string; name:string; short:string; colour?:string|null; avatar?:string|null };
type Side = { player:Badge|null; score:number|null; won:boolean };
type Tie = { index:number; state:string; playedOn:string; sides:Side[]; note:string };

export type SharedCup = {
  id:string; name:string; share:CupShareState;
  roster:Badge[];
  rounds:{round:number;name:string;ties:Tie[]}[];
  champion:Badge|null;
};

const STATUS_LABEL:Record<CupShareState["status"],string>={signup:"報名中",live:"進行中",done:"已完成",short:"未能開賽"};

/** The page behind a shared cup link.
 *
 *  Readable by anyone the link reaches — the club's WhatsApp group included — before they have an
 *  account, because a recruitment poster that demands a login first is not a recruitment poster.
 *  Signing in is asked for at the one moment it is actually needed: entering the cup. */
export default function CupShareView({cup,url,signedIn}:{cup:SharedCup|null;url:string;signedIn:boolean}){
  const [copied,setCopied]=useState(false);
  if(!cup)return <main className="share-page"><div className="share-card">
    <p className="share-kicker">SCAA Snooker · 會友盃</p>
    <h1>搵唔到呢個盃賽</h1>
    <p className="share-note">連結可能已經失效，或者盃賽已被刪除。</p>
    <Link className="primary full share-cta" href="/">開啟 SCAA Snooker</Link>
  </div></main>;

  const {share}=cup;
  const chart:BracketChartData|null=cup.rounds.length?{
    rounds:cup.rounds.map(round=>({round:round.round,name:round.name,
      nodes:round.ties.map(tie=>({index:tie.index,state:tie.state,
        seats:tie.sides.map(side=>({player:side.player,score:side.score,won:side.won}))}))})),
    champion:cup.champion,
  }:null;
  /* Light the round actually being played, so a reader's eye lands on the live part of the tree
     rather than on the first column, which is usually finished. */
  const liveRound=cup.rounds.find(round=>round.ties.some(tie=>tie.state==="ready"||tie.state==="waiting"))?.round
    ??cup.rounds.at(-1)?.round;
  const message=cupShareMessage(cup.name,share,url);
  const shareOut=async()=>{
    /* The native sheet is the right surface on a phone — it lists WhatsApp first for most members —
       and the wa.me link is the desktop fallback rather than a second-class path. */
    if(typeof navigator!=="undefined"&&navigator.share){
      try{ await navigator.share({title:cup.name,text:message}); return; }catch{ /* dismissed */ }
    }
    window.open(whatsappLink(message),"_blank","noopener");
  };
  const copy=async()=>{
    try{ await navigator.clipboard.writeText(url||message);setCopied(true);setTimeout(()=>setCopied(false),1800); }catch{}
  };

  return <main className="cup-share-page">
    <header className="cup-share-hero">
      <div className="cup-art dark" aria-hidden="true">
        <span className="cup-art-cup">🏆</span><i className="cup-art-ball red"/><i className="cup-art-ball white"/><i className="cup-art-arc"/>
      </div>
      <div className="cup-share-hero-body">
        <p className="share-kicker">SCAA Snooker · 會友盃</p>
        <h1>{cup.name}</h1>
        <p className="cup-share-status"><span className={`cup-chip is-${share.status}`}>{STATUS_LABEL[share.status]}</span>
          <span>{share.status==="signup"?`${share.entrants} 人報名 · ${share.deadline} 截止`
            :share.status==="done"?`${share.entrants} 人參賽 · 冠軍 ${cup.champion?.name??""}`
            :share.status==="short"?"報名人數不足":`${share.entrants} 人參賽 · 打到${share.roundName}`}</span></p>
      </div>
    </header>

    <div className="cup-share-actions">
      {share.status==="signup"
        ?<Link className="cup-btn primary" href={signedIn?"/?tab=matches&view=cup":"/login?mode=signup"}>{signedIn?"入去報名":"註冊並報名"}</Link>
        :<Link className="cup-btn primary" href="/?tab=matches&view=cup">開啟 App 睇全部</Link>}
      <button type="button" className="cup-btn ghost" onClick={()=>void shareOut()}>分享畀朋友</button>
      <button type="button" className="cup-btn ghost" onClick={()=>void copy()}>{copied?"已複製連結":"複製連結"}</button>
    </div>

    {cup.champion&&<article className="cup-champion">
      <span aria-hidden="true">🏆</span>
      <div><small>{cup.name} 冠軍</small><b>{cup.champion.name}</b></div>
      <PlayerBadge player={cup.champion}/>
    </article>}

    {cup.roster.length>0&&<section className="cup-roster">
      <h3>{share.status==="signup"?"報名名單":"參賽名單"} <span>{cup.roster.length}</span></h3>
      <ul>{cup.roster.map(entry=><li key={entry.id}><PlayerBadge player={entry}/><b>{entry.name}</b></li>)}</ul>
    </section>}

    {/* The same chart the app draws. A reader who followed the link came to see the bracket, and a
        list of ties is not a bracket. */}
    {chart&&<CupBracketChart chart={chart} activeRound={liveRound}/>}

    {cup.rounds.filter(round=>round.ties.some(tie=>tie.state!=="dead")).map(round=><section className="cup-share-round" key={round.round}>
      <h3>{round.name}</h3>
      <ol className="cup-ties">{round.ties.filter(tie=>tie.state!=="dead").map(tie=><li className={`cup-tie ${tie.state}`} key={tie.index}>
        <div className="cup-tie-head"><span className="cup-tie-no">第 {tie.index} 場</span>
          {tie.playedOn&&<time className="cup-tie-date" dateTime={tie.playedOn}>{tie.playedOn}</time>}</div>
        {tie.sides.map((side,index)=><div className={`cup-tie-side${side.won?" won":""}${side.player?"":" tbd"}`} key={index}>
          <PlayerBadge player={side.player??{short:"?"}}/>
          <b>{side.player?.name??"待定"}</b>
          {side.score!=null?<em>{side.score}</em>:side.won?<i aria-hidden="true">✓</i>:null}
        </div>)}
        {tie.note&&<p className="cup-tie-note">{tie.note}</p>}
      </li>)}</ol>
    </section>)}

    <p className="share-foot">未係會員都睇到呢頁 — SCAA Snooker 嘅盃賽連結。</p>
  </main>;
}
