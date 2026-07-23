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
  deltaA: number; status: "confirmed" | "void"; createdAt: string;
};
type Settings = { start: number; provisionalGames: number; kProvisional: number; kRated: number; conversion: number; cap: number };
type AppState = { players: Player[]; matches: Match[]; settings: Settings; audits: { id: string; text: string; at: string }[] };

const seed: AppState = {
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200 },
  players: [
    { id:"marco",name:"Marco Chan",short:"MC",handicap:-8,rating:1586,initialRating:1500,active:true,wins:8,losses:2,draws:0,framesWon:31,framesLost:19,lastChange:18,form:["W","W","W","W","L"] },
    { id:"jason",name:"Jason Lee",short:"JL",handicap:-4,rating:1542,initialRating:1500,active:true,wins:7,losses:4,draws:1,framesWon:29,framesLost:22,lastChange:11,form:["W","D","W","L","W"] },
    { id:"wing",name:"Wing Ho",short:"WH",handicap:0,rating:1508,initialRating:1500,active:true,wins:5,losses:5,draws:0,framesWon:24,framesLost:23,lastChange:-14,form:["L","W","W","L","W"] },
    { id:"alan",name:"Alan Wong",short:"AW",handicap:6,rating:1467,initialRating:1500,active:true,wins:3,losses:6,draws:1,framesWon:18,framesLost:27,lastChange:-15,form:["L","L","D","W","L"] },
    { id:"carmen",name:"Carmen Lau",short:"CL",handicap:null,rating:1439,initialRating:1500,active:true,wins:2,losses:6,draws:0,framesWon:14,framesLost:25,lastChange:7,form:["W","L","L","W","L"] }
  ],
  matches: [],
  audits: [{ id:"seed",text:"建立 SCAA 公開群組及預設 ELO 設定",at:new Date().toISOString() }]
};

function games(p: Player) { return p.wins + p.losses + p.draws; }
function calc(a: Player,b: Player,scoreA:number,scoreB:number,giver:string|null,points:number,s:Settings) {
  const official = a.handicap == null || b.handicap == null ? null : b.handicap - a.handicap;
  const actual = giver === a.id ? points : giver === b.id ? -points : 0;
  const extra = actual - (official ?? 0);
  const adjustment = Math.max(-s.cap,Math.min(s.cap,s.conversion * extra));
  const expectedA = 1/(1+10**(((b.rating+adjustment)-a.rating)/400));
  const result = scoreA === scoreB ? .5 : scoreA > scoreB ? 1 : 0;
  const k = games(a)<s.provisionalGames || games(b)<s.provisionalGames ? s.kProvisional : s.kRated;
  const deltaA = k*(result-expectedA);
  return { official,actual,extra,expectedA,deltaA };
}

const today = new Date().toISOString().slice(0,10);

export default function Home() {
  const [data,setData] = useState<AppState>(seed);
  const [tab,setTab] = useState("leaderboard");
  const [modal,setModal] = useState<"match"|"player"|"settings"|"detail"|null>(null);
  const [detail,setDetail] = useState<Player|null>(null);
  const [toast,setToast] = useState("");
  const [saving,setSaving] = useState(false);
  const [draft,setDraft] = useState({a:"marco",b:"jason",scoreA:4,scoreB:2,date:today,giver:"marco",points:4});
  const [playerForm,setPlayerForm] = useState({name:"",short:"",handicap:"",rating:""});

  useEffect(()=>{
    const local = localStorage.getItem("scaa-draft");
    if(local) try { setDraft(JSON.parse(local)); } catch {}
    fetch("/api/state").then(r=>r.ok?r.json():null).then(v=>v?.players?.length&&setData(v)).catch(()=>{});
  },[]);
  useEffect(()=>{ localStorage.setItem("scaa-draft",JSON.stringify(draft)); },[draft]);

  async function persist(next:AppState,message:string) {
    setData(next); setSaving(true);
    try {
      const r=await fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(next)});
      if(!r.ok) throw new Error();
      setToast(message);
    } catch { setToast("未能連接伺服器；資料仍保留在此畫面，請稍後再試。"); }
    finally { setSaving(false); setTimeout(()=>setToast(""),3200); }
  }

  const ranked=useMemo(()=>[...data.players].filter(p=>p.active).sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),[data]);
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
      status:"confirmed",createdAt:now};
    const resultA=draft.scoreA===draft.scoreB?"D":draft.scoreA>draft.scoreB?"W":"L";
    const resultB=resultA==="D"?"D":resultA==="W"?"L":"W";
    const players=data.players.map(p=>{
      if(p.id!==a.id&&p.id!==b.id)return p;
      const isA=p.id===a.id,result=isA?resultA:resultB,delta=isA?preview.deltaA:-preview.deltaA;
      return {...p,rating:p.rating+delta,lastChange:delta,wins:p.wins+(result==="W"?1:0),losses:p.losses+(result==="L"?1:0),
        draws:p.draws+(result==="D"?1:0),framesWon:p.framesWon+(isA?+draft.scoreA:+draft.scoreB),
        framesLost:p.framesLost+(isA?+draft.scoreB:+draft.scoreA),form:[result,...p.form].slice(0,5)};
    });
    const next={...data,players,matches:[match,...data.matches],audits:[{id:crypto.randomUUID(),text:`記錄賽果：${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}`,at:now},...data.audits]};
    localStorage.removeItem("scaa-draft"); setModal(null); persist(next,"賽果已儲存，雙方 ELO 已更新。");
  }

  function addPlayer(){
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast("請輸入顯示名稱及縮寫。");return;}
    const rating=playerForm.rating?+playerForm.rating:data.settings.start;
    const p:Player={id:crypto.randomUUID(),name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),
      handicap:playerForm.handicap===""?null:+playerForm.handicap,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,
      framesWon:0,framesLost:0,lastChange:0,form:[]};
    const next={...data,players:[...data.players,p],audits:[{id:crypto.randomUUID(),text:`新增球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
    setPlayerForm({name:"",short:"",handicap:"",rating:""});setModal(null);persist(next,"球員已新增。");
  }

  function archivePlayer(p:Player){
    if(!confirm(`確定${p.active?"封存":"恢復"} ${p.name}？`))return;
    const next={...data,players:data.players.map(x=>x.id===p.id?{...x,active:!x.active}:x),
      audits:[{id:crypto.randomUUID(),text:`${p.active?"封存":"恢復"}球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
    persist(next,p.active?"球員已封存。":"球員已恢復。");
  }

  function voidMatch(m:Match){
    if(m.status==="void"||!confirm("作廢後系統會重建受影響評分。確定繼續？"))return;
    // Full production replay is represented by returning this match's immutable event impact.
    const players=data.players.map(p=>p.id===m.a?{...p,rating:p.rating-m.deltaA}:p.id===m.b?{...p,rating:p.rating+m.deltaA}:p);
    const next={...data,players,matches:data.matches.map(x=>x.id===m.id?{...x,status:"void" as const}:x),
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
      <header><div className="mobile-brand">SCAA <span>Snooker ELO</span></div><div className="status"><i/> 資料公開 · {saving?"儲存中…":"已同步"}</div></header>
      {tab==="leaderboard"&&<Leaderboard ranked={ranked} data={data} onRecord={()=>setModal("match")} onPlayer={(p)=>{setDetail(p);setModal("detail")}}/>}
      {tab==="matches"&&<Matches data={data} onVoid={voidMatch}/>}
      {tab==="players"&&<Players data={data} onAdd={()=>setModal("player")} onArchive={archivePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}}/>}
      {tab==="settings"&&<SettingsView data={data} onEdit={()=>setModal("settings")}/>}
    </main>
    <button className="fab" onClick={()=>setModal("match")}><span>＋</span>記錄</button>
    <nav className="bottom">{[["leaderboard","榜","◆"],["matches","比賽","◫"],["record","記錄","＋"],["players","球員","◎"],["settings","設定","⚙"]].map(([id,label,icon])=>
      <button key={id} className={tab===id?"active":""} onClick={()=>id==="record"?setModal("match"):setTab(id)}><i>{icon}</i><small>{label}</small></button>)}</nav>
    {modal&&<div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&setModal(null)}>
      <section className="sheet" role="dialog" aria-modal="true"><button className="close" aria-label="關閉" onClick={()=>setModal(null)}>×</button>
        {modal==="match"&&<MatchForm data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} onSave={saveMatch}/>}
        {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} onSave={addPlayer}/>}
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
    <div className="table-card"><div className="table-head"><span>排名</span><span>球員</span><span>近況</span><span>場數／勝率</span><span>正式讓分</span><span>ELO</span></div>
      {ranked.map((p,i)=><button className={`row ${i===0?"top":""}`} key={p.id} onClick={()=>onPlayer(p)}>
        <span className="rank">{i===0?"♛":i+1}</span><span className="person"><i>{p.short}</i><b>{p.name}<small>{games(p)<data.settings.provisionalGames?"臨時評分":"正式評分"}</small></b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{games(p)} 場<small>{games(p)?Math.round(p.wins/games(p)*100):0}% 勝率</small></span><span>{p.handicap==null?"未提供":p.handicap}</span>
        <span className="elo"><b>{Math.round(p.rating)}</b><small className={p.lastChange>=0?"positive":"negative"}>{p.lastChange>=0?"+":""}{Math.round(p.lastChange)}</small></span></button>)}</div></>;
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

function Players({data,onAdd,onArchive,onOpen}:{data:AppState;onAdd:()=>void;onArchive:(p:Player)=>void;onOpen:(p:Player)=>void}) {
  return <><section className="hero small"><div><p className="kicker">球會名單</p><h1>球員</h1><p>管理顯示名稱、正式讓分及活躍狀態。</p></div><button className="primary" onClick={onAdd}>＋ 新增球員</button></section>
    <div className="player-grid">{data.players.map(p=><article className="player-card" key={p.id}><button className="profile-hit" onClick={()=>onOpen(p)}><i>{p.short}</i><div><h3>{p.name}</h3><p>{Math.round(p.rating)} ELO · 讓分 {p.handicap??"未提供"}</p></div></button><span className={`pill ${p.active?"":"muted"}`}>{p.active?"活躍":"已封存"}</span><button className="more" onClick={()=>onArchive(p)}>{p.active?"封存":"恢復"}</button></article>)}</div></>;
}

function SettingsView({data,onEdit}:{data:AppState;onEdit:()=>void}) {
  const s=data.settings; return <><section className="hero small"><div><p className="kicker">公開設定</p><h1>ELO 設定</h1><p>任何訪客均可修改；所有變更會寫入審計紀錄。</p></div><button className="primary" onClick={onEdit}>編輯設定</button></section>
    <div className="settings-grid">{[["起始 ELO",s.start],["臨時門檻",`${s.provisionalGames} 場`],["臨時／正式 K",`${s.kProvisional} / ${s.kRated}`],["每點換算",`${s.conversion} ELO`],["調整上限",`±${s.cap} ELO`]].map(x=><div className="setting" key={x[0]}><small>{x[0]}</small><b>{x[1]}</b></div>)}</div>
    <section className="audit"><h2>審計紀錄</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString("zh-HK")}</small></div>)}</section></>;
}

function MatchForm({data,draft,setDraft,preview,a,b,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;onSave:()=>void}) {
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  return <><p className="kicker">快速記錄</p><h2>記錄比賽</h2><p className="sub">自由賽制，只需輸入最終局數；同分即為和局。</p>
    <div className="step-label"><b>1</b> 球員與日期</div><div className="two"><label>球員 A<select value={draft.a} onChange={e=>update("a",e.target.value)}>{data.players.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>球員 B<select value={draft.b} onChange={e=>update("b",e.target.value)}>{data.players.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label></div>
    <label>比賽日期<input type="date" value={draft.date} onChange={e=>update("date",e.target.value)}/></label>
    <div className="step-label"><b>2</b> 實際讓分</div><div className="two"><label>讓分提供者<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">沒有讓分</option><option value={a?.id}>{a?.name}</option><option value={b?.id}>{b?.name}</option></select></label><label>每局讓分<input type="number" min="0" step="1" value={draft.points} onChange={e=>update("points",+e.target.value)}/></label></div>
    <div className="step-label"><b>3</b> 最終比分</div><div className="score-input"><label>{a?.short}<input type="number" min="0" value={draft.scoreA} onChange={e=>update("scoreA",+e.target.value)}/></label><strong>–</strong><label>{b?.short}<input type="number" min="0" value={draft.scoreB} onChange={e=>update("scoreB",+e.target.value)}/></label></div>
    {preview&&<div className="preview"><div><small>{a.name}</small><b>{Math.round(a.rating)} <em className={preview.deltaA>=0?"positive":"negative"}>{preview.deltaA>=0?"+":""}{Math.round(preview.deltaA)}</em></b></div><div><small>預測勝率</small><b>{Math.round(preview.expectedA*100)}% / {Math.round((1-preview.expectedA)*100)}%</b></div><div><small>{b.name}</small><b>{Math.round(b.rating)} <em className={preview.deltaA<=0?"positive":"negative"}>{-preview.deltaA>=0?"+":""}{Math.round(-preview.deltaA)}</em></b></div><p>正式讓分：{preview.official??"未提供（按 0 計）"} · 實際：{preview.actual} · 額外：{preview.extra}</p></div>}
    <button className="primary full" onClick={onSave}>確認並更新 ELO</button></>;
}

function PlayerForm({form,setForm,onSave}:{form:any;setForm:any;onSave:()=>void}) { const u=(k:string,v:string)=>setForm((f:any)=>({...f,[k]:v}));return <><p className="kicker">公開管理</p><h2>新增球員</h2><p className="sub">起始 ELO 留空時使用群組預設值。</p><label>顯示名稱<input value={form.name} onChange={e=>u("name",e.target.value)}/></label><label>短名稱／縮寫<input maxLength={3} value={form.short} onChange={e=>u("short",e.target.value)}/></label><div className="two"><label>正式讓分<input type="number" step="2" value={form.handicap} onChange={e=>u("handicap",e.target.value)}/></label><label>起始 ELO<input type="number" value={form.rating} onChange={e=>u("rating",e.target.value)}/></label></div><button className="primary full" onClick={onSave}>新增球員</button></>}
function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) { const [s,setS]=useState(data.settings);const field=(k:keyof Settings,label:string)=><label>{label}<input type="number" value={s[k]} onChange={e=>setS({...s,[k]:+e.target.value})}/></label>;return <><p className="kicker">公開管理</p><h2>編輯 ELO 設定</h2><p className="warning">任何人都可修改。變更會影響其後賽事，歷史賽事保留原設定快照。</p><div className="two">{field("start","起始 ELO")}{field("provisionalGames","臨時門檻")}{field("kProvisional","臨時 K")}{field("kRated","正式 K")}{field("conversion","每點換算")}{field("cap","調整上限")}</div><button className="primary full" onClick={()=>confirm("確定更新公開 ELO 設定？")&&onSave(s)}>儲存設定</button></>}
function PlayerDetail({player,rank,data}:{player:Player;rank:number;data:AppState}) { const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id);return <><div className="profile-head"><i>{player.short}</i><div><p className="kicker">排名 #{rank||"—"}</p><h2>{player.name}</h2><p>{g<data.settings.provisionalGames?"臨時評分":"正式評分"} · 正式讓分 {player.handicap??"未提供"}</p></div></div><div className="profile-stats"><div><small>目前 ELO</small><b>{Math.round(player.rating)}</b></div><div><small>勝／負／和</small><b>{player.wins}/{player.losses}/{player.draws}</b></div><div><small>勝率</small><b>{g?Math.round(player.wins/g*100):0}%</b></div><div><small>局數勝率</small><b>{player.framesWon+player.framesLost?Math.round(player.framesWon/(player.framesWon+player.framesLost)*100):0}%</b></div></div><h3>表現摘要</h3><p className="summary">{player.name} 目前為 {Math.round(player.rating)} ELO，最近五場錄得 {player.form.filter(x=>x==="W").length} 勝、{player.form.filter(x=>x==="L").length} 負、{player.form.filter(x=>x==="D").length} 和；共有 {related.length} 場可追溯賽事紀錄。</p></>}
function Empty({text,sub}:{text:string;sub:string}){return <div className="empty"><b>○</b><h3>{text}</h3><p>{sub}</p></div>}
