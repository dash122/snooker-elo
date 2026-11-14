import { useEffect,useMemo,useState,type PointerEvent as ReactPointerEvent } from "react";
import { CountUp,CupMark,InteractiveEloChart,PlayerBadge,RecentMatches } from "../UiBits";
import { isEntertainmentMode } from "../../lib/entertainment-match";
import { ShareGlyph } from "../ShareSheet";
import { honourText } from "../../lib/match-share";
import { useT } from "../components/I18nProvider";
import { playerHonours } from "../../lib/tournament";
import { Button,IconButton,SlidingToggleGroup } from "../components/ui/Primitives";
import { calendarDateLabel,monthShortLabel,monthYearLabel } from "../../lib/i18n/format";
import { type Player,type AppState,games,suggestedHandicap,frameRate,playerSeries,playerTrendPoints,type BreakChartMode,breakChartPoints } from "./model";

export type RivalSnapshot = {
  opponent:Player; wins:number; losses:number; draws:number; matches:number;
  framesWon:number; framesLost:number; frameRate:number;
  latest:string; hasAggregate:boolean; label?:string;
};

/** Every opponent the player has met, with the record against each. */
export function opponentRecords(player:Player,data:AppState):RivalSnapshot[] {
  const byOpponent=new Map<string,RivalSnapshot>();
  for(const match of data.matches){
    if(match.status!=="confirmed"||isEntertainmentMode(match.mode)||(match.a!==player.id&&match.b!==player.id))continue;
    const opponentId=match.a===player.id?match.b:match.a;
    const opponent=data.players.find(candidate=>candidate.id===opponentId);
    if(!opponent)continue;
    const first=match.a===player.id;
    const scored=first?match.scoreA:match.scoreB,conceded=first?match.scoreB:match.scoreA;
    const current=byOpponent.get(opponentId)??{opponent,wins:0,losses:0,draws:0,matches:0,framesWon:0,framesLost:0,frameRate:0,latest:"",hasAggregate:false};
    current.framesWon+=scored;current.framesLost+=conceded;
    current.latest=current.latest>match.playedOn?current.latest:match.playedOn;
    if(match.entryMode==="aggregate")current.hasAggregate=true;
    else{
      current.matches++;
      if(scored>conceded)current.wins++;else if(scored<conceded)current.losses++;else current.draws++;
    }
    byOpponent.set(opponentId,current);
  }
  const rivals=[...byOpponent.values()].map(rival=>{
    const totalFrames=rival.framesWon+rival.framesLost;
    return {...rival,frameRate:totalFrames?rival.framesWon/totalFrames:0};
  });
  return rivals;
}

export type MatrixMode="matches"|"frames";
/** Opponents shown before "show all": three rows of three, so a long history never overwhelms the card. */
export const MATRIX_PREVIEW=9;
/** The player against every opponent they have met, as a heat grid: each tile is one opponent, tinted
 *  green where the player is ahead and red where they are behind. The toggle picks the unit: matches
 *  (won–lost, with the match win rate beneath) or frames (won–lost, with the frame win rate beneath);
 *  the tint follows that same win rate. */
export function RivalrySnapshot({player,data,onCompare}:{player:Player;data:AppState;onCompare:(opponent:Player)=>void}) {
  const t = useT();
  const [mode,setMode]=useState<MatrixMode>("matches");
  const [expanded,setExpanded]=useState(false);
  const records=useMemo(()=>opponentRecords(player,data).sort(mode==="matches"
    ?(a,b)=>(b.wins+b.losses+b.draws)-(a.wins+a.losses+a.draws)||(b.framesWon+b.framesLost)-(a.framesWon+a.framesLost)
    :(a,b)=>(b.framesWon+b.framesLost)-(a.framesWon+a.framesLost)||(b.wins+b.losses+b.draws)-(a.wins+a.losses+a.draws)),[player,data,mode]);
  const shown=expanded?records:records.slice(0,MATRIX_PREVIEW);
  const nameCounts=useMemo(()=>data.players.reduce((counts,item)=>counts.set(item.name.trim().toLowerCase(),(counts.get(item.name.trim().toLowerCase())??0)+1),new Map<string,number>()),[data.players]);
  return <section className="profile-section rivalry-snapshot"><div className="profile-section-head"><div><p className="kicker">{t("對賽概覽")}</p><h3>{t("所有對手")} <span className="matchup-count">{records.length}</span></h3></div>{records.length>0&&<SlidingToggleGroup className="ds-toggle-control matrix-toggle" aria-label={t("對賽顯示方式")}><button type="button" className={mode==="matches"?"active":""} onClick={()=>setMode("matches")}>{t("場數")}</button><button type="button" className={mode==="frames"?"active":""} onClick={()=>setMode("frames")}>{t("局數")}</button></SlidingToggleGroup>}</div>
    {records.length===0?<div className="rivalry-empty"><b>{t("尚未有對賽記錄")}</b><span>{t("記錄第一場比賽後，主要對手會顯示在這裡。")}</span></div>:<>
    <div className="matchup-grid">{shown.map(record=>{
      const decided=record.wins+record.losses+record.draws;
      const rate=mode==="matches"?(decided?record.wins/decided:null):(record.framesWon+record.framesLost?record.frameRate:null);
      /* Red and green around a neutral middle, each in four steps by distance from 50%, so 70% and 100% (or
         30% and 0%) never look alike: pale, light, medium, then a solid fill for a lopsided record. */
      const gap=rate==null?0:rate-.5;
      const step=Math.abs(gap)<.03?0:Math.abs(gap)<.12?1:Math.abs(gap)<.22?2:Math.abs(gap)<.35?3:4;
      const level=rate==null?"none":step===0?"even":`${gap>0?"up":"down"}-${step}`;
      const main=mode==="matches"?(decided?`${record.wins}-${record.draws}-${record.losses}`:"—"):`${record.framesWon}–${record.framesLost}`;
      const opponent=record.opponent;
      const clashes=(nameCounts.get(opponent.name.trim().toLowerCase())??0)>1;
      return <button key={opponent.id} className={`matchup-cell lvl-${level}`} onClick={()=>onCompare(opponent)} aria-label={t("查看 {name} 對 {name2} 的詳細對賽", {name: player.name, name2: clashes?`${opponent.name} (${(opponent.short??"").toUpperCase()} · ${Math.round(opponent.rating)})`:opponent.name})}>
        <span className="matchup-name"><b>{opponent.name}</b>{clashes&&<i className="matchup-tag">{(opponent.short??"").toUpperCase()}</i>}</span>
        <strong>{main}</strong>
        <small>ELO {Math.round(opponent.rating)}</small>
        <small>{mode==="matches"?t("{g} 場", {g: decided}):t("{n} 局", {n: record.framesWon+record.framesLost})} / {rate==null?"—":`${Math.round(rate*100)}%`}</small>
      </button>;
    })}</div>
    {records.length>MATRIX_PREVIEW&&<button type="button" className="matchup-more" onClick={()=>setExpanded(open=>!open)}>{expanded?t("收起"):t("顯示全部 {n} 位", {n: records.length})}</button>}</>}
  </section>;
}

/** Buckets a break value into its ten-point band, e.g. 47→"40-49", 100+→"100+". */
export function breakBand(value:number){ return value>=100?"100+":`${Math.floor(value/10)*10}-${Math.floor(value/10)*10+9}`; }
/** Groups the player's recorded breaks into ten-point bands (20-29 up to 100+) so the shape of their form shows at a glance, rather than a flat list of individual scores. */
export function BreakMilestoneChart({player,data,mode}:{player:Player;data:AppState;mode:BreakChartMode}){
  const t = useT();
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const points=useMemo(()=>breakChartPoints(t, player,data,mode),[player,data,mode, t]);
  useEffect(()=>setActiveIndex(null),[mode]);
  if(!points.length)return null;
  /* Laid out exactly like the ELO trend: same plot box, left value axis, bottom period axis, glowing
     end dot and left-to-right reveal, so the two charts read as one family. */
  const max=Math.max(...points.map(point=>point.value));
  const yMax=Math.max(10,Math.ceil(max/10)*10);
  const x=(index:number)=>points.length===1?52:9+index/(points.length-1)*86;
  const y=(value:number)=>54-(value/yMax)*46;
  const linePath=points.reduce((path,point,index)=>index===0?`M ${x(index)} ${y(point.value)}`:`${path} L ${x(index)} ${y(point.value)}`,"");
  const areaPath=points.length>1?`${linePath} L ${x(points.length-1)} 56 L ${x(0)} 56 Z`:"";
  const periodLabel=mode==="monthly"?t("月份"):t("日期");
  /* Short labels for the axis (`8月` / `Aug`, `8月12日` / `12 Aug`), the year only when the range
     crosses one; the tooltip gets the full form with the year. */
  const spansYears=points[0].period.slice(0,4)!==points[points.length-1].period.slice(0,4);
  const periodText=(period:string,full:boolean)=>{
    const [year,month,day]=period.split("-");
    if(full)return mode==="monthly"?monthYearLabel(year,month,t.locale):calendarDateLabel(year,month,day,t.locale,true);
    // Axis ticks stay numeric and short in both languages so they never crowd each other.
    const yy=spansYears?`${year.slice(2)}/`:"";
    return mode==="monthly"?(spansYears?`${yy}${Number(month)}`:monthShortLabel(month,t.locale)):`${yy}${Number(month)}/${Number(day)}`;
  };
  const peakIndex=points.findIndex(point=>point.value===max);
  const last=points.length-1;
  const tickIndexes=[...new Set(last<=0?[0]:[0,Math.round(last/3),Math.round(last*2/3),last])];
  const active=activeIndex==null?null:points[activeIndex]??null;
  const scrub=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const box=event.currentTarget.getBoundingClientRect();
    const index=Math.round((((event.clientX-box.left)/box.width*100-9)/86)*last);
    setActiveIndex(Math.min(last,Math.max(0,index)));
  };
  return <div className="interactive-trend break-trend">
    <div className="trend-plot" onPointerDown={scrub} onPointerMove={scrub} onPointerLeave={()=>setActiveIndex(null)}>
      <div className="trend-yaxis" aria-hidden="true">{[[yMax,8],[Math.round(yMax/2),31],[0,54]].map(([value,line])=><span key={line} style={{top:`${line/60*100}%`}}>{value}</span>)}</div>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={t("{name} {v}單桿圖表", {name: player.name, v: mode==="personal"?t("個人最佳"):t("每月最高")})}>
        <defs><linearGradient id="break-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#287e69" stopOpacity=".28"/><stop offset="100%" stopColor="#287e69" stopOpacity=".02"/></linearGradient></defs>
        {[8,31,54].map(line=><line key={line} x1="9" y1={line} x2="95" y2={line} className="trend-grid"/>)}
        {areaPath&&<path d={areaPath} className="trend-area" style={{fill:"url(#break-area)"}}/>}
        <path d={linePath} className="trend-line"/>
        {active&&<line x1={x(activeIndex!)} y1="6" x2={x(activeIndex!)} y2="56" className="trend-guide"/>}
      </svg>
      {max>0&&<span className="trend-peak" style={{left:`${x(peakIndex)}%`,top:`${y(max)/60*100}%`}} aria-hidden="true"><em>{max}</em></span>}
      <span className="trend-now positive" style={{left:`${x(last)}%`,top:`${y(points[last].value)/60*100}%`}} aria-hidden="true"/>
      {active&&<div className={`trend-tooltip ${x(activeIndex!)>70?"align-right":x(activeIndex!)<30?"align-left":""}`} style={{left:`${x(activeIndex!)}%`,top:`${Math.max(3,y(active.value)/60*100-7)}%`}} role="status"><small>{periodText(active.period,true)}</small><b>{active.value?t("{value} 分", {value: active.value}):"N/A"}</b><span>{active.value?(mode==="personal"?t("個人最佳"):t("該月最高")):t("未記錄單桿")}</span>{active.value>0&&active.date&&<span>{calendarDateLabel(active.date.slice(0,4),active.date.slice(5,7),active.date.slice(8,10),t.locale,true)}</span>}{active.value>0&&active.opponent&&<span>{t("對 {opponent}", {opponent: active.opponent})}</span>}</div>}        {points.map((point,index)=><button key={`${point.period}-${point.value}`} type="button" className={`break-chart-point${activeIndex===index?" active":""}`} style={{left:`${x(index)}%`,top:`${y(point.value)/60*100}%`}} onPointerEnter={()=>setActiveIndex(index)} onFocus={()=>setActiveIndex(index)} onBlur={()=>setActiveIndex(null)} onClick={()=>setActiveIndex(current=>current===index?null:index)} title={t("{periodLabel} {period}：{v}", {periodLabel, period: point.period, v: point.value?t("{v} {value} 分", {v: mode==="personal"?t("個人最佳"):t("該月最高"), value: point.value}):"N/A"})} aria-label={t("{periodLabel} {period}，{v}", {periodLabel, period: point.period, v: point.value?t("{v} {value} 分", {v: mode==="personal"?t("個人最佳"):t("該月最高"), value: point.value}):t("未記錄單桿")})}/>) }
    </div>
    <div className="trend-xaxis" aria-hidden="true">{tickIndexes.map(index=><span key={index} style={{left:`${x(index)}%`}}>{periodText(points[index].period,false)}</span>)}</div>
  </div>;
}

export function BreakStats({player,data}:{player:Player;data:AppState}) {
  const t = useT();
  const [mode,setMode]=useState<BreakChartMode>("monthly");
  const breaks=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>
    (m.highBreaks??[]).filter(item=>item.playerId===player.id&&item.value>0&&item.value<=147).map(item=>item.value));
  if(!breaks.length)return null;
  const highest=Math.max(...breaks);
  const bands=["20-29","30-39","40-49","50-59","60-69","70-79","80-89","90-99","100+"];
  const band=(v:number)=>v<20?"<20":breakBand(v);
  const allBands=breaks.some(v=>v<20)?["<20",...bands]:bands;
  const counts=new Map<string,number>();
  for(const v of breaks) counts.set(band(v),(counts.get(band(v))??0)+1);
  const maxCount=Math.max(1,...allBands.map(b=>counts.get(b)??0));
  return <section className="profile-section break-stats profile-chart-hero">
    <div className="trend-overview"><div className="trend-heading"><div className="profile-section-head"><div><p className="kicker">{t("高桿里程碑")}</p><h3>{t("突破軌跡")}</h3></div></div></div><SlidingToggleGroup className="ds-toggle-control break-milestone-toggle" aria-label={t("高桿圖表顯示方式")}><button type="button" aria-pressed={mode==="monthly"} className={mode==="monthly"?"active":""} onClick={()=>setMode("monthly")}>{t("每月最高")}</button><button type="button" aria-pressed={mode==="personal"} className={mode==="personal"?"active":""} onClick={()=>setMode("personal")}>{t("個人最佳")}</button></SlidingToggleGroup></div>
    <BreakMilestoneChart player={player} data={data} mode={mode}/>
    <div className="break-stats-subhead"><span>{t("單桿表現")}</span><small>{t("共 {breaks} 桿記錄", {breaks: breaks.length})}</small></div>
    <div className="break-bar-chart">{allBands.map(band=>{const count=counts.get(band)??0;return <div className="break-bar-row" key={band}>
      <span className="break-bar-label">{band}</span>
      <span className="break-bar-track"><i style={{width:count?`${8+count/maxCount*92}%`:"0%"}}/></span>
      <span className="break-bar-count">{count||""}</span>
    </div>})}</div>
  </section>;
}

/** The one thing a profile offers about playing: ask this person for a game. The composer opens with
    them already invited, so there is no slot to publish first. */
export function PlayerPlayCta({player,onFindOpponent}:{player:Player;onFindOpponent:(playerId:string)=>void}) {
  const t = useT();
  return <section className="profile-section profile-slots">
    <div className="profile-section-head">
      <div><p className="kicker">{t("約戰")}</p><h3>{t("約 {name} 打波", {name: player.name})}</h3></div>
      <Button variant="secondary" onClick={()=>onFindOpponent(player.id)}>{t("約佢打波")}</Button>
    </div>
  </section>;
}
export function PlayerDetail({player,rank,data,onCompare,onViewAllMatches,onMatch,onFindOpponent,onShare}:{player:Player;rank:number;data:AppState;onCompare:(opponent:Player)=>void;onViewAllMatches:()=>void;onMatch:(matchId:string)=>void;onFindOpponent:(playerId:string)=>void;onShare:()=>void}) {
  const t = useT(); const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data),series=playerSeries(player,data),trendPoints=playerTrendPoints(t, player,data),high=Math.max(...series),low=Math.min(...series);const provisional=g<data.settings.provisionalGames;
  const highestBreak=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>(m.highBreaks??[]).filter(item=>item.playerId===player.id).map(item=>item.value)).reduce((max,value)=>Math.max(max,value),0);
  /* Memoised where the neighbouring stats are not: those are single passes over the match list,
     while this builds a bracket per cup the player entered, and the profile re-renders on every
     slot fetch and chart hover. */
  const honour=useMemo(()=>honourText(t, playerHonours(data.tournaments,data.matches,player.id)),[data.tournaments,data.matches,player.id, t]);
  /* One hero, then a single `.profile-body` grid: every section below is a `.profile-section`, so the
     gaps, surfaces and heads come from one place rather than from each section's own margins. */
  /* A plain div, not a <header>: the global `header{height:62px}` page rule would clamp this and
     clip the chip row. */
  const total=player.wins+player.losses+player.draws,winPct=total?Math.round(player.wins/total*100):0;
  const framePct=Math.round(frameRate(player)*100);
  const [now]=useState(()=>Date.now());
  const monthDelta=useMemo(()=>{
    const dated=trendPoints.filter(point=>point.date);
    if(!dated.length)return 0;
    const cutoff=new Date(now-30*86400000).toISOString().slice(0,10);
    const earlier=dated.filter(point=>point.date<cutoff);
    return Math.round(player.rating-(earlier.length?earlier[earlier.length-1].elo:trendPoints[0].elo));
  },[trendPoints,player.rating,now]);
  const firstNonWin=player.form.findIndex(result=>result!=="W");
  const winStreak=player.form[0]==="W"?(firstNonWin===-1?player.form.length:firstNonWin):0;
  const RING=2*Math.PI*42;
  const ringSegments=[{kind:"w",value:player.wins},{kind:"d",value:player.draws},{kind:"l",value:player.losses}].reduce((acc,seg)=>{
    const length=total?seg.value/total*RING:0;
    acc.items.push({...seg,length,offset:acc.used});acc.used+=length;return acc;
  },{items:[] as {kind:string;value:number;length:number;offset:number}[],used:0}).items.filter(seg=>seg.length>0);
  /* One cinematic hero, then a `.profile-body` of tiles: the chart as the centrepiece, a bento of stats,
     then form, rivals and availability. A plain div, not a <header>: the global `header{height:62px}`
     page rule would clamp it and clip the chip row. */
  return <><div className={`profile-head${honour?" has-honour":""}`}>
    <IconButton className="profile-share" label={t("分享 {name} 的球會紀錄", {name: player.name})} onClick={onShare}><ShareGlyph kind="share" /></IconButton>
    <div className="profile-id">
      <PlayerBadge player={player}/>
      <div className="profile-identity">
        <h2>{player.name}</h2>
        <div className="profile-meta-row"><p className="profile-meta">{t("排名 #")}{rank||"—"} · {t("{g} 場", {g})}{provisional&&<> · {t("臨時 ELO")}</>}</p>
          <span className="profile-form-dots" aria-label={t("最近5場")}>{player.form.slice(0,5).map((result,index)=><i key={`${result}-${index}`} className={result.toLowerCase()}>{result}</i>)}{winStreak>=2&&<em className="profile-streak">{t("{n} 連勝", {n: winStreak})}</em>}</span></div>
        {/* A cup finish is the one thing on this profile the leaderboard can never show. */}
        {honour&&<span className="profile-chip honour"><CupMark/>{honour}</span>}
      </div>
    </div>
    <div className="profile-vitals">
      <div className="profile-vital"><small>{t("目前 ELO")}</small><div className="profile-vital-value"><b><CountUp value={Math.round(player.rating)}/></b>{monthDelta!==0&&<span className={`profile-delta ${monthDelta>0?"positive":"negative"}`}>{monthDelta>0?"+":""}{monthDelta} · {t("近30日")}</span>}</div></div>
      <div className="profile-vital"><small>{t("讓分")}</small><div className="profile-vital-value"><b>{suggested==null?"—":Math.round(suggested)}</b></div></div>
      <div className="profile-vital"><small>{t("最高單桿")}</small><div className="profile-vital-value"><b>{highestBreak||"—"}</b></div></div>
    </div>
  </div>
  <div className="profile-body">
    <section className="profile-section interactive-detail profile-chart-hero">
      <InteractiveEloChart points={trendPoints} label={t("{name} 從起始評分至目前的互動 ELO 走勢", {name: player.name})} heading={<div className="profile-section-head"><div><p className="kicker">{t("評分軌跡")}</p><h3>{t("ELO 走勢")}</h3></div></div>}/>
    </section>
    <div className="profile-bento">
      <div className="bento-tile bento-ring">
        <div className="ring-wrap"><svg viewBox="0 0 100 100" role="img" aria-label={`${player.wins}/${player.losses}/${player.draws}`}><circle className="ring-track" cx="50" cy="50" r="42"/>
          {ringSegments.map(seg=><circle key={seg.kind} className={`ring-seg ring-${seg.kind}`} cx="50" cy="50" r="42" strokeDasharray={`${Math.max(0,seg.length-(ringSegments.length>1?2:0))} ${RING}`} strokeDashoffset={-seg.offset} transform="rotate(-90 50 50)"/>)}
        </svg><div className="ring-center"><b><CountUp value={winPct}/>%</b></div></div>
        <div className="bento-ring-text"><small>{t("勝／負／和")}</small><span className="bento-sub">{player.wins}/{player.losses}/{player.draws}</span></div>
      </div>
      <div className="bento-tile bento-frames"><small>{t("局數勝率")}</small><b><CountUp value={framePct}/>%</b><span className="bento-bar"><i style={{width:`${framePct}%`}}/></span><span className="bento-sub">{t("{framesWon} 局獲勝", {framesWon: player.framesWon})}</span></div>
    </div>
    <BreakStats player={player} data={data}/>
    <RecentMatches points={trendPoints} onViewAll={onViewAllMatches} onMatch={onMatch}/>
    <RivalrySnapshot player={player} data={data} onCompare={onCompare}/>
    <PlayerPlayCta player={player} onFindOpponent={onFindOpponent}/>
  </div></>}
