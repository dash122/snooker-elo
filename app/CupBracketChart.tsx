"use client";
import { PlayerBadge } from "./UiBits";
import type { StoryBracketRound } from "../lib/story-card";

/** The bracket, at a glance.
 *
 *  A knockout tree is the one graphic that makes a cup feel like a cup, and it has to appear in two
 *  places that have nothing else in common: inside the app, driven by a live `Bracket`, and on the
 *  public share page, driven by data already serialised for a reader with no account. So the chart
 *  takes neither — it takes seats. Each caller flattens its own world into this shape once, and the
 *  drawing (and its tap targets, its winner ring, its empty seats) exists exactly once.
 *
 *  ## Why it stacks before it branches
 *
 *  A column-per-round tree cannot carry a name on a 360px phone: four rounds leaves roughly seventy
 *  pixels a column, which is an avatar and two characters. But a bracket without names is a diagram
 *  of a competition rather than a record of one — you cannot tell who is in it.
 *
 *  So the mobile layout is the honest one: rounds stack down the page, each tie a full-width row
 *  with both names, both scores and the date it was played. From 640px there is room to branch, and
 *  the same markup becomes the classic left-to-right tree with the round rail across the top. No
 *  horizontal scrolling at any width — the moment this needs a scrollbar it stops being an overview. */

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
const seatName=(player:ChartPlayer|null,state?:string)=>
  player?player.name||player.short:state==="bye"?"輪空":"待定";

/** The same seats, in the shape the Instagram card draws.
 *
 *  Both surfaces show one bracket, so both read one flattening. The card cannot be tapped and has no
 *  colours to spare, so it takes names, scores and the winner and drops everything else. */
export function storyBracket(chart:BracketChartData):StoryBracketRound[]{
  return chart.rounds.map(round=>({
    name:round.name,
    ties:round.nodes.map(node=>({
      dead:node.state==="dead",
      /* 待定 is marked, not just named: on a freshly drawn cup the card draws the empty half of the
         tree faintly so the first-round pairings stay the thing you read. A bye is a real outcome,
         so it is not pending. */
      seats:node.seats.map(seat=>({name:seatName(seat.player,node.state),score:seat.score,won:seat.won,
        pending:!seat.player&&node.state!=="bye"})),
    })),
  }));
}

export default function CupBracketChart({chart,activeRound,onPick}:{
  chart:BracketChartData;
  /** Highlighted in the rail and on its column — the round whose detail is showing below. */
  activeRound?:number;
  /** Omitted on the public page, where a node has nowhere to take a reader who cannot act. */
  onPick?:(round:number,index:number)=>void;
}){
  if(!chart.rounds.length)return null;
  const total=chart.rounds.length;
  return <div className="cup-mini" role="group" aria-label="賽事對陣圖">
    <div className="cup-mini-rail" aria-hidden="true">{chart.rounds.map(round=>
      <span key={round.round} className={round.round===activeRound?"active":""}>{round.name}</span>)}</div>
    <div className="cup-mini-tree">
      {chart.rounds.map(round=>
        <div className={`cup-mini-round${round.round===total?" final":""}${round.round===activeRound?" is-active":""}`} key={round.round}>
          {/* The rail says this on the wide layout; stacked, each round has to name itself. Only one
              of the two is ever visible, so a screen reader hears the round once. */}
          <h4 className="cup-mini-round-name">{round.name}</h4>
          <div className="cup-mini-nodes">
          {round.nodes.map(node=>{
            const dead=node.state==="dead";
            const className=`cup-mini-node ${node.state}${node.mine?" mine":""}${round.round===activeRound?" in-round":""}`;
            const seats=node.seats.map((seat,side)=>
              /* An empty seat is drawn as a hollow ring rather than a grey avatar: "nobody yet" and
                 "a player whose colour happens to be grey" must not look the same. */
              <span className={`cup-mini-seat${seat.won?" won":""}${seat.player?"":" vacant"}`} key={side}>
                {seat.player?<PlayerBadge player={seat.player}/>:<i aria-hidden="true"/>}
                {/* min-width:0 on the name is what keeps the tree inside its column: it ellipsizes
                    rather than pushing the score off the right edge. */}
                <b className="cup-mini-name">{seatName(seat.player,node.state)}</b>
                {seat.score!=null?<em>{seat.score}</em>:null}
              </span>);
            const names=node.seats.map(seat=>seatName(seat.player,node.state)).join(" 對 ");
            const label=`${round.name} 第 ${node.index} 場，${names}${node.date?`，${node.date}`:""}`;
            const body=<>
              {seats}
              {node.date&&!dead
                ?<time className="cup-mini-date" dateTime={node.date}>{shortDate(node.date)}</time>
                :null}
            </>;
            /* Only interactive where a tap leads somewhere: a plain div on the share page keeps a
               screen reader from announcing a button that does nothing. */
            return onPick
              ?<button type="button" key={node.index} disabled={dead} className={className} aria-label={label}
                onClick={()=>onPick(round.round,node.index)}>{body}</button>
              :<div key={node.index} className={className} aria-label={label} aria-hidden={dead||undefined}>{body}</div>;
          })}
          </div>
        </div>)}
      {chart.champion&&<div className="cup-mini-crown">
        <span aria-hidden="true">🏆</span>
        <PlayerBadge player={chart.champion}/>
        <b>{seatName(chart.champion)}</b>
      </div>}
    </div>
  </div>;
}
