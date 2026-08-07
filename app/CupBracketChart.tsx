"use client";
import { PlayerBadge } from "./UiBits";

/** The bracket, at a glance.
 *
 *  A knockout tree is the one graphic that makes a cup feel like a cup, and it has to appear in two
 *  places that have nothing else in common: inside the app, driven by a live `Bracket`, and on the
 *  public share page, driven by data already serialised for a reader with no account. So the chart
 *  takes neither — it takes seats. Each caller flattens its own world into this shape once, and the
 *  drawing (and its tap targets, its winner ring, its empty seats) exists exactly once.
 *
 *  Faces and scores only: it draws the *shape*, sized to fit any width, and the detailed tie cards
 *  below carry names, dates and actions. That split is what lets a 16-player bracket fit a 360px
 *  phone without shrinking a name to two characters. */

export type ChartPlayer = { name?:string; short:string; colour?:string|null; avatar?:string|null };
export type ChartSeat = { player:ChartPlayer|null; score:number|null; won:boolean };
export type ChartNode = { index:number; state:string; mine?:boolean; seats:ChartSeat[] };
export type ChartRound = { round:number; name:string; nodes:ChartNode[] };
export type BracketChartData = { rounds:ChartRound[]; champion:ChartPlayer|null };

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
        <div className={`cup-mini-round${round.round===total?" final":""}`} key={round.round}>
          {round.nodes.map(node=>{
            const dead=node.state==="dead";
            const className=`cup-mini-node ${node.state}${node.mine?" mine":""}${round.round===activeRound?" in-round":""}`;
            const seats=node.seats.map((seat,side)=>
              /* An empty seat is drawn as a hollow ring rather than a grey avatar: "nobody yet" and
                 "a player whose colour happens to be grey" must not look the same. */
              <span className={`cup-mini-seat${seat.won?" won":""}${seat.player?"":" vacant"}`} key={side}>
                {seat.player?<PlayerBadge player={seat.player}/>:<i aria-hidden="true"/>}
                {seat.score!=null?<em>{seat.score}</em>:null}
              </span>);
            const label=`${round.name} 第 ${node.index} 場`;
            /* Only interactive where a tap leads somewhere: a plain div on the share page keeps a
               screen reader from announcing a button that does nothing. */
            return onPick
              ?<button type="button" key={node.index} disabled={dead} className={className} aria-label={label}
                onClick={()=>onPick(round.round,node.index)}>{seats}</button>
              :<div key={node.index} className={className} aria-label={label} aria-hidden={dead||undefined}>{seats}</div>;
          })}
        </div>)}
      {chart.champion&&<div className="cup-mini-crown"><span aria-hidden="true">🏆</span><PlayerBadge player={chart.champion}/></div>}
    </div>
  </div>;
}
