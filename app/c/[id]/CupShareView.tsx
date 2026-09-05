"use client";
import Link from "next/link";
import { useState } from "react";
import CupBracketChart, { storyBracket, type BracketChartData } from "../../CupBracketChart";
import { PlayerBadge } from "../../UiBits";
import type { StoryPerson } from "../../../lib/story-card";
import { cupShareCta, cupUrgency, type CupShareState } from "../../../lib/cup-share";
import { formatTournamentDateTime } from "../../../lib/tournament";
import CupShareButtons from "../../CupShareButtons";

type Badge = { id:string; name:string; short:string; colour?:string|null; avatar?:string|null;
  /** Null for a player the club has never rated — printed as 未評分 rather than as a zero. */
  rating?:number|null; handicap?:number|null; arrival?:string|null };
type Side = { player:Badge|null; score:number|null; won:boolean };
type Tie = { index:number; state:string; playedOn:string; sides:Side[]; note:string;
  /** 「讓 6 分」 or 「平手」 for this pairing, empty in a cup that plays level. */
  handicap:string };

export type SharedCup = {
  id:string; name:string; startAt?:string|null; share:CupShareState; handicapMode:"suggested"|"none";
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
    <p className="share-kicker">SCAA Snooker · 盃賽</p>
    <h1>搵唔到呢個盃賽</h1>
    <p className="share-note">連結可能已經失效，或者盃賽已被刪除。</p>
    <Link className="primary full share-cta" href="/">開啟 SCAA Snooker</Link>
  </div></main>;

  const {share}=cup;
  const chart:BracketChartData|null=cup.rounds.length?{
    rounds:cup.rounds.map(round=>({round:round.round,name:round.name,
      nodes:round.ties.map(tie=>({index:tie.index,state:tie.state,date:tie.playedOn,
        seats:tie.sides.map(side=>({player:side.player,score:side.score,won:side.won}))}))})),
    champion:cup.champion,
  }:null;
  /* Light the round actually being played, so a reader's eye lands on the live part of the tree
     rather than on the first column, which is usually finished. */
  const liveRound=cup.rounds.find(round=>round.ties.some(tie=>tie.state==="ready"||tie.state==="waiting"))?.round
    ??cup.rounds.at(-1)?.round;
  const cta=cupShareCta(share);
  const urgency=cupUrgency(share);
  const person=(entry:Badge):StoryPerson=>({name:entry.name,short:entry.short,colour:entry.colour??null,avatar:entry.avatar??null});
  const copy=async()=>{
    try{ await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),1800); }catch{}
  };

  return <main className="cup-share-page">
    <header className="cup-share-hero">
      <div className="cup-art dark" aria-hidden="true">
        <span className="cup-art-cup">🏆</span><i className="cup-art-ball red"/><i className="cup-art-ball white"/><i className="cup-art-arc"/>
      </div>
      <div className="cup-share-hero-body">
        <p className="share-kicker">SCAA Snooker · 盃賽</p>
        <h1>{cup.name}</h1>
        <p className="cup-share-status"><span className={`cup-chip is-${share.status}`}>{STATUS_LABEL[share.status]}</span>
          {urgency.label&&share.status==="signup"&&<span className={`cup-urgency${urgency.hot?" hot":""}`}>{urgency.label}</span>}
          {cup.startAt&&<span>開始：{formatTournamentDateTime(cup.startAt)}</span>}
          <span>{share.status==="signup"?`${share.entrants} 人報名 · ${share.deadline} 截止`
            :share.status==="done"?`${share.entrants} 人參賽 · 冠軍 ${cup.champion?.name??""}`
            :share.status==="short"?"報名人數不足":`${share.entrants} 人參賽 · 打到${share.roundName}`}</span></p>
      </div>
    </header>

    <div className="cup-share-actions">
      {share.status==="signup"
        ?<Link className="cup-btn primary" href={signedIn?"/?tab=matches&view=cup":"/login?mode=signup"}>{signedIn?"入去報名":"註冊並報名"}</Link>
        :<Link className="cup-btn primary" href="/?tab=matches&view=cup">開啟 App 睇全部</Link>}
      <button type="button" className="cup-btn ghost cup-share-copy" onClick={()=>void copy()}>{copied?"已複製連結":"複製連結"}</button>
    </div>

    {/* The reader of a shared link is the club's best recruiter: they are already in the group chat
        and on the feed this cup needs to reach. So they get the same two buttons the member who sent
        it had, not a weaker version. */}
    <CupShareButtons name={cup.name} state={share} url={url}
      entrants={cup.roster.map(person)} champion={cup.champion?person(cup.champion):null}
      bracket={chart?storyBracket(chart):[]}/>

    {cup.champion&&<article className="cup-champion">
      <span aria-hidden="true">🏆</span>
      <div><small>{cup.name} 冠軍</small><b>{cup.champion.name}</b></div>
      <PlayerBadge player={cup.champion}/>
    </article>}

    {/* The roster carries ELO and the club's suggested handicap, because a reader deciding whether to
        enter is really asking whether this field is beatable — and 「陳大文、李小明、…」 answers that
        only for someone who already knows every name. With the handicap beside it, a weaker player
        can see the terms they would actually play off rather than the gap they would give away. */}
    {cup.roster.length>0&&<section className="cup-roster">
      <h3>{share.status==="signup"?"報名名單":"參賽名單"} <span>{cup.roster.length}</span></h3>
      <ul className="rated">{cup.roster.map(entry=><li key={entry.id}>
        <div className="cup-roster-player">
          <PlayerBadge player={entry}/>
          <div className="cup-roster-player-copy">
            <b>{entry.name}</b>
            <span className="cup-roster-stat">
              {entry.rating!=null?<span className="cup-roster-stat-item"><i>ELO</i>{entry.rating}</span>:<em>未評分</em>}
              {entry.handicap!=null&&cup.handicapMode==="suggested"&&<span className="cup-roster-stat-item"><i>建議讓分</i>{entry.handicap}</span>}
              {entry.arrival&&<span className="cup-roster-arrival"><i aria-hidden="true">🕒</i>{entry.arrival}</span>}
            </span>
          </div>
        </div>
      </li>)}</ul>
      <p className="cup-roster-note">{cup.handicapMode==="suggested"
        ?"建議讓分由球會 ELO 計出，本盃賽每場自動套用。"
        :"本盃賽不設讓分，所有對局平手打。"}</p>
    </section>}

    {/* The same chart the app draws. A reader who followed the link came to see the bracket, and a
        list of ties is not a bracket. */}
    {chart&&<CupBracketChart chart={chart} activeRound={liveRound}/>}

    {cup.rounds.filter(round=>round.ties.some(tie=>tie.state!=="dead")).map(round=><section className="cup-share-round" key={round.round}>
      <h3>{round.name}</h3>
      <ol className="cup-ties">{round.ties.filter(tie=>tie.state!=="dead").map(tie=><li className={`cup-tie ${tie.state}`} key={tie.index}>
        <div className="cup-tie-head"><span className="cup-tie-no">第 {tie.index} 場</span>
          {tie.handicap&&<span className="cup-tie-handicap">{tie.handicap}</span>}
          {tie.playedOn&&<time className="cup-tie-date" dateTime={tie.playedOn}>{tie.playedOn}</time>}</div>
        {tie.sides.map((side,index)=><div className={`cup-tie-side${side.won?" won":""}${side.player?"":" tbd"}`} key={index}>
          <PlayerBadge player={side.player??{short:"?"}}/>
          <b>{side.player?.name??"待定"}</b>
          {side.score!=null?<em>{side.score}</em>:side.won?<i aria-hidden="true">✓</i>:null}
        </div>)}
        {tie.note&&<p className="cup-tie-note">{tie.note}</p>}
      </li>)}</ol>
    </section>)}

    <p className="share-foot">{cta.hint}</p>
  </main>;
}
