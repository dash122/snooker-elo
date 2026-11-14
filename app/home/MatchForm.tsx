import { Fragment,useEffect,useMemo,useRef,useState } from "react";
import { PlayerBadge } from "../UiBits";
import { type MySquad } from "../Squads";
import { roundedTeamEloDifference } from "../../lib/entertainment-match";
import { applyCupHandicap } from "../../lib/cup-handicap-draft";
import { HANDICAP_ELO_PER_POINT,HANDICAP_MODEL_VERSION } from "../../lib/handicap";
import { localDate } from "../../lib/local-date";
import { PlayerPicker } from "../PlayerPicker";
import { useT } from "../components/I18nProvider";
import { buildBracket,formatTournamentDateTime,opponentIn,playerSlot,roundLabel,slotAt } from "../../lib/tournament";
import { Button,SlidingToggleGroup } from "../components/ui/Primitives";
import { type Player,type Match,type Settings,type AppState,games,provisionalMultiplier,suggestedHandicap,teamLabel,teamRating,teamHandicap,calc,matchProbabilities } from "./model";


/** Replays a short pop on the element whenever `value` changes (not on first paint). Class-toggled, so a focused input is never remounted. */
export function useTick(value:unknown){
  const ref=useRef<HTMLInputElement|null>(null);
  const first=useRef(true);
  useEffect(()=>{
    if(first.current){first.current=false;return;}
    const el=ref.current;if(!el)return;
    el.classList.remove("tick");void el.offsetWidth;el.classList.add("tick");
  },[value]);
  return ref;
}
/** No best-of-N race goes this deep; a bigger number is almost certainly points scored, not frames won. */
export const FRAME_SCORE_SANITY_LIMIT=18;
export function MatchForm({squads,data,draft,setDraft,preview,a,b,editing,saving,onSave,ownPlayerId}:{ownPlayerId?:string;squads:MySquad[];data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;editing:boolean;saving:boolean;onSave:()=>void}) {
  const t = useT();
  const [breakInput,setBreakInput]=useState<Record<string,string>>({});
  const [breakMessage,setBreakMessage]=useState<Record<string,string>>({});
  const [breakReminder,setBreakReminder]=useState(false);
  const eloPreviewRef=useRef<HTMLElement|null>(null);
  const hadEloPreview=useRef(false);
  const [breakOpen,setBreakOpen]=useState<Record<string,boolean>>({});
  const [customHandicap,setCustomHandicap]=useState(editing||Boolean(draft.giver));
  /* Tracks whether the current giver/points are following "ELO 建議" (as opposed to "沒有讓分" or a
     custom value), so that switching the opponent can re-derive them for the new pairing instead of
     leaving stale values from the previous one behind. */
  const [followingSuggestion,setFollowingSuggestion]=useState(false);
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  /* The squad filter lives inside the player sheet and is kept here so it carries over from slot to slot. */
  const [pickerSquadId,setPickerSquadId]=useState<string|null>(null);
  const players=[...data.players].filter(p=>p.active).sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  /* The viewer's most recent co-players, newest first, for the sheet's "recent" section. */
  const recent=useMemo(()=>{
    if(!ownPlayerId)return [] as {id:string;playedOn:string}[];
    const seen=new Set<string>(),out:{id:string;playedOn:string}[]=[];
    const mine=data.matches.filter(m=>m.status==="confirmed"&&[m.a,m.b,m.a2,m.b2].includes(ownPlayerId)).sort((x,y)=>(y.playedOn||"").localeCompare(x.playedOn||"")||(y.createdAt||"").localeCompare(x.createdAt||""));
    for(const m of mine){
      for(const id of [m.a,m.b,m.a2,m.b2])if(id&&id!==ownPlayerId&&!seen.has(id)){seen.add(id);out.push({id,playedOn:m.playedOn})}
      if(out.length>=8)break;
    }
    return out;
  },[data.matches,ownPlayerId]);
  /* When each player last faced the viewer (as an opponent), for the picker rows. */
  const lastPlayed=useMemo(()=>{
    const map:Record<string,string>={};
    if(!ownPlayerId)return map;
    for(const m of data.matches){
      if(m.status!=="confirmed"||!m.playedOn)continue;
      const sideA=[m.a,m.a2],sideB=[m.b,m.b2];
      const against=sideA.includes(ownPlayerId)?sideB:sideB.includes(ownPlayerId)?sideA:[];
      for(const id of against)if(id&&(!map[id]||m.playedOn>map[id]))map[id]=m.playedOn;
    }
    return map;
  },[data.matches,ownPlayerId]);
  const pickerProps={squads,squadId:pickerSquadId,onSquadChange:setPickerSquadId,recent,lastPlayed,handicapOf:(player:Player)=>suggestedHandicap(player,data)};
  const isTeamMode=draft.mode==="2v2";
  const isCupMode=draft.mode==="cup";
  const a2=isTeamMode?data.players.find(player=>player.id===draft.a2):undefined;
  const b2=isTeamMode?data.players.find(player=>player.id===draft.b2):undefined;
  /* Keep the visible forecast tied directly to this form's draft. In particular, changing the
     selected giver or points must not wait for the parent preview used when the result is saved. */
  const livePreview=(()=>{
    const validTeams=!isTeamMode||Boolean(a2&&b2&&new Set([a.id,b.id,a2.id,b2.id]).size===4);
    if(!validTeams)return null;
    const match={a:a.id,b:b.id,a2:a2?.id,b2:b2?.id,mode:draft.mode,teamAName:draft.teamAName?.trim()||"Team A",teamBName:draft.teamBName?.trim()||"Team B"} as Match;
    const previewA=isTeamMode?{...a,id:"teamA",name:teamLabel(match,data,"A"),short:teamLabel(match,data,"A"),handicap:teamHandicap(match,data,"A"),rating:teamRating(match,data,"A")} as Player:a;
    const previewB=isTeamMode?{...b,id:"teamB",name:teamLabel(match,data,"B"),short:teamLabel(match,data,"B"),handicap:teamHandicap(match,data,"B"),rating:teamRating(match,data,"B")} as Player:b;
    const giverSide=isTeamMode?([a.id,a2?.id].includes(draft.giver)?"A":[b.id,b2?.id].includes(draft.giver)?"B":undefined):undefined;
    return calc(previewA,previewB,+draft.scoreA,+draft.scoreB,draft.giver,+draft.points,data.settings,giverSide);
  })();
  const forecast=livePreview??preview;
  const tournament=data.tournaments.find(t=>t.id===draft.tournamentId);
  /* Locked when the form was opened from a bracket box: the pairing, round and match number came
     from the tie itself, so there is nothing here to choose and no way to file the result against
     the wrong slot. */
  const cupSlotLocked=Boolean(isCupMode&&draft.cupSlotLocked);
  const cupBracket=useMemo(()=>isCupMode&&tournament?buildBracket<Match>(tournament,data.matches):null,[isCupMode,tournament,data.matches]);
  const cupSlot=cupBracket?slotAt(cupBracket,Number(draft.tournamentRound),Number(draft.tournamentMatchIndex)):undefined;
  const tournamentLabel=tournament?.name||t("未選擇盃賽");
  const playersForA=players.filter(p=>p.id!==draft.b&&p.id!==draft.b2&&p.id!==draft.a2);
  const playersForB=players.filter(p=>p.id!==draft.a&&p.id!==draft.a2&&p.id!==draft.b2);
  const playersForA2=players.filter(p=>p.id===draft.a2||(p.id!==draft.a&&p.id!==draft.b&&p.id!==draft.b2));
  const playersForB2=players.filter(p=>p.id===draft.b2||(p.id!==draft.b&&p.id!==draft.a&&p.id!==draft.a2));
  const [openASignal,setOpenASignal]=useState(0);
  const [openBSignal,setOpenBSignal]=useState(0);
  const [openA2Signal,setOpenA2Signal]=useState(0);
  const [openB2Signal,setOpenB2Signal]=useState(0);
  const pickA=(id:string)=>{update("a",id);if(id&&!draft.b)setOpenBSignal(s=>s+1);if(id&&!draft.a2&&draft.mode==="2v2")setOpenA2Signal(s=>s+1)};
  const pickB=(id:string)=>{update("b",id);if(id&&!draft.a)setOpenASignal(s=>s+1);if(id&&!draft.b2&&draft.mode==="2v2")setOpenB2Signal(s=>s+1)};
  const pickA2=(id:string)=>{update("a2",id);if(id&&!draft.b2)setOpenB2Signal(s=>s+1)};
  const pickB2=(id:string)=>{update("b2",id);if(id&&!draft.a2)setOpenA2Signal(s=>s+1)};
  /* Picking a player is picking their outstanding tie: there is only ever one box a member is due
     to play in, so the opponent, round and index all follow from the name. */
  const pickCupPlayer=(id:string)=>{
    const slot=cupBracket?playerSlot(cupBracket,id):undefined;
    update("a",id);update("b",slot&&slot.state==="ready"?opponentIn(slot,id):"");
    if(slot){update("tournamentRound",slot.round);update("tournamentMatchIndex",slot.index);}
  };
  const chooseCupTournament=(id:string)=>{
    update("tournamentId",id);
    update("cupSlotLocked",false);
    const nextTournament=data.tournaments.find(item=>item.id===id);
    const nextSlot=nextTournament?buildBracket<Match>(nextTournament,data.matches).slots.find(slot=>slot.state==="ready"):undefined;
    update("a",nextSlot?.a??"");update("b",nextSlot?.b??"");
    if(nextSlot){update("tournamentRound",nextSlot.round);update("tournamentMatchIndex",nextSlot.index);}
  };

  const addBreak=(playerId:string)=>{
    const value=Number(breakInput[playerId]);
    if(!Number.isInteger(value)||value<1||value>147)return;
    setDraft((d:any)=>({...d,highBreaks:[...(d.highBreaks??[]),{playerId,value}]}));
    setBreakInput(current=>({...current,[playerId]:""}));
    const previousBest=data.matches.filter(match=>match.status==="confirmed").flatMap(match=>(match.highBreaks??[]).filter(item=>item.playerId===playerId).map(item=>item.value)).reduce((best,item)=>Math.max(best,item),0);
    setBreakReminder(false);
    setBreakMessage(current=>({...current,[playerId]:value>previousBest&&previousBest>0?t("新個人最佳！比之前高 {v} 分 🎉", {v: value-previousBest}):value>previousBest?"":previousBest-value<=5?t("距離個人最佳 {previousBest} 只差 {v} 分", {previousBest, v: previousBest-value}):""}));
  };
  const removeBreak=(index:number)=>setDraft((d:any)=>({...d,highBreaks:(d.highBreaks??[]).filter((_:unknown,itemIndex:number)=>itemIndex!==index)}));
  const teamEloDifference=draft.mode==="2v2"&&a2&&b2?roundedTeamEloDifference([a,a2],[b,b2]):a.rating-b.rating;
  const teamAHandicap=isTeamMode&&a2?Math.round((suggestedHandicap(a,data)+suggestedHandicap(a2,data))/2):null;
  const teamBHandicap=isTeamMode&&b2?Math.round((suggestedHandicap(b,data)+suggestedHandicap(b2,data))/2):null;
  const fairActual=forecast?(isTeamMode&&teamAHandicap!=null&&teamBHandicap!=null?teamBHandicap-teamAHandicap:suggestedHandicap(b,data)-suggestedHandicap(a,data)):null;
  const probabilities=forecast?matchProbabilities(forecast.expectedA,+draft.scoreA+ +draft.scoreB):null;
  const previewDeltaA=forecast&&!isTeamMode?forecast.deltaA*provisionalMultiplier(games(a)):null;
  const previewDeltaB=forecast&&!isTeamMode?-forecast.deltaA*provisionalMultiplier(games(b)):null;
  const applyFair=()=>{
    if(fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.abs(fairActual)}));
    setCustomHandicap(false);
    setFollowingSuggestion(true);
  };
  const setNoHandicap=()=>{
    setDraft((d:any)=>({...d,giver:"",points:0}));
    setCustomHandicap(false);
    setFollowingSuggestion(false);
  };
  /* A cup's handicap is the cup's, not the recorder's, so the draft is reconciled to it here rather
     than left to the 讓分 controls (which are hidden in cup mode anyway). `applyCupHandicap` returns
     the very same draft once the terms already match, so this settles after one pass instead of
     feeding itself the re-render that used to take the page down — see lib/cup-handicap-draft.ts. */
  const cupHandicapMode=isCupMode&&tournament?tournament.handicapMode:undefined;
  useEffect(()=>{
    if(!cupHandicapMode)return;
    setDraft((d:any)=>applyCupHandicap(d,{handicapMode:cupHandicapMode,fairActual,aId:a.id,bId:b.id}));
    setCustomHandicap(false);
  },[cupHandicapMode,fairActual,a.id,b.id,setDraft]);
  /* Outside cup mode, "ELO 建議" is a snapshot taken at click time: it doesn't recompute on its own
     when the opponent (or team) changes afterwards. Re-derive it here so the button and the points
     shown stay in sync with whoever is currently selected, instead of showing a stale giver/points
     pair the button no longer recognises as "active". */
  useEffect(()=>{
    if(cupHandicapMode||!followingSuggestion||fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.abs(fairActual)}));
  },[cupHandicapMode,followingSuggestion,fairActual,a.id,b.id,setDraft]);
  const tickA=useTick(draft.scoreA),tickB=useTick(draft.scoreB);
  const changeScore=(key:"scoreA"|"scoreB",amount:number)=>setDraft((d:any)=>({...d,[key]:Math.max(0,+d[key]+amount)}));
  const totalFrames=+draft.scoreA + +draft.scoreB;
  const hasEloPreview=Boolean(forecast&&totalFrames>0);
  useEffect(()=>{
    if(hasEloPreview&&!hadEloPreview.current){
      requestAnimationFrame(()=>eloPreviewRef.current?.scrollIntoView({behavior:"smooth",block:"center"}));
    }
    hadEloPreview.current=hasEloPreview;
  },[hasEloPreview]);
  const validTeamSelection=Boolean(isTeamMode&&a2&&b2&&new Set([a.id,b.id,a2.id,b2.id]).size===4);
  const teamAName=(draft.teamAName?.trim()||"Team A"),teamBName=(draft.teamBName?.trim()||"Team B");
  const valid=Boolean(a&&b&&a.id!==b.id&&totalFrames>0&&(!isTeamMode||validTeamSelection)&&(!isCupMode||Boolean(draft.tournamentId&&draft.a&&draft.b&&draft.tournamentRound&&draft.tournamentMatchIndex)));
  const resultLabel=!valid?t("輸入最終比分"):draft.scoreA===draft.scoreB?t("{scoreA}–{scoreB} 和局", {scoreA: draft.scoreA, scoreB: draft.scoreB}):draft.scoreA>draft.scoreB?t("{v} 勝 {scoreA}–{scoreB}", {v: isTeamMode?teamAName:a.name, scoreA: draft.scoreA, scoreB: draft.scoreB}):t("{v} 勝 {scoreB}–{scoreA}", {v: isTeamMode?teamBName:b.name, scoreB: draft.scoreB, scoreA: draft.scoreA});
  const handicapLabel=draft.giver&&+draft.points>0?t("{v} 每局讓 {points} 分", {v: draft.mode==="2v2"?([a.id,a2?.id].includes(draft.giver)?teamAName:teamBName):draft.giver===a?.id?a?.name:b?.name, points: draft.points}):t("沒有讓分");
  /* "Today" is the device's calendar day, not UTC's. Allow one day ahead so a player already past
     midnight somewhere east of the server's idea of today is never blocked. */
  const todayLocal=localDate(),yesterdayLocal=localDate(-1),maxDate=localDate(1);
  const dateLabel=draft.date===todayLocal?t("今天"):draft.date===yesterdayLocal?t("昨天"):draft.date;
  const looksLikePoints=Math.max(+draft.scoreA,+draft.scoreB)>FRAME_SCORE_SANITY_LIMIT;
  const fairPoints=Math.abs(fairActual??0);
  return <div className="match-form"><div className="match-form-head"><div className="match-title-row"><h2 className="accent">{editing?t("編輯比賽"):t("記錄比賽")}</h2><div className="match-date-chip"><span aria-hidden="true"><em>{t("比賽日期：")}</em><b>{dateLabel}</b><i aria-hidden="true">›</i></span><input aria-label={t("比賽日期，目前為{dateLabel}", {dateLabel})} type="date" value={draft.date} max={maxDate} onChange={e=>{if(e.target.value)update("date",e.target.value>maxDate?maxDate:e.target.value)}} onClick={e=>{const input=e.currentTarget;if(typeof input.showPicker==="function")input.showPicker()}}/></div></div></div>
    
    {editing&&<p className="sub">{draft.mode==="2v2"?t("潮拍娛樂賽只會更新這筆歷史記錄，不會重播或改變 ELO。"):t("儲存後會按日期重播全部賽事，重建雙方及後續 ELO。")}</p>}
    {data.players.length<2&&<p className="warning">{t("請先新增至少兩位活躍球員。")}</p>}
    {isCupMode&&!cupSlotLocked && <div className="tournament-selector tournament-selector-first">
      <label>{t("盃賽")}<select value={draft.tournamentId||""} onChange={e=>chooseCupTournament(e.target.value)}>
        <option value="">{t("選擇盃賽")}</option>
        {data.tournaments.map(tour=> <option key={tour.id} value={tour.id}>{tour.name}{tour.startAt?t(" · 開始 {v}", {v: formatTournamentDateTime(t, tour.startAt)}):""}{tour.signupDeadline?t(" · 截止 {v}", {v: formatTournamentDateTime(t, tour.signupDeadline)}):""}</option>)}
      </select></label>
      {draft.tournamentId&&!cupBracket?.slots.length&&<p className="mm-note">{t("此盃賽尚未抽籤（報名未截止或人數不足），暫時無法選擇對陣，請待抽籤後再記錄賽果。")}</p>}
    </div>}
    {cupSlotLocked&&<div className="cup-slot-banner"><small>{tournamentLabel}</small><b>{cupBracket?t("{v} · 第 {tournamentMatchIndex} 場", {v: roundLabel(t, Number(draft.tournamentRound),cupBracket.rounds), tournamentMatchIndex: draft.tournamentMatchIndex}):t("第 {tournamentRound} 輪第 {tournamentMatchIndex} 場", {tournamentRound: draft.tournamentRound, tournamentMatchIndex: draft.tournamentMatchIndex})}</b><span>{t("對陣及場次由賽事對陣圖帶入，不可更改。")}</span></div>}
    <section className="match-players" aria-labelledby="match-players-title"><h3 id="match-players-title" className="visually-hidden">{t("選擇球員")}</h3>{isTeamMode&&<div className="team-name-grid"><label><span>{t("Team A 隊名")}</span><input type="text" maxLength={40} value={draft.teamAName??""} placeholder="Team A" onChange={event=>update("teamAName",event.target.value)}/></label><b aria-hidden="true">{t("對")}</b><label><span>{t("Team B 隊名")}</span><input type="text" maxLength={40} value={draft.teamBName??""} placeholder="Team B" onChange={event=>update("teamBName",event.target.value)}/></label></div>}
      {!isTeamMode&&!isCupMode&&<div className="matchup-card">
        <div className="matchup-slot"><PlayerPicker {...pickerProps} players={playersForA} value={draft.a} onChange={pickA} placeholder={t("選擇球員")} ariaLabel={t("球員 A")} autoOpenSignal={openASignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
        <span className="matchup-vs" aria-hidden="true">{t("對")}</span>
        <div className="matchup-slot"><PlayerPicker {...pickerProps} players={playersForB} value={draft.b} onChange={pickB} placeholder={t("選擇球員")} ariaLabel={t("球員 B")} autoOpenSignal={openBSignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
      </div>}
      {isCupMode&&cupSlotLocked&&<div className="matchup-card cup-matchup-card locked">
        {[a,b].map((player,side)=><Fragment key={side}>
          {side===1&&<span className="matchup-vs" aria-hidden="true">{t("對")}</span>}
          <div className="matchup-slot derived-opponent"><span className="matchup-trigger"><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={player??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{player?.name??t("待定")}</b><small>{player?`${Math.round(player.rating)} ELO`:"—"}</small></span></span></div>
        </Fragment>)}
      </div>}
      {isCupMode&&!cupSlotLocked&&<div className="matchup-card cup-matchup-card">
        <div className="matchup-slot"><PlayerPicker {...pickerProps} players={players} value={draft.a} onChange={pickCupPlayer} placeholder={t("選擇球員")} ariaLabel={t("選擇球員")} autoOpenSignal={openASignal}
          renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?`${Math.round(selected.rating)} ELO` : t("未完成盃賽場次")}</small></span></button>}/></div>
        <span className="matchup-vs" aria-hidden="true">{t("對")}</span>
        <div className="matchup-slot derived-opponent"><span className="matchup-trigger"><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={b??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{draft.b?b.name:t("對手會由賽事名單帶出")}</b><small>{draft.b?t("已按未完成場次配對"):t("先選擇一位球員")}</small></span></span></div>
      </div>}
      {isTeamMode&&<div className="matchup-card team-2v2">
        <div className="matchup-team">
          <div className="matchup-slot"><PlayerPicker {...pickerProps} players={playersForA} value={draft.a} onChange={pickA} placeholder={t("選擇球員")} ariaLabel={t("球員 A")} autoOpenSignal={openASignal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
          <div className="matchup-slot"><PlayerPicker {...pickerProps} players={playersForA2} value={draft.a2} onChange={pickA2} placeholder={t("選擇隊友")} ariaLabel={t("球員 A2")} autoOpenSignal={openA2Signal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇隊友")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
        </div>
        <span className="matchup-vs" aria-hidden="true">{t("對")}</span>
        <div className="matchup-team">
          <div className="matchup-slot"><PlayerPicker {...pickerProps} players={playersForB} value={draft.b} onChange={pickB} placeholder={t("選擇球員")} ariaLabel={t("球員 B")} autoOpenSignal={openBSignal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇球員")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
          <div className="matchup-slot"><PlayerPicker {...pickerProps} players={playersForB2} value={draft.b2} onChange={pickB2} placeholder={t("選擇隊友")} ariaLabel={t("球員 B2")} autoOpenSignal={openB2Signal}
            renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true" className="matchup-avatar-wrap"><PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??t("選擇隊友")}</b><small>{selected?t("{v} ELO / {v2} 分", {v: Math.round(selected.rating), v2: Math.round(suggestedHandicap(selected,data))}):"—"}</small></span></button>}/></div>
        </div>
      </div>}
    </section>
    {/* Typing a round and a match number by hand is how a quarter-final result used to get filed as
        a first-round one. The numbers stay visible when the form was opened from a box, but they are
        the box's — only a hand-built entry (no bracket to tap) can still set them. */}
    {isCupMode&&!cupSlotLocked && <div className="tournament-stage"><label>{t("輪次")}<input type="number" min={1} value={draft.tournamentRound||1} onChange={e=>update("tournamentRound",Math.max(1,Number(e.target.value)||1))}/></label>
      <label>{t("場次")}<input type="number" min={1} value={draft.tournamentMatchIndex||1} onChange={e=>update("tournamentMatchIndex",Math.max(1,Number(e.target.value)||1))}/></label></div>}
    {isCupMode&&cupSlot&&cupSlot.state==="played"&&!editing&&<p className="warning">{t("此場次已有賽果，儲存會另建一筆記錄；請改用對陣圖上的「編輯賽果」。")}</p>}
    <div className="match-group">
    <section className="quick-handicap" aria-labelledby="handicap-title"><h3 id="handicap-title"><span>{t("讓分")}</span> <small>{handicapLabel}</small></h3>
      {isCupMode
        ? <div className="tournament-handicap-note"><b>{t("盃賽模式")}</b><span>{tournament ? (tournament.handicapMode==="suggested" ? t("自動套用建議讓分：每局 {fairPoints} 分", {fairPoints}) : t("此盃賽不設讓分")) : t("未選擇盃賽")}</span></div>
        : <>
            {validTeamSelection&&<div className="entertainment-handicap-note recommended"><b>{t("建議讓分")}</b><span>{fairPoints===0?t("{teamAName} 與 {teamBName} 毋須讓分", {teamAName, teamBName}):t("{v} 每局讓 {v2} {fairPoints} 分", {v: fairActual!>0?teamAName:teamBName, v2: fairActual!>0?teamBName:teamAName, fairPoints})}</span><small>{teamAHandicap!=null&&teamBHandicap!=null?t("{teamAName} 平均 {v} · {teamBName} 平均 {v2}", {teamAName, v: Math.round(teamAHandicap), teamBName, v2: Math.round(teamBHandicap)}):t("隊伍平均 ELO 相差 {v}", {v: Math.abs(teamEloDifference)})}{t("；按球員 ELO 建議讓分計算。")}</small></div>}
            <SlidingToggleGroup className="handicap-segment"><button type="button" className={!draft.giver&&!customHandicap?"active":""} onClick={setNoHandicap}>{t("沒有讓分")}</button><button type="button" disabled={fairActual==null} className={draft.giver&&+draft.points===fairPoints&&!customHandicap?"active":""} onClick={fairPoints===0?setNoHandicap:applyFair}>{t("ELO 建議")}</button><button type="button" className={customHandicap?"active":""} onClick={()=>{setCustomHandicap(value=>!value);setFollowingSuggestion(false);}}>{t("自訂")}</button></SlidingToggleGroup>
            {customHandicap&&<div className="custom-handicap"><label>{draft.mode==="2v2"?t("讓分隊伍"):t("讓分球員")}<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">{t("沒有讓分")}</option><option value={a?.id}>{draft.mode==="2v2"?t("{teamAName}（{name} / {name2}）", {teamAName, name: a.name, name2: a2?.name}):a?.name}</option><option value={b?.id}>{draft.mode==="2v2"?t("{teamBName}（{name} / {name2}）", {teamBName, name: b.name, name2: b2?.name}):b?.name}</option></select></label><label>{t("每局分數")}<input type="number" inputMode="numeric" min="0" step="1" value={draft.points} onKeyDown={e=>{if([".",",","-","+","e","E"].includes(e.key))e.preventDefault()}} onChange={e=>update("points",Math.max(0,Math.trunc(Number(e.target.value))||0))}/></label></div>}
          </>
      }
    </section></div>
    <section className="score-panel" aria-labelledby="score-title"><h3 id="score-title">{t("局數")}</h3>{looksLikePoints&&<p className="score-warning" role="alert">{t("呢個數字好似係分數。請輸入贏咗的局數（例如 3–2），單桿分數請用下面「單桿」記錄。")}</p>}<div className="scoreboard-entry">
      <div><b>{isTeamMode?teamAName:(a?.name??t("球員 A"))}</b><div className="score-row"><button type="button" aria-label={t("{v}減一局", {v: isTeamMode?teamAName:(a?.name??t("球員 A"))})} onClick={()=>changeScore("scoreA",-1)}>−</button><input ref={tickA} className="score-value" aria-label={t("{v}局數", {v: isTeamMode?teamAName:(a?.name??t("球員 A"))})} type="number" inputMode="numeric" min="0" value={draft.scoreA} onChange={e=>update("scoreA",Math.max(0,+e.target.value))}/><button type="button" aria-label={t("{v}加一局", {v: isTeamMode?teamAName:(a?.name??t("球員 A"))})} onClick={()=>changeScore("scoreA",1)}>＋</button></div>
        {!isTeamMode&&a&&<div className="break-inline"><div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===a.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={t("移除 {name} 的 {value} 分單桿度數", {name: a.name, value: item.value})}><i aria-hidden="true">★</i>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[a.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(a.id)}}><input autoFocus className="break-value" aria-label={t("{name} 單桿度數", {name: a.name})} type="number" inputMode="numeric" min="1" max="147" placeholder="52" enterKeyHint="done" value={breakInput[a.id]??""} onChange={event=>setBreakInput(current=>({...current,[a.id]:event.target.value}))}/><button type="submit">{t("記低")}</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[a.id]:true}))}><i aria-hidden="true">★</i>{t("單桿")}<span aria-hidden="true">＋</span></button>}
        {breakMessage[a.id]&&<p className="break-encouragement" role="status">{breakMessage[a.id]}</p>}</div>}
      </div>
      <strong aria-hidden="true">:</strong>
      <div><b>{isTeamMode?teamBName:(b?.name??t("球員 B"))}</b><div className="score-row"><button type="button" aria-label={t("{v}減一局", {v: isTeamMode?teamBName:(b?.name??t("球員 B"))})} onClick={()=>changeScore("scoreB",-1)}>−</button><input ref={tickB} className="score-value" aria-label={t("{v}局數", {v: isTeamMode?teamBName:(b?.name??t("球員 B"))})} type="number" inputMode="numeric" min="0" value={draft.scoreB} onChange={e=>update("scoreB",Math.max(0,+e.target.value))}/><button type="button" aria-label={t("{v}加一局", {v: isTeamMode?teamBName:(b?.name??t("球員 B"))})} onClick={()=>changeScore("scoreB",1)}>＋</button></div>
        {!isTeamMode&&b&&<div className="break-inline"><div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===b.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={t("移除 {name} 的 {value} 分單桿度數", {name: b.name, value: item.value})}><i aria-hidden="true">★</i>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[b.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(b.id)}}><input autoFocus className="break-value" aria-label={t("{name} 單桿度數", {name: b.name})} type="number" inputMode="numeric" min="1" max="147" placeholder="52" enterKeyHint="done" value={breakInput[b.id]??""} onChange={event=>setBreakInput(current=>({...current,[b.id]:event.target.value}))}/><button type="submit">{t("記低")}</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[b.id]:true}))}><i aria-hidden="true">★</i>{t("單桿")}<span aria-hidden="true">＋</span></button>}
        {breakMessage[b.id]&&<p className="break-encouragement" role="status">{breakMessage[b.id]}</p>}</div>}
      </div>
    </div>{forecast&&<div className="predicted-ratio"><div><span>{t("預測局數比例")}</span><b>{isTeamMode?teamAName:a.short} {Math.round(forecast.expectedA*100)}% · {Math.round((1-forecast.expectedA)*100)}% {isTeamMode?teamBName:b.short}</b></div><em aria-label={t("{v} {v2}%，{v3} {v4}%", {v: isTeamMode?teamAName:a.name, v2: Math.round(forecast.expectedA*100), v3: isTeamMode?teamBName:b.name, v4: Math.round((1-forecast.expectedA)*100)})}><i style={{width:`${Math.round(forecast.expectedA*100)}%`}}/></em></div>}</section>
    {forecast&&totalFrames>0&&(draft.mode==="2v2"?<section ref={eloPreviewRef} className="elo-preview entertainment-preview"><b>{t("潮拍娛樂模式")}</b><p>{t("本場只記錄隊伍、讓分與比分；四位球員的目前 ELO、勝負、局數及近況均不會改變。")}</p></section>:<section ref={eloPreviewRef} className="elo-preview"><div><span><small>{a.name}</small><b className={previewDeltaA!>=0?"positive":"negative"}>{previewDeltaA!>=0?"+":""}{Math.round(previewDeltaA!)} ELO</b></span><i aria-hidden="true">↔</i><span className="right"><small>{b.name}</small><b className={previewDeltaB!>=0?"positive":"negative"}>{previewDeltaB!>=0?"+":""}{Math.round(previewDeltaB!)} ELO</b></span></div><details><summary>{t("查看計算詳情")}</summary><p>{probabilities?t("A 勝 {v}% · 和 {v2}% · ", {v: Math.round(probabilities.win*100), v2: Math.round(probabilities.draw*100)}):""}{t("表現分")} {forecast.performanceScore>=0?"+":""}{t("{v} · 讓分 H", {v: Math.round(forecast.performanceScore)})} {forecast.adjustment>=0?"+":""}{Math.round(forecast.adjustment)}</p></details></section>)}
    <div className="match-save">{breakReminder&&<div className="break-save-reminder" role="status"><b>{t("今場有冇值得記低嘅單桿？")}</b><span><button type="button" onClick={()=>{setBreakReminder(false);setBreakOpen({[a.id]:true,[b.id]:true})}}>{t("返回記錄")}</button><button type="button" onClick={onSave}>{t("今場沒有，照樣儲存")}</button></span></div>}<Button className="full" disabled={!valid||data.players.length<2||saving} aria-busy={saving} onClick={()=>{if(!isTeamMode&&!editing&&(draft.highBreaks??[]).length===0){setBreakReminder(true);return}onSave()}}><strong>{saving?t("儲存中…"):editing?t("儲存變更"):t("儲存賽果")}</strong><small>{saving?t("請稍候"):resultLabel}</small></Button></div>
  </div>;
}

export type TunableSettingKey="frameScaleCoefficient"|"handicapEloScale"|"handicapMinimumElo"|"handicapSensitivityRange"|"handicapSensitivityWidth"|"repetitionDecayBase"|"repetitionDecayPeriod";
export function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) {
  const t = useT();
  const [s,setS]=useState<Settings>(data.settings);
  const field=(key:TunableSettingKey,label:string,hint:string,step=1,min?:number,max?:number)=>
    <label className="settings-field"><span>{label}</span><input type="number" step={step} min={min} max={max} value={s[key]}
      onChange={e=>{const value=e.target.value===""?0:Number(e.target.value);setS(current=>({...current,[key]:value}))}}/><small>{hint}</small></label>;
  return <>
    <p className="kicker">{t("公開管理")}</p>
    <h2>{t("PDF Snooker Elo 公式設定")}</h2>
    <p className="warning">{t("起始 ELO 可修改，儲存後會以新參數從此起始值重播全部歷史 ELO。")}</p>
    <div className="settings-form-grid">
      <label className="settings-field"><span>{t("起始 ELO")}</span><input type="number" step="10" min={1000} max={3000} value={s.start} onChange={e=>{const value=e.target.value===""?1500:Number(e.target.value);setS(current=>({...current,start:value}))}}/><small>{t("所有現有球員會用此起始值重建評分。")}</small></label>
      {field("frameScaleCoefficient",t("表現敏感度"),t("ELO 變化 = 此數值 ×（實際局數百分比 − 預測百分比）× 信心權重。預設 250。"),1,0)}
      {field("handicapEloScale",t("讓分 ELO 尺度"),t("勝率公式分母，原值 500。數值越大，同樣 ELO 差距對勝率的影響越小。"),10,1)}
      {field("handicapMinimumElo",t("讓分最低 ELO 值"),t("高 ELO 區域時，每讓 1 分最少代表的 ELO，原值 7。"),1,.1)}
      {field("handicapSensitivityRange",t("讓分敏感度範圍"),t("低 ELO 與高 ELO 每讓 1 分的 ELO 差距範圍，原值 16。"),1,0)}
      {field("handicapSensitivityWidth",t("讓分敏感度寬度"),t("控制敏感度由低至高轉變的速度，原值 250。"),1,1)}
      {field("repetitionDecayBase",t("重複衰減底數"),t("M(t) = 底數^(-t/週期)，PDF 原值 2。"),.1,1)}
      {field("repetitionDecayPeriod",t("重複衰減週期"),t("M(t) 的週期，PDF 原值 7。"),.5,.1)}
    </div>
    <Button className="full" onClick={()=>onSave({...s,provisionalGames:data.settings.provisionalGames,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:HANDICAP_MODEL_VERSION})}>{t("套用並重播歷史 ELO")}</Button>
  </>;
}
