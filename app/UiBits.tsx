"use client";

import { useState } from "react";

export type SortKey = "rank"|"name"|"rating"|"change"|"form"|"official"|"suggested"|"games"|"winRate"|"frameRate";
export type EloTrendPoint = {
  id:string; elo:number; before:number; delta:number; date:string;
  opponent:string; opponentShort:string; score:string; result:"W"|"L"|"D"|"start";
};
export const sortLabels:Record<SortKey,string>={rank:"排名",name:"球員",rating:"ELO",change:"最近變化",form:"近況",official:"正式評分",suggested:"建議評分",games:"場數",winRate:"勝率",frameRate:"局數勝率"};

export function SortControls({sort,dir,onSort}:{sort:SortKey;dir:"asc"|"desc";onSort:(key:SortKey)=>void}) {
  return <div className="sort-controls"><label>排序<select value={sort} onChange={event=>onSort(event.target.value as SortKey)}>{(Object.keys(sortLabels) as SortKey[]).map(key=><option key={key} value={key}>{sortLabels[key]}</option>)}</select></label><button aria-label={dir==="asc"?"目前升序，切換為降序":"目前降序，切換為升序"} onClick={()=>onSort(sort)}>{dir==="asc"?"↑ 升序":"↓ 降序"}</button></div>;
}

export function SortArrow({active,dir}:{active:boolean;dir:"asc"|"desc"}) {
  return <i className={`sort-arrow ${active?"active":""}`} aria-hidden="true">{active?(dir==="asc"?"↑":"↓"):"↕"}</i>;
}

export function Sparkline({values,label}:{values:number[];label:string}) {
  const min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min);
  const points=values.map((v,i)=>`${values.length===1?50:i/(values.length-1)*100},${28-(v-min)/range*24}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 32" role="img" aria-label={`${label}；由 ${Math.round(values[0])} 至 ${Math.round(values.at(-1)??values[0])}`}><polyline points={points}/><circle cx={values.length===1?50:100} cy={28-((values.at(-1)??min)-min)/range*24} r="2.5"/></svg>;
}

export function LineChart({values,label,lower,upper}:{values:number[];label:string;lower?:number;upper?:number}) {
  const all=[...values,...(lower==null?[]:[lower]),...(upper==null?[]:[upper])],min=Math.min(...all),max=Math.max(...all),range=Math.max(1,max-min);
  const x=(i:number)=>values.length===1?50:4+i/(values.length-1)*92,y=(v:number)=>56-(v-min)/range*48;
  const points=values.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
  return <svg className="line-chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={`${label}；最低 ${Math.round(min*100)/100}，最高 ${Math.round(max*100)/100}`}><line x1="4" y1="8" x2="96" y2="8" className="grid-line"/><line x1="4" y1="32" x2="96" y2="32" className="grid-line"/><line x1="4" y1="56" x2="96" y2="56" className="grid-line"/>{lower!=null&&upper!=null&&<rect x="4" y={y(upper)} width="92" height={Math.max(1,y(lower)-y(upper))} className="confidence-band"/>}<polyline points={points}/>{values.map((v,i)=><circle className={i===values.length-1?"current-point":""} key={i} cx={x(i)} cy={y(v)} r={i===values.length-1?"2.4":"1.35"}><title>{Math.round(v*100)/100}</title></circle>)}</svg>;
}

export function InteractiveEloChart({points,label}:{points:EloTrendPoint[];label:string}) {
  const [range,setRange]=useState<"recent"|"all">("recent");
  const [activeId,setActiveId]=useState<string|null>(null);
  const visible=range==="recent"&&points.length>11?[points[0],...points.slice(-10)]:points;
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
    <div className="trend-overview"><div><small>{range==="recent"?"最近十場":"完整紀錄"}</small><b className={periodChange>=0?"positive":"negative"}>{periodChange>=0?"+":""}{Math.round(periodChange)} <em>ELO</em></b></div><div className="mini-toggle" aria-label="ELO 走勢範圍"><button className={range==="recent"?"active":""} onClick={()=>{setRange("recent");setActiveId(null)}}>最近十場</button><button className={range==="all"?"active":""} onClick={()=>{setRange("all");setActiveId(null)}}>全部</button></div></div>
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

export function RecentMatches({points}:{points:EloTrendPoint[]}) {
  const matches=points.filter(point=>point.result!=="start").slice(-5).reverse();
  return <section className="recent-form" aria-labelledby="recent-form-title"><div className="recent-form-head"><div><p className="kicker">近期狀態</p><h3 id="recent-form-title">最近五場</h3></div><span>最新在前</span></div>{matches.length===0?<p className="recent-form-empty">尚未有比賽紀錄</p>:<div className="recent-match-grid">{matches.map(point=><article className={`recent-result ${point.result.toLowerCase()}`} key={point.id}><div><b>{point.result==="W"?"勝":point.result==="L"?"負":"和"}</b><time>{point.date.slice(5).replace("-","/")}</time></div><strong>{point.score}</strong><span><i>{point.opponentShort}</i>{point.opponent}</span><small className={point.delta>=0?"positive":"negative"}>{point.delta>=0?"+":""}{Math.round(point.delta)} ELO</small></article>)}</div>}</section>;
}

export function Empty({text,sub}:{text:string;sub:string}) {
  return <div className="empty"><b>○</b><h3>{text}</h3><p>{sub}</p></div>;
}

export function Term({label,tip}:{label:string;tip:string}) {
  return <span className="term" tabIndex={0} aria-label={`${label}：${tip}`}>{label}<i aria-hidden="true">ⓘ</i><span className="term-tip" role="tooltip">{tip}</span></span>;
}

export function PlayerForm({form,setForm,editing,onSave}:{form:any;setForm:any;editing:boolean;onSave:()=>void}) {
  const update=(key:string,value:string)=>setForm((current:any)=>({...current,[key]:value}));
  return <><p className="kicker">公開管理</p><h2>{editing?"編輯球員":"新增球員"}</h2><p className="sub">{editing?"修改起始 ELO 後，系統會按剩餘賽事完整重播評分及近況。":"起始 ELO 留空時使用群組預設值。"}</p><label>顯示名稱<input value={form.name} onChange={event=>update("name",event.target.value)}/></label><label>短名稱／縮寫<input maxLength={3} value={form.short} onChange={event=>update("short",event.target.value)}/></label><label className="initial-elo-field">球員起始 ELO（可編輯）<input data-testid="player-initial-elo" type="number" inputMode="numeric" placeholder="例如 1500" value={form.rating} onChange={event=>update("rating",event.target.value)}/><small>{editing?"儲存後會重算此球員及受影響賽事。":"留空則使用群組預設起始 ELO。"}</small></label><label>正式讓分<input type="number" step="2" value={form.handicap} onChange={event=>update("handicap",event.target.value)}/></label><button className="primary full" onClick={onSave}>{editing?"儲存並重播":"新增球員"}</button></>;
}
