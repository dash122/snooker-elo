import { useEffect,useId,useMemo,useRef,useState,type CSSProperties,type ReactNode } from "react";
import { Empty,PlayerBadge,SortArrow,avatarHex,sortLabels,type SortKey } from "../UiBits";
import { SQUAD_SWING_DAYS,daysSinceLastMatch,isInactive,ratingSwing,squadForms,squadRecords } from "../../lib/squad-rivalry";
import { SquadStatsPanel } from "../SquadStats";
import { SquadIntro,defaultSquadId,type MySquad } from "../Squads";
import { isEntertainmentMode } from "../../lib/entertainment-match";
import { breakNudge,type BreakNudge } from "../../lib/break-nudge";
import { useT } from "../components/I18nProvider";
import { Button,SegmentedControl,Skeleton,Surface } from "../components/ui/Primitives";
import { TabList,TabPanel } from "../components/ui/Tabs";
import { msg } from "../../lib/i18n/translate";
import { Menu } from "../components/ui/Menu";
import { monthShortLabel,monthYearLabel } from "../../lib/i18n/format";
import type { Translator } from "../../lib/i18n/translate";
import { type Player,type Match,type AppState,games,suggestedHandicap,trailingStat,sortPlayers,matchMode,eloTrendSeries,recentDeltaDays,today,thirtyDaysAgo,isInPastThirtyDays,isInPastTenDays } from "./model";
import { shiftMonth } from "./Matches";


export type BreakRecord={player:Player;opponent:string;value:number;date:string;createdAt:string;key:string};
export type MonthlyBreak={month:string;record:BreakRecord|null;top:BreakRecord[]};
/** The highest break of every month from the first recorded break to today,
 *  newest last, plus up to the 10 highest breaks in that month. Months without
 *  a recorded break stay in the series as gaps so the timeline reads evenly;
 *  the chart scrolls when there are more than a screenful. */
/** The ten-row break table every 最高單桿 view shares, padded with N/A so the layout never shifts. */
export function BreakRankList({records}:{records:BreakRecord[]}){
  const t = useT();
  return <ol className="break-ranking">{Array.from({length:10},(_,index)=>{const record=records[index];const medal=["gold","silver","bronze"][index];return <li key={record?.key??`empty-${index}`} className={`${record?"":"empty-rank"}${medal?` medal medal-${medal}`:""}`}><span className="break-position">{medal?<i className="medal-icon" aria-hidden="true">{["🥇","🥈","🥉"][index]}</i>:index+1}</span>{record?<><PlayerBadge player={record.player}/><b><span>{record.player.name}</span><small>{t("對 {opponent}", {opponent: record.opponent})}<span className="break-date-inline"> · {record.date}</span></small></b><time dateTime={record.date}>{record.date}</time><strong>{record.value>=100&&<em className="century-badge" title={t("破百單桿")}>{t("破百")}</em>}{record.value}</strong></>:<b>N/A</b>}</li>})}</ol>;
}
export function monthlyBreakRecords(records:BreakRecord[]):MonthlyBreak[]{
  const byMonth=new Map<string,BreakRecord[]>();
  // records arrive sorted by value desc, so each month's list stays sorted too.
  for(const record of records){const month=record.date.slice(0,7);const list=byMonth.get(month);if(list)list.push(record);else byMonth.set(month,[record]);}
  const sorted=[...byMonth.keys()].sort();
  if(!sorted.length)return [];
  const first=sorted[0],last=sorted[sorted.length-1];
  // Run through today, unless a record is somehow dated ahead of it.
  const end=last>today.slice(0,7)?last:today.slice(0,7);
  const months:MonthlyBreak[]=[];
  for(let month=first;month<=end;month=shiftMonth(month,1)){
    const top=byMonth.get(month)??[];
    months.push({month,record:top[0]??null,top:top.slice(0,10)});
  }
  return months;
}
/** Monthly high breaks as a column chart: the shape of the club's best month-to-month,
 *  with the holder and opponent for whichever month is selected. */
export function MonthlyBreakChart({months}:{months:MonthlyBreak[]}) {
  const t = useT();
  const withRecord=months.filter(month=>month.record);
  const lastIndex=months.map(month=>!!month.record).lastIndexOf(true);
  const [selected,setSelected]=useState<number|null>(lastIndex>=0?lastIndex:null);
  const active=selected!=null?months[selected]:null;
  const scroller=useRef<HTMLDivElement>(null);
  // The newest months matter most, so the track opens scrolled to its right end.
  useEffect(()=>{const node=scroller.current;if(node)node.scrollLeft=node.scrollWidth;},[months.length]);
  if(!withRecord.length)return <Empty text={t("尚未有單桿紀錄")} sub={t("記錄賽果時加入單桿度數，這裡就會顯示每月最高。")}/>;
  const peak=Math.max(...withRecord.map(month=>month.record!.value));
  const scale=Math.max(50,Math.ceil(peak/25)*25);
  return <div className="monthly-break">
    <div className="monthly-break-plot">
      <div className="monthly-break-axis" aria-hidden="true"><span>{scale}</span><span>{scale/2}</span><span>0</span></div>
      <div className="monthly-break-scroller" ref={scroller} tabIndex={0} role="group" aria-label={t("每月最高單桿，{month} 至 {month2}，可左右捲動", {month: months[0].month, month2: months[months.length-1].month})}>
      <ol className="monthly-break-columns">{months.map((month,index)=>{
        const record=month.record;
        const label=monthYearLabel(month.month.slice(0,4),month.month.slice(5),t.locale);
        return <li key={month.month}>
          <button type="button" className={`monthly-break-column${selected===index?" active":""}${record?"":" empty"}${record&&record.value>=100?" century":""}`}
            aria-pressed={selected===index} disabled={!record}
            aria-label={record?t("{label}，最高單桿 {value} 分，{name} 對 {opponent}", {label, value: record.value, name: record.player.name, opponent: record.opponent}):t("{label}，未有單桿紀錄", {label})}
            onClick={()=>setSelected(index)}>
            {record?<><em>{record.value}</em><i style={{height:`${Math.max(6,record.value/scale*100)}%`}}/></>:<i className="monthly-break-gap"/>}
          </button>
          <small>{monthShortLabel(month.month.slice(5),t.locale)}{(index===0||month.month.endsWith("-01"))&&<span>{month.month.slice(2,4)}</span>}</small>
        </li>})}</ol>
      </div>
    </div>
    {active&&<><p className="monthly-break-heading">{t("{month}最高單桿", {month: monthYearLabel(active.month.slice(0,4),active.month.slice(5),t.locale)})}</p><BreakRankList records={active.top}/></>}
    <p className="chart-summary">{t("{month}至今，共 {months} 個月", {month: monthYearLabel(months[0].month.slice(0,4),months[0].month.slice(5),t.locale), months: months.length})}{months.length>12?t("；可左右捲動查看更早月份。"):t("。")}</p>
  </div>;
}
export function breakNudgeCopy(t: Translator, nudge:BreakNudge){
  switch(nudge.kind){
    case "top":return {big:String(nudge.target),title:t("近30日單桿第 1（{current} 分）", {current: nudge.current}),sub:"",hint:""};
    case "climb":return {big:String(nudge.target),title:t("打 {target} 分，近30日單桿升第 {nextPosition}", {target: nudge.target, nextPosition: nudge.nextPosition}),sub:t("你現時 {current} 分 · 第 {position} 名", {current: nudge.current, position: nudge.position}),hint:t("打 {target} 分升第 {nextPosition}", {target: nudge.target, nextPosition: nudge.nextPosition})};
    case "expiring":return {big:String(nudge.target),title:nudge.daysLeft===0?t("你的 {current} 分今日後過期", {current: nudge.current}):t("你的 {current} 分 {daysLeft} 日後過期", {current: nudge.current, daysLeft: nudge.daysLeft}),sub:t("打 {target} 分保住近30日榜", {target: nudge.target}),hint:t("打 {target} 分保住位置", {target: nudge.target})};
    case "enter":return {big:String(nudge.target),title:t("打 {target} 分，登上近30日單桿榜", {target: nudge.target}),sub:t("第 10 名：{lastValue} 分", {lastValue: nudge.lastValue}),hint:t("打 {target} 分即可上榜", {target: nudge.target})};
    case "open":return {big:t("任何"),title:t("近30日單桿榜尚餘 {openSlots} 位", {openSlots: nudge.openSlots}),sub:t("任何單桿即可上榜"),hint:t("任何單桿即可上榜")};
  }
}
/* A welcome-back line inside the hero rather than an alert under it: a quiet greeting whose second
   half is the day's high-break target, and that opens the 30-day break board. */
export function HeroWelcome({name,nudge,onOpen}:{name:string;nudge:BreakNudge;onOpen:()=>void}){
  const t = useT();
  const copy=breakNudgeCopy(t, nudge);
  return <button type="button" className="hero-welcome" onClick={onOpen}>
    <span className="hero-welcome-name">{t("歡迎回來，{name}", {name})}</span>
    <span className="hero-welcome-line"><b>{copy.title}</b>{copy.sub&&<small>{copy.sub}</small>}</span>
    <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>
  </button>;
}
export type BoardScope={squads:MySquad[];onSelect:(id:string|null)=>void;onMore:()=>void;onManage:()=>void;onCreate:()=>void;isAdmin:boolean};
export const BREAK_VIEWS=[{value:"players",label:msg("球員最高")},{value:"overall",label:msg("歷史")},{value:"recent",label:msg("近30日")},{value:"monthly",label:msg("每月")}] as const;
export type BreakView=typeof BREAK_VIEWS[number]["value"];
export const SearchIcon=()=><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>;
export const ChevronDown=()=><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>;
export const GearIcon=()=><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>;
export const FilterIcon=()=><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>;
export const ClearIcon=()=><svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>;
/* A filter chip states a non-default choice in words and clears it in one tap, so state set inside the
   ⋯ menu is never invisible. */
export function FilterChip({label,clearLabel,onClear}:{label:ReactNode;clearLabel:string;onClear:()=>void}){
  return <button type="button" className="board-chip" aria-label={clearLabel} onClick={onClear}><span>{label}</span><ClearIcon/></button>;
}
export function Leaderboard({ranked,data,ownPlayerId,squad,scope,onRecord,onPlayer,onMatch,onRivalry,onClubScope}:{ranked:Player[];data:AppState;ownPlayerId?:string;squad:MySquad|null;scope:BoardScope;onClubScope:()=>void;onRecord:()=>void;onPlayer:(p:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}) {
  const homeTabsId=useId();
  const t = useT();
  const [squadIntro,setSquadIntro]=useState(false);
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[breakView,setBreakView]=useState<BreakView>("players"),[homeViewRaw,setHomeView]=useState<"ranking"|"breaks"|"recent"|"squad"|"matrix">("ranking"),[query,setQuery]=useState("");
  const homeView=(squad?["ranking","squad","matrix"]:["ranking","breaks","recent"]).includes(homeViewRaw)?homeViewRaw:"ranking";
  const confirmed=data.matches.filter(m=>m.status==="confirmed");
  const month=confirmed.filter(m=>m.playedOn.slice(0,7)===today.slice(0,7)).length,total=confirmed.length;
  // A squad view is the same table filtered to its members, re-ranked among themselves.
  const squadIds=useMemo(()=>squad?new Set(squad.members.map(member=>member.playerId)):null,[squad]);
  const squadRecordById=useMemo(()=>squadIds?squadRecords(data.matches,squadIds):null,[squadIds,data.matches]);
  const visibleRanked=useMemo(()=>ranked.filter(p=>!squadIds||squadIds.has(p.id)),[ranked,squadIds]);
  // A squad's 近況 reads only its members' games against each other, so the form column and its sort follow that.
  const squadForm=useMemo(()=>squadIds?squadForms(data.matches,squadIds):null,[squadIds,data.matches]);
  const boardRanked=useMemo(()=>squadForm?visibleRanked.map(p=>({...p,form:squadForm.get(p.id)??[]})):visibleRanked,[squadForm,visibleRanked]);
  const clubPlayerById=useMemo(()=>new Map(visibleRanked.map(p=>[p.id,p])),[visibleRanked]);
  // Search narrows the list without re-ranking it: a match keeps its real position on the board.
  const needle=query.trim().toLocaleLowerCase();
  const shown=sortPlayers(needle?boardRanked.filter(p=>p.name.toLocaleLowerCase().includes(needle)||(p.short??"").toLocaleLowerCase().includes(needle)):boardRanked,data,sort,dir),rankOf=new Map(visibleRanked.map((p,i)=>[p.id,i+1]));
  const defaultSort=sort==="rank"&&dir==="asc";
  const trailingSort=["change","official","suggested","games","winRate","frameRate"].includes(sort);
  const trailingHeader=trailingSort?t(sortLabels[sort]):"ELO";
  const trailingHeaderSort=trailingSort?sort:"rating";
  /* A squad table measures movement over a month (a group of eight barely moves in ten days), shows
     each squad-mate's record against the viewer, and fades out whoever has stopped playing. */
  const swingDays=squad?SQUAD_SWING_DAYS:10;
  const rivalry=useMemo(()=>squad?new Map(visibleRanked.map(p=>[p.id,{
    idleDays:daysSinceLastMatch(data.matches,p.id),
  }])):null,[squad,visibleRanked,data.matches]);
  // Movement compares today's table against the standings 30 days ago. A single
  // Ten days balances recent momentum with enough matches for a meaningful comparison.
  const movement=useMemo(()=>{
    const recent=confirmed.filter(m=>squad?isInPastThirtyDays(m.playedOn):isInPastTenDays(m.playedOn));
    if(!recent.length)return {map:new Map<string,number>(),active:false};
    const before=visibleRanked.map(p=>{
      const swing=recent.filter(m=>m.a===p.id||m.b===p.id)
        .reduce((sum,m)=>sum+(m.a===p.id?m.deltaA:-m.deltaA),0);
      return {id:p.id,rating:p.rating-swing,name:p.name};
    }).sort((a,b)=>b.rating-a.rating||a.name.localeCompare(b.name));
    const priorRank=new Map(before.map((p,i)=>[p.id,i+1]));
    return {map:new Map(visibleRanked.map((p,i)=>[p.id,(priorRank.get(p.id)??i+1)-(i+1)])),active:true};
  },[confirmed,visibleRanked,squad]);
  const breakRecords=useMemo(()=>{
    const playerById=new Map(data.players.map(player=>[player.id,player]));
    const records=data.matches.flatMap(match=>match.status==="confirmed"?(match.highBreaks??[])
      .filter(item=>Number.isFinite(item.value)&&item.value>0&&item.value<=147&&playerById.has(item.playerId))
      .map((item,index)=>({player:playerById.get(item.playerId)!,opponent:playerById.get(match.a===item.playerId?match.b:match.a)?.name??t("已移除球員"),value:item.value,date:match.playedOn,createdAt:match.createdAt,key:`${match.id}-${index}`})):[])
      .sort((a,b)=>b.value-a.value||(b.date||b.createdAt).localeCompare(a.date||a.createdAt)||b.createdAt.localeCompare(a.createdAt));
    const seen=new Set<string>(),seenRecent=new Set<string>();
    return {
      overall:records.slice(0,10),
      players:records.filter(record=>seen.has(record.player.id)?false:(seen.add(record.player.id),true)).slice(0,10),
      recent:records.filter(record=>isInPastThirtyDays(record.date))
        .filter(record=>seenRecent.has(record.player.id)?false:(seenRecent.add(record.player.id),true)).slice(0,10),
      monthly:monthlyBreakRecords(records)
    };
  },[data.matches,data.players, t]);
  const displayedBreaks=breakView==="monthly"?breakRecords.overall:breakRecords[breakView];
  const nudge=useMemo(()=>ownPlayerId&&data.players.some(player=>player.id===ownPlayerId)
    ?breakNudge(breakRecords.recent.map(record=>({playerId:record.player.id,value:record.value,date:record.date})),ownPlayerId,today):null,[breakRecords.recent,data.players,ownPlayerId]);
  const ownPlayer=ownPlayerId?data.players.find(player=>player.id===ownPlayerId):undefined;
  const openNudge=()=>{setBreakView("recent");setHomeView("breaks");if(squad)onClubScope()};
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  /* A compact hero: one headline line, the welcome-back nudge when there is one, and the club's numbers
     as a single quiet row. The record action stays for wide screens; on phones the bottom bar's ＋ owns it. */
  return <><section className="hero home-hero"><div><h1>{t("讓每一局，")}<span>{t("都推動進步。")}</span></h1>
      {nudge&&ownPlayer&&<HeroWelcome name={ownPlayer.name} nudge={nudge} onOpen={openNudge}/>}
      <div className="podium-stats">
        <span><b>{ranked.length}</b><small>{t("活躍球員")}</small></span>
        <span><b>{month}</b><small>{t("本月比賽")}</small></span>
        <span><b>{total}</b><small>{t("歷來總場數")}</small></span>
      </div>
    </div><Button className="hero-action" onClick={onRecord}><span aria-hidden="true" className="hero-action-icon">＋</span><b>{t("記錄新賽果")}</b><small>{t("更新排名與近期狀態")}</small></Button></section>
    <div className="board-scope-switch">
      <SegmentedControl label={t("檢視範圍")} value={squad||squadIntro?"squad":"club"}
        items={[{value:"club",label:t("全會")},{value:"squad",label:t("球隊")}]}
        onChange={value=>{setQuery("");setHomeView("ranking");if(value==="club"){setSquadIntro(false);scope.onSelect(null)}else{const id=defaultSquadId(scope.squads);if(id)scope.onSelect(id);else setSquadIntro(true)}}}/>
    </div>
    {squadIntro&&!squad?<SquadIntro signedIn={Boolean(ownPlayerId)} isAdmin={scope.isAdmin} onBrowse={scope.onMore} onCreate={scope.onCreate} onClub={()=>{setSquadIntro(false);scope.onSelect(null)}}/>:<>
    {squad&&<div className="board-head">
      <div className="board-heading">
      <Menu className="board-scope" label={t("切換球隊")} align="start" triggerClassName="board-scope__trigger"
        trigger={()=><><span className="board-scope__title">{squad.name}</span><ChevronDown/></>}
        sections={[
          {title:t("我的球隊"),items:scope.squads.map(item=>({key:item.id,label:item.name,checked:squad.id===item.id,detail:t("{count} 位隊員", {count:item.memberCount}),onSelect:()=>{setQuery("");scope.onSelect(item.id)}}))},
          {items:[{key:"more",label:t("瀏覽所有球隊"),onSelect:scope.onMore}]},
        ]}/>
      <p className="board-sub">{t("{count} 位隊員", {count:squad.memberCount})}</p>
      </div>
      {(squad.role||scope.isAdmin)&&<button type="button" className="ds-button ds-button--secondary board-manage" onClick={scope.onManage}><GearIcon/><span>{squad.role==="host"?t("管理球隊"):t("球隊資料")}</span></button>}
    </div>}
    <TabList id={homeTabsId} as="nav" className="page-tabs home-view-nav board-view-tabs" label={squad?t("球隊內容"):t("首頁內容")} value={homeView} onChange={value=>setHomeView(value as typeof homeView)} items={squad?[
      {value:"ranking",label:<span>{t("排行榜")}</span>},
      {value:"squad",label:<span>{t("數據")}</span>},
      {value:"matrix",label:<span>{t("對賽矩陣")}</span>},
    ]:[
      {value:"ranking",label:<span>{t("排行榜")}</span>},
      {value:"breaks",label:<span>{t("最高單桿")}</span>},
      {value:"recent",label:<span>{t("數據")}</span>},
    ]}/>
    <TabPanel id={homeTabsId} value="ranking" active={homeView==="ranking"}>
    <section className={`home-view-panel ranking-panel${squad?" squad-scope":""}`} aria-labelledby="ranking-title">
      <h2 id="ranking-title" className="ds-sr-only">{t("目前排名")}</h2>
    <div className="board-toolbar">
    <label className="board-search"><SearchIcon/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("搜尋球員")} aria-label={t("搜尋球員")}/></label>
      {!defaultSort&&<div className="board-chips">
        <FilterChip label={<>{t("排序：{v}", {v: t(sortLabels[sort])})} {dir==="asc"?"↑":"↓"}</>} clearLabel={t("清除排序")} onClear={()=>{setSort("rank");setDir("asc")}}/>
      </div>}
      <Menu className="board-filter" label={t("排序及篩選")} triggerClassName={`ds-button ds-button--secondary board-filter__trigger${defaultSort?"":" is-active"}`} trigger={()=><><FilterIcon/><span>{t("篩選")}</span></>}
        sections={[
          {title:t("排序"),items:(Object.keys(sortLabels) as SortKey[]).filter(key=>key!=="official").map(key=>({key,label:t(sortLabels[key]),checked:sort===key,detail:sort===key?(dir==="asc"?"↑":"↓"):undefined,onSelect:()=>sortBy(key)}))},
        ]}/>
    </div>
    <Surface as="div" className="table-card">{visibleRanked.length===0?<Empty text={t("尚未有球員")} sub={squad?t("呢個球隊暫時未有球員。"):t("前往球員頁面新增第一位球員。")}/>:<><div className="table-head sortable"><button title={squad?t("箭嘴為過去 30 天的排名升跌"):t("箭嘴為過去 10 天的排名升跌")} onClick={()=>sortBy("rank")}>{t("排名")}<SortArrow active={sort==="rank"} dir={dir}/></button><button onClick={()=>sortBy("name")}>{t("球員")}<SortArrow active={sort==="name"} dir={dir}/></button><button title={t("最近五筆比賽；較近期結果權重較高")} onClick={()=>sortBy("form")}>{t("近況")}<SortArrow active={sort==="form"} dir={dir}/></button><button onClick={()=>sortBy("winRate")}>{t("場數／勝率")}<SortArrow active={sort==="winRate"} dir={dir}/></button><button onClick={()=>sortBy("suggested")}>{t("建議評分")}<SortArrow active={sort==="suggested"} dir={dir}/></button><button title={trailingSort?trailingHeader:squad?t("ELO 及近30天ELO變化"):t("ELO 及近10天ELO變化")} onClick={()=>sortBy(trailingHeaderSort)}><span className="head-elo">{trailingHeader}<SortArrow active={sort===trailingHeaderSort} dir={dir}/></span>{!trailingSort&&<small className="head-suggested">{t("建議評分")}</small>}</button></div>
      {shown.length===0&&<p className="board-empty">{t("沒有符合「{query}」的球員", {query: query.trim()})}</p>}
      {shown.map(p=>{const rank=rankOf.get(p.id)??0,suggested=Math.round(suggestedHandicap(p,data)),swing=squad?ratingSwing(data.matches,p.id,SQUAD_SWING_DAYS):recentDeltaDays(p,data,10),played=games(p),rival=rivalry?.get(p.id),idle=rival&&isInactive(rival.idleDays),rate=played?Math.round(p.wins/played*100):0,provisional=played<data.settings.provisionalGames,trailing=trailingStat(t, sort,p,data,suggested);
        const rec=squadRecordById?(squadRecordById.get(p.id)??{wins:0,draws:0,losses:0}):p,recordLabel=t("勝-和-負 {w}-{d}-{l}",{w:rec.wins,d:rec.draws,l:rec.losses});
        const idleText=idle?(rival.idleDays===null?t("未有賽事"):t("{days} 日未打", {days:rival.idleDays})):null;
        return <button className={`row ${rank===1?"top":""} ${rank<=3?`podium-${rank}`:""} ${provisional?"provisional":""} ${idle?"squad-inactive":""} ${p.id===ownPlayerId?"is-self":""}`} type="button" id={p.id===ownPlayerId?homeTabsId+"-self":undefined} data-self={p.id===ownPlayerId||undefined} key={p.id} onClick={()=>onPlayer(clubPlayerById.get(p.id)??p)} aria-label={[p.id===ownPlayerId?t("你"):null,t("{name}，排名 {rank}，ELO {v}，近{days}天ELO變化 {v2}{v3}，建議讓分 {suggested}{v4}", {name: p.name, rank, v: Math.round(p.rating), days: swingDays, v2: swing>=0?"+":"", v3: Math.round(swing), suggested, v4: provisional?t("，臨時評分"):""}),recordLabel,idleText].filter(Boolean).join("，")}>
        <span className="rank">{rank<=3?<i className="medal-icon" aria-hidden="true">{["🥇","🥈","🥉"][rank-1]}</i>:rank}{(()=>{if(!movement.active)return null;const move=movement.map.get(p.id)??0;
          // Only real movement earns a mark; a dash on every unchanged row is noise at 100+ players.
          return move===0?null
          :<em className={`move ${move>0?"up":"down"}`} aria-label={t("較 {days} 天前{v} {v2} 位", {days:swingDays, v: move>0?t("上升"):t("下跌"), v2: Math.abs(move)})}>{move>0?"▲":"▼"}{Math.abs(move)}</em>})()}</span><span className="person"><PlayerBadge player={p}/><b><span className="player-name">{p.name}</span>{p.id===ownPlayerId&&<em className="board-self-label">{t("你")}</em>}{provisional&&<small>{t("臨時")}</small>}<span className="player-record" title={recordLabel}><span className="pr-w">{rec.wins}W</span><span className="pr-d">{rec.draws}D</span><span className="pr-l">{rec.losses}L</span></span>{idleText&&<span className="squad-rival" aria-hidden="true"><em className="squad-idle">{idleText}</em></span>}</b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}><span className="ds-sr-only">{x==="W"?t("勝"):x==="L"?t("負"):t("和")}</span></i>)}</span>
        <span>{t("{played} 場", {played})}<small>{t("{rate}% 勝率", {rate})}</small></span><span className="dual-rating"><b>{suggested}</b></span>
        {trailing?<span className="elo"><b className={trailing.cls}>{trailing.big}</b><small>{trailing.sub}</small></span>
        :<span className="elo"><b>{Math.round(p.rating)}</b><small className={swing>=0?"positive":"negative"}>{swing>=0?"+":""}{Math.round(swing)}</small><em className="elo-suggested">{suggested}</em></span>}</button>})}
</>}</Surface>
    </section></TabPanel>
    {!squad&&<TabPanel id={homeTabsId} value="breaks" active={homeView==="breaks"} as="section" className="home-view-panel break-records-panel">
      <h2 id="break-records-title" className="ds-sr-only">{t("最高單桿紀錄")}</h2>
    <div className="board-head">
      <div className="board-heading">
      <Menu className="board-scope" label={t("單桿紀錄顯示方式")} align="start" triggerClassName="board-scope__trigger"
        trigger={()=><><span className="board-scope__title">{t(BREAK_VIEWS.find(item=>item.value===breakView)!.label)}</span><ChevronDown/></>}
        sections={[{items:BREAK_VIEWS.map(item=>({key:item.value,label:t(item.label),checked:breakView===item.value,onSelect:()=>setBreakView(item.value)}))}]}/>
      </div>
    </div>
      {breakView==="monthly"?<MonthlyBreakChart months={breakRecords.monthly}/>:<>{breakView==="recent"&&nudge&&breakNudgeCopy(t, nudge).hint&&<p className="break-nudge-hint">{breakNudgeCopy(t, nudge).hint}</p>}<BreakRankList records={displayedBreaks}/>
      <p className="chart-summary">{breakView==="players"?t("每位球員只顯示其最高單桿。"):breakView==="overall"?t("按所有已確認賽事的單桿記錄排名，同一球員可重複上榜。"):t("{thirtyDaysAgo} 至 {today} 的最高單桿，每位球員只顯示其最高單桿。", {thirtyDaysAgo, today})}</p></>}
    </TabPanel>}
    {squad&&<>
    <TabPanel id={homeTabsId} value="squad" active={homeView==="squad"}><SquadStatsPanel squad={squad} players={data.players} matches={data.matches} ownPlayerId={ownPlayerId} onPlayer={id=>{const player=data.players.find(p=>p.id===id);if(player)onPlayer(player)}} onPair={(first,second)=>{const one=data.players.find(p=>p.id===first),two=data.players.find(p=>p.id===second);if(one&&two)onRivalry(one,two)}}/><TrendSection players={ranked.filter(p=>squadIds?.has(p.id))} data={data}/></TabPanel>
    <TabPanel id={homeTabsId} value="matrix" active={homeView==="matrix"}><HeadToHeadMatrix squad={squad} data={data} ownPlayerId={ownPlayerId} onOpenPair={(first,second)=>{const one=data.players.find(p=>p.id===first),two=data.players.find(p=>p.id===second);if(one&&two)onRivalry(one,two)}}/></TabPanel></>}
    {!squad&&<TabPanel id={homeTabsId} value="recent" active={homeView==="recent"}><TrendSection players={ranked} data={data}/><ThirtyDayStats data={data} onPlayer={onPlayer} onMatch={onMatch} onRivalry={onRivalry}/></TabPanel>}</>}</>;
}

/** The Elo trend chart, which used to hide behind a ranking toggle, now heads the Stats tab. */
export function TrendSection({players,data}:{players:Player[];data:AppState}){
  const t = useT();
  return <section className="home-view-panel trend-panel" aria-labelledby="trend-title">
    <div className="home-panel-head"><div><h2 id="trend-title">{t("ELO走勢")}</h2><p>{t("各球員 ELO 評分隨日期的走勢，取每日最後一場賽事後的評分。")}</p></div></div>
    <EloTrendChart players={players} data={data}/>
  </section>;
}

export function HomeLoadingSkeleton() {
  const t = useT();
  return <section className="home-loading-skeleton" aria-busy="true" aria-label={t("正在載入球會資料")}>
    <span className="sr-only">{t("正在載入球會資料")}</span>
    <div className="home-loading-hero" aria-hidden="true">
      <div className="home-loading-hero-copy">
        <Skeleton width="8rem" height=".75rem" />
        <Skeleton width="min(24rem, 80%)" height="clamp(3.8rem, 9vw, 5.2rem)" className="home-loading-title" />
        <Skeleton width="min(30rem, 90%)" height="1rem" />
        <div className="home-loading-stats"><Skeleton width="5rem" height="2.2rem" /><Skeleton width="5rem" height="2.2rem" /><Skeleton width="5rem" height="2.2rem" /></div>
      </div>
      <Skeleton width="13rem" height="4.5rem" className="home-loading-action" />
    </div>
    <div className="home-loading-tabs" aria-hidden="true"><Skeleton width="5.5rem" height="1rem" /><Skeleton width="7rem" height="1rem" /><Skeleton width="7rem" height="1rem" /></div>
    <section className="home-loading-panel" aria-hidden="true">
      <div className="home-loading-panel-head"><div><Skeleton width="7rem" height=".75rem" /><Skeleton width="8rem" height="1.9rem" /><Skeleton width="min(26rem, 90%)" height=".9rem" /></div><Skeleton width="14rem" height="2.75rem" className="home-loading-toggle" /></div>
      <div className="home-loading-podium"><Skeleton height="8.5rem" /><Skeleton height="10rem" /><Skeleton height="8.5rem" /></div>
      <div className="home-loading-table"><div className="home-loading-table-head"><Skeleton height=".75rem" /><Skeleton height=".75rem" /><Skeleton height=".75rem" /><Skeleton height=".75rem" /></div>{Array.from({length:5},(_,index)=><div className="home-loading-row" key={index}><Skeleton width="2rem" height="1rem" /><span><Skeleton width="2.75rem" height="2.75rem" className="home-loading-avatar" /><Skeleton width="7rem" height=".9rem" /></span><Skeleton width="5rem" height="1.2rem" /><Skeleton width="4rem" height="1.2rem" /></div>)}</div>
    </section>
  </section>;
}

export function trendDateLabel(date:string){return date.replace(/-/g,"/");}
export function trendAxisDateLabel(date:string){return `${date.slice(2,4)}/${date.slice(5).replace("-","/")}`;}
export function useMediaQuery(query:string){
  const [matches,setMatches]=useState(false);
  useEffect(()=>{
    const mq=window.matchMedia(query),update=()=>setMatches(mq.matches);
    update();
    mq.addEventListener("change",update);
    return ()=>mq.removeEventListener("change",update);
  },[query]);
  return matches;
}
export function EloTrendChart({players,data}:{players:Player[];data:AppState}) {
  const t = useT();
  const narrow=useMediaQuery("(max-width:599px)");
  const ranked=useMemo(()=>players.filter(p=>games(p)>0).sort((a,b)=>b.rating-a.rating),[players]);
  const [hiddenIds,setHiddenIds]=useState<Set<string>>(()=>new Set(ranked.slice(5).map(p=>p.id)));
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const plotRef=useRef<HTMLDivElement>(null);
  const shownPlayers=ranked.filter(p=>!hiddenIds.has(p.id));
  const {dates,series}=useMemo(()=>eloTrendSeries(t, shownPlayers,data),[shownPlayers,data, t]);
  const toggle=(id:string)=>{setActiveIndex(null);setHiddenIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})};
  const deselectAll=()=>{setActiveIndex(null);setHiddenIds(new Set(ranked.map(p=>p.id)))};
  if(ranked.length===0) return players.length===0
    ? <Empty text={t("尚未有球員")} sub={t("前往球員頁面新增第一位球員。")}/>
    : <Empty text={t("尚未有賽事紀錄")} sub={t("累積賽事後即可查看 ELO 走勢。")}/>;
  const legend=<>
    <div className="trend-legend-actions"><button type="button" className="trend-clear-btn" onClick={deselectAll} disabled={shownPlayers.length===0}><span>{t("取消全選")}</span></button></div>
    <ul className="trend-legend">{ranked.map(p=>{const hidden=hiddenIds.has(p.id);
      return <li key={p.id}><button type="button" className={`trend-legend-item${hidden?" hidden":""}`} aria-pressed={!hidden} onClick={()=>toggle(p.id)}><i style={{background:avatarHex(p.colour)}}/><span>{p.name}</span><b>{Math.round(p.rating)}</b></button></li>})}
    </ul>
  </>;
  if(shownPlayers.length===0) return <>
    <Empty text={t("尚未選擇球員")} sub={t("請於下方選擇至少一位球員以顯示 ELO 走勢。")}/>
    {legend}
  </>;
  if(dates.length===0) return <>
    <Empty text={t("尚未有賽事紀錄")} sub={t("所選球員累積賽事後即可查看 ELO 走勢。")}/>
    {legend}
  </>;
  const values=series.flatMap(s=>s.values).filter((v):v is number=>v!=null);
  const rawMin=Math.min(...values),rawMax=Math.max(...values);
  const observed=Math.max(1,rawMax-rawMin),visualRange=Math.max(24,observed*1.15);
  const middle=(rawMin+rawMax)/2,min=middle-visualRange/2,max=middle+visualRange/2;
  const lineEnd=78;
  const x=(index:number)=>dates.length<=1?50:3+index/(dates.length-1)*(lineEnd-3);
  const y=(value:number)=>54-(value-min)/(max-min)*46;
  const yTicks=[max,(max+middle)/2,middle,(middle+min)/2,min];
  const xTickCount=Math.min(dates.length,narrow?3:6);
  const xTickIndexes=Array.from(new Set(Array.from({length:xTickCount},(_,i)=>Math.round(i/(xTickCount-1||1)*(dates.length-1)))));
  const updateActive=(clientX:number)=>{
    const rect=plotRef.current?.getBoundingClientRect();
    if(!rect||dates.length===0) return;
    const fraction=Math.min(1,Math.max(0,(clientX-rect.left)/rect.width));
    const raw=((fraction*100-3)/(lineEnd-3))*(dates.length-1);
    setActiveIndex(Math.min(dates.length-1,Math.max(0,Math.round(raw))));
  };
  const activeAbove=activeIndex!=null&&x(activeIndex)>lineEnd-16;
  const lastIndex=dates.length-1;
  const endLabels=(()=>{
    const minGap=9;
    const lastValue=(s:typeof series[number])=>s.values[lastIndex]!;
    const sorted=[...series].sort((a,b)=>y(lastValue(a))-y(lastValue(b)));
    const tops=sorted.map(s=>y(lastValue(s))/60*100);
    for(let i=1;i<tops.length;i++) if(tops[i]-tops[i-1]<minGap) tops[i]=tops[i-1]+minGap;
    for(let i=tops.length-2;i>=0;i--) if(tops[i+1]-tops[i]<minGap) tops[i]=tops[i+1]-minGap;
    return sorted.map((s,i)=>({player:s.player,value:lastValue(s),anchor:y(lastValue(s))/60*100,top:tops[i]}));
  })();
  return <>
    <div className="multi-trend-chart">
      <div className="multi-trend-yaxis" aria-hidden="true">{yTicks.map((v,i)=><span key={i} style={{top:`${y(v)/60*100}%`}}>{Math.round(v)}</span>)}</div>
      <div className="trend-plot multi-trend-plot" ref={plotRef}
        onPointerMove={e=>updateActive(e.clientX)}
        onPointerDown={e=>updateActive(e.clientX)}
        onPointerLeave={()=>setActiveIndex(null)}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={t("各球員 ELO 走勢圖")}>
          {yTicks.map((v,i)=><line key={i} x1="0" y1={y(v)} x2="100" y2={y(v)} className="trend-grid"/>)}
          {activeIndex!=null&&<line x1={x(activeIndex)} y1="2" x2={x(activeIndex)} y2="58" className="trend-guide"/>}
          {series.map(s=><polyline key={s.player.id} points={s.values.map((v,i)=>v==null?null:`${x(i)},${y(v)}`).filter((p):p is string=>p!=null).join(" ")} className="multi-trend-line" style={{stroke:avatarHex(s.player.colour)}}/>)}
          {endLabels.map(({player,anchor,top})=>Math.abs(top-anchor)>0.6&&<line key={player.id} x1={x(lastIndex)} y1={anchor/100*60} x2={x(lastIndex)} y2={top/100*60} className="multi-trend-leader" style={{stroke:avatarHex(player.colour)}}/>)}
        </svg>
        {activeIndex!=null&&series.map(s=>s.values[activeIndex]!=null&&<span key={s.player.id} className="multi-trend-dot" style={{left:`${x(activeIndex)}%`,top:`${y(s.values[activeIndex]!)/60*100}%`,background:avatarHex(s.player.colour)}} aria-hidden="true"/>)}
        {endLabels.map(({player,anchor})=><span key={player.id} className="multi-trend-endpoint" style={{left:`${x(lastIndex)}%`,top:`${anchor}%`,background:avatarHex(player.colour)}} aria-hidden="true"/>)}
        {activeIndex!=null&&<div className={`multi-trend-tooltip${activeAbove?" align-right":""}`} style={{left:`${x(activeIndex)}%`}} role="status">
          <small>{trendDateLabel(dates[activeIndex])}</small>
          <ul>{[...series].filter(s=>s.values[activeIndex!]!=null).sort((a,b)=>b.values[activeIndex!]!-a.values[activeIndex!]!).map(s=><li key={s.player.id}><i style={{background:avatarHex(s.player.colour)}}/><span>{s.player.name}</span><em>{t("{v} 場", {v: s.counts[activeIndex!]})}</em><b>{Math.round(s.values[activeIndex!]!)}</b></li>)}</ul>
        </div>}
        <div className="multi-trend-endlabels" aria-hidden="true">{endLabels.map(({player,value,top})=><div key={player.id} className="multi-trend-endlabel" style={{left:`${x(lastIndex)}%`,top:`${top}%`,color:avatarHex(player.colour)}}><b>{narrow?player.short:player.name}</b><span>{Math.round(value)}</span></div>)}</div>
      </div>
      <div className="multi-trend-xaxis">{xTickIndexes.map(i=><span key={i} style={{left:`${x(i)}%`}}>{trendAxisDateLabel(dates[i])}</span>)}</div>
    </div>
    {legend}
    <p className="chart-summary">{t("點按下方球員名稱可切換顯示；移至圖表可查看該日各球員的 ELO 及累積場數。目前顯示 {shownPlayers} 位球員，共 {dates} 個有賽事的日期。", {shownPlayers: shownPlayers.length, dates: dates.length})}</p>
  </>;
}

export function RecentStatIcon({kind}:{kind:"matches"|"frames"|"players"|"average"|"active"|"elo"|"win"|"break"}) {
  const paths={
    matches:<><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="m10.5 10.5 3 3"/></>,
    frames:<><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 9h8M8 13h5"/></>,
    players:<><circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.4-5.3 5.5-5.3s5.5 2.3 5.5 5.3M15 6.5a3 3 0 0 1 0 5.8M16 14c2.6.3 4.5 2.3 4.5 5"/></>,
    average:<><path d="M5 18V9M12 18V5M19 18v-6"/><path d="M3 18h18"/></>,
    active:<><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    elo:<><path d="m5 15 4-4 3 3 7-8"/><path d="M14 6h5v5"/></>,
    win:<><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M5 6H3v1a4 4 0 0 0 4 4M19 6h2v1a4 4 0 0 1-4 4M12 13v4M8 20h8"/></>,
    break:<><circle cx="7" cy="15" r="3"/><circle cx="14" cy="9" r="3"/><circle cx="17" cy="17" r="3"/></>
  };
  return <span className="recent-stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24">{paths[kind]}</svg></span>;
}
export function ThirtyDayStats({data,onPlayer,onMatch,onRivalry}:{data:AppState;onPlayer:(player:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}){
  const t = useT();
  const stats=useMemo(()=>{
    const matches=data.matches.filter(match=>match.status==="confirmed"&&isInPastThirtyDays(match.playedOn));
    const playerById=new Map(data.players.map(player=>[player.id,player]));
    const perPlayer=new Map<string,{matches:number;wins:number;delta:number;frames:number}>();
    const touch=(id:string)=>{const current=perPlayer.get(id)??{matches:0,wins:0,delta:0,frames:0};perPlayer.set(id,current);return current};
    for(const match of matches){
      const a=touch(match.a),b=touch(match.b),frames=match.scoreA+match.scoreB;
      a.matches++;b.matches++;a.frames+=frames;b.frames+=frames;a.delta+=match.deltaA;b.delta-=match.deltaA;
      if(match.scoreA>match.scoreB)a.wins++;else if(match.scoreB>match.scoreA)b.wins++;
    }
    const entries=[...perPlayer.entries()].filter(([id])=>playerById.has(id));
    const pick=(sorter:(a:[string,{matches:number;wins:number;delta:number;frames:number}],b:[string,{matches:number;wins:number;delta:number;frames:number}])=>number)=>entries.slice().sort(sorter)[0];
    const busiest=pick((a,b)=>b[1].matches-a[1].matches||b[1].frames-a[1].frames);
    const mover=pick((a,b)=>b[1].delta-a[1].delta||b[1].matches-a[1].matches);
    const qualified=entries.filter(([,value])=>value.matches>=3).sort((a,b)=>b[1].wins/b[1].matches-a[1].wins/a[1].matches||b[1].matches-a[1].matches)[0];
    const topBreak=matches.flatMap(match=>(match.highBreaks??[]).map(item=>({player:playerById.get(item.playerId),value:item.value,date:match.playedOn}))).filter(item=>item.player&&item.value>0&&item.value<=147).sort((a,b)=>b.value-a.value||(b.date||"").localeCompare(a.date||""))[0];
    const pairCounts=new Map<string,{a:string;b:string;matches:number;framesA:number;framesB:number}>();
    for(const match of matches){const first=match.a<match.b,key=first?`${match.a}|${match.b}`:`${match.b}|${match.a}`,record=pairCounts.get(key)??{a:first?match.a:match.b,b:first?match.b:match.a,matches:0,framesA:0,framesB:0};record.matches++;record.framesA+=first?match.scoreA:match.scoreB;record.framesB+=first?match.scoreB:match.scoreA;pairCounts.set(key,record)}
    const rivalry=[...pairCounts.values()].filter(pair=>playerById.has(pair.a)&&playerById.has(pair.b)).sort((a,b)=>b.matches-a.matches||(b.framesA+b.framesB)-(a.framesA+a.framesB))[0];
    const closest=matches.slice().sort((a,b)=>Math.abs(a.scoreA-a.scoreB)-Math.abs(b.scoreA-b.scoreB)||(b.scoreA+b.scoreB)-(a.scoreA+a.scoreB)||(b.playedOn||b.createdAt).localeCompare(a.playedOn||a.createdAt))[0];
    const totalFrames=matches.reduce((sum,match)=>sum+match.scoreA+match.scoreB,0);
    const weekCounts=[0,0,0,0];
    for(const match of matches){const age=Math.max(0,Math.floor((Date.parse(`${today}T00:00:00+08:00`)-Date.parse(`${match.playedOn}T00:00:00+08:00`))/864e5)),bucket=Math.min(3,Math.floor(age/7));weekCounts[3-bucket]++}
    const decisive=matches.filter(match=>match.scoreA!==match.scoreB).length,draws=matches.length-decisive;
    const closeMatches=matches.filter(match=>Math.abs(match.scoreA-match.scoreB)<=1).length;
    const averageMargin=matches.reduce((sum,match)=>sum+Math.abs(match.scoreA-match.scoreB),0)/matches.length;
    return {matches,totalFrames,active:entries.length,average:matches.length?totalFrames/matches.length:0,busiest:busiest&&{player:playerById.get(busiest[0])!,...busiest[1]},mover:mover&&{player:playerById.get(mover[0])!,...mover[1]},winRate:qualified&&{player:playerById.get(qualified[0])!,...qualified[1]},topBreak,rivalry:rivalry&&{...rivalry,aPlayer:playerById.get(rivalry.a)!,bPlayer:playerById.get(rivalry.b)!},closest,weekCounts,decisive,draws,closeMatches,averageMargin};
  },[data]);
  // Historical imports can contain a non-string participant/name value. Keep
  // the dashboard presentable instead of letting an unexpected record reach JSX.
  const playerName=(id:unknown)=>{
    const player=typeof id==="string"?data.players.find(candidate=>candidate.id===id):undefined;
    return typeof player?.name==="string"?player.name:t("已移除球員");
  };
  if(!stats.matches.length)return <section className="home-view-panel recent-stats-panel"><div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2>{t("近三十日統計")}</h2><p>{t("最近三十日暫時未有已確認賽事。")}</p></div></div><Empty text={t("未有近期賽事")} sub={t("記錄新賽果後，活躍度與近期焦點會顯示在這裡。")}/></section>;
  const maxWeek=Math.max(1,...stats.weekCounts);
  return <section className="home-view-panel recent-stats-panel" aria-labelledby="recent-stats-title">
    <div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2 id="recent-stats-title">{t("近三十日統計")}</h2><p>{t("{thirtyDaysAgo} 至 {today} 的已確認賽事。", {thirtyDaysAgo, today})}</p></div></div>
    <div className="recent-stat-metrics">
      <div><RecentStatIcon kind="matches"/><span><small>{t("比賽場數")}</small><b>{stats.matches.length}</b></span></div>
      <div><RecentStatIcon kind="frames"/><span><small>{t("總局數")}</small><b>{stats.totalFrames}</b></span></div>
      <div><RecentStatIcon kind="players"/><span><small>{t("活躍球員")}</small><b>{stats.active}</b></span></div>
      <div><RecentStatIcon kind="average"/><span><small>{t("平均每場")}</small><b>{stats.average.toFixed(1)}<em>{t("局")}</em></b></span></div>
    </div>
    <div className="recent-focus-grid">
      {stats.busiest&&<button onClick={()=>onPlayer(stats.busiest!.player)}><span className="recent-focus-label"><RecentStatIcon kind="active"/>{t("最活躍球員")}</span><PlayerBadge className="recent-player-badge" player={stats.busiest.player}/><span className="recent-focus-person"><b>{stats.busiest.player.name}</b><em>{t("{matches} 場 · {frames} 局", {matches: stats.busiest.matches, frames: stats.busiest.frames})}</em></span></button>}
      {stats.mover&&<button onClick={()=>onPlayer(stats.mover!.player)}><span className="recent-focus-label"><RecentStatIcon kind="elo"/>{t("ELO 升幅最高")}</span><PlayerBadge className="recent-player-badge" player={stats.mover.player}/><span className="recent-focus-person"><b>{stats.mover.player.name}</b><em className={stats.mover.delta>=0?"positive":"negative"}>{stats.mover.delta>=0?"+":""}{Math.round(stats.mover.delta)} ELO</em></span></button>}
      {stats.winRate&&<button onClick={()=>onPlayer(stats.winRate!.player)}><span className="recent-focus-label"><RecentStatIcon kind="win"/>{t("最高勝率 · 至少 3 場")}</span><PlayerBadge className="recent-player-badge" player={stats.winRate.player}/><span className="recent-focus-person"><b>{stats.winRate.player.name}</b><em>{t("{v}% · {wins}/{matches} 勝", {v: Math.round(stats.winRate.wins/stats.winRate.matches*100), wins: stats.winRate.wins, matches: stats.winRate.matches})}</em></span></button>}
      {stats.topBreak&&<button onClick={()=>onPlayer(stats.topBreak!.player!)}><span className="recent-focus-label"><RecentStatIcon kind="break"/>{t("近三十日最高單桿")}</span><PlayerBadge className="recent-player-badge" player={stats.topBreak.player!}/><span className="recent-focus-person"><b>{stats.topBreak.player!.name}</b><em>{t("{value} 分 · {date}", {value: stats.topBreak.value, date: stats.topBreak.date})}</em></span></button>}
    </div>
    <div className="recent-chart-grid">
      <Surface as="article" className="recent-chart-card recent-activity-chart"><header><div><small>ACTIVITY</small><h3>{t("每週比賽走勢")}</h3></div><strong>{stats.matches.length}<small>{t("場")}</small></strong></header><div className="recent-week-chart" aria-label={t("過去四週比賽場數：{v}", {v: stats.weekCounts.join(t("、"))})}>{stats.weekCounts.map((value,index)=><div key={`week-${index}`}><span><i style={{height:`${Math.max(8,value/maxWeek*100)}%`}}/></span><b>{value}</b><small>{t("第 {v} 週", {v: index+1})}</small></div>)}</div></Surface>
      <Surface as="article" className="recent-chart-card recent-outcome-chart"><header><div><small>OUTCOMES</small><h3>{t("賽事結果分布")}</h3></div></header><div className="recent-donut-wrap"><div className="recent-donut" style={{"--decisive":`${stats.decisive/stats.matches.length*360}deg`} as Record<string,string>}><span><b>{Math.round(stats.decisive/stats.matches.length*100)}%</b><small>{t("分勝負")}</small></span></div><div className="recent-chart-legend"><span><i className="decisive"/><b>{t("分勝負")}</b><em>{t("{decisive} 場", {decisive: stats.decisive})}</em></span><span><i className="draw"/><b>{t("和局")}</b><em>{t("{draws} 場", {draws: stats.draws})}</em></span></div></div></Surface>
      <Surface as="article" className="recent-chart-card recent-balance-chart"><header><div><small>COMPETITION</small><h3>{t("對賽緊湊度")}</h3></div></header><div className="recent-balance-hero"><b>{Math.round(stats.closeMatches/stats.matches.length*100)}<small>%</small></b><span>{t("賽事僅相差一局或以下")}</span></div><footer><span>{t("緊湊賽事")} <b>{stats.closeMatches}</b></span><span>{t("平均差距")} <b>{t("{v} 局", {v: stats.averageMargin.toFixed(1)})}</b></span></footer></Surface>
    </div>
    <div className="recent-detail-grid">
      {stats.rivalry&&<Surface as="button" className="recent-detail-card" onClick={()=>onRivalry(stats.rivalry!.aPlayer,stats.rivalry!.bPlayer)} aria-label={t("查看 {name} 對 {name2} 的對賽紀錄", {name: stats.rivalry.aPlayer.name, name2: stats.rivalry.bPlayer.name})}><small>{t("熱門對賽")}</small><b>{stats.rivalry.aPlayer.name} × {stats.rivalry.bPlayer.name}</b><p>{t("{matches} 場 · 局數 {framesA}–{framesB}", {matches: stats.rivalry.matches, framesA: stats.rivalry.framesA, framesB: stats.rivalry.framesB})}</p><span>{t("查看對賽紀錄 →")}</span></Surface>}
      {stats.closest&&<Surface as="button" className="recent-detail-card recent-close-card" onClick={()=>onMatch(stats.closest!)} aria-label={t("查看 {v} 對 {v2} 的賽事", {v: playerName(stats.closest.a), v2: playerName(stats.closest.b)})}><small>{t("最接近賽事")}</small><b>{playerName(stats.closest.a)} {stats.closest.scoreA}–{stats.closest.scoreB} {playerName(stats.closest.b)}</b><p>{t("{playedOn} · 相差 {v} 局", {playedOn: stats.closest.playedOn, v: Math.abs(stats.closest.scoreA-stats.closest.scoreB)})}</p><span>{t("查看賽事 →")}</span></Surface>}
    </div>  </section>;
}
export function fadeHex(hex:string,alpha:number){
  const value=hex.replace("#","");
  const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* Diverging heat scale centred on the coin-flip: favoured players warm the brand green,
   underdogs warm the same red used for "behind" elsewhere, intensity tracking distance
   from 50/50 so a 51% toss-up reads as flat as the legend promises. */
export function winRateHeat(rate:number){
  const diff=(rate-50)/50;
  const intensity=Math.min(1,Math.abs(diff));
  const hex=diff>=0?"#155e52":"#ad5149";
  return {background:fadeHex(hex,.1+intensity*.55),color:intensity>.62?"#fff":undefined};
}

export const monthGroupLabel=(t: Translator, month:string)=>{
  const [y,m]=month.split("-").map(Number);
  const now=new Date(),thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  if(month===thisMonth)return t("本月");
  const last=shiftMonth(thisMonth,-1);
  if(month===last)return t("上月");
  return monthYearLabel(y,m,t.locale);
};

/* Every pair that has ever met, keyed by the two ids in a stable order, so a
   meeting counts the same whichever way round it was recorded. Any singles
   match counts — regular 1v1 and cup ties alike — since both are individual
   head-to-head results; only 2v2 team matches are excluded. */
export type H2HRecord={wins:Record<string,number>;draws:number;frames:Record<string,number>;total:number;last:string};
export function headToHeadIndex(matches:Match[]){
  const index=new Map<string,H2HRecord>();
  for(const match of matches){
    if(match.status!=="confirmed"||isEntertainmentMode(match.mode)||matchMode(match)==="2v2")continue;
    const [first,second]=[match.a,match.b].sort();
    if(!first||!second||first===second)continue;
    const key=`${first}|${second}`;
    const record=index.get(key)??{wins:{[first]:0,[second]:0},draws:0,frames:{[first]:0,[second]:0},total:0,last:""};
    const scoreFirst=match.a===first?match.scoreA:match.scoreB;
    const scoreSecond=match.a===first?match.scoreB:match.scoreA;
    record.frames[first]+=scoreFirst;
    record.frames[second]+=scoreSecond;
    if(scoreFirst>scoreSecond)record.wins[first]++;else if(scoreSecond>scoreFirst)record.wins[second]++;else record.draws++;
    record.total++;
    if(match.playedOn>record.last)record.last=match.playedOn;
    index.set(key,record);
  }
  return index;
}
export const h2hKey=(first:string,second:string)=>[first,second].sort().join("|");
export function actualFrameWinRate(record:H2HRecord,id:string,otherId:string){
  return Math.round(record.frames[id]/Math.max(1,record.frames[id]+record.frames[otherId])*100);
}
export type H2HPlayerStats={opponents:number;framesWon:number;framesPlayed:number};
export function headToHeadPlayerStats(index:Map<string,H2HRecord>){
  const stats=new Map<string,H2HPlayerStats>();
  const add=(playerId:string,framesWon:number,framesPlayed:number)=>{
    const current=stats.get(playerId)??{opponents:0,framesWon:0,framesPlayed:0};
    current.opponents++;
    current.framesWon+=framesWon;
    current.framesPlayed+=framesPlayed;
    stats.set(playerId,current);
  };
  for(const [key,record] of index){
    const [first,second]=key.split("|");
    const framesFirst=record.frames[first]??0;
    const framesSecond=record.frames[second]??0;
    add(first,framesFirst,framesFirst+framesSecond);
    add(second,framesSecond,framesFirst+framesSecond);
  }
  return stats;
}

/* The club kept asking "how do I stand against everyone?" and the only answer
   was to pick opponents one at a time in the filter bar. This is the index for
   that: every cell is a tap through to the existing head-to-head view, which
   stays the one place a rivalry is read in full.

   Phone-first, so the *list* is the primary shape — one focused player, one row
   per opponent, no horizontal scrolling and full-width tap targets. The grid is
   the same data for anyone with the width for it, and is reachable on a phone
   too (it scrolls sideways under a pinned name column). */
/* A full-roster grid or heatmap runs wide fast — panning with two thumbs works but nobody
   discovers it unassisted. Explicit +/- controls (with a tap-to-reset percentage) give the
   same shrink-to-fit-more/grow-to-read power without relying on a gesture the toolbar can't
   hint at. Scaling through a CSS variable — not a transform — keeps position:sticky headers
   and row names working exactly as before, just at a different rem size. */
export const MATRIX_ZOOM_MIN=.45,MATRIX_ZOOM_MAX=1.8;
export const clampMatrixZoom=(value:number)=>Math.min(MATRIX_ZOOM_MAX,Math.max(MATRIX_ZOOM_MIN,Math.round(value*100)/100));
export function HeadToHeadMatrix({squad,data,ownPlayerId,onOpenPair}:{squad:MySquad|null;data:AppState;ownPlayerId?:string;onOpenPair:(first:string,second:string)=>void}){
  const t = useT();
  const index=useMemo(()=>headToHeadIndex(data.matches),[data.matches]);
  const playerStats=useMemo(()=>headToHeadPlayerStats(index),[index]);
  // Only players who have actually met somebody: an all-players grid is mostly
  // empty cells, and empty cells are the enemy of a readable matrix.
  const players=useMemo(()=>{
    const met=new Set<string>();
    for(const key of index.keys()){const [first,second]=key.split("|");met.add(first);met.add(second)}
    const members=squad?new Set(squad.members.map(member=>member.playerId)):null;
    return data.players.filter(player=>met.has(player.id)&&(!members||members.has(player.id))).sort((left,right)=>right.rating-left.rating||left.name.localeCompare(right.name,"zh-HK"));
  },[data.players,index,squad]);
  // How much of the squad's possible pairings have actually been played.
  const pairs=useMemo(()=>{
    if(!squad)return null;
    const ids=new Set(squad.members.map(member=>member.playerId).filter(id=>data.players.some(player=>player.id===id)));
    let met=0;
    for(const key of index.keys()){const [first,second]=key.split("|");if(ids.has(first)&&ids.has(second))met++}
    return {met,total:ids.size*(ids.size-1)/2};
  },[squad,index,data.players]);
  const [mode,setMode]=useState<"grid"|"heatmap">(squad?"heatmap":"grid");
  const [zoom,setZoom]=useState(1);
  const sectionRef=useRef<HTMLElement>(null);
  const zoomRef=useRef(zoom);
  useEffect(()=>{zoomRef.current=zoom},[zoom]);
  // The table is rem-sized off --matrix-zoom, so its width scales linearly with zoom and
  // the fitting zoom is just the current zoom times (available width / current width).
  const fitZoom=()=>{
    const scroller=sectionRef.current?.querySelector<HTMLElement>(".h2h-matrix-scroll");
    if(!scroller||!scroller.scrollWidth)return;
    setZoom(Math.min(1,clampMatrixZoom(Math.floor(zoomRef.current*scroller.clientWidth/scroller.scrollWidth*100)/100)));
  };
  // Open already fitted to the screen, so most people never touch the zoom control.
  useEffect(()=>{const frame=requestAnimationFrame(fitZoom);return()=>cancelAnimationFrame(frame)},[mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Two-finger pinch on the grid drives the same zoom the buttons do. touch-action in CSS
  // hands pinches to us instead of the browser; one-finger panning is untouched.
  useEffect(()=>{
    const el=sectionRef.current;
    if(!el)return;
    let startDistance=0,startZoom=1;
    const distance=(event:TouchEvent)=>Math.hypot(event.touches[0].clientX-event.touches[1].clientX,event.touches[0].clientY-event.touches[1].clientY);
    const onStart=(event:TouchEvent)=>{if(event.touches.length===2){startDistance=distance(event);startZoom=zoomRef.current}};
    const onMove=(event:TouchEvent)=>{
      if(event.touches.length!==2||!startDistance)return;
      event.preventDefault();
      setZoom(clampMatrixZoom(startZoom*distance(event)/startDistance));
    };
    const onEnd=()=>{startDistance=0};
    // Desktop: hold Ctrl (or ⌘) and scroll to zoom, like a map. Plain scrolling is left alone.
    const onWheel=(event:WheelEvent)=>{
      if(!event.ctrlKey&&!event.metaKey)return;
      event.preventDefault();
      setZoom(clampMatrixZoom(zoomRef.current*(event.deltaY<0?1.08:1/1.08)));
    };
    el.addEventListener("wheel",onWheel,{passive:false});
    el.addEventListener("touchstart",onStart,{passive:true});
    el.addEventListener("touchmove",onMove,{passive:false});
    el.addEventListener("touchend",onEnd);
    el.addEventListener("touchcancel",onEnd);
    return()=>{el.removeEventListener("wheel",onWheel);el.removeEventListener("touchstart",onStart);el.removeEventListener("touchmove",onMove);el.removeEventListener("touchend",onEnd);el.removeEventListener("touchcancel",onEnd)};
  },[]);
  // No row is singled out: the matrix reads the same for everyone, signed in or not.
  const focusId="";
  if(players.length===0)return <Empty text={t("尚未有對賽記錄")} sub={t("記錄第一場 1v1 比賽後，球員之間的對賽矩陣會顯示在這裡。")}/>;

  return <section ref={sectionRef} className="h2h-matrix" data-compact={zoom<.85?"true":undefined} aria-label={t("對賽矩陣")} style={{"--matrix-zoom":zoom} as CSSProperties}>
    <div className="h2h-matrix-toolbar">
      <Menu className="board-scope" label={t("對賽矩陣")} align="start" triggerClassName="board-scope__trigger"
        trigger={()=><><span className="board-scope__title">{mode==="grid"?t("局數比分"):t("勝率")}</span><ChevronDown/></>}
        sections={[{items:[{key:"grid",label:t("局數比分"),checked:mode==="grid",onSelect:()=>setMode("grid")},{key:"heatmap",label:t("勝率"),checked:mode==="heatmap",onSelect:()=>setMode("heatmap")}]}]}/>
      <div className="h2h-zoom" role="group" aria-label={t("縮放")}>
        <button type="button" className="h2h-zoom-step" onClick={()=>setZoom(clampMatrixZoom(zoom/1.15))} disabled={zoom<=MATRIX_ZOOM_MIN} aria-label={t("縮小")}>−</button>
        <button type="button" className="h2h-zoom-value" onClick={()=>zoom===1?fitZoom():setZoom(1)} title={zoom!==1?t("重設縮放至 100%"):t("縮放至符合畫面")}>{Math.round(zoom*100)}%</button>
        <button type="button" className="h2h-zoom-step" onClick={()=>setZoom(clampMatrixZoom(zoom*1.15))} disabled={zoom>=MATRIX_ZOOM_MAX} aria-label={t("放大")}>+</button>
      </div>
    </div>
    {pairs&&pairs.total>0&&<p className="h2h-pairs">{t("{met} / {total} 組已交手",{met:pairs.met,total:pairs.total})}</p>}
    {mode==="heatmap"?<WinRateHeatmap players={players} index={index} focusId={focusId} onOpenPair={onOpenPair}/>
    :<>
      <div className="h2h-matrix-scroll">
        <table className="h2h-matrix-grid">
          <caption className="sr-only">{t("球員之間的 1v1 對賽局數勝負矩陣，橫行球員對直行球員")}</caption>
          <thead><tr><th scope="col" className="h2h-corner-cell" aria-hidden="true"></th>{players.map(player=><th key={player.id} scope="col" title={player.name}>{player.short||player.name.slice(0,2)}</th>)}</tr></thead>
          <tbody>{players.map(row=>{
            const stats=playerStats.get(row.id)??{opponents:0,framesWon:0,framesPlayed:0};
            const rate=stats.framesPlayed?Math.round(stats.framesWon/stats.framesPlayed*100):0;
            const statsLabel=t("對手 {opponents} 位 · 勝局 {framesWon} 局 · 局數勝率 {rate}%", {opponents: stats.opponents, framesWon: stats.framesWon, rate});
            return <tr key={row.id} className={row.id===focusId?"focused":""}>
            <th scope="row"><span className="h2h-matrix-rowhead"><span className="h2h-matrix-player-trigger" tabIndex={0} title={t("{name}：{statsLabel}", {name: row.name, statsLabel})} aria-describedby={`h2h-player-stats-${row.id}`}><PlayerBadge player={row}/><span className="h2h-matrix-player-name-text">{row.short||row.name}</span><span className="h2h-matrix-player-stats" id={`h2h-player-stats-${row.id}`} role="tooltip"><b>{row.name}</b><span>{statsLabel}</span></span></span></span></th>
            {players.map(column=>{
              if(column.id===row.id)return <td key={column.id} className="self" aria-label={t("同一位球員")}>—</td>;
              const record=index.get(h2hKey(row.id,column.id));
              if(!record)return <td key={column.id} className="none" aria-label={t("{name} 與 {name2} 未曾交手", {name: row.name, name2: column.name})}>·</td>;
              const share=actualFrameWinRate(record,row.id,column.id);
              const framesWon=record.frames[row.id],framesLost=record.frames[column.id];
              return <td key={column.id} className={share>50?"ahead":share<50?"behind":"level"}>
                <button type="button" onClick={()=>onOpenPair(row.id,column.id)} aria-label={t("{name} 對 {name2}：局數 {framesWon} 勝 {framesLost} 負，共 {total} 場", {name: row.name, name2: column.name, framesWon, framesLost, total: record.total})}>
                  <b>{framesWon}<em>–</em>{framesLost}</b>
                </button>
              </td>;
            })}
          </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="h2h-matrix-legend"><span><i className="ahead"/>{t("領先")}</span><span><i className="level"/>{t("均勢")}</span><span><i className="behind"/>{t("落後")}</span><span><i className="none"/>{t("未交手")}</span></div>
    </>}
  </section>;
}

/* "誰打得贏誰" now reflects recorded frames, not an ELO forecast. A diverging heat scale
   keeps the same scan-friendly shape while blanking pairings with no actual meeting. */
export function WinRateHeatmap({players,index,focusId,onOpenPair}:{players:Player[];index:Map<string,H2HRecord>;focusId:string;onOpenPair:(first:string,second:string)=>void}){
  const t = useT();
  if(players.length<2)return <Empty text={t("尚未有足夠對賽記錄")} sub={t("至少兩位球員記錄過 1v1 比賽後，實際局數勝率矩陣會顯示在這裡。")}/>;
  return <>
    <div className="h2h-matrix-scroll">
      <table className="h2h-matrix-grid h2h-heatmap">
        <caption className="sr-only">{t("球員之間的實際局數勝率矩陣，橫行球員對直行球員")}</caption>
        <thead><tr><th scope="col" className="h2h-corner-cell" aria-hidden="true"></th>{players.map(player=><th key={player.id} scope="col" title={player.name}>{player.short||player.name.slice(0,2)}</th>)}</tr></thead>
        <tbody>{players.map(row=><tr key={row.id} className={row.id===focusId?"focused":""}>
          <th scope="row"><span className="h2h-matrix-rowhead"><PlayerBadge player={row}/><span>{row.short||row.name}</span></span></th>
          {players.map(column=>{
            if(column.id===row.id)return <td key={column.id} className="self" aria-label={t("同一位球員")}>—</td>;
            const record=index.get(h2hKey(row.id,column.id));
            if(!record)return <td key={column.id} className="none" aria-label={t("{name} 與 {name2} 未曾交手，沒有實際局數勝率", {name: row.name, name2: column.name})}>·</td>;
            const framesWon=record.frames[row.id]??0;
            const framesLost=record.frames[column.id]??0;
            const rate=actualFrameWinRate(record,row.id,column.id);
            return <td key={column.id} style={winRateHeat(rate)}>
              <button type="button" onClick={()=>onOpenPair(row.id,column.id)} aria-label={t("{name} 對 {name2} 的實際局數勝率為 {rate}%，局數 {framesWon}–{framesLost}，共 {total} 場", {name: row.name, name2: column.name, rate, framesWon, framesLost, total: record.total})}>
                <b>{rate}%</b>
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="h2h-heat-key" aria-hidden="true"><span>{t("較低局數勝率")}</span><i style={{background:`linear-gradient(90deg, ${winRateHeat(0).background}, ${winRateHeat(50).background}, ${winRateHeat(100).background})`}}/><span>{t("較高局數勝率")}</span></div>
  </>;
}
