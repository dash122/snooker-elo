import { useEffect,useState } from "react";
import { Empty,PlayerBadge,sortLabels,type SortKey } from "../UiBits";
import { useT } from "../components/I18nProvider";
import { Button,IconButton,Surface } from "../components/ui/Primitives";
import { INTL_LOCALE } from "../../lib/i18n/locales";
import { type Player,type AppState,games,suggestedHandicap,winRate,frameRate,sortPlayers,recentDelta,recentDeltaDays,highestBreak,handicapVerdict } from "./model";



export type PlayersChip = "near"|"hot"|"all";
export const PLAYERS_SORT_CYCLE:SortKey[]=["rank","rating","form","suggested"];
export const playersSortDir=(key:SortKey):"asc"|"desc"=>key==="rank"||key==="name"?"asc":"desc";

export function Players({data,ownPlayerId,managementMode=false,canAdd,canManagePlayer,onAdd,onEdit,onDelete,onOpen,onCompare,onRecordAgainst,onFindOpponent}:{
  data:AppState;ownPlayerId?:string;managementMode?:boolean;canAdd:boolean;canManagePlayer:(player:Player)=>boolean;
  onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void;
  onCompare:(p:Player)=>void;onRecordAgainst:(p:Player)=>void;onFindOpponent:(playerId:string)=>void;
}) {
  const t = useT();
  const me=data.players.find(p=>p.id===ownPlayerId);
  const [query,setQuery]=useState("");
  const [chip,setChip]=useState<PlayersChip>(managementMode?"all":me?"near":"all");
  const [openId,setOpenId]=useState("");
  const [sort,setSort]=useState<SortKey>("rank");
  useEffect(()=>{if(managementMode)setChip("all")},[managementMode]);

  const ranked=[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name));
  const rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  const myRank=me?rankOf.get(me.id):undefined;
  const myDelta=me?recentDelta(me,data,5):0;
  const superior=myRank&&myRank>1?ranked[myRank-2]:null;
  // Self-panel progress bar: 0 at the rating of the player just below, full at the player just above.
  const gapToNext=me&&superior?Math.max(0,Math.ceil(superior.rating-me.rating)):0;
  const floor=me?(myRank?ranked[myRank]?.rating:undefined)??me.rating-100:0;
  const nextProgress=me&&superior?Math.min(1,Math.max(.04,(me.rating-floor)/Math.max(1,superior.rating-floor))):1;

  const tests:Record<PlayersChip,(p:Player)=>boolean>={
    all:()=>true,
    near:p=>Boolean(me)&&Math.abs(p.rating-me!.rating)<=200,
    hot:p=>recentDeltaDays(p,data,30)>0,
  };
  const counts:Record<PlayersChip,number>={
    all:data.players.length,
    near:me?data.players.filter(tests.near).length:0,
    hot:data.players.filter(tests.hot).length,
  };
  const activeChip:PlayersChip=chip==="near"&&!me?"all":chip;
  const chipDefs:[PlayersChip,string][]=[["all",t("全部")],["near",t("水平相約")],["hot",t("狀態 🔥")]];

  const q=query.trim().toLowerCase();
  const filtered=(activeChip==="hot"
    ? [...data.players].sort((a,b)=>recentDeltaDays(b,data,30)-recentDeltaDays(a,data,30))
    : sortPlayers(data.players,data,sort,playersSortDir(sort))
  ).filter(p=>{
    if(q&&!(p.name.toLowerCase().includes(q)||p.short.toLowerCase().includes(q)))return false;
    return tests[activeChip](p);
  });
  const empty=filtered.length===0;

  return <div className="players-view">
    <div className={`players-self-panel${me?"":" is-guest"}`}>
      <div className="players-self-top"><span>{t("球員 · {players} 位", {players: data.players.length})}</span></div>
      {me&&<>
        <div className="players-self-main">
          <b className="players-self-rank"><small>#</small>{myRank}</b>
          <div className="players-self-id">
            <div className="players-self-name">{t("我 · {v} ELO", {v: Math.round(me.rating)})}{myDelta!==0&&<span className={`players-delta ${myDelta>0?"positive":"negative"}`}>{myDelta>0?"+":"−"}{Math.abs(Math.round(myDelta))}</span>}</div>
            <div className="players-self-gap">{t("建議讓分")} {suggestedHandicap(me,data)}</div>
          </div>
          <span className="players-self-form">{me.form.map((x,i)=><i className={x.toLowerCase()} key={i}>{x}</i>)}</span>
        </div>
        <div className="players-self-progress">
          <span>{superior?t("距離 #{v} 只差 {v2} 分", {v: myRank!-1, v2: gapToNext}):t("暫列榜首")}</span>
          <div className="players-self-progress-track" aria-hidden="true"><i style={{width:`${Math.round(nextProgress*100)}%`}}/></div>
        </div>
      </>}
    </div>
    <div className="players-toolbar">
      <div className="players-search"><input type="text" value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("搜尋姓名或縮寫")} aria-label={t("搜尋球員")}/></div>
      {/* Native select sits invisibly over a chip-styled label: compact look, 16px control (no iOS zoom). */}
      <label className="players-sort">
        <span aria-hidden="true">{t(sortLabels[sort])}</span>
        <select value={sort} onChange={e=>setSort(e.target.value as SortKey)} disabled={activeChip==="hot"} aria-label={t("排序")}>
          {PLAYERS_SORT_CYCLE.map(key=><option key={key} value={key}>{t(sortLabels[key])}</option>)}
        </select>
      </label>
    </div>
    <div className="players-chips" role="group" aria-label={t("球員篩選")}>
      {chipDefs.map(([id,label])=>{
        const n=counts[id],isEmpty=n===0&&id!=="all",isActive=activeChip===id&&!isEmpty;
        return <button key={id} type="button" aria-pressed={isActive} disabled={isEmpty} className={`players-chip${isActive?" active":""}${isEmpty?" is-empty":""}`} onClick={()=>setChip(id)}>{label} {n}</button>;
      })}
    </div>
    <div className="players-list-head">
      <span>{t("{filtered} 位球員", {filtered: filtered.length})}</span>
      <span className="players-list-hint">{activeChip==="hot"?t("ELO · 近30日ELO變化"):t("ELO · 建議評分")}</span>
    </div>
    {data.players.length===0
      ? <Empty text={t("尚未有球員")} sub={t("新增球員後便可開始記錄比賽。")}/>
      : empty
        ? <div className="players-empty"><b>{q?t("找不到「{query}」", {query}):t("這個篩選暫時沒有人")}</b><span>{t("試試其他篩選，或按「全部」查看整個名單。")}</span></div>
        : <div className="players-rows">{filtered.map(p=>{
            const isSelf=Boolean(me)&&me!.id===p.id;
            const open=openId===p.id;
            const delta=recentDeltaDays(p,data,30);
            const rank=rankOf.get(p.id)??0;
            const provisional=games(p)<data.settings.provisionalGames;
            const high=highestBreak(p,data);
            const suggested=suggestedHandicap(p,data);
            return <div className={`players-row${open?" open":""}${provisional?" provisional":""}${isSelf?" is-self":""}`} key={p.id}>
              <button type="button" className="players-row-hit" aria-expanded={open} onClick={()=>setOpenId(current=>current===p.id?"":p.id)}>
                <span className={`players-row-rank${!provisional&&rank<=3?` top-${rank}`:""}`}>{provisional?"–":rank}</span>
                <span className="players-row-badge"><PlayerBadge player={p}/></span>
                <span className="players-row-id">
                  <span className="players-row-name-line"><b>{p.name}</b>{provisional&&<em className="players-tag provisional">{t("臨時")}</em>}</span>
                  <span className="players-row-meta">
                    <span className="players-row-form">{p.form.map((x,i)=><i className={x.toLowerCase()} key={i}/>)}</span>
                    {t("{v} 場", {v: games(p)})}
                  </span>
                </span>
                <span className="players-row-elo"><b>{Math.round(p.rating)}</b>{activeChip==="hot"
                  ? <em className={`players-delta ${delta>=0?"positive":"negative"}`}>{delta>=0?"+":"−"}{Math.abs(Math.round(delta))}</em>
                  : <em className="neutral">{suggested}</em>}</span>
              </button>
              {managementMode&&canManagePlayer(p)&&<Button variant="quiet" className="players-row-manage" onClick={()=>onEdit(p)}>{t("管理")}</Button>}
              {open&&<div className="players-row-expand">
                {me&&!isSelf&&<div className="players-verdict">
                  <div className="players-verdict-main">{handicapVerdict(t, me,p,data.settings)}</div>
                  <div className="players-verdict-sub">{t("建議評分 {v} 分 · 相差 {v2} ELO", {v: suggestedHandicap(p,data), v2: Math.abs(Math.round(me.rating-p.rating))})}</div>
                </div>}
                <div className="players-expand-stats">
                  <span><small>{t("勝率／局率")}</small><b>{Math.round(winRate(p)*100)}／{Math.round(frameRate(p)*100)}%</b></span>
                  <span><small>{t("最高單桿")}</small><b>{high??"—"}</b></span>                </div>
                <div className="players-expand-actions">
                  {isSelf
                    ? <Button variant="primary" className="players-expand-open-self" onClick={()=>onOpen(p)}>{t("查看完整球員頁 ›")}</Button>
                    : <>
                        <Button onClick={()=>onRecordAgainst(p)}>{t("記錄對局")}</Button>
                        <Button variant="secondary" onClick={()=>onCompare(p)}>{t("對戰紀錄")}</Button>
                        <Button variant="secondary" onClick={()=>onFindOpponent(p.id)}>{t("約戰")}</Button>
                        <IconButton className="players-row-open" label={t("開啟 {name} 的球員卡", {name: p.name})} onClick={()=>onOpen(p)}>›</IconButton>
                      </>}
                </div>
                {!managementMode&&(canManagePlayer(p)||canAdd)&&<div className="players-expand-manage">
                  {canManagePlayer(p)&&<IconButton className="card-tool" label={t("編輯 {name}", {name: p.name})} onClick={()=>onEdit(p)}>✎</IconButton>}
                  {canAdd&&<IconButton className="card-tool danger" label={t("刪除 {name}", {name: p.name})} onClick={()=>onDelete(p)}>✕</IconButton>}
                </div>}
              </div>}
            </div>;
          })}</div>}
  </div>;
}

export function SettingsView({data,onEdit,onReset,canReset}:{data:AppState;onEdit:()=>void;onReset:()=>void;canReset:boolean}) {
  const t = useT();
  const s=data.settings;
  return <><section className="hero small"><div><p className="kicker">{t("公開設定")}</p><h1>{t("ELO 設定")}</h1><p>{t("所有球員由 1500 起步；每場賽果只使用 PDF Snooker Elo 公式重播。以下參數只有管理員可以修改。")}</p></div><Button onClick={onEdit}>{t("編輯設定")}</Button></section>
    <div className="settings-grid">
      <Surface as="div" className="setting"><small>{t("起始 ELO")}</small><b>{s.start}</b></Surface>
       <Surface as="div" className="setting"><small>{t("表現敏感度（250）")}</small><b>{s.frameScaleCoefficient}</b></Surface>
      <Surface as="div" className="setting"><small>{t("信心權重")}</small><b>{t("局數 ÷（局數＋5）")}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分 ELO 尺度（500）")}</small><b>{s.handicapEloScale}</b></Surface>
      <Surface as="div" className="setting"><small>{t("個人建議讓分換算（只供顯示）")}</small><b>{s.handicapPointsToElo}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分最低 ELO 值（7）")}</small><b>{s.handicapMinimumElo}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分敏感度範圍（16）")}</small><b>{s.handicapSensitivityRange}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分敏感度寬度（250）")}</small><b>{s.handicapSensitivityWidth}</b></Surface>
      <Surface as="div" className="setting"><small>{t("重複衰減底數（2）")}</small><b>{s.repetitionDecayBase}</b></Surface>
      <Surface as="div" className="setting"><small>{t("重複衰減週期（7）")}</small><b>{s.repetitionDecayPeriod}</b></Surface>
      <Surface as="div" className="setting"><small>{t("讓分有效度")}</small><b>{Math.round(s.handicapEffectiveness*100)}%</b></Surface>
      <Surface as="div" className="setting"><small>{t("零和更新")}</small><b>{t("是")}</b></Surface>
    </div>
    <Surface className="audit"><h2>{t("審計記錄")}</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString(INTL_LOCALE[t.locale])}</small></div>)}</Surface>
    {canReset&&<section className="danger-zone"><div><h2>{t("清除並重設資料")}</h2><p>{t("永久刪除共用資料庫內所有球員、比賽及審計記錄，並恢復預設 ELO 設定。")}</p></div><Button variant="danger" onClick={onReset}>{t("清除所有資料")}</Button></section>}</>;
}
