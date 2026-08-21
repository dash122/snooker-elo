"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./components/ui/Primitives";

export type SortKey = "rank"|"name"|"rating"|"change"|"form"|"official"|"suggested"|"games"|"winRate"|"frameRate";
export type EloTrendPoint = {
  id:string; elo:number; before:number; delta:number; date:string;
  opponent:string; opponentShort:string; score:string; result:"W"|"L"|"D"|"start";
};
export const sortLabels:Record<SortKey,string>={rank:"排名",name:"球員",rating:"ELO",change:"近10天ELO變化",form:"近況",official:"正式評分",suggested:"建議評分",games:"場數",winRate:"勝率",frameRate:"局數勝率"};

/**
 * The primary navigation's five icons share a quiet matchroom vocabulary:
 * podium, scorecard, calendar slot, roster and rating dial. They stay as
 * crisp geometry rather than literal snooker illustrations so the set remains
 * legible at the 20px size used by both desktop and mobile navigation.
 */
export function NavIcon({id,active}:{id:"leaderboard"|"matches"|"availability"|"players"|"settings";active:boolean}) {
  const line={fill:"none",stroke:"currentColor",strokeWidth:1.75,strokeLinecap:"round" as const,strokeLinejoin:"round" as const};
  const activeMark={...line,fill:active?"currentColor":"none"};
  const svgProps={width:21,height:21,viewBox:"0 0 24 24","aria-hidden":true,focusable:"false" as const};
  switch(id){
    case "leaderboard":return <svg {...svgProps}>
      <path d="M3.5 19.5h17" {...line}/>
      <rect x="5" y="12" width="4" height="7.5" rx="1" {...line}/>
      <rect x="10" y="8" width="4" height="11.5" rx="1" {...line}/>
      <rect x="15" y="4.5" width="4" height="15" rx="1" {...activeMark}/>
    </svg>;
    case "matches":return <svg {...svgProps}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" {...line}/>
      <path d="M5.5 9h13M12 9v8M6.5 12.5h3M14.5 12.5h3M6.5 16h3M14.5 16h3" {...line}/>
      <circle cx="8" cy="7" r="1" {...activeMark}/><circle cx="16" cy="7" r="1" {...activeMark}/>
    </svg>;
    case "availability":return <svg {...svgProps}>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" {...line}/>
      <path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" {...line}/>
      <circle cx="16" cy="16.5" r="1.05" {...activeMark}/>
    </svg>;
    case "players":return <svg {...svgProps}>
      <circle cx="9" cy="8" r="3.1" {...activeMark}/>
      <path d="M3.5 19.5c.2-3.4 2.3-5.5 5.5-5.5 2.2 0 3.9.9 4.8 2.6" {...line}/>
      <circle cx="16.5" cy="9" r="2.4" {...line}/>
      <path d="M13.8 15.3c.8-.8 1.8-1.3 3.1-1.3 2.3 0 3.8 1.8 4.1 5.5" {...line}/>
    </svg>;
    case "settings":return <svg {...svgProps}>
      <circle cx="12" cy="12" r="4.2" {...line}/>
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2" {...line}/>
      <circle cx="12" cy="12" r="1.15" {...activeMark}/>
    </svg>;
  }
}

import { AVATAR_COLOURS, DEFAULT_AVATAR, avatarHex, avatarStyle } from "./avatar-colours";
export { AVATAR_COLOURS, DEFAULT_AVATAR, avatarHex, avatarStyle };

/**
 * The one place a player's identity badge is drawn. Every list, card, chart and
 * head-to-head goes through here, so an uploaded photo or a new colour picked
 * on the account page shows up identically across the app. The element stays an
 * `<i>` because the surrounding CSS (.person>i, .profile-head>i, …) is what
 * sizes it for each context.
 */
export function PlayerBadge({player,className}:{player:{short?:string|null;colour?:string|null;avatar?:string|null};className?:string}) {
  const initials=(player.short??"").toUpperCase()||"?";
  if(player.avatar) return <i className={`player-badge has-photo${className?` ${className}`:""}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed */}
    <img src={player.avatar} alt="" />
  </i>;
  return <i className={`player-badge${className?` ${className}`:""}`} style={avatarStyle(player.colour)}>{initials}</i>;
}

/**
 * Type-ahead player picker. A native <select> is fine for a handful of names
 * but forces scrolling an alphabetical list as the roster grows; this filters
 * by typed text instead, the way Contacts/Messages "To:" fields do. Pass
 * `renderTrigger` to show a rich display (avatar, ELO) when closed and only
 * swap to the search input once opened — used by the match-entry form.
 */
export function PlayerCombobox<P extends {id:string;name:string}>({players,value,onChange,placeholder,ariaLabel,allowClear,clearLabel,renderTrigger,autoOpenSignal}:{
  players:P[];value:string;onChange:(id:string)=>void;placeholder:string;ariaLabel:string;
  allowClear?:boolean;clearLabel?:string;renderTrigger?:(selected:P|undefined,open:()=>void)=>ReactNode;
  // Bump this (e.g. a counter) to force the picker open imperatively — used to
  // advance focus to "opponent" the instant "player" is chosen, so a two-step
  // pick reads as one continuous motion instead of two separate taps.
  autoOpenSignal?:number;
}) {
  const [query,setQuery]=useState("");
  const [open,setOpen]=useState(false);
  const inputRef=useRef<HTMLInputElement>(null);
  const containerRef=useRef<HTMLDivElement>(null);
  const selected=players.find(p=>p.id===value);
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return q?players.filter(p=>p.name.toLowerCase().includes(q)):players;
  },[players,query]);
  useEffect(()=>{
    if(!open)return;
    const handler=(event:MouseEvent)=>{if(containerRef.current&&!containerRef.current.contains(event.target as Node))setOpen(false)};
    document.addEventListener("mousedown",handler);
    return ()=>document.removeEventListener("mousedown",handler);
  },[open]);
  const startOpen=()=>{setQuery("");setOpen(true);requestAnimationFrame(()=>inputRef.current?.focus())};
  useEffect(()=>{
    if(autoOpenSignal)startOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[autoOpenSignal]);
  const pick=(id:string)=>{onChange(id);setQuery("");setOpen(false)};
  return <div className={`player-combobox${renderTrigger?" as-trigger":""}`} ref={containerRef}>
    {renderTrigger&&!open?renderTrigger(selected,startOpen):
      <input ref={inputRef} type="text" role="combobox" aria-expanded={open} aria-label={ariaLabel} placeholder={placeholder} autoComplete="off"
        value={open?query:(selected?.name??"")}
        onFocus={()=>{if(!open){setQuery("");setOpen(true)}}}
        onChange={event=>{setQuery(event.target.value);setOpen(true)}}
        onKeyDown={event=>{
          if(event.key==="Escape")setOpen(false);
          if(event.key==="Enter"&&filtered.length===1){pick(filtered[0].id);event.preventDefault()}
        }}/>}
    {open&&<ul className="player-combobox-list" role="listbox">
      {allowClear&&<li role="option" aria-selected={!value}><button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>pick("")}>{clearLabel??placeholder}</button></li>}
      {filtered.length===0?<li className="player-combobox-empty">沒有符合的球員</li>:filtered.map(p=><li key={p.id} role="option" aria-selected={p.id===value}><button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>pick(p.id)}>{p.name}</button></li>)}
    </ul>}
  </div>;
}

/**
 * The scoreline is the reason both the match list and head-to-head exist, so
 * both render it through here: same size, same winner treatment, no drift.
 */
export function Scoreline({left,right,scoreLeft,scoreRight,eloLeft,eloRight,onLeftClick,onRightClick}:{left:string;right:string;scoreLeft:number;scoreRight:number;eloLeft?:{before:number;after:number;delta:number};eloRight?:{before:number;after:number;delta:number};onLeftClick?:()=>void;onRightClick?:()=>void}) {
  const leftWins=scoreLeft>scoreRight,rightWins=scoreRight>scoreLeft,drawn=scoreLeft===scoreRight;
  const side=(wins:boolean)=>drawn?"drawn":wins?"winner":"loser";
  return <div className={`scoreline${eloLeft||eloRight?" with-elo":""}`} role="group" aria-label={`${left} ${scoreLeft} 比 ${scoreRight} ${right}${drawn?"，和局":`，${leftWins?left:right} 勝`}`}>
    {onLeftClick?<button type="button" className={`scoreline-name ${side(leftWins)}`} onClick={onLeftClick}>{left}</button>:<span className={`scoreline-name ${side(leftWins)}`}>{left}</span>}
    <b className={side(leftWins)}>{scoreLeft}</b>
    <em aria-hidden="true">–</em>
    <b className={side(rightWins)}>{scoreRight}</b>
    {onRightClick?<button type="button" className={`scoreline-name right ${side(rightWins)}`} onClick={onRightClick}>{right}</button>:<span className={`scoreline-name right ${side(rightWins)}`}>{right}</span>}
    {eloLeft&&<small className={`scoreline-delta ${eloLeft.delta>=0?"positive":"negative"}`}>ELO {eloLeft.delta>=0?"+":""}{Math.round(eloLeft.delta)}</small>}
    {eloRight&&<small className={`scoreline-delta right ${eloRight.delta>=0?"positive":"negative"}`}>ELO {eloRight.delta>=0?"+":""}{Math.round(eloRight.delta)}</small>}
    {eloLeft&&<small className={`scoreline-elo ${eloLeft.delta>=0?"positive":"negative"}`}>{Math.round(eloLeft.before)} <i aria-hidden="true">→</i> {Math.round(eloLeft.after)}</small>}
    {eloRight&&<small className={`scoreline-elo right ${eloRight.delta>=0?"positive":"negative"}`}>{Math.round(eloRight.before)} <i aria-hidden="true">→</i> {Math.round(eloRight.after)}</small>}
  </div>;
}

/** The club's trophy mark, at whatever size its container gives it.
 *
 *  Drawn rather than typed, and defined once. An emoji would render as whichever colour emoji font
 *  the device happens to carry — and, worse, as a different mark in the app than in the story card
 *  the app exports, which rasterises its own path. The match card's cup badge, the share pages'
 *  ribbon and the profile's honour chip are meant to read as one system, so they take one mark. */
export function CupMark({className="cup-mark"}:{className?:string}) {
  return <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M4.5 3h11v3.5a5.5 5.5 0 0 1-11 0Z"/>
    <path d="M4.5 3.8C2.4 3.8 2.4 8.2 4.9 8" fill="none" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M15.5 3.8c2.1 0 2.1 4.4-.4 4.2" fill="none" stroke="currentColor" strokeWidth="1.4"/>
    <rect x="8.8" y="11.6" width="2.4" height="2.6"/><rect x="6" y="14" width="8" height="1.9" rx=".9"/>
  </svg>;
}

export function SortControls({sort,dir,onSort}:{sort:SortKey;dir:"asc"|"desc";onSort:(key:SortKey)=>void}) {
  return <div className="sort-controls"><label><span className="sort-controls-label">排序</span><select value={sort} onChange={event=>onSort(event.target.value as SortKey)}>{(Object.keys(sortLabels) as SortKey[]).map(key=><option key={key} value={key}>{sortLabels[key]}</option>)}</select></label><button aria-label={dir==="asc"?"目前升序，切換為降序":"目前降序，切換為升序"} onClick={()=>onSort(sort)}>{dir==="asc"?"↑":"↓"}<span className="sort-controls-dir-label">{dir==="asc"?" 升序":" 降序"}</span></button></div>;
}

export function SortArrow({active,dir}:{active:boolean;dir:"asc"|"desc"}) {
  return <i className={`sort-arrow ${active?"active":""}`} aria-hidden="true">{active?(dir==="asc"?"↑":"↓"):"↕"}</i>;
}

export function Sparkline({values,label}:{values:number[];label:string}) {
  const min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min);
  const points=values.map((v,i)=>`${values.length===1?50:i/(values.length-1)*100},${28-(v-min)/range*24}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 32" role="img" aria-label={`${label}；由 ${Math.round(values[0])} 至 ${Math.round(values.at(-1)??values[0])}`}><polyline points={points}/><circle cx={values.length===1?50:100} cy={28-((values.at(-1)??min)-min)/range*24} r="2.5"/></svg>;
}

export type CalibrationHistoryPoint = { estimate:number; usableMatches:number; at:string };

/**
 * The calibration trend answers one question: "is the handicap-to-ELO exchange
 * rate settled, and what is it worth right now?". The old chart plotted bare
 * estimates with no axis, so it could not answer either half. This one labels
 * the scale, shows the plausible range as a band the line sits inside, and
 * translates the number into a concrete handicap the reader recognises.
 */
export function CalibrationTrend({history,lower,upper,conversion,confidence,example}:{history:CalibrationHistoryPoint[];lower:number;upper:number;conversion:number;confidence:string;example:{points:number;elo:number}}) {
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const estimates=history.map(point=>point.estimate);
  const domain=[...estimates,lower,upper];
  const rawMin=Math.min(...domain),rawMax=Math.max(...domain);
  // A negative exchange rate is meaningless, so padding never pushes the floor
  // below zero — an axis tick of "-1 ELO／分" reads as a broken chart.
  const span=Math.max(.5,rawMax-rawMin),min=Math.max(0,rawMin-span*.2),max=rawMax+span*.2;
  const x=(index:number)=>history.length===1?50:6+index/(history.length-1)*88;
  const y=(value:number)=>52-(value-min)/(max-min)*44;
  const line=history.map((point,index)=>`${x(index)},${y(point.estimate)}`).join(" ");
  const current=estimates.at(-1)??conversion,first=estimates[0];
  const change=current-first;
  // "Settled" is about the recent walk, not the whole history: a rate that moved
  // early and then stopped is stable, and that is what a reader wants to know.
  const recent=estimates.slice(-5);
  const drift=Math.max(...recent)-Math.min(...recent);
  const settled=drift<=.25;
  const active=activeIndex==null?null:history[activeIndex];
  const day=(iso:string)=>{const d=new Date(iso);return `${d.getMonth()+1}/${d.getDate()}`};
  const firstDay=day(history[0].at),lastDay=day(history.at(-1)!.at);
  const ticks=[max,(max+min)/2,min];
  // Early on, the best-fit rate can sit outside the range the data can defend.
  // Saying so is more useful than letting the line float above an unexplained band.
  const outsideBand=current<lower||current>upper;
  return <section className="calibration-trend">
    <div className="calibration-trend-head">
      <div><p className="kicker">模型演變</p><h2>換算率校準趨勢</h2></div>
      <span className={`calibration-state ${settled?"steady":"moving"}`}>{settled?"● 已趨穩定":"● 仍在調整"}</span>
    </div>
    <div className="calibration-readout">
      <div><small>目前換算率</small><b>{conversion}<em>ELO／分</em></b></div>
      <div><small>自首次校準</small><b className={change>=0?"positive":"negative"}>{change>=0?"+":""}{Math.round(change*100)/100}<em>ELO／分</em></b></div>
      <div><small>合理範圍</small><b>{lower}–{upper}<em>校準信心 {confidence}</em></b></div>
    </div>
    <div className="calibration-plot">
      <div className="calibration-axis-y">{ticks.map(tick=><span key={tick}>{Math.round(tick*10)/10}</span>)}</div>
      <div className="calibration-canvas" onPointerLeave={()=>setActiveIndex(null)}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={`換算率校準趨勢，由 ${first} 變至 ${current} ELO／分，目前合理範圍 ${lower} 至 ${upper}`}>
          {ticks.map(tick=><line key={tick} x1="6" y1={y(tick)} x2="94" y2={y(tick)} className="calibration-grid"/>)}
          <rect x="6" y={y(upper)} width="88" height={Math.max(.6,y(lower)-y(upper))} className="calibration-band"/>
          <polyline points={line} className="calibration-line"/>
          {active&&<line x1={x(activeIndex!)} y1="4" x2={x(activeIndex!)} y2="54" className="calibration-guide"/>}
        </svg>
        {history.map((point,index)=><button key={`${point.at}-${index}`} type="button"
          className={`calibration-point${index===history.length-1?" current":""}${activeIndex===index?" active":""}`}
          style={{left:`${x(index)}%`,top:`${y(point.estimate)/60*100}%`}}
          onPointerEnter={()=>setActiveIndex(index)} onFocus={()=>setActiveIndex(index)} onBlur={()=>setActiveIndex(null)}
          onClick={()=>setActiveIndex(previous=>previous===index?null:index)}
          aria-label={`第 ${index+1} 次校準，${point.at.slice(0,10)}，估算 ${point.estimate} ELO／分，依據 ${point.usableMatches} 筆記錄`}/>)}
        {active&&<div className={`calibration-tip ${x(activeIndex!)>68?"align-right":x(activeIndex!)<32?"align-left":""}`} style={{left:`${x(activeIndex!)}%`,top:`${Math.max(2,y(active.estimate)/60*100-8)}%`}} role="status">
          <small>{active.at.slice(0,10)}</small><b>{active.estimate} ELO／分</b><span>依據 {active.usableMatches} 筆可用記錄</span>
        </div>}
      </div>
      <div className="calibration-axis-x"><span>{firstDay}</span><span>{history.length} 次校準</span><span>{firstDay===lastDay?"同日":lastDay}</span></div>
    </div>
    <div className="calibration-legend"><span className="legend-line">每次校準的估算</span><span className="legend-band">目前合理範圍</span></div>
    <p className="calibration-meaning">
      現時<b>每讓 1 分約值 {conversion} ELO</b>，即讓 {example.points} 分相當於 <b>{example.elo} ELO</b> 的實力差距。
      {settled
        ?`最近五次估算只在 ${Math.round(drift*100)/100} 之內浮動，換算率已大致穩定。`
        :`最近五次估算仍有 ${Math.round(drift*100)/100} 的浮動，累積更多不同讓分的賽果後會更穩定。`}
      {change>=0
        ?"與首次校準相比，系統認為同樣的讓分代表更大的實力差距。"
        :"與首次校準相比，系統認為同樣的讓分代表較小的實力差距。"}
    </p>
    {outsideBand&&<p className="calibration-caution">目前換算率仍在向資料支持的範圍（{lower}–{upper}）靠攏。系統每次只作小幅調整，避免單一批賽果造成大幅波動。</p>}
  </section>;
}

export function InteractiveEloChart({points,label}:{points:EloTrendPoint[];label:string}) {
  const [range,setRange]=useState<"recent"|"all">("recent");
  const [activeId,setActiveId]=useState<string|null>(null);
  const recentMatches=points.filter(point=>point.result!=="start").slice(-10);
  const recentStart=recentMatches[0]
    ? {...recentMatches[0],id:`${recentMatches[0].id}-recent-start`,elo:recentMatches[0].before,before:recentMatches[0].before,delta:0,result:"start" as const}
    : points[0];
  const visible=range==="recent"&&recentMatches.length
    ? [recentStart,...recentMatches]
    : points;
  const values=visible.map(point=>point.elo),rawMin=Math.min(...values),rawMax=Math.max(...values);
  const observed=Math.max(1,rawMax-rawMin),visualRange=Math.max(24,observed*1.32);
  const middle=(rawMin+rawMax)/2,min=middle-visualRange/2,max=middle+visualRange/2;
  const x=(index:number)=>visible.length===1?50:5+index/(visible.length-1)*90;
  const y=(value:number)=>54-(value-min)/(max-min)*46;
  const polyline=visible.map((point,index)=>`${x(index)},${y(point.elo)}`).join(" ");
  const area=`M ${x(0)} 56 L ${visible.map((point,index)=>`${x(index)} ${y(point.elo)}`).join(" L ")} L ${x(visible.length-1)} 56 Z`;
  const active=visible.find(point=>point.id===activeId)??null;
  const activeIndex=active?visible.findIndex(point=>point.id===active.id):-1;
  const periodChange=visible.at(-1)!.elo-visible[0].elo;
  const resultLabel=(result:EloTrendPoint["result"])=>result==="W"?"勝":result==="L"?"負":result==="D"?"和":"起始";
  return <div className="interactive-trend">
    <div className="trend-overview"><div><small>{range==="recent"?"最近十場":"完整記錄"}</small><b className={periodChange>=0?"positive":"negative"}>{periodChange>=0?"+":""}{Math.round(periodChange)} <em>ELO</em></b></div><div className="mini-toggle" aria-label="ELO 走勢範圍"><button className={range==="recent"?"active":""} onClick={()=>{setRange("recent");setActiveId(null)}}>最近十場</button><button className={range==="all"?"active":""} onClick={()=>{setRange("all");setActiveId(null)}}>全部</button></div></div>
    <div className="trend-plot" onPointerLeave={()=>setActiveId(null)}>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={label}>
        <defs><linearGradient id="elo-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#287e69" stopOpacity=".28"/><stop offset="100%" stopColor="#287e69" stopOpacity=".02"/></linearGradient></defs>
        {[8,31,54].map(line=><line key={line} x1="5" y1={line} x2="95" y2={line} className="trend-grid"/>)}
        <path d={area} className="trend-area"/><polyline points={polyline} className="trend-line"/>
        {active&&<line x1={x(activeIndex)} y1="6" x2={x(activeIndex)} y2="56" className="trend-guide"/>}
      </svg>
      {visible.map((point,index)=><button key={point.id} className={`trend-point ${point.result==="start"?"start":point.result.toLowerCase()} ${activeId===point.id?"active":""}`} style={{left:`${x(index)}%`,top:`${y(point.elo)/60*100}%`}} onPointerEnter={()=>setActiveId(point.id)} onFocus={()=>setActiveId(point.id)} onBlur={()=>setActiveId(null)} onClick={()=>setActiveId(current=>current===point.id?null:point.id)} aria-label={point.result==="start"?`起始 ELO ${Math.round(point.elo)}`:`${point.date}，${resultLabel(point.result)} ${point.opponent} ${point.score}，ELO ${point.delta>=0?"上升":"下降"} ${Math.abs(Math.round(point.delta))} 至 ${Math.round(point.elo)}`}/>)}
      {active&&<div className={`trend-tooltip ${x(activeIndex)>70?"align-right":x(activeIndex)<30?"align-left":""}`} style={{left:`${x(activeIndex)}%`,top:`${Math.max(3,y(active.elo)/60*100-7)}%`}} role="status"><small>{active.result==="start"?"評分起點":active.date}</small><b>{active.result==="start"?"起始 ELO":`${resultLabel(active.result)} ${active.opponent} ${active.score}`}</b><span>{active.result==="start"?Math.round(active.elo):<>{Math.round(active.before)} → {Math.round(active.elo)} <strong className={active.delta>=0?"positive":"negative"}>{active.delta>=0?"+":""}{Math.round(active.delta)}</strong></>}</span></div>}
    </div>
    <div className="trend-scale"><span>{Math.round(max)}</span><span>{Math.round(middle)}</span><span>{Math.round(min)}</span></div>
    <p className="trend-help">移至或點按資料點，查看該場對手、比分與 ELO 變化。</p>
  </div>;
}

export function RecentMatches({points,onViewAll,onMatch}:{points:EloTrendPoint[];onViewAll?:()=>void;onMatch:(matchId:string)=>void}) {
  const matches=points.filter(point=>point.result!=="start").slice(-5).reverse();
  return <section className="profile-section recent-form" aria-labelledby="recent-form-title"><div className="profile-section-head"><div><p className="kicker">近期狀態</p><h3 id="recent-form-title">最近五場</h3></div>{onViewAll&&<button type="button" className="recent-form-action in-head" onClick={onViewAll}><span>查看所有賽事</span><i aria-hidden="true">→</i></button>}</div>{matches.length===0?<p className="recent-form-empty">尚未有比賽記錄</p>:<div className="recent-match-grid">{matches.map(point=><button type="button" className={`recent-result ${point.result.toLowerCase()}`} key={point.id} onClick={()=>onMatch(point.id)} aria-label={`查看對 ${point.opponent} 的賽事：${point.score}`}><div><b>{point.result==="W"?"勝":point.result==="L"?"負":"和"}</b><time>{point.date.slice(5).replace("-","/")}</time></div><strong>{point.score}</strong><span><i>{point.opponentShort}</i>{point.opponent}</span><small className={point.delta>=0?"positive":"negative"}>{point.delta>=0?"+":""}{Math.round(point.delta)} ELO</small></button>)}</div>}</section>;
}

export function Empty({text,sub}:{text:string;sub:string}) {
  return <div className="empty"><b>○</b><h3>{text}</h3><p>{sub}</p></div>;
}

export function Term({label,tip}:{label:string;tip:string}) {
  return <span className="term" tabIndex={0} aria-label={`${label}：${tip}`}>{label}<i aria-hidden="true">ⓘ</i><span className="term-tip" role="tooltip">{tip}</span></span>;
}

export function PlayerForm({form,setForm,editing,canEditRating=false,onSave}:{form:any;setForm:any;editing:boolean;canEditRating?:boolean;onSave:()=>void}) {
  const update=(key:string,value:string)=>setForm((current:any)=>({...current,[key]:value}));
  return <><p className="kicker">公開管理</p><h2>{editing?"編輯球員":"新增球員"}</h2><p className="sub">所有球員沒有賽事記錄時會使用預設起始 ELO；管理員也可以為個別球員設定自己的起始 ELO。</p><label>顯示名稱<input value={form.name} onChange={event=>update("name",event.target.value)}/></label><label>短名稱／縮寫<input maxLength={3} value={form.short} onChange={event=>update("short",event.target.value)}/></label>{canEditRating&&<label>個人起始 ELO<input type="number" min="1000" max="3000" step="10" value={form.rating} onChange={event=>update("rating",event.target.value)}/><small>儲存後會從此起始值重播這位球員的歷史賽事。</small></label>}<label>正式讓分<input type="number" step="2" value={form.handicap} onChange={event=>update("handicap",event.target.value)}/></label>
    <div className="colour-field"><span className="colour-field-label">圖示顏色</span>
      <div className="colour-preview"><i style={avatarStyle(form.colour)}>{(form.short||"?").toUpperCase().slice(0,3)}</i><small>{AVATAR_COLOURS.find(option=>option.id===(form.colour||DEFAULT_AVATAR))?.name}</small></div>
      <div className="colour-grid" role="radiogroup" aria-label="圖示顏色">{AVATAR_COLOURS.map(option=><button key={option.id} type="button" role="radio" aria-checked={(form.colour||DEFAULT_AVATAR)===option.id} aria-label={option.name} title={option.name} className={`colour-swatch${(form.colour||DEFAULT_AVATAR)===option.id?" active":""}`} style={{background:option.hex}} onClick={()=>update("colour",option.id)}/>)}</div>
    </div>
    <Button className="full" onClick={onSave}>{editing?"儲存並重播":"新增球員"}</Button></>;
}
