"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CupMark, PlayerBadge } from "./UiBits";
import type { StoryBracketRound } from "../lib/story-card";
import { useT } from "./components/I18nProvider";
import type { Translator } from "../lib/i18n/translate";

/** The bracket, at a glance.
 *
 *  A knockout tree is the one graphic that makes a cup feel like a cup, and it has to appear in two
 *  places that have nothing else in common: inside the app, driven by a live `Bracket`, and on the
 *  public share page, driven by data already serialised for a reader with no account. So the chart
 *  takes neither — it takes seats. Each caller flattens its own world into this shape once, and the
 *  drawing (and its tap targets, its winner ring, its empty seats) exists exactly once.
 *
 *  ## Why it pages on a phone
 *
 *  A column-per-round tree cannot carry a name on a 360px phone: four rounds leaves roughly seventy
 *  pixels a column, which is an avatar and two characters. But a bracket without names is a diagram
 *  of a competition rather than a record of one — you cannot tell who is in it.
 *
 *  So on a phone the tree becomes a pager: each round is a near-full-width column with both names,
 *  both scores and the date, and the next round peeks in from the right edge so the reader knows to
 *  swipe. The elbows between columns are drawn at every width, so the shape of a knockout is never
 *  lost. From 821px every column fits at once and the same markup reads as the classic tree. */

export type ChartPlayer = { name?:string; short:string; colour?:string|null; avatar?:string|null };
export type ChartSeat = { player:ChartPlayer|null; score:number|null; won:boolean };
export type ChartNode = { index:number; state:string; mine?:boolean;
  /** ISO `YYYY-MM-DD`, or empty for a tie that has not been played. */
  date?:string; seats:ChartSeat[] };
export type ChartRound = { round:number; name:string; nodes:ChartNode[] };
export type BracketChartData = { rounds:ChartRound[]; champion:ChartPlayer|null };

/** Day and month only. The year is the same for every tie in a cup, so printing it four times a
    column spends the width that a name needs. */
function shortDate(value:string):string{
  return /^\d{4}-\d{2}-\d{2}/.test(value)?`${value.slice(5,7)}/${value.slice(8,10)}`:value;
}

/** An empty seat says which kind of empty it is. In a bye the other side simply walks through, and
    「待定」 there would promise an opponent who is never coming. */
const seatName=(t: Translator, player:ChartPlayer|null,state?:string)=>
  player?player.name||player.short:state==="bye"?t("輪空"):t("待定");

/** The same seats, in the shape the Instagram card draws.
 *
 *  Both surfaces show one bracket, so both read one flattening. The card cannot be tapped and has no
 *  colours to spare, so it takes names, scores and the winner and drops everything else. */
export function storyBracket(t: Translator, chart:BracketChartData):StoryBracketRound[]{
  return chart.rounds.map(round=>({
    name:round.name,
    ties:round.nodes.map(node=>({
      dead:node.state==="dead",
      /* 待定 is marked, not just named: on a freshly drawn cup the card draws the empty half of the
         tree faintly so the first-round pairings stay the thing you read. A bye is a real outcome,
         so it is not pending. */
      seats:node.seats.map(seat=>({name:seatName(t, seat.player,node.state),score:seat.score,won:seat.won,
        pending:!seat.player&&node.state!=="bye"})),
    })),
  }));
}

/** A tie in one of these states has already sent someone through, so its elbow lights up. */
const SETTLED_STATES=new Set(["played","walkover","bye"]);

/** First-round ties visible before a phone folds the tree. Four is a full quarter-final set, so a
    draw with four first-round ties never folds; a draw with eight (a 16-slot bracket) does, and the
    fold shows about four and a half of them, with the cut through the last one saying there is more
    below. */
const PEEK_TIES=4;

export default function CupBracketChart({chart,activeRound,onPick}:{
  chart:BracketChartData;
  /** Highlighted on its column — the round whose detail is showing below. */
  activeRound?:number;
  /** Omitted on the public page, where a node has nowhere to take a reader who cannot act. */
  onPick?:(round:number,index:number)=>void;
}){
  const t = useT();
  const treeRef=useRef<HTMLDivElement|null>(null);
  const treeId=useId();
  /* Folded by default, and only where the tree is taller than the phone wants. The fold is CSS
     (`cup-page.css`), so on a wide screen this state changes nothing. */
  const [expanded,setExpanded]=useState(false);
  const foldable=(chart.rounds[0]?.nodes.length??0)>PEEK_TIES;
  /* Paged on a phone: follow the active round so the column the reader is acting on stays in view.
     scrollTo on the tree itself, never scrollIntoView, so the page does not jump vertically. */
  useEffect(()=>{
    const tree=treeRef.current;
    if(!tree||activeRound==null||tree.scrollWidth<=tree.clientWidth)return;
    const column=tree.querySelector<HTMLElement>(`[data-round="${activeRound}"]`);
    if(column)tree.scrollTo({left:column.offsetLeft-tree.offsetLeft,behavior:"smooth"});
  },[activeRound]);
  if(!chart.rounds.length)return null;
  const total=chart.rounds.length;
  const folded=foldable&&!expanded;
  return <div className={`cup-mini${folded?" is-folded":""}`} role="group" aria-label={t("賽事對陣圖")}>
    <div className="cup-mini-tree" id={treeId} ref={treeRef}>
      {chart.rounds.map(round=>{
        const live=round.nodes.filter(node=>node.state!=="dead");
        const settled=live.filter(node=>SETTLED_STATES.has(node.state)).length;
        return <div className={`cup-mini-round${round.round===total?" final":""}${round.round===activeRound?" is-active":""}`} key={round.round} data-round={round.round}>
          <h4 className="cup-mini-round-name"><span>{round.name}</span><small aria-hidden="true">{settled}/{live.length}</small></h4>
          <div className="cup-mini-nodes">
          {round.nodes.map(node=>{
            const dead=node.state==="dead";
            const decided=node.seats.some(seat=>seat.won);
            const className=`cup-mini-node ${node.state}${node.mine?" mine":""}${round.round===activeRound?" in-round":""}`;
            /* Each node sits in an equal-height cell, and the cell rather than the node draws the elbow
               to the next round — so a pair's lines meet exactly between them however tall a node is. */
            const cell=`cup-mini-cell${dead?" is-dead":""}${SETTLED_STATES.has(node.state)?" is-settled":""}${node.seats.some(seat=>seat.player)?" has-entrant":""}`;
            const seats=node.seats.map((seat,side)=>
              /* An empty seat is drawn as a hollow ring rather than a grey avatar: "nobody yet" and
                 "a player whose colour happens to be grey" must not look the same. */
              <span className={`cup-mini-seat${seat.won?" won":""}${seat.player?"":" vacant"}${decided&&!seat.won&&seat.player?" lost":""}`} key={side}>
                {seat.player?<PlayerBadge player={seat.player}/>:<i aria-hidden="true"/>}
                {/* min-width:0 on the name is what keeps the tree inside its column: it ellipsizes
                    rather than pushing the score off the right edge. */}
                <b className="cup-mini-name">{seatName(t, seat.player,node.state)}</b>
                {seat.score!=null?<em>{seat.score}</em>:null}
              </span>);
            const names=node.seats.map(seat=>seatName(t, seat.player,node.state)).join(t(" 對 "));
            const label=t("{name} 第 {index} 場，{names}{v}", {name: round.name, index: node.index, names, v: node.date?t("，{date}", {date: node.date}):""});
            const body=<>
              {seats}
              {node.date&&!dead
                ?<time className="cup-mini-date" dateTime={node.date}>{shortDate(node.date)}</time>
                :null}
            </>;
            /* Only interactive where a tap leads somewhere: a plain div on the share page keeps a
               screen reader from announcing a button that does nothing. */
            return <div className={cell} key={node.index}>{onPick
              ?<button type="button" disabled={dead} className={className} aria-label={label}
                onClick={()=>onPick(round.round,node.index)}>{body}</button>
              :<div className={className} aria-label={label} aria-hidden={dead||undefined}>{body}</div>}</div>;
          })}
          </div>
        </div>;
      })}
      {/* The trophy waits at the end of the tree from the day of the draw: an empty plinth says what
          the whole thing is for, and fills with a face the moment the final is settled. */}
      <div className={`cup-mini-crown${chart.champion?" is-crowned":""}`}>
        <span className="cup-mini-crown-mark" aria-hidden="true"><CupMark/></span>
        {chart.champion
          ?<><PlayerBadge player={chart.champion}/><b>{seatName(t, chart.champion)}</b></>
          :<b className="is-pending">{t("待定")}</b>}
      </div>
    </div>
    {/* Only a phone folds, so the control is hidden at wider widths by the stylesheet. It sits in the
        fade when folded and below the tree when open. */}
    {foldable&&<button type="button" className="cup-mini-toggle" aria-controls={treeId} aria-expanded={expanded}
      onClick={()=>setExpanded(open=>!open)}>{expanded?t("收起"):t("展開對陣圖")}</button>}
  </div>;
}
