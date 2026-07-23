"use client";

import { useEffect, useMemo, useState } from "react";

type Player = {
  id: string; name: string; short: string; handicap: number | null; rating: number;
  initialRating: number; active: boolean; wins: number; losses: number; draws: number;
  framesWon: number; framesLost: number; lastChange: number; form: string[];
};
type Match = {
  id: string; a: string; b: string; scoreA: number; scoreB: number; playedOn: string;
  actual: number; giver: string | null; official: number | null; extra: number;
  expectedA: number; beforeA: number; beforeB: number; afterA: number; afterB: number;
  deltaA: number; marginMultiplier?: number; status: "confirmed" | "void"; createdAt: string;
};
type Calibration = { rawEstimate:number; estimate:number; lower:number; upper:number; usableMatches:number; confidence:string; updatedAt:string };
type Settings = { start: number; provisionalGames: number; kProvisional: number; kRated: number; conversion: number; cap: number; calibration?:Calibration };
type AppState = { players: Player[]; matches: Match[]; settings: Settings; audits: { id: string; text: string; at: string }[] };

const seed: AppState = {
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200 },
  players: [],
  matches: [],
  audits: [{ id:"seed",text:"建立 SCAA 公開群組及預設 ELO 設定",at:new Date().toISOString() }]
};

function games(p: Player) { return p.wins + p.losses + p.draws; }
function suggestedHandicap(p: Player,data: AppState) {
  const meanRating=data.players.length?data.players.reduce((sum,x)=>sum+x.rating,0)/data.players.length:data.settings.start;
  const official=data.players.map(x=>x.handicap).filter((x):x is number=>x!=null);
  const anchor=official.length?official.reduce((sum,x)=>sum+x,0)/official.length:0;
  return anchor-(p.rating-meanRating)/data.settings.conversion;
}
function calc(a: Player,b: Player,scoreA:number,scoreB:number,giver:string|null,points:number,s:Settings) {
  const official = a.handicap == null || b.handicap == null ? null : b.handicap - a.handicap;
  const actual = giver === a.id ? points : giver === b.id ? -points : 0;
  const extra = actual - (official ?? 0);
  const adjustment = Math.max(-s.cap,Math.min(s.cap,s.conversion * actual));
  const expectedA = 1/(1+10**(((b.rating+adjustment)-a.rating)/400));
  const result = scoreA === scoreB ? .5 : scoreA > scoreB ? 1 : 0;
  const k = games(a)<s.provisionalGames || games(b)<s.provisionalGames ? s.kProvisional : s.kRated;
  const totalFrames = scoreA + scoreB;
  const marginMultiplier = scoreA === scoreB || totalFrames === 0 ? 1 : 1 + Math.abs(scoreA-scoreB)/totalFrames;
  const deltaA = k*(result-expectedA)*marginMultiplier;
  return { official,actual,extra,expectedA,deltaA,marginMultiplier };
}

function recalibrate(settings:Settings,matches:Match[]):Settings {
  const usable=matches.filter(m=>m.status==="confirmed"&&m.actual!==0&&Number.isFinite(m.beforeA)&&Number.isFinite(m.beforeB));
  const n=usable.length, prior=8;
  if(n<10) return {...settings,calibration:{rawEstimate:prior,estimate:settings.conversion,lower:2,upper:14,usableMatches:n,confidence:"資料不足",updatedAt:new Date().toISOString()}};
  let best=prior,bestLoss=Infinity;
  for(let candidate=1;candidate<=20;candidate+=.25){
    let loss=0;
    for(const m of usable){
      const adjustment=Math.max(-settings.cap,Math.min(settings.cap,candidate*m.actual));
      const predicted=1/(1+10**(((m.beforeB+adjustment)-m.beforeA)/400));
      const actual=m.scoreA===m.scoreB?.5:m.scoreA>m.scoreB?1:0;
      loss+=(predicted-actual)**2;
    }
    if(loss<bestLoss){bestLoss=loss;best=candidate;}
  }
  const shrunk=(30*prior+n*best)/(30+n);
  const estimate=Math.max(1,Math.min(20,settings.conversion+Math.max(-.25,Math.min(.25,shrunk-settings.conversion))));
  const spread=Math.max(.75,4/Math.sqrt(n/30));
  const confidence=n>=150?"高":n>=75?"中":n>=30?"低":"初步";
  return {...settings,conversion:Number(estimate.toFixed(2)),calibration:{rawEstimate:Number(best.toFixed(2)),estimate:Number(estimate.toFixed(2)),lower:Number(Math.max(1,estimate-spread).toFixed(2)),upper:Number(Math.min(20,estimate+spread).toFixed(2)),usableMatches:n,confidence,updatedAt:new Date().toISOString()}};
}

const today = new Date().toISOString().slice(0,10);

export default function Home() {
  const [data,setData] = useState<AppState>(seed);
  const [tab,setTab] = useState("leaderboard");
  const [modal,setModal] = useState<"match"|"player"|"settings"|"detail"|null>(null);
  const [detail,setDetail] = useState<Player|null>(null);
  const [editingPlayer,setEditingPlayer] = useState<Player|null>(null);
  const [toast,setToast] = useState("");
  const [saving,setSaving] = useState(false);
  const [draft,setDraft] = useState({a:"marco",b:"jason",scoreA:4,scoreB:2,date:today,giver:"marco",points:4});
  const [playerForm,setPlayerForm] = useState({name:"",short:"",handicap:"",rating:""});

  useEffect(()=>{
    const local = localStorage.getItem("scaa-draft");
    if(local) try { setDraft(JSON.parse(local)); } catch {}
    fetch("/api/state").then(r=>r.ok?r.json():null).then(v=>v?.players&&setData(v)).catch(()=>{});
  },[]);
  useEffect(()=>{
    const timer=setInterval(()=>{
      if(document.visibilityState!=="visible"||saving)return;
      fetch("/api/state").then(r=>r.ok?r.json():null).then(v=>v?.players&&setData(v)).catch(()=>{});
    },15000);
    return ()=>clearInterval(timer);
  },[saving]);
  useEffect(()=>{ localStorage.setItem("scaa-draft",JSON.stringify(draft)); },[draft]);
  useEffect(()=>{
    if(data.players.length<2)return;
    setDraft(d=>{
      const validA=data.players.some(p=>p.id===d.a);
      const validB=data.players.some(p=>p.id===d.b);
      if(validA&&validB&&d.a!==d.b)return d;
      return {...d,a:data.players[0].id,b:data.players[1].id,giver:""};
    });
  },[data.players]);

  async function persist(next:AppState,message:string) {
    setData(next); setSaving(true);
    try {
      const r=await fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(next)});
      if(!r.ok) throw new Error();
      setToast(message);
    } catch { setToast("未能連接伺服器；資料仍保留在此畫面，請稍後再試。"); }
    finally { setSaving(false); setTimeout(()=>setToast(""),3200); }
  }

  async function resetAll(){
    const typed=prompt("此操作會永久刪除所有球員、比賽及審計紀錄。請輸入 RESET 繼續：");
    if(typed!=="RESET")return;
    if(!confirm("最後確認：清除並重設所有共用資料？此操作無法復原。"))return;
    setSaving(true);
    try{
      const response=await fetch("/api/state",{method:"DELETE"});
      if(!response.ok)throw new Error();
      const fresh=await response.json();
      setData(fresh);
      localStorage.removeItem("scaa-draft");
      setDraft({a:"",b:"",scoreA:4,scoreB:2,date:today,giver:"",points:0});
      setToast("所有共用資料已清除並重設。");
    }catch{setToast("重設失敗，資料沒有被清除。請稍後再試。");}
    finally{setSaving(false);setTimeout(()=>setToast(""),3200);}
  }

  const ranked=useMemo(()=>[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),[data]);
  const a=data.players.find(p=>p.id===draft.a)??data.players[0];
  const b=data.players.find(p=>p.id===draft.b)??data.players[1];
  const preview=a&&b&&a.id!==b.id?calc(a,b,+draft.scoreA,+draft.scoreB,draft.giver,+draft.points,data.settings):null;

  function saveMatch(){
    if(!a||!b||a.id===b.id||draft.scoreA<0||draft.scoreB<0){setToast("請選擇兩位不同球員及有效比分。");return;}
    if(!preview)return;
    const now=new Date().toISOString(), id=crypto.randomUUID();
    const match:Match={id,a:a.id,b:b.id,scoreA:+draft.scoreA,scoreB:+draft.scoreB,playedOn:draft.date||today,
      actual:preview.actual,giver:draft.giver||null,official:preview.official,extra:preview.extra,expectedA:preview.expectedA,
      beforeA:a.rating,beforeB:b.rating,afterA:a.rating+preview.deltaA,afterB:b.rating-preview.deltaA,deltaA:preview.deltaA,
      marginMultiplier:preview.marginMultiplier,status:"confirmed",createdAt:now};
    const resultA=draft.scoreA===draft.scoreB?"D":draft.scoreA>draft.scoreB?"W":"L";
    const resultB=resultA==="D"?"D":resultA==="W"?"L":"W";
    const players=data.players.map(p=>{
      if(p.id!==a.id&&p.id!==b.id)return p;
      const isA=p.id===a.id,result=isA?resultA:resultB,delta=isA?preview.deltaA:-preview.deltaA;
      return {...p,rating:p.rating+delta,lastChange:delta,wins:p.wins+(result==="W"?1:0),losses:p.losses+(result==="L"?1:0),
        draws:p.draws+(result==="D"?1:0),framesWon:p.framesWon+(isA?+draft.scoreA:+draft.scoreB),
        framesLost:p.framesLost+(isA?+draft.scoreB:+draft.scoreA),form:[result,...p.form].slice(0,5)};
    });
    const matches=[match,...data.matches];
    const settings=recalibrate(data.settings,matches);
    const next={...data,settings,players,matches,audits:[{id:crypto.randomUUID(),text:`記錄賽果：${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}；持續校準 ${settings.conversion} ELO／分`,at:now},...data.audits]};
    localStorage.removeItem("scaa-draft"); setModal(null); persist(next,"賽果已儲存，雙方 ELO 已更新。");
  }

  function savePlayer(){
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast("請輸入顯示名稱及縮寫。");return;}
    const rating=playerForm.rating?+playerForm.rating:data.settings.start;
    const p:Player=editingPlayer
      ? {...editingPlayer,name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),handicap:playerForm.handicap===""?null:+playerForm.handicap}
      : {id:crypto.randomUUID(),name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),
        handicap:playerForm.handicap===""?null:+playerForm.handicap,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,
        framesWon:0,framesLost:0,lastChange:0,form:[]};
    const action=editingPlayer?"編輯":"新增";
    const players=editingPlayer?data.players.map(x=>x.id===p.id?p:x):[...data.players,p];
    const next={...data,players,audits:[{id:crypto.randomUUID(),text:`${action}球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
    setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:""});setModal(null);persist(next,editingPlayer?"球員資料已更新。":"球員已新增。");
  }

  function editPlayer(p:Player){
    setEditingPlayer(p);
    setPlayerForm({name:p.name,short:p.short,handicap:p.handicap==null?"":String(p.handicap),rating:String(Math.round(p.initialRating))});
    setModal("player");
  }

  function deletePlayer(p:Player){
    const hasHistory=data.matches.some(m=>m.a===p.id||m.b===p.id);
    if(!confirm(`永久刪除 ${p.name}？${hasHistory?"歷史賽事會保留並顯示為「已刪除球員」。":""}此操作無法復原。`))return;
    const next={...data,players:data.players.filter(x=>x.id!==p.id),
      audits:[{id:crypto.randomUUID(),text:`永久刪除球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
    persist(next,"球員已永久刪除。");
  }

  function voidMatch(m:Match){
    if(m.status==="void"||!confirm("作廢後系統會重建受影響評分。確定繼續？"))return;
    // Full production replay is represented by returning this match's immutable event impact.
    const players=data.players.map(p=>p.id===m.a?{...p,rating:p.rating-m.deltaA}:p.id===m.b?{...p,rating:p.rating+m.deltaA}:p);
    const matches=data.matches.map(x=>x.id===m.id?{...x,status:"void" as const}:x);
    const settings=recalibrate(data.settings,matches);
    const next={...data,settings,players,matches,
      audits:[{id:crypto.randomUUID(),text:`作廢賽事：${m.id.slice(0,8)}；觸發評分重建`,at:new Date().toISOString()},...data.audits]};
    persist(next,"賽事已作廢，ELO 已重建。");
  }

  return <div className="shell">
    <aside className="side">
      <div className="brand"><span>S</span><div><b>SCAA</b><small>Snooker ELO</small></div></div>
      <nav>{[["leaderboard","排行榜","◆"],["matches","比賽","◫"],["players","球員","◎"],["settings","設定","⚙"]].map(([id,label,icon])=>
        <button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}><i>{icon}</i>{label}</button>)}</nav>
      <div className="public-note"><b>公開模式</b><span>任何人均可查看及編輯</span></div>
    </aside>
    <main>
      <header><div className="mobile-brand">SCAA <span>Snooker ELO</span></div><div className="status"><i/> 共用資料庫 · {saving?"儲存中…":"已同步"}</div></header>
      {tab==="leaderboard"&&<Leaderboard ranked={ranked} data={data} onRecord={()=>setModal("match")} onPlayer={(p)=>{setDetail(p);setModal("detail")}}/>}
      {tab==="matches"&&<Matches data={data} onVoid={voidMatch}/>}
      {tab==="players"&&<Players data={data} onAdd={()=>{setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:""});setModal("player")}} onEdit={editPlayer} onDelete={deletePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}}/>}
      {tab==="settings"&&<SettingsView data={data} onEdit={()=>setModal("settings")} onReset={resetAll}/>}
    </main>
    <button className="fab" onClick={()=>setModal("match")}><span>＋</span>記錄</button>
    <nav className="bottom">{[["leaderboard","榜","◆"],["matches","比賽","◫"],["record","記錄","＋"],["players","球員","◎"],["settings","設定","⚙"]].map(([id,label,icon])=>
      <button key={id} className={tab===id?"active":""} onClick={()=>id==="record"?setModal("match"):setTab(id)}><i>{icon}</i><small>{label}</small></button>)}</nav>
    {modal&&<div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&setModal(null)}>
      <section className="sheet" role="dialog" aria-modal="true"><button className="close" aria-label="關閉" onClick={()=>setModal(null)}>×</button>
        {modal==="match"&&<MatchForm data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} onSave={saveMatch}/>}
        {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} editing={!!editingPlayer} onSave={savePlayer}/>}
        {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{setModal(null);persist({...data,settings,audits:[{id:crypto.randomUUID(),text:"更新 ELO 設定",at:new Date().toISOString()},...data.audits]},"設定已更新。")}}/>}
        {modal==="detail"&&detail&&<PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data}/>}
      </section></div>}
    {toast&&<div className="toast" role="status">{toast}</div>}
  </div>;
}

function Leaderboard({ranked,data,onRecord,onPlayer}:{ranked:Player[];data:AppState;onRecord:()=>void;onPlayer:(p:Player)=>void}) {
  const leader=ranked[0],month=data.matches.filter(m=>m.playedOn.slice(0,7)===today.slice(0,7)&&m.status==="confirmed").length;
  return <><section className="hero"><div><p className="kicker">SCAA 公開排名</p><h1>排行榜</h1><p>每一場，都清楚計算。</p></div><button className="primary" onClick={onRecord}>＋ 記錄新賽果</button></section>
    <section className="metrics"><div><small>目前第一</small><b>{leader?.name??"—"}</b><span>{Math.round(leader?.rating??0)} ELO</span></div><div><small>活躍球員</small><b>{ranked.length}</b><span>公開排名</span></div><div><small>本月比賽</small><b>{month}</b><span>已確認賽果</span></div></section>
    <section className="section-title"><div><p className="kicker">即時更新</p><h2>目前排名</h2></div><span className="pill">● 公開</span></section>
    <div className="table-card">{ranked.length===0?<Empty text="尚未有球員" sub="前往球員頁面新增第一位球員。"/>:<><div className="table-head"><span>排名</span><span>球員</span><span>近況</span><span>場數／勝率</span><span>正式／建議評分</span><span>ELO</span></div>
      {ranked.map((p,i)=><button className={`row ${i===0?"top":""}`} key={p.id} onClick={()=>onPlayer(p)}>
        <span className="rank">{i===0?"♛":i+1}</span><span className="person"><i>{p.short}</i><b>{p.name}<small>{games(p)<data.settings.provisionalGames?"臨時評分":"正式評分"}</small></b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{games(p)} 場<small>{games(p)?Math.round(p.wins/games(p)*100):0}% 勝率</small></span><span className="dual-rating"><b>{p.handicap==null?"—":p.handicap}</b><small>建議 {suggestedHandicap(p,data)==null?"—":Math.round(suggestedHandicap(p,data)!)}</small></span>
        <span className="elo"><b>{Math.round(p.rating)}</b><small className={p.lastChange>=0?"positive":"negative"}>{p.lastChange>=0?"+":""}{Math.round(p.lastChange)}</small></span></button>)}</>}</div></>;
}

function Matches({data,onVoid}:{data:AppState;onVoid:(m:Match)=>void}) {
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  return <><section className="hero small"><div><p className="kicker">完整可追溯</p><h1>比賽紀錄</h1><p>查看比分、讓分與每場 ELO 變化。</p></div></section>
    <div className="filters"><input placeholder="搜尋球員…" /><input type="date"/><select><option>所有狀態</option><option>已確認</option><option>已作廢</option></select></div>
    <div className="match-list">{data.matches.length===0?<Empty text="尚未有比賽紀錄" sub="記錄第一場比賽後，詳情會顯示在這裡。"/>:data.matches.map(m=>
      <article className={`match ${m.status}`} key={m.id}><div><span className="pill">{m.status==="void"?"已作廢":"已確認"}</span><small>{m.playedOn}</small></div>
        <h3>{name(m.a)} <b>{m.scoreA}–{m.scoreB}</b> {name(m.b)}</h3>
        <p>實際讓分 {m.actual>0?`${name(m.a)} 讓 ${m.actual}`:m.actual<0?`${name(m.b)} 讓 ${Math.abs(m.actual)}`:"無"} · 額外讓分 {m.extra}</p>
        <div className="delta"><span>{Math.round(m.beforeA)} → {Math.round(m.afterA)} <b>{m.deltaA>=0?"+":""}{Math.round(m.deltaA)}</b></span><span>預測 A 勝率 {Math.round(m.expectedA*100)}%</span></div>
        {m.status!=="void"&&<button className="danger-link" onClick={()=>onVoid(m)}>作廢賽事</button>}</article>)}</div></>;
}

function Players({data,onAdd,onEdit,onDelete,onOpen}:{data:AppState;onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void}) {
  return <><section className="hero small"><div><p className="kicker">球會名單</p><h1>球員</h1><p>管理職員提供的正式評分，並比較 ELO 建議評分。</p></div><button className="primary" onClick={onAdd}>＋ 新增球員</button></section>
    <div className="player-grid">{data.players.length===0?<Empty text="尚未有球員" sub="新增球員後便可開始記錄比賽。"/>:data.players.map(p=><article className="player-card" key={p.id}><button className="profile-hit" onClick={()=>onOpen(p)}><i>{p.short}</i><div><h3>{p.name}</h3><p>{Math.round(p.rating)} ELO · 正式 {p.handicap??"未提供"} · 建議 {suggestedHandicap(p,data)==null?"未提供":Math.round(suggestedHandicap(p,data)!)}</p></div></button><div className="player-actions"><button className="more" onClick={()=>onEdit(p)}>編輯</button><button className="danger-link static" onClick={()=>onDelete(p)}>刪除</button></div></article>)}</div></>;
}

function SettingsView({data,onEdit,onReset}:{data:AppState;onEdit:()=>void;onReset:()=>void}) {
  const s=data.settings,c=s.calibration; return <><section className="hero small"><div><p className="kicker">公開設定</p><h1>ELO 設定</h1><p>實際讓分直接影響 ELO；正式讓分只作參考。</p></div><button className="primary" onClick={onEdit}>編輯設定</button></section>
    <div className="settings-grid">{[["起始 ELO",s.start],["臨時門檻",`${s.provisionalGames} 場`],["臨時／正式 K",`${s.kProvisional} / ${s.kRated}`],["持續校準換算率",`${s.conversion} ELO／分`],["調整上限",`±${s.cap} ELO`]].map(x=><div className="setting" key={x[0]}><small>{x[0]}</small><b>{x[1]}</b></div>)}</div>
    <section className="calibration-card"><div><p className="kicker">每場自動更新</p><h2>讓分換算持續學習</h2><p>目前每讓 1 分約等於 <b>{s.conversion} ELO</b>。系統只使用實際讓分與賽果估算，正式讓分不參與計算。</p></div><div className="calibration-stats"><span><small>可用賽事</small><b>{c?.usableMatches??0}</b></span><span><small>信心</small><b>{c?.confidence??"資料不足"}</b></span><span><small>估計範圍</small><b>{c?`${c.lower}–${c.upper}`:"—"}</b></span></div></section>
    <section className="audit"><h2>審計紀錄</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString("zh-HK")}</small></div>)}</section>
    <section className="danger-zone"><div><h2>清除並重設資料</h2><p>永久刪除共用資料庫內所有球員、比賽及審計紀錄，並恢復預設 ELO 設定。</p></div><button onClick={onReset}>清除所有資料</button></section></>;
}

function MatchForm({data,draft,setDraft,preview,a,b,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;onSave:()=>void}) {
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  const fairActual=preview?(a.rating-b.rating)/data.settings.conversion:null;
  const applyFair=()=>{
    if(fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.round(Math.abs(fairActual))}));
  };
  return <><p className="kicker">快速記錄</p><h2>記錄比賽</h2><p className="sub">自由賽制，只需輸入最終局數；同分即為和局。</p>
    {data.players.length<2&&<p className="warning">請先新增至少兩位活躍球員。</p>}
    <div className="step-label"><b>1</b> 球員與日期</div><div className="two"><label>球員 A<select value={draft.a} onChange={e=>update("a",e.target.value)}>{data.players.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>球員 B<select value={draft.b} onChange={e=>update("b",e.target.value)}>{data.players.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label></div>
    <label>比賽日期<input type="date" value={draft.date} onChange={e=>update("date",e.target.value)}/></label>
    <div className="step-label"><b>2</b> 實際讓分</div>{fairActual!=null&&<div className="fair-tip"><div><small>ELO 建議公平讓分</small><b>{fairActual>=0?a.name:b.name} 讓 {Math.round(Math.abs(fairActual))} 分</b><span>套用後預測勝率接近 50／50</span></div><button type="button" onClick={applyFair}>套用建議</button></div>}<div className="two"><label>讓分提供者<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">沒有讓分</option><option value={a?.id}>{a?.name}</option><option value={b?.id}>{b?.name}</option></select></label><label>每局讓分<input type="number" min="0" step="1" value={draft.points} onChange={e=>update("points",+e.target.value)}/></label></div>
    <div className="step-label"><b>3</b> 最終比分</div><div className="score-input"><label>{a?.short}<input type="number" min="0" value={draft.scoreA} onChange={e=>update("scoreA",+e.target.value)}/></label><strong>–</strong><label>{b?.short}<input type="number" min="0" value={draft.scoreB} onChange={e=>update("scoreB",+e.target.value)}/></label></div>
    {preview&&<div className="preview"><div><small>{a.name}</small><b>{Math.round(a.rating)} <em className={preview.deltaA>=0?"positive":"negative"}>{preview.deltaA>=0?"+":""}{Math.round(preview.deltaA)}</em></b></div><div><small>預測勝率</small><b>{Math.round(preview.expectedA*100)}% / {Math.round((1-preview.expectedA)*100)}%</b></div><div><small>{b.name}</small><b>{Math.round(b.rating)} <em className={preview.deltaA<=0?"positive":"negative"}>{-preview.deltaA>=0?"+":""}{Math.round(-preview.deltaA)}</em></b></div><p>正式讓分參考：{preview.official??"未提供"} · 實際讓分：{preview.actual} · 換算率：{data.settings.conversion} ELO／分 · 比分倍率 ×{preview.marginMultiplier.toFixed(2)}</p></div>}
    <button className="primary full" disabled={data.players.length<2} onClick={onSave}>確認並更新 ELO</button></>;
}

function PlayerForm({form,setForm,editing,onSave}:{form:any;setForm:any;editing:boolean;onSave:()=>void}) { const u=(k:string,v:string)=>setForm((f:any)=>({...f,[k]:v}));return <><p className="kicker">公開管理</p><h2>{editing?"編輯球員":"新增球員"}</h2><p className="sub">{editing?"可更新名稱、縮寫及正式讓分；變更不會改寫舊賽事快照。":"起始 ELO 留空時使用群組預設值。"}</p><label>顯示名稱<input value={form.name} onChange={e=>u("name",e.target.value)}/></label><label>短名稱／縮寫<input maxLength={3} value={form.short} onChange={e=>u("short",e.target.value)}/></label><div className="two"><label>正式讓分<input type="number" step="2" value={form.handicap} onChange={e=>u("handicap",e.target.value)}/></label>{!editing&&<label>起始 ELO<input type="number" value={form.rating} onChange={e=>u("rating",e.target.value)}/></label>}</div><button className="primary full" onClick={onSave}>{editing?"儲存變更":"新增球員"}</button></>}
function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) { const [s,setS]=useState(data.settings);const field=(k:keyof Settings,label:string)=><label>{label}<input type="number" value={s[k]} onChange={e=>setS({...s,[k]:+e.target.value})}/></label>;return <><p className="kicker">公開管理</p><h2>編輯 ELO 設定</h2><p className="warning">任何人都可修改。變更會影響其後賽事，歷史賽事保留原設定快照。</p><div className="two">{field("start","起始 ELO")}{field("provisionalGames","臨時門檻")}{field("kProvisional","臨時 K")}{field("kRated","正式 K")}{field("conversion","每點換算")}{field("cap","調整上限")}</div><button className="primary full" onClick={()=>confirm("確定更新公開 ELO 設定？")&&onSave(s)}>儲存設定</button></>}
function PlayerDetail({player,rank,data}:{player:Player;rank:number;data:AppState}) { const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data);return <><div className="profile-head"><i>{player.short}</i><div><p className="kicker">排名 #{rank||"—"}</p><h2>{player.name}</h2><p>{g<data.settings.provisionalGames?"臨時 ELO":"正式 ELO"}</p></div></div><div className="profile-stats"><div><small>目前 ELO</small><b>{Math.round(player.rating)}</b></div><div><small>正式讓分評分</small><b>{player.handicap??"未提供"}</b></div><div><small>ELO 建議評分</small><b>{suggested==null?"未提供":Math.round(suggested)}</b></div><div><small>勝／負／和</small><b>{player.wins}/{player.losses}/{player.draws}</b></div></div><h3>表現摘要</h3><p className="summary">{player.name} 目前為 {Math.round(player.rating)} ELO，最近五場錄得 {player.form.filter(x=>x==="W").length} 勝、{player.form.filter(x=>x==="L").length} 負、{player.form.filter(x=>x==="D").length} 和；ELO 建議評分以現有正式評分為基準，再按相對 ELO 表現校正。共有 {related.length} 場可追溯賽事紀錄。</p></>}
function Empty({text,sub}:{text:string;sub:string}){return <div className="empty"><b>○</b><h3>{text}</h3><p>{sub}</p></div>}
