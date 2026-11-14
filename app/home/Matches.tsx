import { createPortal } from "react-dom";
import { Fragment,useCallback,useEffect,useId,useMemo,useRef,useState,type ChangeEvent,type ReactNode,type TouchEvent as ReactTouchEvent } from "react";
import { CupMark,Empty,PlayerBadge,PlayerCombobox,Scoreline,avatarHex } from "../UiBits";
import CupBracketChart,{ storyBracket,type BracketChartData } from "../CupBracketChart";
import { type MySquad } from "../Squads";
import { isEntertainmentMode } from "../../lib/entertainment-match";
import { cupShareCta,cupShareMessage,cupShareState,cupShareUrl,cupUrgency,whatsappLink } from "../../lib/cup-share";
import { ShareGlyph } from "../ShareSheet";
import CupShareButtons from "../CupShareButtons";
import { type StoryPerson } from "../../lib/story-card";
import { useT } from "../components/I18nProvider";
import { buildBracket,cupMatches,currentRoundLabel,formatTournamentDateTime,matchRoundLabel,opponentIn,playerEliminated,playerSlot,rosterOrder,roundLabel,signupsClosed,type Bracket,type BracketSlot } from "../../lib/tournament";
import { Button,ChipGroup,IconButton,InlineNotice,SectionLabel,SlidingToggleGroup,Surface } from "../components/ui/Primitives";
import { TabList,TabPanel } from "../components/ui/Tabs";
import { Sheet,ConfirmDialog } from "../components/ui/Overlay";
import { msg } from "../../lib/i18n/translate";
import { Menu } from "../components/ui/Menu";
import { calendarDateLabel,monthYearLabel } from "../../lib/i18n/format";
import { INTL_LOCALE,type Locale } from "../../lib/i18n/locales";
import type { Translator } from "../../lib/i18n/translate";
import { type Player,type MatchMode,type Match,type Tournament,type AppState,suggestedHandicap,suggestedHandicapAtRating,matchMode,isParticipant,teamMemberIds,teamLabel,today } from "./model";
import { SearchIcon,FilterIcon,fadeHex,monthGroupLabel,HeadToHeadMatrix } from "./Leaderboard";


export function Matches({squad,scopeMenu,data,canManageMatch,canManageCup,onEdit,onVoid,onShare,onPlayer,view,setView,pair,setPair,highlight,isAdmin,onCreateTournament,onEditTournament,onDeleteTournament,ownPlayerId,onSignUpTournament,onSetArrivalTime,onRecordSlot,onArrange,onWalkover,onEditRoster,onShuffleRoster,onReorderRoster,onRefresh}:{squad:MySquad|null;scopeMenu:ReactNode;data:AppState;canManageMatch:(match:Match)=>boolean;canManageCup:(tournament:Tournament)=>boolean;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void;onPlayer:(player:Player)=>void;view:"history"|"calendar"|"cup"|"matrix";setView:(view:"history"|"calendar"|"cup"|"matrix")=>void;pair:{a:string;b:string};setPair:(pair:{a:string;b:string})=>void;highlight:string|null;isAdmin:boolean;onCreateTournament:()=>void;onEditTournament:(tournament:Tournament)=>void;onDeleteTournament:(tournament:Tournament)=>void;ownPlayerId?:string;onSignUpTournament:(id:string,arrivalTime?:string)=>void;onSetArrivalTime:(tournamentId:string,arrivalTime:string)=>void;onRecordSlot:(tournament:Tournament,slot:BracketSlot<Match>)=>void;onArrange:(opponentId:string)=>void;onWalkover:(tournament:Tournament,slot:BracketSlot<Match>,winnerId:string)=>void;onEditRoster:(tournament:Tournament,outgoingId:string,incomingId:string)=>void;onShuffleRoster:(tournament:Tournament)=>void;onReorderRoster:(tournament:Tournament,draggedId:string,targetId:string)=>void;onRefresh:()=>void}) {
  const matchTabsId=useId();
  const t = useT();
  // The active squad narrows history and calendar to games played entirely among its members.
  const squadMatches=useMemo(()=>{
    if(!squad)return data.matches;
    const members=new Set(squad.members.map(member=>member.playerId));
    return data.matches.filter(match=>[match.a,match.b,match.a2,match.b2].filter(Boolean).every(id=>members.has(id as string)));
  },[data.matches,squad]);
  const scopedData=useMemo(()=>squad?{...data,matches:squadMatches}:data,[data,squad,squadMatches]);
  const [sortBy,setSortBy]=useState<"playedOn"|"createdAt">("playedOn");
  const [sortDirection,setSortDirection]=useState<"desc"|"asc">("desc");
  const [modeFilter,setModeFilter]=useState<"all"|MatchMode>("all");
  const [selectedTournament,setSelectedTournament]=useState<string>("");
  useEffect(()=>{
    if(selectedTournament && data.tournaments.some(item=>item.id===selectedTournament))return;
    if(selectedTournament)setSelectedTournament("");
  },[data.tournaments,selectedTournament]);
  // This component unmounts on every trip to another tab, so without a round
  // trip through storage a scouting session loses its sort and date range the
  // moment the user glances at 排行榜. Same restore-then-write shape as the
  // focus above, including the skipped first write.
  const prefsRestored=useRef(false);
  useEffect(()=>{
    const stored=localStorage.getItem("elo-match-prefs");
    if(!stored)return;
    try{
      const value=JSON.parse(stored);
      if(value?.sortBy==="playedOn"||value?.sortBy==="createdAt")setSortBy(value.sortBy);
      if(value?.sortDirection==="asc"||value?.sortDirection==="desc")setSortDirection(value.sortDirection);
      if(value?.modeFilter==="all"||value?.modeFilter==="1v1"||value?.modeFilter==="2v2"||value?.modeFilter==="cup")setModeFilter(value.modeFilter);
    }catch{}
  },[]);
  useEffect(()=>{
    if(!prefsRestored.current){prefsRestored.current=true;return;}
    localStorage.setItem("elo-match-prefs",JSON.stringify({sortBy,sortDirection,modeFilter}));
  },[sortBy,sortDirection,modeFilter]);
  // A stale "2v2" mode filter from a previous session would otherwise hide the
  // dedicated head-to-head view whenever a fresh pair is picked to compare.
  const pairMounted=useRef(false);
  useEffect(()=>{
    if(!pairMounted.current){pairMounted.current=true;return;}
    setModeFilter(current=>current==="2v2"?"all":current);
  },[pair.a,pair.b]);
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??t("已刪除球員");
  // With a squad active the player filters offer only its members; a player picked before the
  // squad changed simply stops applying rather than leaving the list empty.
  const squadMemberIds=useMemo(()=>squad?new Set(squad.members.map(member=>member.playerId)):null,[squad]);
  const roster=data.players.filter(player=>!squadMemberIds||squadMemberIds.has(player.id)).sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const a=roster.find(p=>p.id===pair.a);
  const focusPlayer=a?a.id:"";
  const opponent=a?roster.find(p=>p.id===pair.b):undefined;
  // Picking a second player switches the same list into a head-to-head
  // comparison instead of jumping to a separate screen — one mental model,
  // one match card, for both "my results" and "us against each other".
  const pairSelected=Boolean(a&&opponent&&a.id!==opponent.id);
  const comparing=pairSelected&&modeFilter!=="2v2";
  const filteringShared2v2=pairSelected&&modeFilter==="2v2";
  const matches=useMemo(()=>{
    const matchesMode=(match:Match)=>modeFilter==="all"||matchMode(match)===modeFilter;
    if(comparing){
      return squadMatches
        .filter(m=>matchesMode(m)&&m.status==="confirmed"&&(
          matchMode(m)==="2v2"
            ? modeFilter==="all"&&isParticipant(m,a!.id)&&isParticipant(m,opponent!.id)
            : (m.a===a!.id&&m.b===opponent!.id)||(m.a===opponent!.id&&m.b===a!.id)
        ))
        .sort((left,right)=>{const primary=left[sortBy].localeCompare(right[sortBy]);const tieBreak=left.createdAt.localeCompare(right.createdAt);return sortDirection==="asc"?(primary||tieBreak):-(primary||tieBreak)});
    }
    return [...squadMatches]
      .filter(m=>matchesMode(m)&&(
        filteringShared2v2
          ? isParticipant(m,a!.id)&&isParticipant(m,opponent!.id)
          : !focusPlayer||isParticipant(m,focusPlayer)
      ))
      .sort((left,right)=>{
        const primary=left[sortBy].localeCompare(right[sortBy]);
        const tieBreak=left.createdAt.localeCompare(right.createdAt);
        return sortDirection==="asc"?(primary||tieBreak):-(primary||tieBreak);
      });
  },[squadMatches,sortBy,sortDirection,modeFilter,focusPlayer,comparing,filteringShared2v2,a,opponent]);
  const headToHeadMatches=useMemo(
    ()=>matches.filter(match=>matchMode(match)!=="2v2").sort((left,right)=>right.playedOn.localeCompare(left.playedOn)||right.createdAt.localeCompare(left.createdAt)),
    [matches]
  );
  const h2hStats=useMemo(()=>{
    if(!comparing)return null;
    return headToHeadMatches.reduce((total,match)=>{const first=match.a===a!.id,scoreA=first?match.scoreA:match.scoreB,scoreB=first?match.scoreB:match.scoreA;total.framesA+=scoreA;total.framesB+=scoreB;if(scoreA>scoreB)total.winsA++;else if(scoreA<scoreB)total.winsB++;else total.draws++;return total;},{winsA:0,winsB:0,draws:0,framesA:0,framesB:0});
  },[headToHeadMatches,comparing,a]);
  const decided=Math.max(1,(h2hStats?.winsA??0)+(h2hStats?.winsB??0)+(h2hStats?.draws??0));
  const aShare=h2hStats?Math.round((h2hStats.winsA+h2hStats.draws/2)/decided*100):50;
  // Last 5 meetings, most recent first — the quick "who's hot" read that a
  // plain win/loss tally can't give you.
  const recentForm=useMemo(()=>{
    if(!comparing||!a)return [];
    return headToHeadMatches.slice(0,5).map(match=>{
      const first=match.a===a.id,own=first?match.scoreA:match.scoreB,other=first?match.scoreB:match.scoreA;
      return own>other?"W":own<other?"L":"D";
    });
  },[headToHeadMatches,comparing,a]);
  const setFocus=(id:string)=>setPair(id
    ? {a:id,b:id===pair.b?"":pair.b}
    : {a:pair.b,b:""});
  const setOpponent=(id:string)=>setPair({...pair,b:id});
  const clearAll=()=>{setPair({a:"",b:""});setModeFilter("all")};
  const openTournamentCount=data.tournaments.filter(tournament=>!signupsClosed(tournament)).length;
  // Grouped by month with a sticky header instead of a flat list — long
  // history stays scannable without repeating the full date on every row.
  const groups=useMemo(()=>{
    const order:string[]=[],map=new Map<string,Match[]>();
    for(const m of matches){
      const key=comparing?"__all__":m.playedOn.slice(0,7);
      if(!map.has(key)){map.set(key,[]);order.push(key)}
      map.get(key)!.push(m);
    }
    return order.map(key=>({key,matches:map.get(key)!}));
  },[matches,comparing]);
  const defaultSort=sortBy==="playedOn"&&sortDirection==="desc";
  return <div className="matches-page"><section className="hero small matches-hero"><div className="matches-hero-copy"><p className="kicker">{t("完整可追溯")}</p><h1>{t("比賽記錄")}</h1><p>{t("查看比分、讓分與每場 ELO 變化。")}</p></div>
      <div className="matches-hero-meta">{view!=="cup"&&scopeMenu}<div className="matches-hero-count"><b>{(view==="cup"?data.matches:squadMatches).filter(match=>match.status==="confirmed").length}</b><span>{t("比賽場數")}</span></div></div></section>
    <TabList id={matchTabsId} className="ds-toggle-control match-view-toggle" label={t("比賽資料檢視")} value={view} onChange={value=>setView(value as typeof view)} items={[
      {value:"history",label:t("賽事記錄")},
      {value:"calendar",label:t("日曆")},
      {value:"matrix",label:t("對賽矩陣")},
      {value:"cup",accessibleLabel:t("盃賽{v}", {v: openTournamentCount>0?t("，{openTournamentCount} 個盃賽開放報名", {openTournamentCount}):""}),label:<>{t("盃賽")}{openTournamentCount>0&&<span className="match-tab-count" aria-hidden="true">{openTournamentCount>9?"9+":openTournamentCount}</span>}</>},
    ]}/>
    {["history","calendar","matrix","cup"].filter(item=>item!==view).map(item=><TabPanel key={item} id={matchTabsId} value={item} active={false}>{null}</TabPanel>)}
    <TabPanel id={matchTabsId} value={view} active>
    {view==="matrix"?<HeadToHeadMatrix squad={squad} data={data} ownPlayerId={ownPlayerId} onOpenPair={(first,second)=>{setPair({a:first,b:second});setModeFilter("all");setView("history")}}/> : view==="calendar"?<CalendarView data={scopedData} canManageMatch={canManageMatch} onPlayer={onPlayer} onEdit={onEdit} onVoid={onVoid} onShare={onShare}/> : view==="cup" ? <CupBracketView data={data} selectedTournament={selectedTournament} setSelectedTournament={setSelectedTournament} canManageMatch={canManageMatch} canManageCup={canManageCup} onEdit={onEdit} onPlayer={onPlayer} onVoid={onVoid} onShare={onShare} isAdmin={isAdmin} onCreateTournament={onCreateTournament} onEditTournament={onEditTournament} onDeleteTournament={onDeleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={onSignUpTournament} onSetArrivalTime={onSetArrivalTime} onRecordSlot={onRecordSlot} onArrange={onArrange} onWalkover={onWalkover} onEditRoster={onEditRoster} onShuffleRoster={onShuffleRoster} onReorderRoster={onReorderRoster} onRefresh={onRefresh}/> : <>
    <section className="match-filters" aria-label={t("篩選及排序比賽記錄")}>
      <div className="match-search">
        <SearchIcon/>
        {a&&<span className="match-player-chip">{a.name}<IconButton label={t("取消選擇 {name}", {name: a.name})} onClick={()=>setFocus("")}>×</IconButton></span>}
        {opponent&&<span className="match-player-chip compare">{opponent.name}<IconButton label={t("取消比較 {name}", {name: opponent.name})} onClick={()=>setOpponent("")}>×</IconButton></span>}
        {!focusPlayer&&<PlayerCombobox players={roster} value="" onChange={setFocus} placeholder={t("搜尋球員")} ariaLabel={t("球員")}/>}
        {focusPlayer&&!opponent&&<PlayerCombobox players={roster.filter(p=>p.id!==focusPlayer)} value="" onChange={setOpponent} placeholder={t("＋ 比較球員")} ariaLabel={t("選擇比較球員")}/>}
      </div>
      <div className="match-filter-row">
        <ChipGroup label={t("比賽類型")} value={modeFilter} onChange={value=>setModeFilter(value as "all"|MatchMode)} items={[{value:"all",label:t("全部")},{value:"1v1",label:"1v1"},{value:"2v2",label:"2v2"},{value:"cup",label:t("盃賽")}]}/>
        <Menu className="board-filter" label={t("排序")} triggerClassName={`ds-button ds-button--secondary board-filter__trigger${defaultSort?"":" is-active"}`} trigger={()=><><FilterIcon/><span>{t("排序")}</span></>}
          sections={[
            {title:t("排序依據"),items:([["playedOn",t("比賽日期")],["createdAt",t("加入日期")]] as const).map(([key,label])=>({key,label,checked:sortBy===key,onSelect:()=>setSortBy(key)}))},
            {title:t("次序"),items:([["desc",t("最新至最舊")],["asc",t("最舊至最新")]] as const).map(([key,label])=>({key,label,checked:sortDirection===key,onSelect:()=>setSortDirection(key)}))},
          ]}/>
      </div>
    </section>
    {(focusPlayer||modeFilter!=="all")&&<div className="match-filter-status"><span>{t("{matches} 場符合記錄", {matches: matches.length})}</span><Button variant="quiet" onClick={clearAll}>{t("清除篩選")}</Button></div>}    {comparing&&a&&opponent&&h2hStats&&<div className="h2h-summary neutral">
      <div className="h2h-hero-players">
        <div className="h2h-hero-player"><PlayerBadge player={a}/><b>{a.name}</b><small>{Math.round(a.rating)} ELO</small></div>
        <div className="h2h-hero-score"><span><b>{h2hStats.winsA}</b><em>–</em><b>{h2hStats.winsB}</b></span>{h2hStats.draws>0&&<small>{t("{draws} 和", {draws: h2hStats.draws})}</small>}</div>
        <div className="h2h-hero-player right"><PlayerBadge player={opponent}/><b>{opponent.name}</b><small>{Math.round(opponent.rating)} ELO</small></div>
      </div>
      {/* Both sides stay in their own avatar colour (so the bar still ties
          back to the avatars above), but the trailing side fades to ~38%
          opacity — that guarantees contrast against the leader regardless
          of how close the two avatar hues happen to be. Tied share fades
          neither side. */}
      <div className="h2h-hero-bar" aria-hidden="true">
        <i style={{width:`${aShare}%`,background:fadeHex(avatarHex(a.colour),aShare<50?.38:1)}}/>
        <i style={{width:`${100-aShare}%`,background:fadeHex(avatarHex(opponent.colour),aShare>50?.38:1)}}/>
      </div>
      <div className="h2h-hero-bar-labels"><span>{aShare}%</span><span>{100-aShare}%</span></div>
      {recentForm.length>0&&<div className="h2h-hero-form"><small>{t("近{recentForm}場", {recentForm: recentForm.length})}</small><div className="h2h-form-dots">{recentForm.map((result,index)=><i key={index} className={`form-dot ${result.toLowerCase()}`} aria-label={result==="W"?t("勝"):result==="L"?t("負"):t("和")}>{result}</i>)}</div></div>}
      <div className="h2h-hero-stats">
        <div><small>{t("局數比例")}</small><b>{h2hStats.framesA}<em>–</em>{h2hStats.framesB}</b></div>
        <div><small>{t("總場數")}</small><b>{headToHeadMatches.length}</b></div>
        <div><small>{t("最近交手")}</small><b>{headToHeadMatches[0]?.playedOn??"—"}</b></div>
      </div>
    </div>}
    <div className="match-list">{groups.length===0?<Empty text={comparing?t("沒有符合的對賽記錄"):filteringShared2v2?t("沒有兩人共同參與的 2v2 記錄"):focusPlayer?t("沒有符合的比賽記錄"):t("尚未有比賽記錄")} sub={comparing?t("記錄兩人的第一場比賽後，對賽記錄會顯示在這裡。"):filteringShared2v2?t("兩位球員可以是隊友或對手；目前沒有同時包含兩人的賽事。"):focusPlayer?t("這位球員暫時沒有已記錄的賽事。"):t("記錄第一場比賽後，詳情會顯示在這裡。")}/>:groups.map(group=>{
      const cards=group.matches.map(m=><MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} onShare={onShare} highlighted={m.id===highlight}/>);
      if(comparing)return <Fragment key={group.key}>{cards}</Fragment>;
      return <section className="match-month-group" key={group.key}>
        <SectionLabel meta={t("{matches} 場", {matches: group.matches.length})}>{monthGroupLabel(t, group.key)}</SectionLabel>
        <div className="match-month-cards">{cards}</div>
      </section>;
    })}</div></>}</TabPanel></div>;
}

export type CupStatus="signup"|"live"|"done"|"short";
export function cupStatus(tournament:Tournament,matches:Match[]):CupStatus{
  if(!signupsClosed(tournament))return "signup";
  const bracket=buildBracket<Match>(tournament,matches);
  if(!bracket.size)return "short";
  return bracket.champion?"done":"live";
}
export const CUP_STATUS_LABEL:Record<CupStatus,string>={signup:msg("報名中"),live:msg("進行中"),done:msg("已完成"),short:msg("人數不足")};

/* The trophy every cup card, banner and champion wears — one drawn mark, lit by its container, so a
   competition never looks like a settings row and an emoji never stands in for the club's own hand. */
export function CupEmblem({className=""}:{className?:string}){
  return <span className={`cup-emblem ${className}`.trim()} aria-hidden="true"><CupMark/></span>;
}

export const ARRIVAL_HOURS=Array.from({length:24},(_,i)=>String(i).padStart(2,"0"));
export const ARRIVAL_MINUTES=["00","05","10","15","20","25","30","35","40","45","50","55"];
/** `startAt` shifted by `minutesOffset`, wrapping across midnight — used for the "提早/準時/遲到"
    presets, which are all read relative to a cup's own start time rather than the clock. */
export function shiftHHMM(base:string,minutesOffset:number):string {
  const [hour,minute]=base.split(":").map(Number);
  const total=(((hour*60+minute+minutesOffset)%1440)+1440)%1440;
  return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
}
/** A pair of native selects standing in for `<input type="time">`. Selects have no intrinsic
    minimum-width quirk the way native date/time pickers do (most visibly on iOS Safari), so this
    is the one control in the app guaranteed to stay inside its container at any width — and its
    scroll-wheel-like feel reads more native on a phone than typing into a text-ish time field. */
export function TimeOfDayPicker({hour,minute,onHour,onMinute}:{hour:string;minute:string;onHour:(value:string)=>void;onMinute:(value:string)=>void}){
  const t = useT();
  return <div className="time-of-day-picker">
    <select aria-label={t("小時")} value={hour} onChange={event=>onHour(event.target.value)}>{ARRIVAL_HOURS.map(h=><option key={h} value={h}>{h}</option>)}</select>
    <span aria-hidden="true">:</span>
    <select aria-label={t("分鐘")} value={minute} onChange={event=>onMinute(event.target.value)}>{ARRIVAL_MINUTES.map(m=><option key={m} value={m}>{m}</option>)}</select>
  </div>;
}

/* Everything after the deadline used to be a poster: the bracket appeared, and the only way to move
   it forward was to leave, open 記錄, and retype the round and match number of the box you had just
   been looking at. The cup view now owns the whole life of a cup — your own tie, recording it from
   the box itself, and the admin levers for the ties that never get played.

   Laid out phone-first: a horizontal bracket tree cannot fit 360px without either overflowing its
   container or shrinking names to nothing, so the tree is the *desktop* representation and the
   round-by-round list below is the primary one. Both read the same bracket. */
export function CupBracketView({data,selectedTournament,setSelectedTournament,canManageMatch,canManageCup,onEdit,onPlayer,onVoid,onShare,isAdmin,onCreateTournament,onEditTournament,onDeleteTournament,ownPlayerId,onSignUpTournament,onSetArrivalTime,onRecordSlot,onArrange,onWalkover,onEditRoster,onShuffleRoster,onReorderRoster,onRefresh}:{data:AppState;selectedTournament:string;onPlayer:(player:Player)=>void;onVoid:(match:Match)=>void;onShare:(match:Match)=>void;setSelectedTournament:(id:string)=>void;canManageMatch:(match:Match)=>boolean;canManageCup:(tournament:Tournament)=>boolean;onEdit:(match:Match)=>void;isAdmin:boolean;onCreateTournament:()=>void;onEditTournament:(tournament:Tournament)=>void;onDeleteTournament:(tournament:Tournament)=>void;ownPlayerId?:string;onSignUpTournament:(id:string,arrivalTime?:string)=>void;onSetArrivalTime:(tournamentId:string,arrivalTime:string)=>void;onRecordSlot:(tournament:Tournament,slot:BracketSlot<Match>)=>void;onArrange:(opponentId:string)=>void;onWalkover:(tournament:Tournament,slot:BracketSlot<Match>,winnerId:string)=>void;onEditRoster:(tournament:Tournament,outgoingId:string,incomingId:string)=>void;onShuffleRoster:(tournament:Tournament)=>void;onReorderRoster:(tournament:Tournament,draggedId:string,targetId:string)=>void;onRefresh:()=>void}){
  const t = useT();
  const tournament=data.tournaments.find(item=>item.id===selectedTournament);
  const player=useCallback((id:string)=>data.players.find(item=>item.id===id),[data.players]);
  const name=(id:string)=>player(id)?.name??t("待定");
  const deadlineText=(value:string)=>formatTournamentDateTime(t, value);
  const deadlinePassed=Boolean(tournament&&signupsClosed(tournament));
  const drawn=Boolean(tournament?.draw?.length);
  const canManage=Boolean(tournament&&canManageCup(tournament));
  const signedUp=Boolean(ownPlayerId&&(tournament?.signups||[]).includes(ownPlayerId));
  const bracket=useMemo(()=>tournament?buildBracket<Match>(tournament,data.matches):null,[tournament,data.matches]);
  const mySlot=bracket?playerSlot(bracket,ownPlayerId):undefined;
  const eliminated=bracket?playerEliminated(bracket,ownPlayerId):false;
  const champion=bracket?.champion??"";
  /* Flattened for the shared chart, which the public share page renders from its own serialised
     data — the drawing lives in one component, and each side hands it seats. */
  const chart=useMemo<BracketChartData|null>(()=>{
    if(!bracket?.rounds)return null;
    return {
      rounds:Array.from({length:bracket.rounds},(_,index)=>({
        round:index+1,name:roundLabel(t, index+1,bracket.rounds),
        nodes:bracket.slots.filter(slot=>slot.round===index+1).map(slot=>({
          index:slot.index,state:slot.state,
          mine:Boolean(ownPlayerId&&(slot.a===ownPlayerId||slot.b===ownPlayerId)),
          date:slot.match?.playedOn??"",
          seats:[slot.a,slot.b].map(id=>({
            player:id?player(id)??{short:"?"}:null,
            score:slot.match&&id?Number(scoreFor(slot.match,id)):null,
            won:Boolean(slot.winner&&slot.winner===id),
          })),
        })),
      })),
      champion:bracket.champion?player(bracket.champion)??{short:"?"}:null,
    };
  },[bracket,ownPlayerId,player, t]);
  const [openRound,setOpenRound]=useState(1);
  /* Which roster row is mid-drag and which one it is currently poised over — purely visual state,
     reset the moment the drag ends one way or another so a stale highlight can never survive it. */
  const [dragRosterId,setDragRosterId]=useState("");
  const [dragOverRosterId,setDragOverRosterId]=useState("");
  /* HTML5 drag-and-drop has no touch backend, so it's silently inert on the PWA/mobile browsers
     the club actually reorders draws from — this reimplements the same gesture by hand from the
     handle's touch events, tracking the finger with elementFromPoint instead of native drag events. */
  const touchDragId=useRef("");
  const touchOverId=useRef("");
  /* The same gesture means two different edits depending on where it started: dragging a row in the
     roster list moves it up or down that list, while dragging a name in the bracket trades it with
     whoever it lands on. Recording the origin at touch-start is what keeps them apart, since by
     touch-end both look like "this id onto that id". */
  const touchDragOrigin=useRef<"roster"|"bracket">("roster");
  const onRosterHandleTouchStart=(id:string,origin:"roster"|"bracket"="roster")=>()=>{
    touchDragId.current=id;
    touchOverId.current="";
    touchDragOrigin.current=origin;
    setDragRosterId(id);
  };
  const onRosterHandleTouchMove=(event:ReactTouchEvent)=>{
    if(!touchDragId.current)return;
    event.preventDefault();
    const touch=event.touches[0];
    const el=document.elementFromPoint(touch.clientX,touch.clientY);
    const row=el?.closest<HTMLElement>("[data-roster-id],[data-drag-player-id]");
    const rowId=row?.dataset.rosterId??row?.dataset.dragPlayerId;
    const overId=rowId&&rowId!==touchDragId.current?rowId:"";
    touchOverId.current=overId;
    setDragOverRosterId(overId);
  };
  const onRosterHandleTouchEnd=(tournamentForDrop:Tournament)=>()=>{
    if(touchDragId.current&&touchOverId.current){
      if(touchDragOrigin.current==="bracket")onEditRoster(tournamentForDrop,touchDragId.current,touchOverId.current);
      else onReorderRoster(tournamentForDrop,touchDragId.current,touchOverId.current);
    }
    touchDragId.current="";
    touchOverId.current="";
    setDragRosterId("");
    setDragOverRosterId("");
  };
  /* Both entering and leaving a cup are one-tap actions with real consequences — a missed 報名 window
     doesn't reopen, and a careless 取消報名 drops your seat in a bracket that may already be filling
     up — so each gets a confirmation naming the cup, not a silent toggle. */
  const [pendingSignup,setPendingSignup]=useState<{id:string;name:string;joined:boolean}|null>(null);
  const [signupArrivalOn,setSignupArrivalOn]=useState(false);
  const [signupArrivalHour,setSignupArrivalHour]=useState("18");
  const [signupArrivalMinute,setSignupArrivalMinute]=useState("00");
  const startAtTime=tournament?.startAt&&tournament.startAt.length>=16?tournament.startAt.slice(11,16):null;
  const [arrivalPanelOpen,setArrivalPanelOpen]=useState(false);
  const [arrivalCustomOpen,setArrivalCustomOpen]=useState(false);
  const [arrivalCustomHour,setArrivalCustomHour]=useState("18");
  const [arrivalCustomMinute,setArrivalCustomMinute]=useState("00");
  // Closes both panels across a tournament switch, so neither lingers open against a different
  // cup's presets/start time than the one it was opened for.
  useEffect(()=>{setArrivalPanelOpen(false);setArrivalCustomOpen(false)},[selectedTournament]);
  const confirmSignupDialog=pendingSignup&&<ConfirmDialog kicker={pendingSignup.joined?t("取消報名"):t("確認報名")} titleId="cup-signup-confirm-title"
    title={pendingSignup.joined?t("確定取消「{name}」的報名？", {name: pendingSignup.name}):t("確定報名參加「{name}」？", {name: pendingSignup.name})}
    description={pendingSignup.joined?t("取消後可重新報名，但截止後就無法再加入。"):t("截止前都可以隨時取消報名；報名後仍可隨時更改預計到達時間。")}
    onClose={()=>setPendingSignup(null)}
    extra={!pendingSignup.joined&&<div className="cup-arrival-toggle-block">
      {/* Optional and skippable — a member can always add or change it later from the cup page, so
          this is a convenience offered at the moment it's top of mind, never a gate on signing up. */}
      <div className="cup-arrival-toggle-row" role="switch" aria-checked={signupArrivalOn} aria-label={t("分享預計到達時間")} tabIndex={0}
        onClick={()=>setSignupArrivalOn(value=>!value)}
        onKeyDown={event=>{if(event.key===" "||event.key==="Enter"){event.preventDefault();setSignupArrivalOn(value=>!value)}}}>
        <div className="cup-arrival-toggle-copy"><b>{t("分享預計到達時間")}</b><small>{t("可選 — 讓其他球員知道你大約幾點到場。")}</small></div>
        <span className={`toggle-switch${signupArrivalOn?" on":""}`} aria-hidden="true"><i/></span>
      </div>
      {signupArrivalOn&&<div className="cup-arrival-field">
        <span>{t("預計到達時間")}</span>
        <TimeOfDayPicker hour={signupArrivalHour} minute={signupArrivalMinute} onHour={setSignupArrivalHour} onMinute={setSignupArrivalMinute}/>
      </div>}
    </div>}>
    <Button variant="secondary" onClick={()=>setPendingSignup(null)}>{t("返回")}</Button>
    <Button variant={pendingSignup.joined?"danger":"primary"} onClick={()=>{const id=pendingSignup.id,joined=pendingSignup.joined,arrivalTime=signupArrivalOn?`${signupArrivalHour}:${signupArrivalMinute}`:"";setPendingSignup(null);setSignupArrivalOn(false);onSignUpTournament(id,joined?undefined:(arrivalTime||undefined))}}>{pendingSignup.joined?t("確定取消"):t("確定報名")}</Button>
  </ConfirmDialog>;
  /* Tapping a node in the overview has to *land* somewhere, or the map is just decoration: it opens
     that round and scrolls its card into view, flashing it so the eye finds it after the jump. */
  const [focusTie,setFocusTie]=useState("");
  useEffect(()=>{
    if(!focusTie)return;
    const card=document.getElementById(`cup-tie-${focusTie}`);
    card?.scrollIntoView({behavior:"smooth",block:"center"});
    const timer=setTimeout(()=>setFocusTie(""),1600);
    return ()=>clearTimeout(timer);
  },[focusTie]);
  /* Follow the competition rather than reset to 八強 every visit: the round worth reading is the one
     still being played — or the member's own, if they are in it. */
  useEffect(()=>{
    if(!bracket?.rounds)return;
    const live=bracket.slots.find(slot=>slot.state==="ready"||slot.state==="waiting");
    setOpenRound(mySlot?.round??live?.round??bracket.rounds);
  },[bracket,mySlot]);
  /* Five round names do not fit a phone's width, so the switcher scrolls inside itself — and must
     bring the selected round along, or 決賽 opens selected but off the edge. */
  useEffect(()=>{
    const active=document.querySelector<HTMLElement>(".cup-rounds button.active");
    const rail=active?.parentElement;
    if(!active||!rail||rail.scrollWidth<=rail.clientWidth)return;
    rail.scrollTo({left:active.offsetLeft-(rail.clientWidth-active.offsetWidth)/2,behavior:"smooth"});
  },[openRound]);

  /* The draw is frozen server-side, and whichever member opens the cup first after the deadline is
     what triggers it — no cron, no admin ceremony. The ref keeps a re-render from firing a second
     request; the route itself is idempotent, so a genuine race just gets the same draw back. */
  const drawRequested=useRef<string>("");
  useEffect(()=>{
    if(!tournament||!deadlinePassed||drawn||(tournament.signups?.length??0)<2)return;
    if(drawRequested.current===tournament.id)return;
    drawRequested.current=tournament.id;
    fetch(`/api/tournaments/${tournament.id}/draw`,{method:"POST"})
      .then(response=>{if(response.ok)onRefresh()})
      .catch(()=>{});
  },[tournament,deadlinePassed,drawn,onRefresh]);

  /* Sharing a cup is the app's best word-of-mouth moment: the link lands in the club's WhatsApp
     group, where most of the members who have never opened the app already are. The native sheet
     goes first on a phone (WhatsApp is the first row for most of them), wa.me is the desktop path. */
  const shareStateOf=(item:Tournament)=>{
    const itemBracket=buildBracket<Match>(item,data.matches);
    return cupShareState(t, {
      signupDeadline:item.signupDeadline,entrants:item.signups?.length??0,closed:signupsClosed(item),
      drew:Boolean(itemBracket.size),
      roundName:currentRoundLabel(t, itemBracket),
      championName:itemBracket.champion?name(itemBracket.champion):"",
    });
  };
  const shareCup=async(item:Tournament)=>{
    const state=shareStateOf(item);
    const url=cupShareUrl(window.location.origin,item.id);
    const message=cupShareMessage(t, item.name,state,url);
    if(navigator.share){
      try{ await navigator.share({title:item.name,text:message}); return; }catch{ /* dismissed */ }
    }
    window.open(whatsappLink(message),"_blank","noopener");
  };
  /* Named for where the tap lands and what it is for. 「分享」 described the mechanism; while a cup is
     recruiting the button's actual job is to put another member in the draw, and a button that says
     so is pressed by people who would not have pressed the other one. */
  const shareButton=(item:Tournament,className="cup-btn ghost",compact=false)=>{
    const state=shareStateOf(item);
    const cta=cupShareCta(t, state);
    return <button type="button" className={`${className} wa-btn`} onClick={()=>void shareCup(item)} aria-label={cta.label}>
      <ShareGlyph kind="whatsapp"/>
      <span>{compact?(state.status==="signup"?t("叫人報名"):t("分享")):cta.label}</span>
    </button>;
  };

  const controls=(item:Tournament)=><span className="cup-admin"><IconButton className="cup-admin-btn" label={t("編輯 {name}", {name: item.name})} onClick={()=>onEditTournament(item)}>✎</IconButton>{isAdmin&&<IconButton className="cup-admin-btn danger" label={t("刪除 {name}", {name: item.name})} onClick={()=>onDeleteTournament(item)}>✕</IconButton>}</span>;
  const avatarStack=(ids:string[])=><span className="cup-avatars">{ids.slice(0,5).map(id=><PlayerBadge key={id} player={player(id)??{short:"?"}}/>)}{ids.length>5&&<i>+{ids.length-5}</i>}</span>;

  if(!selectedTournament){
    const cups=[...data.tournaments].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
    const cupEntries=cups.map(item=>({item,status:cupStatus(item,data.matches)}));
    const championTable=Array.from(cupEntries.reduce((table,{item,status})=>{
      if(status!=="done")return table;
      const championId=buildBracket<Match>(item,data.matches).champion;
      if(!championId)return table;
      const previous=table.get(championId);
      table.set(championId,{playerId:championId,titles:(previous?.titles??0)+1,lastTitle:item.name,lastWonAt:item.startAt??item.createdAt});
      return table;
    },new Map<string,{playerId:string;titles:number;lastTitle:string;lastWonAt:string}>()).values()).sort((left,right)=>right.titles-left.titles||right.lastWonAt.localeCompare(left.lastWonAt)||name(left.playerId).localeCompare(name(right.playerId),"zh-HK"));
    const cupSections=[
      {id:"active",label:t("報名中／進行中賽事"),entries:cupEntries.filter(entry=>entry.status!=="done")},
      {id:"done",label:t("已完成賽事"),entries:cupEntries.filter(entry=>entry.status==="done")},
    ].filter(section=>section.entries.length>0);
    return <section className="cup">
      <div className="cup-intro">
        <div><h2>{t("盃賽")}</h2><p>{t("報名、抽籤、對陣同賽果，一頁睇晒。")}</p></div>
        {isAdmin&&<Button onClick={onCreateTournament}>{t("＋ 新增盃賽")}</Button>}
      </div>
      {cups.length===0?<div className="cup-empty"><CupEmblem/><b>{t("尚未有盃賽")}</b><p>{isAdmin?t("建立第一個盃賽，球員即可報名。"):t("管理員建立盃賽後，你就可以在這裡報名。")}</p></div>
      :<div className="cup-sections">{cupSections.map((section,sectionIndex)=><section className="cup-section" aria-labelledby={`cup-section-${section.id}`} key={section.id}>
        <div className="cup-section-head"><h3 id={`cup-section-${section.id}`}>{section.label}</h3><span aria-hidden="true">{section.entries.length}</span></div>
        <div className="cup-list">{section.entries.map(({item,status},entryIndex)=>{
        /* The cup at the top of the page — the one recruiting or being played, or else the latest
           final — gets the poster treatment; the rest are a quiet grid beneath it. */
        const featured=sectionIndex===0&&entryIndex===0;
        const itemBracket=buildBracket<Match>(item,data.matches);
        const itemSlot=playerSlot(itemBracket,ownPlayerId),itemSignedUp=Boolean(ownPlayerId&&item.signups.includes(ownPlayerId));
        const line=item.startAt?t("開始 {v} · {v2}", {v: deadlineText(item.startAt), v2: status==="signup"?t("報名截止 {v}", {v: deadlineText(item.signupDeadline)}):status==="done"?t("冠軍 {v}", {v: name(itemBracket.champion)}):status==="short"?t("報名人數不足兩人"):itemSlot?t("輪到你：{v}", {v: itemSlot.state==="ready"?t("對 {v}", {v: name(opponentIn(itemSlot,ownPlayerId))}):t("等待對手")}):t("賽事進行中")})
          :status==="signup"?t("報名截止 {v}", {v: deadlineText(item.signupDeadline)})
          :status==="done"?t("冠軍 {v}", {v: name(itemBracket.champion)})
          :status==="short"?t("報名人數不足兩人")
          :itemSlot?t("輪到你：{v}", {v: itemSlot.state==="ready"?t("對 {v}", {v: name(opponentIn(itemSlot,ownPlayerId))}):t("等待對手")})
          :t("賽事進行中");
        return <Surface as="article" padded={false} className={`cup-card is-${status}${featured?" is-featured":""}`} key={item.id}>
          <CupEmblem className="cup-card-emblem"/>
          <div className="cup-card-body">
            <div className="cup-card-top"><span className={`cup-chip is-${status}`}>{t(CUP_STATUS_LABEL[status])}</span>{canManageCup(item)&&controls(item)}</div>
            <h3>{item.name}</h3>
            <p className="cup-card-line">{line}</p>
            <div className="cup-card-people">{item.signups.length>0&&avatarStack(item.signups)}<span>{t("{signups} 人報名", {signups: item.signups.length})}</span></div>
            <div className="cup-card-actions">
              {status==="signup"&&(ownPlayerId
                ?<Button variant={itemSignedUp?"secondary":"primary"} className="cup-btn" onClick={()=>setPendingSignup({id:item.id,name:item.name,joined:itemSignedUp})}>{itemSignedUp?t("取消報名"):t("立即報名")}</Button>
                :<a className="cup-btn primary" href="/login">{t("登入後報名")}</a>)}
              <Button variant={status==="signup"?"secondary":"primary"} className="cup-btn" onClick={()=>setSelectedTournament(item.id)}>{status==="signup"?t("睇對陣預覽"):t("賽程")}<span className="cup-btn-mark" aria-hidden="true">›</span></Button>
              {shareButton(item,"cup-btn ghost",true)}
            </div>
          </div>
        </Surface>;
      })}</div>
      </section>)}</div>}
      {championTable.length>0&&<section className="cup-honours" aria-labelledby="cup-honours-title">
        <div className="cup-honours-head">
          <div><p className="sl-eyebrow">Hall of champions</p><h3 id="cup-honours-title">{t("歷屆冠軍榜")}</h3></div>
          <span>{cupEntries.filter(entry=>entry.status==="done").length}  {t("屆賽事")}</span>
        </div>
        <ol className="cup-honours-list">
          {championTable.map((champion,index)=>{
            const championPlayer=player(champion.playerId)??{short:"?"};
            return <li className={index===0?"is-leader":""} key={champion.playerId}>
              <span className="cup-honours-rank" aria-label={t("第 {v} 名", {v: index+1})}>{index===0?"♛":String(index+1).padStart(2,"0")}</span>
              <PlayerBadge player={championPlayer}/>
              <span className="cup-honours-player"><b>{name(champion.playerId)}</b><small>{t("最近勝出 · {lastTitle}", {lastTitle: champion.lastTitle})}</small></span>
              <span className="cup-honours-count"><b>{champion.titles}</b><small>{t("次冠軍")}</small></span>
            </li>;
          })}
        </ol>
      </section>}
      {confirmSignupDialog}
    </section>;
  }
  if(!tournament)return null;

  const status=cupStatus(tournament,data.matches);
  const total=bracket?bracket.slots.filter(slot=>slot.state!=="dead").length:0;
  const settled=bracket?bracket.slots.filter(slot=>slot.settled&&slot.state!=="dead").length:0;
  const stage=bracket?.slots.find(slot=>slot.state==="ready"||slot.state==="waiting");

  /* Once drawn, the list worth showing is the frozen draw. A completed cup may additionally carry
     a presentation order, but that order never feeds the bracket or its scorecards. */
  const rosterIds=drawn?rosterOrder(tournament):tournament.signups;
  /* Signups that landed after the draw was frozen: the bracket never re-syncs with `signups` once
     drawn (see rosterOrder's comment), so these members are registered but were left out of the
     draw. Surface them rather than let them quietly vanish from 參賽名單. */
  const lateSignups=drawn?tournament.signups.filter(id=>!rosterIds.includes(id)):[];
  const spare=data.players.filter(item=>item.active&&!rosterIds.includes(item.id)).sort((left,right)=>left.name.localeCompare(right.name));
  const rosterPick=(outgoingId:string)=>(event:ChangeEvent<HTMLSelectElement>)=>{
    const value=event.target.value;
    event.target.value="";
    if(value)onEditRoster(tournament,outgoingId,value);
  };
  /* Same two numbers the shared cup page quotes — ELO and the club's suggested handicap — so a
     member deciding whether to enter can see how beatable the field is without leaving the app. */
  const rosterStanding=(id:string)=>{
    const found=player(id);
    if(!found)return {rating:null as number|null,handicap:null as number|null};
    return {rating:Math.round(found.rating),handicap:Math.round(suggestedHandicap(found,data))};
  };
  const hasCupResults=cupMatches(data.matches,tournament.id).length>0;
  /* A live bracket remains protected, while a completed cup can reorder its roster presentation.
     The bracket's own drag targets still use canShuffle, because completed scorecards must stay in
     their original seats. */
  const canShuffle=canManage&&deadlinePassed&&rosterIds.length>=2&&!hasCupResults;
  /* Who plays who is a round-one property: every later box is filled by whoever wins the boxes
     feeding it, so the only seats a host can set by hand are the ones the draw dealt. A seat stays
     editable for as long as its player has no recorded result — `swapPlayer` enforces the same rule
     server-side, and trading two seats leaves every other pairing in the bracket exactly as it was,
     which is what makes this safe to offer mid-cup when a reshuffle is not. */
  const playedIds=new Set(cupMatches(data.matches,tournament.id).flatMap(match=>[match.a,match.b]));
  const canMoveSeat=(id:string)=>canManage&&deadlinePassed&&drawn&&Boolean(id)&&!playedIds.has(id);
  const seatOpponents=(id:string)=>rosterIds.filter(other=>other!==id&&!playedIds.has(other));
  /* The picker is the keyboard and touch route to the same edit as the drag — a bracket you can only
     rearrange by dragging is a bracket a host on a phone, or on a keyboard, cannot rearrange. */
  const seatTool=(id:string,round:number)=>{
    if(round!==1||!canMoveSeat(id))return null;
    const opponents=seatOpponents(id);
    if(!opponents.length&&!spare.length)return null;
    return <select className="cup-seat-edit" defaultValue="" aria-label={t("調整 {v} 的對陣", {v: name(id)})}
      onChange={event=>{const value=event.target.value;event.target.value="";if(value)onEditRoster(tournament,id,value)}}>
      <option value="">⋯</option>
      {opponents.length>0&&<optgroup label={t("對調位置")}>{opponents.map(other=><option key={other} value={other}>{name(other)}</option>)}</optgroup>}
      {spare.length>0&&<optgroup label={t("換上")}>{spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
    </select>;
  };
  /* Adding or dropping a name re-lays the whole field, so it stays open exactly as long as the
     reshuffle does — before the draw it is a plain sign-up edit, after the first result the swap
     picker and the walkover button are the tools that do not disturb settled boxes. */
  const canEditEntrants=canManage&&(!drawn||(deadlinePassed&&!hasCupResults));
  const canArrangeRoster=canManage&&rosterIds.length>=2&&(status==="done"||(deadlinePassed&&!hasCupResults));
  const rosterPanel=rosterIds.length>0||canManage?<div className="cup-roster">
    <h3>{drawn?t("參賽名單"):t("報名名單")} <span className="cup-roster-count">{rosterIds.length}</span>{canManage&&canShuffle&&<Button variant="secondary" className="cup-btn sm cup-roster-shuffle" onClick={()=>onShuffleRoster(tournament)}>{t("重新抽籤")}</Button>}</h3>
    {lateSignups.length>0&&<InlineNotice tone="warning" title={t("報名時間在抽籤之後")}>{lateSignups.map(id=>name(id)).join(t("、"))}  {t("已報名，但抽籤時尚未報名，故未列入對陣圖。")}{canManage&&(canEditEntrants?t("如需加入，請於下方「加入球員」把他們加入籤表。"):t("已有賽果，如需加入請使用「換上」替補名單上的球員。"))}</InlineNotice>}
    <ul className="rated">{rosterIds.map(id=>{
      const standing=rosterStanding(id);
      const draggable=canArrangeRoster;
      return <li key={id} draggable={draggable} data-roster-id={id}
        className={`${dragRosterId&&dragRosterId!==id&&dragOverRosterId===id?"drag-over":""}${dragRosterId===id?" dragging":""}`.trim()||undefined}
        onDragStart={draggable?event=>{setDragRosterId(id);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id)}:undefined}
        onDragOver={draggable&&dragRosterId&&dragRosterId!==id?event=>{event.preventDefault();setDragOverRosterId(id)}:undefined}
        onDragLeave={draggable&&dragOverRosterId===id?()=>setDragOverRosterId(""):undefined}
        onDrop={draggable&&dragRosterId&&dragRosterId!==id?event=>{event.preventDefault();onReorderRoster(tournament,dragRosterId,id);setDragRosterId("");setDragOverRosterId("")}:undefined}
        onDragEnd={draggable?()=>{setDragRosterId("");setDragOverRosterId("")}:undefined}>
      <div className="cup-roster-player">
        {draggable&&<span className="cup-roster-handle" aria-hidden="true"
          onTouchStart={onRosterHandleTouchStart(id,"roster")}
          onTouchMove={onRosterHandleTouchMove}
          onTouchEnd={onRosterHandleTouchEnd(tournament)}
          onTouchCancel={onRosterHandleTouchEnd(tournament)}
          style={{touchAction:"none"}}>⠿</span>}
        <PlayerBadge player={player(id)??{short:"?"}}/>
        <div className="cup-roster-player-copy">
          <b>{name(id)}</b>
          <span className="cup-roster-stat">
            {standing.rating!=null?<span className="cup-roster-stat-item"><i>ELO</i>{standing.rating}</span>:<em>{t("未評分")}</em>}
            {standing.handicap!=null&&tournament.handicapMode==="suggested"&&<span className="cup-roster-stat-item"><i>{t("評分")}</i>{standing.handicap}</span>}
            {tournament.arrivalTimes?.[id]&&<span className="cup-roster-arrival"><i aria-hidden="true">🕒</i>{tournament.arrivalTimes[id]}</span>}
          </span>
        </div>
      </div>
      <span className="cup-roster-actions">
        {canManage&&<select className="cup-roster-edit" defaultValue="" onChange={rosterPick(id)} aria-label={t("更換 {v}", {v: name(id)})}>
          <option value="">⋯</option>
          <optgroup label={t("換上")}>{spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
        </select>}
        {canEditEntrants&&<Button variant="quiet" className="cup-btn sm cup-roster-remove" onClick={()=>onEditRoster(tournament,id,"")}>{t("移除")}</Button>}
      </span>
    </li>;})}</ul>
    {canManage&&canArrangeRoster&&<p className="cup-roster-note">{t("拖曳球員名稱可調整名單順序")}{status!=="done"&&t("，亦會更新對陣圖")}{t("。")}</p>}
    {/* The list reorders; the bracket trades seats. Two different edits, so say where the other one
        lives rather than letting a host hunt for it. */}
    {canManage&&drawn&&deadlinePassed&&<p className="cup-roster-note">{t("如要指定邊個打邊個，可在下方對陣圖／賽程用每位球員旁的「⋯」對調位置，或直接拖曳對陣圖上的名字。")}</p>}
    {canManage&&<label className="cup-roster-add">
      <span>{!canEditEntrants?t("已有賽果，只可替換名單上的球員"):drawn?t("加入球員（會重新排列籤表）"):t("加入球員")}</span>
      {canEditEntrants&&<select defaultValue="" onChange={event=>{const value=event.target.value;event.target.value="";if(value)onEditRoster(tournament,"",value)}}>
        <option value="">{t("選擇球員…")}</option>
        {spare.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
    </label>}
  </div>:null;

  const tieRow=(slot:BracketSlot<Match>)=>{
    const key=`${slot.round}-${slot.index}`;
    /* A played tie is a result, so it is drawn as one: the same card the Matches tab uses, gold for a
       cup. Its own tools (edit, share, details) come with it; the tie's actions below are for ties
       still to be played. */
    if(slot.state==="played"&&slot.match){
      const match=slot.match;
      return <li id={`cup-tie-${key}`} className={`cup-tie-result${focusTie===key?" focus":""}`} key={key}>
        <MatchCard data={data} match={match} canManage={canManageMatch(match)} name={name} onPlayer={id=>{const who=player(id);if(who)onPlayer(who)}} onEdit={onEdit} onVoid={onVoid} onShare={onShare}/>
      </li>;
    }
    const mine=Boolean(ownPlayerId&&(slot.a===ownPlayerId||slot.b===ownPlayerId));
    const canRecord=slot.state==="ready"&&Boolean(isAdmin||mine);
    /* One status chip in the head for every tie still open or decided without a match, so a bye, a
       walkover and a tie to be played all read from the same place. The ✓ already says who went
       through, so the chip does not need to repeat the name. */
    const status=slot.state==="bye"?t("輪空")
      :slot.state==="walkover"?t("棄權晉級")
      :slot.state==="waiting"?t("等待上一圈")
      :slot.state==="tbd"?t("對陣待定")
      :slot.state==="ready"?t("未開賽"):"";
    return <li id={`cup-tie-${key}`} className={`cup-tie ${slot.state}${mine?" mine":""}${focusTie===key?" focus":""}`} key={key}>
      {/* A cup runs over weeks, so "who won" without "when" leaves the bracket undated — the one
          question a member asks of a finished tie after the fact. */}
      <div className="cup-tie-head"><span className="cup-tie-no">{t("第 {index} 場", {index: slot.index})}</span>
        {slot.match&&<time className="cup-tie-date" dateTime={slot.match.playedOn}>{slot.match.playedOn}</time>}
        {status&&<span className={`cup-tie-status ${slot.state}`}>{status}</span>}
        {mine&&<span className="cup-tie-mine">{t("你的賽事")}</span>}
        {slot.match&&canManageMatch(slot.match)&&<IconButton className="card-tool cup-tie-edit" label={t("編輯 {v} 對 {v2} 的賽果", {v: name(slot.a), v2: name(slot.b)})} onClick={()=>onEdit(slot.match!)}>✎</IconButton>}</div>
      {([slot.a,slot.b] as const).map((id,side)=>{
        const won=Boolean(slot.winner&&slot.winner===id);
        return <div className={`cup-tie-side${won?" won":""}${id?"":" tbd"}`} key={side}>
          {/* An empty seat is a dashed ring, as on the bracket overview, so "nobody yet" never looks like a player. */}
          {id?<PlayerBadge player={player(id)??{short:"?"}}/>:<i className="cup-tie-vacant" aria-hidden="true"/>}
          <b>{id?name(id):slot.state==="bye"?t("輪空"):t("待定")}</b>
          {slot.match&&id?<em>{scoreFor(slot.match,id)}</em>:won?<i aria-hidden="true">✓</i>:null}
          {seatTool(id,slot.round)}
        </div>;
      })}
      <div className="cup-tie-actions">
        {canRecord&&<Button variant="primary" className="cup-btn sm" onClick={()=>onRecordSlot(tournament,slot)}>{t("記錄賽果")}</Button>}
        {canRecord&&mine&&<Button variant="secondary" className="cup-btn sm" onClick={()=>onArrange(opponentIn(slot,ownPlayerId))}>{t("約時間")}</Button>}
        {canManage&&slot.state==="ready"&&[slot.a,slot.b].map(id=><Button variant="secondary" className="cup-btn sm" key={id} onClick={()=>onWalkover(tournament,slot,id)}>{t("判 {v} 晉級", {v: name(id)})}</Button>)}
        {canManage&&slot.state==="walkover"&&<Button variant="secondary" className="cup-btn sm" onClick={()=>onWalkover(tournament,slot,"")}>{t("取消判定")}</Button>}
      </div>
    </li>;
  };

  /* A courtesy for the other entrants, not a decision — so it never asks for confirmation the way
     joining/leaving does, and stays open to change for as long as you're entered, deadline or not.
     Presets read relative to the cup's own start time (when the host set one) so a tap needs no
     typing at all; "自訂時間" is the one path that still needs input, and even that is two selects
     rather than a native time field, so it can never be the thing overflowing its row again.

     Collapsed by default: a card showing a live row of preset buttons invited stray taps from
     members just scrolling past — "編輯" is a deliberate second step before any of them are even
     on screen, and picking one (or confirming a custom time) collapses straight back. */
  const myArrivalTime=ownPlayerId?tournament.arrivalTimes?.[ownPlayerId]??"":"";
  const arrivalPresets=startAtTime?[
    {key:"early",label:t("提早15分鐘"),time:shiftHHMM(startAtTime,-15)},
    {key:"onTime",label:t("準時到達"),time:startAtTime},
    {key:"late15",label:t("遲到15分鐘"),time:shiftHHMM(startAtTime,15)},
    {key:"late30",label:t("遲到30分鐘"),time:shiftHHMM(startAtTime,30)},
  ]:[];
  const applyArrival=(time:string)=>{onSetArrivalTime(tournament.id,time);setArrivalCustomOpen(false);setArrivalPanelOpen(false)};
  const openArrivalCustom=()=>{
    if(arrivalCustomOpen){setArrivalCustomOpen(false);return}
    const [h,m]=(myArrivalTime||startAtTime||"18:00").split(":");
    setArrivalCustomHour(h);setArrivalCustomMinute(m);setArrivalCustomOpen(true);
  };
  const arrivalEditor=signedUp&&ownPlayerId&&<div className="cup-arrival-card">
    <div className="cup-arrival-card-head">
      <div className="cup-arrival-card-copy">
        <b><span aria-hidden="true">🕒</span>  {t("到達時間")}</b>
        <small>{myArrivalTime?t("已告知其他球員你預計到達的時間。"):t("可選 — 讓其他球員知道你大約幾點到場。")}</small>
      </div>
      <div className="cup-arrival-card-actions">
        {myArrivalTime&&<span className="cup-arrival-value">{myArrivalTime}</span>}
        <Button variant="secondary" className="cup-btn sm" aria-expanded={arrivalPanelOpen} onClick={()=>{if(arrivalPanelOpen){setArrivalCustomOpen(false)}setArrivalPanelOpen(value=>!value)}}>{arrivalPanelOpen?t("收起"):myArrivalTime?t("更改"):t("設定")}</Button>
      </div>
    </div>
    {arrivalPanelOpen&&<>
      <div className="cup-arrival-presets">
        {arrivalPresets.map(preset=><button type="button" key={preset.key} className={`cup-arrival-preset${myArrivalTime===preset.time?" active":""}`} onClick={()=>applyArrival(preset.time)}>
          <b>{preset.time}</b><small>{preset.label}</small>
        </button>)}
        <button type="button" className={`cup-arrival-preset is-custom${arrivalCustomOpen?" active":""}`} aria-expanded={arrivalCustomOpen} onClick={openArrivalCustom}>
          <b aria-hidden="true">⋯</b><small>{t("自訂時間")}</small>
        </button>
      </div>
      {arrivalCustomOpen&&<div className="cup-arrival-custom">
        <TimeOfDayPicker hour={arrivalCustomHour} minute={arrivalCustomMinute} onHour={setArrivalCustomHour} onMinute={setArrivalCustomMinute}/>
        <div className="cup-arrival-custom-actions">
          <Button variant="primary" className="cup-btn sm" onClick={()=>applyArrival(`${arrivalCustomHour}:${arrivalCustomMinute}`)}>{t("確定")}</Button>
          <Button variant="secondary" className="cup-btn sm" onClick={()=>setArrivalCustomOpen(false)}>{t("取消")}</Button>
        </div>
      </div>}
      {myArrivalTime&&<button type="button" className="cup-arrival-clear" onClick={()=>applyArrival("")}>{t("清除到達時間")}</button>}
    </>}
  </div>;
  const shareState=shareStateOf(tournament);
  const shareUrgency=cupUrgency(shareState);
  /* The faces on the Instagram card. A viewer recognising one person they play with is the whole
     argument for entering, so the roster travels with the story rather than just a count. */
  const storyPerson=(id:string):StoryPerson=>{
    const found=player(id);
    return {name:found?.name??"",short:found?.short??"?",colour:found?.colour??null,avatar:found?.avatar??null};
  };
  return <section className="cup">
    <button type="button" className="cup-back" onClick={()=>setSelectedTournament("")}><span aria-hidden="true">‹</span>  {t("所有盃賽")}</button>
    <header className={`cup-banner is-${status}`}>
      <CupEmblem className="cup-banner-emblem"/>
      <div className="cup-banner-body">
        <div className="cup-card-top"><span className={`cup-chip is-${status}`}>{t(CUP_STATUS_LABEL[status])}</span>{canManage&&controls(tournament)}</div>
        <h2>{tournament.name}</h2>
        <p>{tournament.startAt&&<>{t("開始：{v} ·", {v: deadlineText(tournament.startAt)})} </>}{deadlinePassed?t("報名已於 {v} 截止", {v: deadlineText(tournament.signupDeadline)}):t("報名截止 {v}", {v: deadlineText(tournament.signupDeadline)})}</p>
        <div className="cup-banner-stats">
          <div><b>{tournament.signups.length}</b><small>{t("參賽")}</small></div>
          <div><b>{settled}<i>/{total||"—"}</i></b><small>{t("已定勝負")}</small></div>
          <div><b>{champion?t("完賽"):stage&&bracket?roundLabel(t, stage.round,bracket.rounds):t("待抽籤")}</b><small>{t("階段")}</small></div>
        </div>
        {total>0&&<div className="cup-progress" role="img" aria-label={t("賽程進度 {settled} / {total}", {settled, total})}><i style={{width:`${Math.round(settled/total*100)}%`}}/></div>}
      </div>
    </header>

    {/* Recruiting is the one state where sharing is not a nicety — a cup with four entrants is a
        worse cup — so the ask is loud, states the clock, and names WhatsApp rather than 「分享」. */}
    <div className={`cup-share-row${status==="signup"?" recruiting":""}`}>
      <div>
        <b>{status==="signup"?t("叫多幾個會友嚟報名{v}", {v: shareUrgency.label?t("｜{label}", {label: shareUrgency.label}):""}):t("分享賽程同賽果")}</b>
        <small>{cupShareCta(t, shareState).hint}</small>
      </div>
      <CupShareButtons name={tournament.name} state={shareState}
        url={typeof window==="undefined"?"":cupShareUrl(window.location.origin,tournament.id)}
        entrants={rosterIds.map(storyPerson)}
        champion={champion?storyPerson(champion):null}
        bracket={chart?storyBracket(t, chart):[]} tone="primary"/>
    </div>

    {!deadlinePassed?<>
      {/* Entering a cup is a competition decision, so it sits with the bracket it leads to rather
          than in 約戰, where it competed for attention with arranging tonight's frame. */}
      <div className={`cup-signup${signedUp?" in":""}`}>
        <div><b>{signedUp?t("你已報名"):t("報名參加")}</b><small>{signedUp?t("截止後會自動抽籤，並通知你首圈對手。"):t("截止後按報名名單抽籤並建立對陣。")}</small></div>
        {ownPlayerId
          ?<Button variant={signedUp?"secondary":"primary"} className="cup-btn" onClick={()=>{setSignupArrivalOn(false);if(startAtTime){const [h,m]=startAtTime.split(":");setSignupArrivalHour(h);setSignupArrivalMinute(m)}setPendingSignup({id:selectedTournament,name:tournament.name,joined:signedUp})}}>{signedUp?t("取消報名"):t("立即報名")}</Button>
          :<a className="cup-btn primary" href="/login">{t("登入後報名")}</a>}
      </div>
      {arrivalEditor}
      {rosterPanel}
    </>:!bracket||!bracket.size?<div className="cup-empty"><span aria-hidden="true">🎱</span><b>{t("報名人數不足兩人")}</b><p>{isAdmin?t("可編輯盃賽並延後報名截止時間，重新開放報名。"):t("今屆未能開賽。")}</p></div>:<>
      {!drawn&&ownPlayerId&&<p className="cup-note">{t("正在抽籤…")}</p>}
      {arrivalEditor}
      {champion?<article className="cup-champion">
        <CupEmblem/>
        <div><small>{t("{name} 冠軍", {name: tournament.name})}</small><b>{name(champion)}</b></div>
        <PlayerBadge player={player(champion)??{short:"?"}}/>
      </article>
      :mySlot?<article className={`cup-mytie${mySlot.state==="ready"?" ready":""}`}>
        <p className="sl-eyebrow">{t("{v} · 第 {index} 場", {v: roundLabel(t, mySlot.round,bracket.rounds), index: mySlot.index})}</p>
        <div className="cup-mytie-vs">
          {([ownPlayerId!,opponentIn(mySlot,ownPlayerId)] as const).map((id,side)=><Fragment key={side}>
            {side===1&&<span className="cup-mytie-mark" aria-hidden="true">VS</span>}
            <div className="cup-mytie-player">
              <PlayerBadge player={player(id)??{short:"?"}}/>
              <b>{side===0?t("你"):id?name(id):t("待定")}</b>
              <small>{id&&player(id)?`${Math.round(player(id)!.rating)} ELO`:t("未定")}</small>
            </div>
          </Fragment>)}
        </div>
        {mySlot.state==="ready"
          ?<div className="cup-mytie-actions"><Button variant="primary" className="cup-btn" onClick={()=>onRecordSlot(tournament,mySlot)}>{t("記錄賽果")}</Button><Button variant="secondary" className="cup-btn" onClick={()=>onArrange(opponentIn(mySlot,ownPlayerId))}>{t("約時間")}</Button></div>
          :<p className="cup-mytie-wait">{t("對手要等上一圈賽果出咗先定到。")}</p>}
      </article>
      :eliminated?<p className="cup-note">{t("你在今屆已止步；可繼續睇餘下賽程。")}</p>
      :ownPlayerId&&!tournament.signups.includes(ownPlayerId)?<p className="cup-note">{t("你未有報名今屆盃賽。")}</p>:null}

      {chart&&<CupBracketChart chart={chart} activeRound={openRound}
        onPick={(round,index)=>{setOpenRound(round);setFocusTie(`${round}-${index}`)}}/>}
      <SlidingToggleGroup as="nav" className="cup-rounds ds-toggle-control" aria-label={t("選擇輪次")}>{Array.from({length:bracket.rounds},(_,index)=>{
        const round=index+1,done=bracket.slots.filter(slot=>slot.round===round&&slot.settled&&slot.state!=="dead").length;
        const count=bracket.slots.filter(slot=>slot.round===round&&slot.state!=="dead").length;
        return <button type="button" key={round} className={round===openRound?"active":""} aria-current={round===openRound?"true":undefined} onClick={()=>setOpenRound(round)}>
          <b>{roundLabel(t, round,bracket.rounds)}</b><small>{done}/{count}</small>
        </button>;
      })}</SlidingToggleGroup>
      <ol className="cup-ties">{bracket.slots.filter(slot=>slot.round===openRound&&slot.state!=="dead").map(tieRow)}</ol>
      {canManage&&rosterPanel}

      {/* The full tree — names, scores and controls in every box — needs width the phone does not
          have; there, CupBracketChart carries the shape and the cards carry the detail. */}
      <div className="cup-tree"><TournamentBracketChart bracket={bracket} name={name} ownPlayerId={ownPlayerId} isAdmin={isAdmin} canManage={canManage} canMoveSeat={canMoveSeat} seatTool={seatTool} dragRosterId={dragRosterId} dragOverRosterId={dragOverRosterId} canManageMatch={canManageMatch} onEdit={onEdit} onRecordSlot={slot=>onRecordSlot(tournament,slot)} onWalkover={(slot,winnerId)=>onWalkover(tournament,slot,winnerId)} onDragStart={id=>{setDragRosterId(id);setDragOverRosterId("")}} onDragOver={id=>setDragOverRosterId(id)} onDrop={id=>{if(dragRosterId&&dragRosterId!==id){onEditRoster(tournament,dragRosterId,id)}setDragRosterId("");setDragOverRosterId("")}} onDragEnd={()=>{setDragRosterId("");setDragOverRosterId("")}} onTouchStart={id=>onRosterHandleTouchStart(id,"bracket")} onTouchMove={onRosterHandleTouchMove} onTouchEnd={onRosterHandleTouchEnd(tournament)}/></div>
    </>}
    {confirmSignupDialog}
  </section>;
}

/* The recorder's own name leads the form, so the match's A side is not necessarily the box's top
   line. Read each score by player id and the two can never drift apart. */
export function scoreFor(match:Match,playerId:string){
  return match.a===playerId?match.scoreA:match.b===playerId?match.scoreB:"";
}

// A horizontal, left-to-right bracket tree: each round is a column of match
// boxes vertically centred against the pair feeding it, using the flex
// "stretch + space-around" trick so pairing lines up correctly without
// needing to measure pixel positions in JS.
export function TournamentBracketChart({bracket,name,ownPlayerId,isAdmin,canManage,canMoveSeat,seatTool,dragRosterId,dragOverRosterId,canManageMatch,onEdit,onRecordSlot,onWalkover,onDragStart,onDragOver,onDrop,onDragEnd,onTouchStart,onTouchMove,onTouchEnd}:{
  bracket:Bracket<Match>;
  name:(id:string)=>string;
  ownPlayerId?:string;
  isAdmin:boolean;
  canManage:boolean;
  canMoveSeat:(id:string)=>boolean;
  seatTool:(id:string,round:number)=>ReactNode;
  dragRosterId:string;
  dragOverRosterId:string;
  canManageMatch:(match:Match)=>boolean;
  onEdit:(match:Match)=>void;
  onRecordSlot:(slot:BracketSlot<Match>)=>void;
  onWalkover:(slot:BracketSlot<Match>,winnerId:string)=>void;
  onDragStart:(id:string)=>void;
  onDragOver:(id:string)=>void;
  onDrop:(id:string)=>void;
  onDragEnd:()=>void;
  onTouchStart:(id:string)=>(event:ReactTouchEvent)=>void;
  onTouchMove:(event:ReactTouchEvent)=>void;
  onTouchEnd:()=>void;
}){
  const t = useT();
  return <div className="bracket-chart" role="group" aria-label={t("賽事對陣圖")}>
    {Array.from({length:bracket.rounds},(_,roundIndex)=>{
      const round=roundIndex+1;
      return <div className={`bracket-round${round===bracket.rounds?" final":""}`} key={round}>
        <h3 className="bracket-round-title">{roundLabel(t, round,bracket.rounds)}</h3>
        <div className="bracket-round-matches">
          {bracket.slots.filter(slot=>slot.round===round).map(slot=>{
            const {a:first,b:second,match,winner}=slot;
            const mine=Boolean(ownPlayerId&&(first===ownPlayerId||second===ownPlayerId));
            /* Recording is offered to the two players in the box and to an admin. Coming from the
               box means the round and match number are carried, not typed — the class of mistake
               that used to file a quarter-final result as a first-round one. */
            const canRecord=slot.state==="ready"&&Boolean(isAdmin||mine);
            /* The equal-height cell draws the elbow into the next round (see .bracket-cell), so the
               lines meet between a pair even when one box carries record or walkover controls. */
            return <div className={`bracket-cell${slot.state==="dead"?" is-dead":""}${slot.settled&&slot.state!=="dead"?" is-settled":""}${first||second?" has-entrant":""}`} key={`${round}-${slot.index}`}>
            <div className={`bracket-match ${slot.state}${mine?" mine":""}`}>
              {match&&canManageMatch(match)&&<IconButton className="card-tool bracket-edit" label={t("編輯 {v} 對 {v2} 的賽果", {v: name(first), v2: name(second)})} onClick={()=>onEdit(match)}>✎</IconButton>}
              {[first,second].map((id,side)=>{
                /* Only round one, and only a player who has not played: dragging a name out of a
                   box that already has a scorecard would leave the two disagreeing. */
                const draggable=round===1&&canMoveSeat(id);
                return <div key={side} className={`bracket-slot${winner&&winner===id?" winner":""}${!id?" tbd":""}${dragRosterId&&dragRosterId!==id&&dragOverRosterId===id?" drag-over":""}${dragRosterId===id?" dragging":""}`} draggable={draggable} data-drag-player-id={id||undefined}
                  onDragStart={draggable?event=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id);onDragStart(id)}:undefined}
                  onDragOver={draggable?event=>{event.preventDefault();onDragOver(id)}:undefined}
                  onDrop={draggable?event=>{event.preventDefault();onDrop(id)}:undefined}
                  onDragEnd={draggable?onDragEnd:undefined}
                  onTouchStart={draggable?onTouchStart(id):undefined}
                  onTouchMove={draggable?onTouchMove:undefined}
                  onTouchEnd={draggable?onTouchEnd:undefined}
                  onTouchCancel={draggable?onTouchEnd:undefined}>
                  <span>{id?name(id):t("待定")}</span>{match&&<b>{scoreFor(match,id)}</b>}{seatTool(id,round)}
                </div>;
              })}
              {match&&<time className="bracket-date" dateTime={match.playedOn}>{match.playedOn}</time>}
              {slot.state==="bye"&&<small className="bracket-bye">{t("輪空晉級")}</small>}
              {slot.state==="walkover"&&<small className="bracket-bye">{t("{v} 因對手棄權晉級", {v: name(slot.winner)})}</small>}
              {slot.state==="waiting"&&<small className="bracket-bye">{t("等待上一圈賽果")}</small>}
              {canRecord&&<Button variant="featured" className="bracket-record" onClick={()=>onRecordSlot(slot)}>{t("記錄賽果")}</Button>}
              {canManage&&slot.state==="ready"&&<div className="bracket-walkover"><small>{t("判定晉級")}</small><span>{[first,second].map(id=><Button variant="quiet" key={id} onClick={()=>onWalkover(slot,id)}>{name(id)}</Button>)}</span></div>}
              {canManage&&slot.state==="walkover"&&<Button variant="quiet" className="bracket-edit" onClick={()=>onWalkover(slot,"")}>{t("取消判定")}</Button>}
            </div>
            </div>;
          })}
        </div>
      </div>;
    })}
    <div className={`bracket-crown${bracket.champion?" is-crowned":""}`}>
      <span className="bracket-crown-mark" aria-hidden="true"><CupMark/></span>
      {bracket.champion
        ?<><small>{t("冠軍")}</small><b>{name(bracket.champion)}</b></>
        :<b className="is-pending">{t("待定")}</b>}
    </div>
  </div>;
}

// Collapsed by default: who played, the score, and each player's own ELO
// swing — the facts a user scans for. Edit/delete controls and the deeper
// math (before→after, predicted ratio, handicap detail) stay one tap away.
/** The competition a match belonged to, named and staged, or null for an ordinary club game.
 *
 *  One derivation for every surface: the share sheet, the story card and the match card's own badge
 *  all call it, so a tie can never be a semi-final in one place and unlabelled in another. */
export function cupFor(t: Translator, match:Match,data:AppState){
  if(!match.tournamentId)return null;
  const tournament=data.tournaments.find(item=>item.id===match.tournamentId);
  if(!tournament)return null;
  return {name:tournament.name,round:matchRoundLabel(t, tournament.signups?.length??0,match.tournamentRound)};
}

/** `8月1日` / `1 Aug` — the year only appears once the match is from a different year than today.
 *  Matches sit under month headings, so the full ISO date was repeating what the list already says. */
export function shortMatchDate(playedOn:string,locale:Locale){
  const [y,mo,d]=playedOn.split("-");
  if(!y||!mo||!d)return playedOn;
  return calendarDateLabel(y,mo,d.slice(0,2),locale,Number(y)!==new Date().getFullYear());
}

export function MatchCard({data,match:m,canManage,name,onPlayer,onEdit,onVoid,onShare,highlighted=false}:{data:AppState;match:Match;canManage:boolean;name:(id:string)=>string;onPlayer:(id:string)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void;highlighted?:boolean}) {
  const t = useT();
  const [open,setOpen]=useState(false);
  // Scrolling to the card beats trusting it to be at the top: a backdated
  // result, or an ascending sort, can drop it anywhere in the month groups.
  const card=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!highlighted)return;
    card.current?.scrollIntoView({behavior:"smooth",block:"center"});
  },[highlighted]);
  const breaksByPlayer=(m.highBreaks??[]).filter(item=>item.value>0).reduce((groups,item)=>{
    const group=groups.find(g=>g.playerId===item.playerId);
    if(group)group.values.push(item.value);else groups.push({playerId:item.playerId,values:[item.value]});
    return groups;
  },[] as {playerId:string;values:number[]}[]);
  const leftLabel = isEntertainmentMode(m.mode) ? teamLabel(m,data,"A") : name(m.a);
  const rightLabel = isEntertainmentMode(m.mode) ? teamLabel(m,data,"B") : name(m.b);
  const preMatchLeftElo=m.beforeA2==null?m.beforeA:(m.beforeA+m.beforeA2)/2;
  const preMatchRightElo=m.beforeB2==null?m.beforeB:(m.beforeB+m.beforeB2)/2;
  const recommendedActual=suggestedHandicapAtRating(preMatchRightElo,data)-suggestedHandicapAtRating(preMatchLeftElo,data);
  const handicapText=(actual:number)=>
    actual>0?t("{leftLabel} 每局讓 {rightLabel} {actual} 分", {leftLabel, rightLabel, actual})
    :actual<0?t("{rightLabel} 每局讓 {leftLabel} {v} 分", {rightLabel, leftLabel, v: Math.abs(actual)})
    :t("不設讓分");
  /* A cup tie used to be indistinguishable from a Tuesday night frame in this list, which is the
     one place a member scrolls looking for the game they remember. It gets a gold edge on the board
     and a chip naming the round — the edge does the finding, the chip does the telling, and neither
     costs a row. */
  const cup=cupFor(t, m,data);
  const decisive=m.status!=="void"&&Math.min(m.scoreA,m.scoreB)===0&&Math.max(m.scoreA,m.scoreB)>=3;
  return <article ref={card} className={`match ${m.status}${isEntertainmentMode(m.mode)?" entertainment":""}${cup?" is-cup":""}${highlighted?" just-saved":""}`}
    // The whole card opens the details sheet; the › button below is the visible cue and the keyboard
    // route. Taps on the card's own buttons (share, player names) keep their own meaning.
    onClick={event=>{if(!(event.target as HTMLElement).closest("button,a,input,select,textarea"))setOpen(true)}}>
    <div className="match-board"><div className="match-top"><span className="match-when"><time dateTime={m.playedOn} title={m.playedOn}>{shortMatchDate(m.playedOn,t.locale)}</time>{cup&&<small className={`match-cup-badge${cup.round?" has-round":""}`} title={cup.round?`${cup.name} · ${cup.round}`:cup.name}><CupMark/>{cup.round&&<b>{cup.round}</b>}<span>{cup.name}</span></small>}{isEntertainmentMode(m.mode)&&<small className="match-entertainment-badge">{t("潮拍 2v2 · 不計 ELO")}</small>}{highlighted&&<span className="pill just-saved-pill">{t("剛剛記錄")}</span>}{m.status==="void"&&<span className="pill">{t("已作廢")}</span>}{m.entryMode==="aggregate"&&<span className="pill muted">{t("歷史匯總")}</span>}</span>
      {/* Sharing sits with the card's own tools rather than behind the expander: the urge to show a
          result off lasts about as long as the walk back to the table, and a share hidden one tap
          down is a share that does not happen. Offered to every reader, not only to whoever may
          edit the card — a clubmate posting your win is worth more than you posting it. A voided
          match is excluded; it is not a result any more. */}
      {/* The › sits outside .card-tools, which read-only (signed-out) views hide: everyone can open details. */}
      <span className="match-top-actions">
        <IconButton className="card-tool details" label={t("查看比賽詳情")} aria-haspopup="dialog" onClick={()=>setOpen(true)}><i aria-hidden="true"/></IconButton>
      </span></div>
    <Scoreline left={leftLabel} right={rightLabel} onLeftClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.a)} onRightClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.b)} scoreLeft={m.scoreA} scoreRight={m.scoreB}
      eloLeft={isEntertainmentMode(m.mode)?undefined:{before:m.beforeA,after:m.afterA,delta:m.deltaA}} eloRight={isEntertainmentMode(m.mode)?undefined:{before:m.beforeB,after:m.afterB,delta:m.deltaB??-m.deltaA}}/>
    {isEntertainmentMode(m.mode)&&<div className="match-team-rosters">{(["A","B"] as const).map(side=><div className={`match-team-roster ${side==="B"?"right":""}`} key={side}>{teamMemberIds(m,side).map(id=>{const player=data.players.find(item=>item.id===id);return <button type="button" key={id} onClick={()=>onPlayer(id)} aria-label={t("查看 {v} 的球員卡", {v: name(id)})}><PlayerBadge player={player??{short:"?"}}/><span>{name(id)}</span></button>})}</div>)}</div>}
    {!!breaksByPlayer.length&&<div className="match-summary-row"><span className="match-net-breaks">★ {t("單桿")}{t.locale==="en"?": ":"："}{breaksByPlayer.map((group,index)=><Fragment key={group.playerId}>{index>0&&" / "}{name(group.playerId)} {group.values.join(", ")}</Fragment>)}</span></div>}
    </div>
    {/* Portalled: the card lifts with a transform on hover, which would otherwise become the
        containing block for the sheet's fixed overlay and clip it to the card. */}
    {open&&createPortal(<Sheet open title={t("{leftLabel} 對 {rightLabel}", {leftLabel, rightLabel})} onClose={()=>setOpen(false)} className={`match-sheet${cup?" is-cup":""}`}>
      <div className="match-sheet__board">
        <p className="match-sheet__meta"><time dateTime={m.playedOn}>{m.playedOn}</time>{cup&&<> · {cup.round?`${cup.name} · ${cup.round}`:cup.name}</>}{isEntertainmentMode(m.mode)&&<> · {t("潮拍 2v2 · 不計 ELO")}</>}{m.status==="void"&&<> · {t("已作廢")}</>}</p>
  <Scoreline animate left={leftLabel} right={rightLabel} onLeftClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.a)} onRightClick={isEntertainmentMode(m.mode)?undefined:()=>onPlayer(m.b)} scoreLeft={m.scoreA} scoreRight={m.scoreB}/>
        {!isEntertainmentMode(m.mode)&&<div className="match-sheet__elo">{([{label:leftLabel,before:m.beforeA,after:m.afterA,delta:m.deltaA},{label:rightLabel,before:m.beforeB,after:m.afterB,delta:m.deltaB??-m.deltaA}]).map((side,index)=><div key={index} className={`match-sheet__elo-side ${index?"right ":""}${side.delta>=0?"positive":"negative"}`}><b>ELO {side.delta>=0?"+":""}{Math.round(side.delta)}</b><span>{Math.round(side.before)} <i aria-hidden="true">→</i> {Math.round(side.after)}</span></div>)}</div>}
        {decisive&&<span className="match-sheet__tag">{t("完勝")}</span>}
      </div>
      {!isEntertainmentMode(m.mode)&&<div className="match-sheet__odds"><span className="match-sheet__label">{t("預測局數比例")}</span>
        <div className="match-sheet__odds-bar" role="img" aria-label={`${leftLabel} ${Math.round(m.expectedA*100)}% · ${rightLabel} ${100-Math.round(m.expectedA*100)}%`}><i style={{width:`${Math.round(m.expectedA*100)}%`}}/></div>
        <div className="match-sheet__odds-legend"><b>{leftLabel} {Math.round(m.expectedA*100)}%</b><b>{100-Math.round(m.expectedA*100)}% {rightLabel}</b></div></div>}
      {isEntertainmentMode(m.mode)&&<p className="match-sheet__note">{t("娛樂賽記錄；不影響四位球員的 ELO 或統計。")}</p>}
      <div className="match-sheet__tile"><span className="match-sheet__label">{t("本場讓分")}</span><b>{handicapText(m.actual)}</b><small>{t("賽前建議：{v}", {v: handicapText(recommendedActual)})}</small></div>
      {!!breaksByPlayer.length&&<div className="match-sheet__breaks"><span className="match-sheet__label">{t("單桿")}</span>{breaksByPlayer.map(group=><div key={group.playerId}><span>{name(group.playerId)}</span>{group.values.map((value,index)=><b key={index} className={value>=100?"century":""}>{value}</b>)}</div>)}</div>}
      <p className="match-sheet__added">{t("加入日期")} · {new Date(m.createdAt).toLocaleString(INTL_LOCALE[t.locale])}</p>
      <div className="match-sheet__actions">
        {m.status!=="void"&&<Button variant="secondary" onClick={()=>{setOpen(false);onShare(m)}}>{t("分享")}</Button>}
        {canManage&&<Button variant="secondary" onClick={()=>{setOpen(false);onEdit(m)}}>{t("編輯")}</Button>}
        {canManage&&<Button variant="danger" onClick={()=>{setOpen(false);onVoid(m)}}>{t("刪除")}</Button>}
      </div>
    </Sheet>,document.body)}
  </article>;
}

export function EloChange({before,after,delta}:{before:number;after:number;delta:number}){
  return <span className={`elo-change ${delta>=0?"positive":"negative"}`}><b>{delta>=0?"+":""}{Math.round(delta)}</b>{Math.round(before)} → {Math.round(after)}</span>;
}

export const weekdayLabels=[msg("一"),msg("二"),msg("三"),msg("四"),msg("五"),msg("六"),msg("日")];
export function shiftMonth(month:string,delta:number){
  const [y,m]=month.split("-").map(Number);
  const d=new Date(y,m-1+delta,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
export function monthGrid(month:string){
  const [y,m]=month.split("-").map(Number);
  const startOffset=(new Date(y,m-1,1).getDay()+6)%7;
  const daysInMonth=new Date(y,m,0).getDate();
  const cells:(string|null)[]=Array.from({length:startOffset},()=>null);
  for(let d=1;d<=daysInMonth;d++)cells.push(`${month}-${String(d).padStart(2,"0")}`);
  while(cells.length%7!==0)cells.push(null);
  return cells;
}
export function monthLabel(t: Translator, month:string){
  const [y,m]=month.split("-").map(Number);
  return monthYearLabel(y,m,t.locale);
}

export function CalendarView({data,canManageMatch,onPlayer,onEdit,onVoid,onShare}:{data:AppState;canManageMatch:(match:Match)=>boolean;onPlayer:(player:Player)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onShare:(m:Match)=>void}) {
  const t = useT();
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??t("已刪除球員");
  const confirmed=useMemo(()=>data.matches.filter(m=>m.status==="confirmed"),[data.matches]);
  const currentMonth=today.slice(0,7);
  const bounds=useMemo(()=>{
    const months=new Set(confirmed.map(m=>m.playedOn.slice(0,7)));
    months.add(currentMonth);
    const sorted=[...months].sort();
    return {min:sorted[0],max:sorted[sorted.length-1]};
  },[confirmed,currentMonth]);
  const [month,setMonth]=useState(currentMonth);
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const dayMatches=useMemo(()=>{
    const map=new Map<string,Match[]>();
    for(const m of confirmed){
      if(!m.playedOn.startsWith(month))continue;
      const list=map.get(m.playedOn)??[];
      list.push(m);
      map.set(m.playedOn,list);
    }
    return map;
  },[confirmed,month]);
  const maxCount=Math.max(1,...[...dayMatches.values()].map(list=>list.length));
  const monthMatchCount=useMemo(()=>[...dayMatches.values()].reduce((total,matches)=>total+matches.length,0),[dayMatches]);
  const grid=useMemo(()=>monthGrid(month),[month]);
  const goToMonth=(next:string)=>{setMonth(next);setSelectedDay(null)};
  const selectedMatches=selectedDay?dayMatches.get(selectedDay)??[]:[];
  return <section className="calendar-view">
    <div className="calendar-nav">
      <IconButton className="calendar-nav-btn" label={t("上一個月")} disabled={month<=bounds.min} onClick={()=>goToMonth(shiftMonth(month,-1))}>‹</IconButton>
      <div className="calendar-nav-title">
        <b>{monthLabel(t, month)}</b>
        <span className="calendar-month-total"><strong>{monthMatchCount}</strong>  {t("場比賽")}</span>
      </div>
      <IconButton className="calendar-nav-btn" label={t("下一個月")} disabled={month>=bounds.max} onClick={()=>goToMonth(shiftMonth(month,1))}>›</IconButton>
    </div>
    <div className="calendar-body">
      <div className="calendar-weekdays">{weekdayLabels.map(w=><span key={w}>{t(w)}</span>)}</div>
      <div className="calendar-grid">{grid.map((date,index)=>{
        if(!date)return <span key={index} className="calendar-cell-blank" aria-hidden="true"/>;
        const list=dayMatches.get(date)??[];
        const count=list.length;
        const hasCentury=list.some(m=>m.highBreaks?.some(b=>b.value>=100));
        const tint=count?Math.max(1,Math.min(5,Math.ceil(count/maxCount*5))):0;
        const isToday=date===today;
        const isSelected=date===selectedDay;
        return <button key={date} type="button" disabled={!count}
          className={`calendar-cell${count?` has-matches tint-${tint}`:""}${isToday?" today":""}${isSelected?" selected":""}`}
          aria-pressed={isSelected} aria-label={`${date}${count?t("，{count} 場比賽", {count}):t("，沒有比賽")}`}
          onClick={()=>setSelectedDay(isSelected?null:date)}>
          <span className="calendar-date">{Number(date.slice(8))}</span>
          {count>0&&<span className="calendar-count">{count}</span>}
          {hasCentury&&<i className="calendar-century" aria-hidden="true" title={t("破百單桿")}>★</i>}
        </button>;
      })}</div>
      {dayMatches.size===0&&<div className="calendar-empty-overlay"><Empty text={t("本月沒有比賽記錄")} sub={t("使用上方箭嘴切換到有記錄的月份。")}/></div>}
    </div>
    {selectedDay&&<div className="calendar-day-detail">
      <SectionLabel sticky={false} meta={t("{selectedMatches} 場", {selectedMatches: selectedMatches.length})}><time dateTime={selectedDay}>{selectedDay}</time></SectionLabel>
      <div className="calendar-day-list">{selectedMatches.map(m=>
        <MatchCard key={m.id} data={data} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} onShare={onShare}/>)}</div>
    </div>}
  </section>;
}

export function ConfirmDeleteMatch({match,data,onCancel,onConfirm}:{match:Match;data:AppState;onCancel:()=>void;onConfirm:()=>void}) {
  const t = useT();
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??t("已刪除球員");
  const later=data.matches.filter(m=>m.status==="confirmed"&&m.id!==match.id&&(m.playedOn||m.createdAt)>=(match.playedOn||match.createdAt)).length;
  const leftLabel=isEntertainmentMode(match.mode)?teamLabel(match,data,"A"):name(match.a);
  const rightLabel=isEntertainmentMode(match.mode)?teamLabel(match,data,"B"):name(match.b);
  return <><p className="kicker">{t("需要確認")}</p><h2>{t("刪除這場比賽？")}</h2>
    <p className="sub">{isEntertainmentMode(match.mode)?t("這是潮拍娛樂賽；刪除只會移除歷史記錄，不會改變任何 ELO 或球員統計。"):t("確認後會由這場比賽起重新計算，其後所有 ELO、勝負、局數及近況都會重建。")}</p>
    <div className="confirm-target">
      <small>{t("比賽日期 {playedOn}", {playedOn: match.playedOn})}</small>
      <div className="confirm-scoreline"><span>{leftLabel}</span><b>{match.scoreA}</b><em>–</em><b>{match.scoreB}</b><span>{rightLabel}</span></div>
      <p>{match.actual>0?t("{leftLabel} 讓 {actual} 分", {leftLabel, actual: match.actual}):match.actual<0?t("{rightLabel} 讓 {v} 分", {rightLabel, v: Math.abs(match.actual)}):t("沒有讓分")} · ELO {match.deltaA>=0?"+":""}{Math.round(match.deltaA)} / {-match.deltaA>=0?"+":""}{Math.round(-match.deltaA)}</p>
      {!!match.highBreaks?.length&&<div className="match-breaks"><span>{t("單桿")}</span>{match.highBreaks.map((item,index)=><b key={`${item.playerId}-${index}`}>{name(item.playerId)} {item.value}</b>)}</div>}
    </div>
    {later>1&&<p className="confirm-impact">{t("此賽事之後還有")} <b>{later-1}</b>  {t("場比賽會一併重新計算。")}</p>}
    <div className="confirm-actions"><Button variant="secondary" className="confirm-cancel" onClick={onCancel}>{t("保留賽事")}</Button><Button variant="danger" className="confirm-delete" onClick={onConfirm}>{t("刪除賽事")}</Button></div>
    <p className="confirm-hint">{t("刪除後可在提示訊息按「復原」還原。")}</p></>;
}
