"use client";

import { useEffect, useMemo, useState } from "react";

type Player = {
  id: string; name: string; short: string; handicap: number | null; rating: number;
  initialRating: number; active: boolean; wins: number; losses: number; draws: number;
  framesWon: number; framesLost: number; lastChange: number; form: string[];
};
type Match = {
  id: string; a: string; b: string; scoreA: number; scoreB: number; playedOn: string;
  entryMode?: "match" | "aggregate"; frameEvidence?: number; performanceScore?:number; evidenceWeight?:number; handicapAdjustment?:number; overHandicapElo?:number; overHandicapMultiplier?:number;
  actual: number; giver: string | null; official: number | null; extra: number;
  expectedA: number; beforeA: number; beforeB: number; afterA: number; afterB: number;
  deltaA: number; marginMultiplier?: number; status: "confirmed" | "void"; createdAt: string;
};
type CalibrationPoint = { estimate:number; usableMatches:number; at:string };
type Calibration = { rawEstimate:number; estimate:number; lower:number; upper:number; curvatureEstimate?:number; curvatureLower?:number; curvatureUpper?:number; usableMatches:number; handicapLevels:number; confidence:string; updatedAt:string; history?:CalibrationPoint[] };
type Settings = { start: number; provisionalGames: number; kProvisional: number; kRated: number; conversion: number; cap: number; curvature?:number; handicapSoftCap?:number; winnerBonus?:number; overHandicapBoost?:number; overHandicapScale?:number; modelVersion?:number; calibration?:Calibration };
type AppState = { players: Player[]; matches: Match[]; settings: Settings; audits: { id: string; text: string; at: string }[] };

const seed: AppState = {
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature:1.25, handicapSoftCap:800, winnerBonus:.5, overHandicapBoost:.75, overHandicapScale:200, modelVersion:3 },
  players: [],
  matches: [],
  audits: [{ id:"seed",text:"建立 SCAA 公開群組及預設 ELO 設定",at:new Date().toISOString() }]
};

function games(p: Player) { return p.wins + p.losses + p.draws; }
function handicapAdjustment(points:number,s:Settings,conversion=s.conversion,curvature=s.curvature??1.25){
  if(!points)return 0;
  const raw=Math.sign(points)*conversion*10*(Math.abs(points)/10)**curvature;
  const ceiling=s.handicapSoftCap??800;
  return ceiling*Math.tanh(raw/ceiling);
}
function eloToHandicap(eloDifference:number,s:Settings){
  if(!eloDifference)return 0;
  const ceiling=s.handicapSoftCap??800,clamped=Math.min(Math.abs(eloDifference),ceiling*.995);
  const raw=ceiling*Math.atanh(clamped/ceiling);
  return Math.sign(eloDifference)*10*(raw/(Math.max(.01,s.conversion)*10))**(1/(s.curvature??1.25));
}
function suggestedHandicap(p: Player,data: AppState) {
  const meanRating=data.players.length?data.players.reduce((sum,x)=>sum+x.rating,0)/data.players.length:data.settings.start;
  const official=data.players.map(x=>x.handicap).filter((x):x is number=>x!=null);
  const anchor=official.length?official.reduce((sum,x)=>sum+x,0)/official.length:0;
  return anchor-eloToHandicap(p.rating-meanRating,data.settings);
}
type SortKey = "rank"|"name"|"rating"|"change"|"form"|"official"|"suggested"|"games"|"winRate"|"frameRate";
const sortLabels:Record<SortKey,string>={rank:"排名",name:"球員",rating:"ELO",change:"最近變化",form:"近況",official:"正式評分",suggested:"建議評分",games:"場數",winRate:"勝率",frameRate:"局數勝率"};
function winRate(p:Player){return games(p)?p.wins/games(p):0}
function frameRate(p:Player){const total=p.framesWon+p.framesLost;return total?p.framesWon/total:0}
function formScore(p:Player){return p.form.reduce((sum,x,i)=>sum+(x==="W"?1:x==="D"?.5:0)*(5-i),0)}
function sortPlayers(players:Player[],data:AppState,key:SortKey,dir:"asc"|"desc"){
  const ranks=new Map([...players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)).map((p,i)=>[p.id,i+1]));
  const value=(p:Player):number|string|null=>key==="rank"?ranks.get(p.id)??999:key==="name"?p.name:key==="rating"?p.rating:key==="change"?p.lastChange:key==="form"?formScore(p):key==="official"?p.handicap:key==="suggested"?suggestedHandicap(p,data):key==="games"?games(p):key==="winRate"?winRate(p):frameRate(p);
  return [...players].sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av==null&&bv==null)return a.name.localeCompare(b.name);
    if(av==null)return 1;if(bv==null)return -1;
    const cmp=typeof av==="string"?av.localeCompare(String(bv)):av-Number(bv);
    return (dir==="asc"?cmp:-cmp)||a.name.localeCompare(b.name);
  });
}
function playerSeries(p:Player,data:AppState){
  const related=[...data.matches].filter(m=>m.a===p.id||m.b===p.id).sort((a,b)=>(a.playedOn||a.createdAt).localeCompare(b.playedOn||b.createdAt)||a.createdAt.localeCompare(b.createdAt));
  return [p.initialRating,...related.map(m=>m.a===p.id?m.afterA:m.afterB)];
}
function recentDelta(p:Player,data:AppState,count:number){
  return [...data.matches].filter(m=>m.a===p.id||m.b===p.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,count).reduce((sum,m)=>sum+(m.a===p.id?m.deltaA:-m.deltaA),0);
}
function calc(a: Player,b: Player,scoreA:number,scoreB:number,giver:string|null,points:number,s:Settings) {
  const official = a.handicap == null || b.handicap == null ? null : b.handicap - a.handicap;
  const actual = giver === a.id ? points : giver === b.id ? -points : 0;
  const extra = actual - (official ?? 0);
  const adjustment = handicapAdjustment(actual,s);
  const expectedA = 1/(1+10**(((b.rating+adjustment)-a.rating)/400));
  const k = games(a)<s.provisionalGames || games(b)<s.provisionalGames ? s.kProvisional : s.kRated;
  const totalFrames = scoreA + scoreB;
  const frameShare = totalFrames ? scoreA/totalFrames : .5;
  const frameEvidence = Math.min(totalFrames,20);
  const bonus=s.winnerBonus??.5;
  const performanceScore=scoreA===scoreB?.5:scoreA>scoreB?(scoreA+bonus)/(totalFrames+bonus):scoreA/(totalFrames+bonus);
  const evidenceWeight=Math.sqrt(frameEvidence/4);
  const baseDelta=k*evidenceWeight*(performanceScore-expectedA);
  const ratingDifference=a.rating-b.rating;
  const performerIsA=performanceScore>.5||(performanceScore===.5&&expectedA<.5);
  const overHandicapElo=performerIsA
    ? Math.max(0,adjustment-ratingDifference)
    : Math.max(0,ratingDifference-adjustment);
  const performanceMargin=performanceScore===.5?.6:.6+.4*Math.min(1,Math.abs(performanceScore-.5)/.5);
  const overHandicapMultiplier=1+(s.overHandicapBoost??.75)*(1-Math.exp(-overHandicapElo/(s.overHandicapScale??200)))*performanceMargin;
  const deltaA=baseDelta*overHandicapMultiplier;
  return { official,actual,extra,expectedA,deltaA,frameShare,frameEvidence,performanceScore,evidenceWeight,adjustment,overHandicapElo,overHandicapMultiplier };
}
function matchProbabilities(frameProbability:number,frames:number){
  if(frames<=0)return {win:0,draw:0,loss:0};
  const choose=(n:number,k:number)=>{let value=1;for(let i=1;i<=k;i++)value=value*(n-k+i)/i;return value};
  let win=0,draw=0;
  for(let k=0;k<=frames;k++){const probability=choose(frames,k)*frameProbability**k*(1-frameProbability)**(frames-k);if(k>frames/2)win+=probability;else if(k===frames/2)draw=probability;}
  return {win,draw,loss:1-win-draw};
}

function recalibrate(settings:Settings,matches:Match[]):Settings {
  const usable=matches.filter(m=>m.status==="confirmed"&&m.actual!==0&&(m.scoreA+m.scoreB)>0&&Number.isFinite(m.beforeA)&&Number.isFinite(m.beforeB));
  const n=usable.length, prior=8,priorCurve=1.25,currentCurve=settings.curvature??priorCurve;
  const levels=new Set(usable.map(m=>Math.abs(m.actual))).size;
  const now=new Date().toISOString();
  const oldHistory=settings.calibration?.history??[];
  if(n<10||levels<2) return {...settings,curvature:currentCurve,handicapSoftCap:settings.handicapSoftCap??800,winnerBonus:settings.winnerBonus??.5,overHandicapBoost:settings.overHandicapBoost??.75,overHandicapScale:settings.overHandicapScale??200,calibration:{rawEstimate:prior,estimate:settings.conversion,lower:1,upper:20,curvatureEstimate:currentCurve,curvatureLower:1,curvatureUpper:1.6,usableMatches:n,handicapLevels:levels,confidence:"資料不足",updatedAt:now,history:oldHistory}};
  let best=prior,bestCurve=priorCurve,bestLoss=Infinity;
  const losses:{candidate:number;curve:number;loss:number}[]=[];
  for(let candidate=1;candidate<=20;candidate+=.25){
    for(let curve=1;curve<=1.6001;curve+=.05){
      let loss=0,weight=0;
      for(const m of usable){
        const adjustment=handicapAdjustment(m.actual,settings,candidate,curve);
        const predicted=1/(1+10**(((m.beforeB+adjustment)-m.beforeA)/400));
        const frames=m.scoreA+m.scoreB,actual=m.scoreA/frames,evidence=Math.min(frames,20);
        loss+=evidence*(predicted-actual)**2;weight+=evidence;
      }
      loss/=weight;
      losses.push({candidate,curve,loss});
      if(loss<bestLoss){bestLoss=loss;best=candidate;bestCurve=curve;}
    }
  }
  const shrunk=(30*prior+n*best)/(30+n);
  const estimate=Math.max(1,Math.min(20,settings.conversion+Math.max(-.25,Math.min(.25,shrunk-settings.conversion))));
  const curveTarget=(60*priorCurve+n*bestCurve)/(60+n);
  const curvature=Math.max(1,Math.min(1.6,currentCurve+Math.max(-.02,Math.min(.02,curveTarget-currentCurve))));
  const threshold=bestLoss+Math.max(.0025,bestLoss*.1);
  const plausible=losses.filter(x=>x.loss<=threshold),rates=plausible.map(x=>x.candidate),curves=plausible.map(x=>x.curve);
  const lower=Math.min(...rates),upper=Math.max(...rates),curveLower=Math.min(...curves),curveUpper=Math.max(...curves);
  const confidence=n>=150&&levels>=5?"高":n>=75&&levels>=4?"中":n>=30&&levels>=3?"低":"初步";
  const rounded=Number(estimate.toFixed(2)),roundedCurve=Number(curvature.toFixed(2));
  const history=[...oldHistory,{estimate:rounded,usableMatches:n,at:now}].slice(-20);
  return {...settings,conversion:rounded,curvature:roundedCurve,handicapSoftCap:settings.handicapSoftCap??800,winnerBonus:settings.winnerBonus??.5,overHandicapBoost:settings.overHandicapBoost??.75,overHandicapScale:settings.overHandicapScale??200,calibration:{rawEstimate:Number(best.toFixed(2)),estimate:rounded,lower:Number(lower.toFixed(2)),upper:Number(upper.toFixed(2)),curvatureEstimate:roundedCurve,curvatureLower:Number(curveLower.toFixed(2)),curvatureUpper:Number(curveUpper.toFixed(2)),usableMatches:n,handicapLevels:levels,confidence,updatedAt:now,history}};
}

function replay(players:Player[],matches:Match[],settings:Settings) {
  const rebuilt=players.map(p=>({...p,rating:p.initialRating,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[] as string[]}));
  const byId=new Map(rebuilt.map(p=>[p.id,p]));
  const ordered=[...matches].filter(m=>m.status==="confirmed").sort((x,y)=>
    (x.playedOn||x.createdAt).localeCompare(y.playedOn||y.createdAt)||x.createdAt.localeCompare(y.createdAt));
  const updated=new Map<string,Match>();
  for(const m of ordered){
    const a=byId.get(m.a),b=byId.get(m.b);
    if(!a||!b)continue;
    const giver=m.actual>0?a.id:m.actual<0?b.id:null;
    const result=calc(a,b,m.scoreA,m.scoreB,giver,Math.abs(m.actual),settings);
    const resultA=m.scoreA===m.scoreB?"D":m.scoreA>m.scoreB?"W":"L";
    const resultB=resultA==="D"?"D":resultA==="W"?"L":"W";
    const beforeA=a.rating,beforeB=b.rating;
    a.rating+=result.deltaA;b.rating-=result.deltaA;
    a.lastChange=result.deltaA;b.lastChange=-result.deltaA;
    for(const [p,r,fw,fl] of [[a,resultA,m.scoreA,m.scoreB],[b,resultB,m.scoreB,m.scoreA]] as const){
      p.wins+=r==="W"?1:0;p.losses+=r==="L"?1:0;p.draws+=r==="D"?1:0;
      p.framesWon+=fw;p.framesLost+=fl;p.form=[r,...p.form].slice(0,5);
    }
    updated.set(m.id,{...m,expectedA:result.expectedA,beforeA,beforeB,afterA:a.rating,afterB:b.rating,deltaA:result.deltaA,frameEvidence:result.frameEvidence,performanceScore:result.performanceScore,evidenceWeight:result.evidenceWeight,handicapAdjustment:result.adjustment,overHandicapElo:result.overHandicapElo,overHandicapMultiplier:result.overHandicapMultiplier});
  }
  return {players:rebuilt,matches:matches.filter(m=>m.status==="confirmed").map(m=>updated.get(m.id)??m)};
}
function upgradeState(raw:AppState){
  if((raw.settings.modelVersion??1)>=3)return {state:raw,changed:false};
  let settings:Settings={...raw.settings,curvature:raw.settings.curvature??1.25,handicapSoftCap:raw.settings.handicapSoftCap??800,winnerBonus:raw.settings.winnerBonus??.5,overHandicapBoost:raw.settings.overHandicapBoost??.75,overHandicapScale:raw.settings.overHandicapScale??200,modelVersion:3};
  settings=recalibrate(settings,raw.matches);
  let rebuilt=replay(raw.players,raw.matches,settings);
  settings=recalibrate(settings,rebuilt.matches);
  rebuilt=replay(raw.players,rebuilt.matches,settings);
  return {state:{...raw,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:"加入超額讓分表現加乘；完整重播歷史 ELO",at:new Date().toISOString()},...raw.audits]},changed:true};
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
  const [draft,setDraft] = useState({mode:"match" as "match"|"aggregate",a:"",b:"",scoreA:0,scoreB:0,date:today,giver:"",points:0});
  const [playerForm,setPlayerForm] = useState({name:"",short:"",handicap:"",rating:""});

  useEffect(()=>{
    const local = localStorage.getItem("scaa-draft");
    if(local) try { setDraft(JSON.parse(local)); } catch {}
    fetch("/api/state").then(r=>r.ok?r.json():null).then(v=>{if(!v?.players)return;const upgraded=upgradeState(v);setData(upgraded.state);if(upgraded.changed)fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(upgraded.state)}).catch(()=>{});}).catch(()=>{});
  },[]);
  useEffect(()=>{
    const timer=setInterval(()=>{
      if(document.visibilityState!=="visible"||saving)return;
      fetch("/api/state").then(r=>r.ok?r.json():null).then(v=>v?.players&&setData(upgradeState(v).state)).catch(()=>{});
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
      setDraft({mode:"match",a:"",b:"",scoreA:0,scoreB:0,date:today,giver:"",points:0});
      setToast("所有共用資料已清除並重設。");
    }catch{setToast("重設失敗，資料沒有被清除。請稍後再試。");}
    finally{setSaving(false);setTimeout(()=>setToast(""),3200);}
  }

  const ranked=useMemo(()=>[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),[data]);
  const a=data.players.find(p=>p.id===draft.a)??data.players[0];
  const b=data.players.find(p=>p.id===draft.b)??data.players[1];
  const preview=a&&b&&a.id!==b.id?calc(a,b,+draft.scoreA,+draft.scoreB,draft.giver,+draft.points,data.settings):null;

  function saveMatch(){
    if(!a||!b||a.id===b.id||draft.scoreA<0||draft.scoreB<0||(+draft.scoreA+ +draft.scoreB)===0){setToast("請選擇兩位不同球員，比分總局數必須大於 0。");return;}
    if(!preview)return;
    const now=new Date().toISOString(), id=crypto.randomUUID();
    const match:Match={id,a:a.id,b:b.id,scoreA:+draft.scoreA,scoreB:+draft.scoreB,playedOn:draft.date||today,
      actual:preview.actual,giver:draft.giver||null,official:preview.official,extra:preview.extra,expectedA:preview.expectedA,
      beforeA:a.rating,beforeB:b.rating,afterA:a.rating+preview.deltaA,afterB:b.rating-preview.deltaA,deltaA:preview.deltaA,
      entryMode:draft.mode??"match",frameEvidence:preview.frameEvidence,performanceScore:preview.performanceScore,evidenceWeight:preview.evidenceWeight,handicapAdjustment:preview.adjustment,overHandicapElo:preview.overHandicapElo,overHandicapMultiplier:preview.overHandicapMultiplier,status:"confirmed",createdAt:now};
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
    const rebuilt=replay(data.players,matches,settings);
    const next={...data,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:`記錄賽果：${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}；持續校準 ${settings.conversion} ELO／分`,at:now},...data.audits]};
    localStorage.removeItem("scaa-draft"); setModal(null); persist(next,"賽果已儲存，雙方 ELO 已更新。");
  }

  function savePlayer(){
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast("請輸入顯示名稱及縮寫。");return;}
    const rating=playerForm.rating?+playerForm.rating:data.settings.start;
    const p:Player=editingPlayer
      ? {...editingPlayer,name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),handicap:playerForm.handicap===""?null:+playerForm.handicap,initialRating:rating}
      : {id:crypto.randomUUID(),name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),
        handicap:playerForm.handicap===""?null:+playerForm.handicap,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,
        framesWon:0,framesLost:0,lastChange:0,form:[]};
    const action=editingPlayer?"編輯":"新增";
    const players=editingPlayer?data.players.map(x=>x.id===p.id?p:x):[...data.players,p];
    const rebuilt=editingPlayer?replay(players,data.matches,data.settings):{players,matches:data.matches};
    const next={...data,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}球員：${p.name}${editingPlayer?"；重播歷史評分":""}`,at:new Date().toISOString()},...data.audits]};
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
    if(!confirm("永久刪除此賽事？系統會重建所有後續 ELO、勝負、局數及近況，此操作無法復原。"))return;
    const matches=data.matches.filter(x=>x.id!==m.id);
    const settings=recalibrate(data.settings,matches);
    const rebuilt=replay(data.players,matches,settings);
    const next={...data,settings,...rebuilt,
      audits:[{id:crypto.randomUUID(),text:`永久刪除賽事：${m.id.slice(0,8)}；重建評分及近況`,at:new Date().toISOString()},...data.audits]};
    persist(next,"賽事已刪除，ELO、統計及近況已重建。");
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
        {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{const applied={...settings,modelVersion:3},rebuilt=replay(data.players,data.matches,applied);setModal(null);persist({...data,settings:applied,...rebuilt,audits:[{id:crypto.randomUUID(),text:"更新 ELO 設定；完整重播歷史評分",at:new Date().toISOString()},...data.audits]},"設定已更新，歷史 ELO 已重播。")}}/>}
        {modal==="detail"&&detail&&<PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data}/>}
      </section></div>}
    {toast&&<div className="toast" role="status">{toast}</div>}
  </div>;
}

function Leaderboard({ranked,data,onRecord,onPlayer}:{ranked:Player[];data:AppState;onRecord:()=>void;onPlayer:(p:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[momentum,setMomentum]=useState<1|5>(1);
  const leader=ranked[0],month=data.matches.filter(m=>m.playedOn.slice(0,7)===today.slice(0,7)&&m.status==="confirmed").length;
  const shown=sortPlayers(ranked,data,sort,dir),rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  const ratings=ranked.map(p=>p.rating),minRating=Math.min(...ratings,0),maxRating=Math.max(...ratings,1),range=Math.max(1,maxRating-minRating);
  const suggestedValues=ranked.map(p=>({p,value:suggestedHandicap(p,data)})).sort((a,b)=>a.value-b.value),suggestedMin=suggestedValues.length?Math.min(...suggestedValues.map(x=>x.value)):0,suggestedMax=suggestedValues.length?Math.max(...suggestedValues.map(x=>x.value)):1,suggestedRange=Math.max(1,suggestedMax-suggestedMin);
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  return <><section className="hero"><div><p className="kicker">SCAA 公開排名</p><h1>排行榜</h1><p>每一場，都清楚計算。</p></div><button className="primary" onClick={onRecord}>＋ 記錄新賽果</button></section>
    <section className="metrics"><div><small>目前第一</small><b>{leader?.name??"—"}</b><span>{Math.round(leader?.rating??0)} ELO</span></div><div><small>活躍球員</small><b>{ranked.length}</b><span>公開排名</span></div><div><small>本月比賽</small><b>{month}</b><span>已確認賽果</span></div></section>
    {ranked.length>0&&<section className="visual-grid" aria-label="排行榜圖表"><div className="chart-card"><div className="chart-head"><div><p className="kicker">實力分布</p><h2>ELO 分布</h2></div><span>最高與最低相差 {Math.round(maxRating-minRating)} ELO</span></div><div className="bar-chart">{ranked.map((p,i)=><button key={p.id} onClick={()=>onPlayer(p)} aria-label={`${p.name}，${Math.round(p.rating)} ELO`}><span><i>{i+1}</i>{p.name}</span><em><i style={{width:`${18+(p.rating-minRating)/range*82}%`}}/></em><b>{Math.round(p.rating)}</b></button>)}</div><p className="chart-summary">目前由 {leader.name} 領先；圖表長度顯示各球員相對於榜內最低 ELO 的位置。</p></div>
      <div className="chart-card suggested-chart"><div className="chart-head"><div><p className="kicker">讓分校準</p><h2>建議評分分布</h2></div><span>數字越低代表越強</span></div><div className="bar-chart">{suggestedValues.map(({p,value},i)=><button key={p.id} onClick={()=>onPlayer(p)} aria-label={`${p.name}，建議評分 ${Math.round(value)}`}><span><i>{i+1}</i>{p.name}</span><em><i style={{width:`${18+(suggestedMax-value)/suggestedRange*82}%`}}/></em><b>{Math.round(value)}</b></button>)}</div><p className="chart-summary">建議評分按相對 ELO 及非線性讓分曲線換算；較低分代表球員較強。</p></div>
      <div className="chart-card momentum"><div className="chart-head"><div><p className="kicker">升跌動能</p><h2>近期 ELO 變化</h2></div><div className="mini-toggle"><button className={momentum===1?"active":""} onClick={()=>setMomentum(1)}>最近一場</button><button className={momentum===5?"active":""} onClick={()=>setMomentum(5)}>最近五場</button></div></div><div className="momentum-chart">{ranked.map(p=>{const delta=recentDelta(p,data,momentum),width=Math.min(50,Math.abs(delta));return <div key={p.id}><span>{p.short}</span><em className={delta<0?"negative-bar":"positive-bar"} style={{width:`${width}%`,marginLeft:delta>=0?"50%":`${50-width}%`}}/><b className={delta>=0?"positive":"negative"}>{delta>=0?"+":""}{Math.round(delta)}</b></div>})}</div><p className="chart-summary">右方代表上升、左方代表下降；數字保留正負號，無需只依靠顏色判讀。</p></div></section>}
    <section className="section-title"><div><p className="kicker">即時更新</p><h2>目前排名</h2></div><span className="pill">● 公開</span></section>
    <SortControls sort={sort} dir={dir} onSort={sortBy}/>
    <div className="table-card">{ranked.length===0?<Empty text="尚未有球員" sub="前往球員頁面新增第一位球員。"/>:<><div className="table-head sortable"><button onClick={()=>sortBy("rank")}>排名<SortArrow active={sort==="rank"} dir={dir}/></button><button onClick={()=>sortBy("name")}>球員<SortArrow active={sort==="name"} dir={dir}/></button><button title="最近五筆比賽；較近期結果權重較高" onClick={()=>sortBy("form")}>近況<SortArrow active={sort==="form"} dir={dir}/></button><button onClick={()=>sortBy("winRate")}>場數／勝率<SortArrow active={sort==="winRate"} dir={dir}/></button><button onClick={()=>sortBy("suggested")}>建議／正式評分<SortArrow active={sort==="suggested"} dir={dir}/></button><button onClick={()=>sortBy("rating")}>ELO<SortArrow active={sort==="rating"} dir={dir}/></button></div>
      {shown.map(p=>{const rank=rankOf.get(p.id)??0;return <button className={`row ${rank===1?"top":""}`} key={p.id} onClick={()=>onPlayer(p)}>
        <span className="rank">{rank===1?"♛":rank}</span><span className="person"><i>{p.short}</i><b>{p.name}<small>{games(p)<data.settings.provisionalGames?"臨時評分":"正式評分"}</small></b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{games(p)} 場<small>{games(p)?Math.round(p.wins/games(p)*100):0}% 勝率</small></span><span className="dual-rating"><b>{Math.round(suggestedHandicap(p,data))}<em>建議</em></b><small>正式 {p.handicap==null?"—":p.handicap}</small></span>
        <span className="elo"><b>{Math.round(p.rating)}</b><small className={p.lastChange>=0?"positive":"negative"}>{p.lastChange>=0?"+":""}{Math.round(p.lastChange)}</small></span></button>})}</>}</div></>;
}

function Matches({data,onVoid}:{data:AppState;onVoid:(m:Match)=>void}) {
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  return <><section className="hero small"><div><p className="kicker">完整可追溯</p><h1>比賽紀錄</h1><p>查看比分、讓分與每場 ELO 變化。</p></div></section>
    <div className="filters"><input placeholder="搜尋球員…" /><input type="date"/><select><option>所有賽事</option><option>已確認</option></select></div>
    <div className="match-list">{data.matches.length===0?<Empty text="尚未有比賽紀錄" sub="記錄第一場比賽後，詳情會顯示在這裡。"/>:data.matches.map(m=>
      <article className={`match ${m.status}`} key={m.id}><div><span><span className="pill">{m.status==="void"?"已作廢":"已確認"}</span> <span className="pill muted">{m.entryMode==="aggregate"?"歷史匯總":"單場"}</span></span><small>{m.playedOn}</small></div>
        <h3>{name(m.a)} <b>{m.scoreA}–{m.scoreB}</b> {name(m.b)}</h3>
        <p><Term label="實際讓分" tip="該筆比賽雙方真正採用的每局讓分；它會影響賽前預期及 ELO 變化。"/> {m.actual>0?`${name(m.a)} 讓 ${m.actual}`:m.actual<0?`${name(m.b)} 讓 ${Math.abs(m.actual)}`:"無"} · <Term label="額外讓分" tip="實際讓分與正式讓分參考之間的差距；正式讓分缺失時以 0 作比較基準。"/> {m.extra}</p>
        <div className="delta"><span>{Math.round(m.beforeA)} → {Math.round(m.afterA)} <b>{m.deltaA>=0?"+":""}{Math.round(m.deltaA)}</b></span><span>預測 A 勝率 {Math.round(m.expectedA*100)}%</span></div>
        <button className="danger-link" onClick={()=>onVoid(m)}>刪除賽事</button></article>)}</div></>;
}

function Players({data,onAdd,onEdit,onDelete,onOpen}:{data:AppState;onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[view,setView]=useState<"cards"|"list">("cards");
  const ranked=[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),shown=sortPlayers(data.players,data,sort,dir),rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  return <><section className="hero small"><div><p className="kicker">球會名單</p><h1>球員</h1><p>管理職員提供的正式評分，並比較 ELO 建議評分。</p></div><button className="primary" onClick={onAdd}>＋ 新增球員</button></section>
    <div className="player-toolbar"><SortControls sort={sort} dir={dir} onSort={sortBy}/><div className="view-toggle" aria-label="顯示模式"><button className={view==="cards"?"active":""} onClick={()=>setView("cards")}>卡片</button><button className={view==="list"?"active":""} onClick={()=>setView("list")}>列表</button></div></div>
    <div className={`player-grid ${view==="list"?"list-view":""}`}>{data.players.length===0?<Empty text="尚未有球員" sub="新增球員後便可開始記錄比賽。"/>:shown.map(p=>{const suggested=suggestedHandicap(p,data),difference=p.handicap==null?null:suggested-p.handicap;return <article className="player-card rich" key={p.id}><button className="profile-hit" onClick={()=>onOpen(p)}><i>{p.short}</i><div className="player-main"><div><small>排名 #{rankOf.get(p.id)}</small><h3>{p.name}</h3><p><b>{Math.round(p.rating)}</b> ELO · {games(p)} 場 · {Math.round(winRate(p)*100)}% 勝率</p></div><Sparkline values={playerSeries(p,data)} label={`${p.name} ELO 趨勢`}/></div></button><div className="rating-compare"><span><small>正式評分</small><b>{p.handicap??"—"}</b></span><span><small>建議評分</small><b>{suggested==null?"—":Math.round(suggested)}</b></span><span><small>差異</small><b className={difference!=null&&difference>0?"positive":difference!=null&&difference<0?"negative":""}>{difference==null?"—":`${difference>0?"+":""}${Math.round(difference)}`}</b></span><span><small>局數勝率</small><b>{Math.round(frameRate(p)*100)}%</b></span></div><div className="player-card-foot"><span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span><div className="player-actions"><button className="more" onClick={()=>onEdit(p)}>編輯</button><button className="danger-link static" onClick={()=>onDelete(p)}>刪除</button></div></div></article>})}</div></>;
}

function SettingsView({data,onEdit,onReset}:{data:AppState;onEdit:()=>void;onReset:()=>void}) {
  const s=data.settings,c=s.calibration; return <><section className="hero small"><div><p className="kicker">公開設定</p><h1>ELO 設定</h1><p>實際讓分直接影響 ELO；正式讓分只作參考。</p></div><button className="primary" onClick={onEdit}>編輯設定</button></section>
    <div className="settings-grid"><div className="setting"><small><Term label="起始 ELO" tip="球員加入時的評分起點；個別球員可另行設定，修改後會重播歷史賽果。"/></small><b>{s.start}</b></div><div className="setting"><small><Term label="臨時門檻" tip="球員完成此數量的比賽前會標示為臨時評分，並使用較大的臨時 K 值。"/></small><b>{s.provisionalGames} 場</b></div><div className="setting"><small><Term label="K 值" tip="控制每次賽果令 ELO 改變多少；數值越高，評分調整越快。"/></small><b>{s.kProvisional} / {s.kRated}</b></div><div className="setting"><small><Term label="持續校準換算率" tip="10 分附近每 1 分實際讓分相當於多少 ELO；會按累積賽果逐步重新估算。"/></small><b>{s.conversion} ELO／分</b></div><div className="setting"><small><Term label="讓分曲線" tip="大讓分難度的非線性增幅；1 為線性，數值越高，20、40、100 分的難度上升越快。"/></small><b>{s.curvature??1.25}</b></div><div className="setting"><small><Term label="軟上限" tip="用平滑曲線限制極端讓分的等效 ELO；額外讓分仍有影響，但不會無限增長。"/></small><b>±{s.handicapSoftCap??800} ELO</b></div><div className="setting"><small><Term label="勝者獎勵" tip="勝方加入的虛擬局數；預設半局，使 3–2 略優於 3–3，但不會出現巨大跳升。"/></small><b>{s.winnerBonus??.5} 局</b></div><div className="setting"><small><Term label="超額讓分加乘" tip="球員承受比雙方 ELO 公平線更艱難的讓分，仍打和或勝出時，額外放大其 ELO 回報；不利程度越高，加乘越大。"/></small><b>最高 +{Math.round((s.overHandicapBoost??.75)*100)}%</b></div><div className="setting"><small><Term label="加乘尺度" tip="控制超額讓分加乘增長速度；數值越小，加乘越快接近上限。"/></small><b>{s.overHandicapScale??200} ELO</b></div></div>
    <section className="calibration-card"><div><p className="kicker">每場自動更新</p><h2><Term label="讓分換算持續學習" tip="每次賽果變動後，同時估計 10 分附近的 ELO 換算率與大讓分的非線性曲線。"/></h2><p>目前每讓 1 分約等於 <b>{s.conversion} ELO</b>，曲線為 <b>{s.curvature??1.25}</b>。系統比較預測與真實局數比例，最多採計每筆 20 局；正式讓分不參與計算。</p>{c?.history&&c.history.length>1&&<small className="calibration-history">最近校準：{c.history.slice(-5).map(x=>x.estimate).join(" → ")} ELO／分</small>}</div><div className="calibration-stats"><span><small><Term label="可用紀錄" tip="具備有效局數、賽前 ELO，而且實際讓分不為 0 的紀錄數量。"/></small><b>{c?.usableMatches??0}</b></span><span><small><Term label="實際讓分種類" tip="歷史資料出現過多少種不同的非零實際讓分數值；例如 4、8、12 分代表 3 種。"/></small><b>{c?.handicapLevels??0}</b></span><span><small><Term label="信心" tip="按可用紀錄數及實際讓分種類評估校準可靠程度。"/></small><b>{c?.confidence??"資料不足"}</b></span><span><small><Term label="換算率範圍" tip="與最佳估算表現接近的一段 ELO／分換算率。"/></small><b>{c?`${c.lower}–${c.upper}`:"—"}</b></span><span><small><Term label="曲線範圍" tip="數據支持的非線性曲線範圍；資料不足時會保持接近 1.25。"/></small><b>{c?.curvatureLower!=null?`${c.curvatureLower}–${c.curvatureUpper}`:"—"}</b></span></div></section>
    {c?.history&&c.history.length>1&&<section className="trend-card"><div className="chart-head"><div><p className="kicker">模型演變</p><h2>換算率校準趨勢</h2></div><span>{c.history.length} 次更新</span></div><LineChart values={c.history.map(x=>x.estimate)} label="每次校準後的 ELO／分估算" lower={c.lower} upper={c.upper}/><p className="chart-summary">最近由 {c.history[0].estimate} 變至 {c.history.at(-1)?.estimate} ELO／分；目前合理範圍為 {c.lower}–{c.upper}。</p></section>}
    <section className="audit"><h2>審計紀錄</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString("zh-HK")}</small></div>)}</section>
    <section className="danger-zone"><div><h2>清除並重設資料</h2><p>永久刪除共用資料庫內所有球員、比賽及審計紀錄，並恢復預設 ELO 設定。</p></div><button onClick={onReset}>清除所有資料</button></section></>;
}

function MatchForm({data,draft,setDraft,preview,a,b,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;onSave:()=>void}) {
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  const fairActual=preview?eloToHandicap(a.rating-b.rating,data.settings):null;
  const probabilities=preview?matchProbabilities(preview.expectedA,+draft.scoreA+ +draft.scoreB):null;
  const applyFair=()=>{
    if(fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.round(Math.abs(fairActual))}));
  };
  return <><p className="kicker">快速記錄</p><h2>記錄比賽</h2><p className="sub">自由賽制，只需輸入最終局數；同分即為和局。</p>
    {data.players.length<2&&<p className="warning">請先新增至少兩位活躍球員。</p>}
    <div className="entry-mode" role="group" aria-label="紀錄類型"><button type="button" className={(draft.mode??"match")==="match"?"active":""} onClick={()=>update("mode","match")}><b>單場比賽</b><small>一場比賽的最終局數</small></button><button type="button" className={draft.mode==="aggregate"?"active":""} onClick={()=>update("mode","aggregate")}><b>歷史匯總</b><small>同一對手多場局數合計</small></button></div>
    {draft.mode==="aggregate"&&<p className="aggregate-note">匯總會以同一個賽前 ELO 基準計算。例：70–70 為中性局數證據，不會因輸入次序造成偏差。</p>}
    <div className="step-label"><b>1</b> 球員與日期</div><div className="two"><label>球員 A<select value={draft.a} onChange={e=>update("a",e.target.value)}>{data.players.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>球員 B<select value={draft.b} onChange={e=>update("b",e.target.value)}>{data.players.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label></div>
    <label>比賽日期<input type="date" value={draft.date} onChange={e=>update("date",e.target.value)}/></label>
    <div className="step-label"><b>2</b> <Term label="實際讓分" tip="雙方在這筆比賽真正採用的每局讓分，不需要跟正式讓分相同。"/></div>{fairActual!=null&&<div className="fair-tip"><div><small><Term label="ELO 建議公平讓分" tip="按目前 ELO 差及持續校準換算率反推，令雙方預測局數比例接近 50／50 的讓分。"/></small><b>{fairActual>=0?a.name:b.name} 讓 {Math.round(Math.abs(fairActual))} 分</b><span>套用後預測勝率接近 50／50</span></div><button type="button" onClick={applyFair}>套用建議</button></div>}<div className="two"><label>讓分提供者<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">沒有讓分</option><option value={a?.id}>{a?.name}</option><option value={b?.id}>{b?.name}</option></select></label><label>每局讓分<input type="number" min="0" step="1" value={draft.points} onChange={e=>update("points",+e.target.value)}/></label></div>
    <div className="step-label"><b>3</b> 最終比分</div><div className="score-input"><label>{a?.short}<input type="number" min="0" value={draft.scoreA} onChange={e=>update("scoreA",+e.target.value)}/></label><strong>–</strong><label>{b?.short}<input type="number" min="0" value={draft.scoreB} onChange={e=>update("scoreB",+e.target.value)}/></label></div>
    {preview&&<div className="preview"><div><small>{a.name}</small><b>{Math.round(a.rating)} <em className={preview.deltaA>=0?"positive":"negative"}>{preview.deltaA>=0?"+":""}{Math.round(preview.deltaA)}</em></b></div><div><small><Term label="預測局數比例" tip="非線性計入雙方賽前 ELO 與實際讓分後，預測球員 A／B 應取得的局數比例。"/></small><b>{Math.round(preview.expectedA*100)}% / {Math.round((1-preview.expectedA)*100)}%</b>{draft.mode!=="aggregate"&&probabilities&&<small>A 勝 {Math.round(probabilities.win*100)}% · 和 {Math.round(probabilities.draw*100)}%</small>}</div><div><small>{b.name}</small><b>{Math.round(b.rating)} <em className={preview.deltaA<=0?"positive":"negative"}>{-preview.deltaA>=0?"+":""}{Math.round(-preview.deltaA)}</em></b></div><p>{draft.mode==="aggregate"?"歷史匯總":"單場"} · 表現分 {Math.round(preview.performanceScore*100)}% · 證據權重 ×{preview.evidenceWeight.toFixed(2)} · 讓分等效 {preview.adjustment>=0?"+":""}{Math.round(preview.adjustment)} ELO{preview.overHandicapMultiplier>1.001?` · 超額難度 ${Math.round(preview.overHandicapElo)} ELO · 表現加乘 ×${preview.overHandicapMultiplier.toFixed(2)}`:""} · 曲線 {data.settings.curvature??1.25} · 換算率 {data.settings.conversion} ELO／分</p></div>}
    <button className="primary full" disabled={data.players.length<2} onClick={onSave}>確認並更新 ELO</button></>;
}

function PlayerForm({form,setForm,editing,onSave}:{form:any;setForm:any;editing:boolean;onSave:()=>void}) { const u=(k:string,v:string)=>setForm((f:any)=>({...f,[k]:v}));return <><p className="kicker">公開管理</p><h2>{editing?"編輯球員":"新增球員"}</h2><p className="sub">{editing?"修改起始 ELO 後，系統會按剩餘賽事完整重播評分及近況。":"起始 ELO 留空時使用群組預設值。"}</p><label>顯示名稱<input value={form.name} onChange={e=>u("name",e.target.value)}/></label><label>短名稱／縮寫<input maxLength={3} value={form.short} onChange={e=>u("short",e.target.value)}/></label><label className="initial-elo-field">球員起始 ELO（可編輯）<input data-testid="player-initial-elo" type="number" inputMode="numeric" placeholder="例如 1500" value={form.rating} onChange={e=>u("rating",e.target.value)}/><small>{editing?"儲存後會重算此球員及受影響賽事。":"留空則使用群組預設起始 ELO。"}</small></label><label>正式讓分<input type="number" step="2" value={form.handicap} onChange={e=>u("handicap",e.target.value)}/></label><button className="primary full" onClick={onSave}>{editing?"儲存並重播":"新增球員"}</button></>}
function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) { const [s,setS]=useState(data.settings);const field=(k:"start"|"provisionalGames"|"kProvisional"|"kRated"|"conversion"|"curvature"|"handicapSoftCap"|"winnerBonus"|"overHandicapBoost"|"overHandicapScale",label:string,step=1)=><label>{label}<input type="number" step={step} value={s[k]??""} onChange={e=>setS({...s,[k]:+e.target.value})}/></label>;return <><p className="kicker">公開管理</p><h2>編輯 ELO 設定</h2><p className="warning">任何人都可修改。儲存後會以新規則重播全部歷史評分。</p><div className="two">{field("start","起始 ELO")}{field("provisionalGames","臨時門檻")}{field("kProvisional","臨時 K")}{field("kRated","正式 K")}{field("conversion","10 分附近每點換算",.25)}{field("curvature","非線性讓分曲線",.01)}{field("handicapSoftCap","讓分等效 ELO 軟上限")}{field("winnerBonus","勝者虛擬局數",.1)}{field("overHandicapBoost","超額讓分最高加乘",.05)}{field("overHandicapScale","超額讓分加乘尺度")}</div><button className="primary full" onClick={()=>confirm("確定更新並重播全部歷史 ELO？")&&onSave(s)}>儲存並重播</button></>}
function PlayerDetail({player,rank,data}:{player:Player;rank:number;data:AppState}) { const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data),series=playerSeries(player,data),high=Math.max(...series),low=Math.min(...series);return <><div className="profile-head"><i>{player.short}</i><div><p className="kicker">排名 #{rank||"—"}</p><h2>{player.name}</h2><p>{g<data.settings.provisionalGames?"臨時 ELO":"正式 ELO"}</p></div></div><div className="profile-stats"><div><small>目前 ELO</small><b>{Math.round(player.rating)}</b></div><div><small>正式讓分評分</small><b>{player.handicap??"未提供"}</b></div><div><small>ELO 建議評分</small><b>{suggested==null?"未提供":Math.round(suggested)}</b></div><div><small>勝／負／和</small><b>{player.wins}/{player.losses}/{player.draws}</b></div></div><section className="detail-chart"><div className="chart-head"><div><p className="kicker">完整歷史</p><h3>ELO 走勢</h3></div><span>最高 {Math.round(high)} · 最低 {Math.round(low)}</span></div><LineChart values={series} label={`${player.name} 從起始評分至目前的 ELO 走勢`}/><div className="chart-axis"><span>起始 {Math.round(series[0])}</span><span>目前 {Math.round(player.rating)}</span></div></section><h3>表現摘要</h3><p className="summary">{player.name} 目前為 {Math.round(player.rating)} ELO，最近五場錄得 {player.form.filter(x=>x==="W").length} 勝、{player.form.filter(x=>x==="L").length} 負、{player.form.filter(x=>x==="D").length} 和；局數勝率為 {Math.round(frameRate(player)*100)}%。ELO 曾介乎 {Math.round(low)} 至 {Math.round(high)}，共有 {related.length} 筆可追溯賽事紀錄。</p></>}
function SortControls({sort,dir,onSort}:{sort:SortKey;dir:"asc"|"desc";onSort:(key:SortKey)=>void}){return <div className="sort-controls"><label>排序<select value={sort} onChange={e=>onSort(e.target.value as SortKey)}>{(Object.keys(sortLabels) as SortKey[]).map(k=><option key={k} value={k}>{sortLabels[k]}</option>)}</select></label><button aria-label={dir==="asc"?"目前升序，切換為降序":"目前降序，切換為升序"} onClick={()=>onSort(sort)}>{dir==="asc"?"↑ 升序":"↓ 降序"}</button></div>}
function SortArrow({active,dir}:{active:boolean;dir:"asc"|"desc"}){return <i className={`sort-arrow ${active?"active":""}`} aria-hidden="true">{active?(dir==="asc"?"↑":"↓"):"↕"}</i>}
function Sparkline({values,label}:{values:number[];label:string}){const min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min),points=values.map((v,i)=>`${values.length===1?50:i/(values.length-1)*100},${28-(v-min)/range*24}`).join(" ");return <svg className="sparkline" viewBox="0 0 100 32" role="img" aria-label={`${label}；由 ${Math.round(values[0])} 至 ${Math.round(values.at(-1)??values[0])}`}><polyline points={points}/><circle cx={values.length===1?50:100} cy={28-((values.at(-1)??min)-min)/range*24} r="2.5"/></svg>}
function LineChart({values,label,lower,upper}:{values:number[];label:string;lower?:number;upper?:number}){const all=[...values,...(lower==null?[]:[lower]),...(upper==null?[]:[upper])],min=Math.min(...all),max=Math.max(...all),range=Math.max(1,max-min),x=(i:number)=>values.length===1?50:4+i/(values.length-1)*92,y=(v:number)=>56-(v-min)/range*48,points=values.map((v,i)=>`${x(i)},${y(v)}`).join(" ");return <svg className="line-chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={`${label}；最低 ${Math.round(min*100)/100}，最高 ${Math.round(max*100)/100}`}><line x1="4" y1="56" x2="96" y2="56" className="grid-line"/>{lower!=null&&upper!=null&&<rect x="4" y={y(upper)} width="92" height={Math.max(1,y(lower)-y(upper))} className="confidence-band"/>}<polyline points={points}/>{values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r="1.5"><title>{Math.round(v*100)/100}</title></circle>)}</svg>}
function Empty({text,sub}:{text:string;sub:string}){return <div className="empty"><b>○</b><h3>{text}</h3><p>{sub}</p></div>}
function Term({label,tip}:{label:string;tip:string}){return <span className="term" tabIndex={0} aria-label={`${label}：${tip}`}>{label}<i aria-hidden="true">ⓘ</i><span className="term-tip" role="tooltip">{tip}</span></span>}
