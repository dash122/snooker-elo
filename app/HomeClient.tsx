"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalibrationTrend, DEFAULT_AVATAR, Empty, InteractiveEloChart, PlayerForm, RecentMatches, Scoreline, SortArrow, SortControls, Sparkline, Term, avatarStyle, sortLabels, type EloTrendPoint, type SortKey } from "./UiBits";

type Player = {
  id: string; name: string; short: string; handicap: number | null; rating: number; colour?: string;
  initialRating: number; active: boolean; wins: number; losses: number; draws: number;
  framesWon: number; framesLost: number; lastChange: number; form: string[];
};
type Match = {
  id: string; a: string; b: string; scoreA: number; scoreB: number; playedOn: string;
  entryMode?: "match" | "aggregate"; frameEvidence?: number; performanceScore?:number; evidenceWeight?:number; handicapAdjustment?:number; overHandicapElo?:number; overHandicapMultiplier?:number;
  highBreaks?: { playerId: string; value: number }[];
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
function winRate(p:Player){return games(p)?p.wins/games(p):0}
function frameRate(p:Player){const total=p.framesWon+p.framesLost;return total?p.framesWon/total:0}
function formScore(p:Player){return p.form.reduce((sum,x,i)=>sum+(x==="W"?1:x==="D"?.5:0)*(5-i),0)}
function sortPlayers(players:Player[],data:AppState,key:SortKey,dir:"asc"|"desc"){
  const ranks=new Map([...players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)).map((p,i)=>[p.id,i+1]));
  const value=(p:Player):number|string|null=>key==="rank"?ranks.get(p.id)??999:key==="name"?p.name:key==="rating"?p.rating:key==="change"?recentDelta(p,data,5):key==="form"?formScore(p):key==="official"?p.handicap:key==="suggested"?suggestedHandicap(p,data):key==="games"?games(p):key==="winRate"?winRate(p):frameRate(p);
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
function playerTrendPoints(p:Player,data:AppState):EloTrendPoint[]{
  const related=[...data.matches].filter(m=>m.status==="confirmed"&&(m.a===p.id||m.b===p.id)).sort((a,b)=>(a.playedOn||a.createdAt).localeCompare(b.playedOn||b.createdAt)||a.createdAt.localeCompare(b.createdAt));
  const start:EloTrendPoint={id:`${p.id}-start`,elo:p.initialRating,before:p.initialRating,delta:0,date:"",opponent:"",opponentShort:"",score:"",result:"start"};
  return [start,...related.map(match=>{
    const isA=match.a===p.id,opponent=data.players.find(player=>player.id===(isA?match.b:match.a));
    const ownScore=isA?match.scoreA:match.scoreB,opponentScore=isA?match.scoreB:match.scoreA;
    const before=isA?match.beforeA:match.beforeB,elo=isA?match.afterA:match.afterB,delta=elo-before;
    return {id:match.id,elo,before,delta,date:match.playedOn,opponent:opponent?.name??"已移除球員",opponentShort:opponent?.short??"—",score:`${ownScore}–${opponentScore}`,result:ownScore===opponentScore?"D":ownScore>opponentScore?"W":"L"} satisfies EloTrendPoint;
  })];
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
// Module scope, not render: reading the clock during render is impure.
const thirtyDaysAgo = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
// Ink-symmetric chevron: the path bounding box is centred on the viewBox, so the
// glyph stays centred in its circle both closed and rotated 180° when open.
const chevron = <i aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.6 4.25 6 7.75 9.4 4.25"/></svg></i>;

export default function Home() {
  const [data,setData] = useState<AppState>(seed);
  const [tab,setTab] = useState("leaderboard");
  const [matchesView,setMatchesView] = useState<"history"|"headToHead">("history");
  const [headToHead,setHeadToHead] = useState({a:"",b:""});
  const [modal,setModal] = useState<"match"|"player"|"settings"|"detail"|"deleteMatch"|null>(null);
  const [detail,setDetail] = useState<Player|null>(null);
  const [editingPlayer,setEditingPlayer] = useState<Player|null>(null);
  const [editingMatch,setEditingMatch] = useState<Match|null>(null);
  const [deletingMatch,setDeletingMatch] = useState<Match|null>(null);
  const [toast,setToast] = useState("");
  const [undoSnapshot,setUndoSnapshot] = useState<AppState|null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [saving,setSaving] = useState(false);
  const [draft,setDraft] = useState({a:"",b:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[] as {playerId:string;value:number}[]});
  const [playerForm,setPlayerForm] = useState({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});

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
      const sorted=[...data.players].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,"zh-HK"));
      return {...d,a:sorted[0]?.id??"",b:sorted[1]?.id??"",giver:""};
    });
  },[data.players]);

  // `undo` holds the pre-change snapshot; while the toast is on screen it can be persisted back.
  async function persist(next:AppState,message:string,undo?:AppState) {
    setData(next); setSaving(true);
    if(toastTimer.current) clearTimeout(toastTimer.current);
    let restorable=false;
    try {
      const r=await fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(next)});
      if(!r.ok) throw new Error();
      setToast(message); restorable=Boolean(undo);
    } catch { setToast("未能連接伺服器；資料仍保留在此畫面，請稍後再試。"); }
    finally {
      setSaving(false);
      setUndoSnapshot(restorable?undo??null:null);
      toastTimer.current=setTimeout(()=>{setToast("");setUndoSnapshot(null)},restorable?8000:3200);
    }
  }
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current)},[]);

  async function resetAll(){
    const typed=prompt("此操作會永久刪除所有球員、比賽及審計記錄。請輸入 RESET 繼續：");
    if(typed!=="RESET")return;
    if(!confirm("最後確認：清除並重設所有共用資料？此操作無法復原。"))return;
    setSaving(true);
    try{
      const response=await fetch("/api/state",{method:"DELETE"});
      if(!response.ok)throw new Error();
      const fresh=await response.json();
      setData(fresh);
      localStorage.removeItem("scaa-draft");
      setDraft({a:"",b:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[]});
      setToast("所有共用資料已清除並重設。");
    }catch{setToast("重設失敗，資料沒有被清除。請稍後再試。");}
    finally{setSaving(false);setUndoSnapshot(null);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3200);}
  }

  const ranked=useMemo(()=>[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),[data]);
  const a=data.players.find(p=>p.id===draft.a)??data.players[0];
  const b=data.players.find(p=>p.id===draft.b)??data.players[1];
  const preview=a&&b&&a.id!==b.id?calc(a,b,+draft.scoreA,+draft.scoreB,draft.giver,+draft.points,data.settings):null;
  const openHeadToHead=(player:Player,selectedOpponent?:Player)=>{
    const opponent=selectedOpponent??data.players.find(candidate=>candidate.id!==player.id&&candidate.active)??data.players.find(candidate=>candidate.id!==player.id);
    setHeadToHead({a:player.id,b:opponent?.id??""});
    setMatchesView("headToHead");
    setTab("matches");
  };

  function saveMatch(){
    if(!a||!b||a.id===b.id||draft.scoreA<0||draft.scoreB<0||(+draft.scoreA+ +draft.scoreB)===0){setToast("請選擇兩位不同球員，比分總局數必須大於 0。");return;}
    if(!preview)return;
    const now=new Date().toISOString(), id=editingMatch?.id??crypto.randomUUID();
    const match:Match={id,a:a.id,b:b.id,scoreA:+draft.scoreA,scoreB:+draft.scoreB,playedOn:draft.date||today,
      actual:preview.actual,giver:draft.giver||null,official:preview.official,extra:preview.extra,expectedA:preview.expectedA,
      beforeA:a.rating,beforeB:b.rating,afterA:a.rating+preview.deltaA,afterB:b.rating-preview.deltaA,deltaA:preview.deltaA,
      entryMode:"match",highBreaks:(draft.highBreaks??[]).filter((item:{playerId:string;value:number})=>(item.playerId===a.id||item.playerId===b.id)&&item.value>0&&item.value<=147),
      frameEvidence:preview.frameEvidence,performanceScore:preview.performanceScore,evidenceWeight:preview.evidenceWeight,handicapAdjustment:preview.adjustment,overHandicapElo:preview.overHandicapElo,overHandicapMultiplier:preview.overHandicapMultiplier,status:"confirmed",createdAt:editingMatch?.createdAt??now};
    const resultA=draft.scoreA===draft.scoreB?"D":draft.scoreA>draft.scoreB?"W":"L";
    const resultB=resultA==="D"?"D":resultA==="W"?"L":"W";
    const players=data.players.map(p=>{
      if(p.id!==a.id&&p.id!==b.id)return p;
      const isA=p.id===a.id,result=isA?resultA:resultB,delta=isA?preview.deltaA:-preview.deltaA;
      return {...p,rating:p.rating+delta,lastChange:delta,wins:p.wins+(result==="W"?1:0),losses:p.losses+(result==="L"?1:0),
        draws:p.draws+(result==="D"?1:0),framesWon:p.framesWon+(isA?+draft.scoreA:+draft.scoreB),
        framesLost:p.framesLost+(isA?+draft.scoreB:+draft.scoreA),form:[result,...p.form].slice(0,5)};
    });
    const matches=editingMatch
      ? data.matches.map(existing=>existing.id===editingMatch.id?match:existing)
      : [match,...data.matches];
    const settings=recalibrate(data.settings,matches);
    const rebuilt=replay(data.players,matches,settings);
    const action=editingMatch?"編輯":"記錄";
    const next={...data,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}賽果：${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}；重播歷史 ELO`,at:now},...data.audits]};
    localStorage.removeItem("scaa-draft"); setEditingMatch(null); setModal(null); persist(next,editingMatch?"賽事已更新，所有後續 ELO 已重建。":"賽果已儲存，雙方 ELO 已更新。");
  }

  function editMatch(m:Match){
    setEditingMatch(m);
    setDraft({
      a:m.a,b:m.b,scoreA:m.scoreA,scoreB:m.scoreB,
      date:m.playedOn,giver:m.actual>0?m.a:m.actual<0?m.b:"",points:Math.abs(m.actual),highBreaks:m.highBreaks??[]
    });
    setModal("match");
  }

  function newMatch(){
    setEditingMatch(null);
    const sorted=[...data.players].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,"zh-HK"));
    setDraft({
      a:sorted[0]?.id??"",b:sorted[1]?.id??"",
      scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[]
    });
    setModal("match");
  }

  function savePlayer(){
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast("請輸入顯示名稱及縮寫。");return;}
    const rating=playerForm.rating?+playerForm.rating:data.settings.start;
    const p:Player=editingPlayer
      ? {...editingPlayer,name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),handicap:playerForm.handicap===""?null:+playerForm.handicap,initialRating:rating,colour:playerForm.colour||DEFAULT_AVATAR}
      : {id:crypto.randomUUID(),name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),colour:playerForm.colour||DEFAULT_AVATAR,
        handicap:playerForm.handicap===""?null:+playerForm.handicap,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,
        framesWon:0,framesLost:0,lastChange:0,form:[]};
    const action=editingPlayer?"編輯":"新增";
    const players=editingPlayer?data.players.map(x=>x.id===p.id?p:x):[...data.players,p];
    const rebuilt=editingPlayer?replay(players,data.matches,data.settings):{players,matches:data.matches};
    const next={...data,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}球員：${p.name}${editingPlayer?"；重播歷史評分":""}`,at:new Date().toISOString()},...data.audits]};
    setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal(null);persist(next,editingPlayer?"球員資料已更新。":"球員已新增。");
  }

  function editPlayer(p:Player){
    setEditingPlayer(p);
    setPlayerForm({name:p.name,short:p.short,handicap:p.handicap==null?"":String(p.handicap),rating:String(Math.round(p.initialRating)),colour:p.colour||DEFAULT_AVATAR});
    setModal("player");
  }

  function deletePlayer(p:Player){
    const hasHistory=data.matches.some(m=>m.a===p.id||m.b===p.id);
    if(!confirm(`永久刪除 ${p.name}？${hasHistory?"歷史賽事會保留並顯示為「已刪除球員」。":""}此操作無法復原。`))return;
    const next={...data,players:data.players.filter(x=>x.id!==p.id),
      audits:[{id:crypto.randomUUID(),text:`永久刪除球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
    persist(next,"球員已永久刪除。");
  }

  function closeModal(){ setModal(null); setDeletingMatch(null); }

  function requestDeleteMatch(m:Match){ setDeletingMatch(m); setModal("deleteMatch"); }

  function confirmDeleteMatch(){
    const m=deletingMatch;
    if(!m)return;
    const snapshot=data;
    const matches=data.matches.filter(x=>x.id!==m.id);
    const settings=recalibrate(data.settings,matches);
    const rebuilt=replay(data.players,matches,settings);
    const next={...data,settings,...rebuilt,
      audits:[{id:crypto.randomUUID(),text:`永久刪除賽事：${m.id.slice(0,8)}；重建評分及近況`,at:new Date().toISOString()},...data.audits]};
    setDeletingMatch(null); setModal(null);
    persist(next,"賽事已刪除，ELO、統計及近況已重建。",snapshot);
  }

  function undoDelete(){
    const snapshot=undoSnapshot;
    if(!snapshot)return;
    setUndoSnapshot(null);
    // Restore the exact pre-delete state, but keep the rewind itself traceable.
    persist({...snapshot,audits:[{id:crypto.randomUUID(),text:"復原已刪除的賽事；還原評分及近況",at:new Date().toISOString()},...snapshot.audits]},"已復原賽事，ELO 及統計已還原。");
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
      {tab==="leaderboard"&&<Leaderboard ranked={ranked} data={data} onRecord={newMatch} onPlayer={(p)=>{setDetail(p);setModal("detail")}}/>}
      {tab==="matches"&&<Matches data={data} onEdit={editMatch} onVoid={requestDeleteMatch} view={matchesView} setView={setMatchesView} pair={headToHead} setPair={setHeadToHead}/>}
      {tab==="players"&&<Players data={data} onAdd={()=>{setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal("player")}} onEdit={editPlayer} onDelete={deletePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}} onCompare={openHeadToHead}/>}
      {tab==="settings"&&<SettingsView data={data} onEdit={()=>setModal("settings")} onReset={resetAll}/>}
    </main>
    <nav className="bottom">{[["leaderboard","榜","◆"],["matches","比賽","◫"],["record","記錄","＋"],["players","球員","◎"],["settings","設定","⚙"]].map(([id,label,icon])=>
      <button key={id} className={tab===id?"active":""} onClick={()=>id==="record"?newMatch():setTab(id)}><i>{icon}</i><small>{label}</small></button>)}</nav>
    {modal&&<div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&closeModal()}>
      <section className={`sheet${modal==="deleteMatch"?" confirm-sheet":""}`} role="dialog" aria-modal="true"><button className="close" aria-label="關閉" onClick={closeModal}>×</button>
        {modal==="match"&&<MatchForm data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} editing={!!editingMatch} onSave={saveMatch}/>}
        {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} editing={!!editingPlayer} onSave={savePlayer}/>}
        {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{const applied={...settings,modelVersion:3},rebuilt=replay(data.players,data.matches,applied);setModal(null);persist({...data,settings:applied,...rebuilt,audits:[{id:crypto.randomUUID(),text:"更新 ELO 設定；完整重播歷史評分",at:new Date().toISOString()},...data.audits]},"設定已更新，歷史 ELO 已重播。")}}/>}
        {modal==="deleteMatch"&&deletingMatch&&<ConfirmDeleteMatch match={deletingMatch} data={data} onCancel={closeModal} onConfirm={confirmDeleteMatch}/>}
        {modal==="detail"&&detail&&<><PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data} onCompare={opponent=>{setModal(null);openHeadToHead(detail,opponent)}}/><button className="more profile-compare" onClick={()=>{setModal(null);openHeadToHead(detail)}}>查看所有對賽</button></>}
      </section></div>}
    {toast&&<div className="toast" role="status"><span>{toast}</span>{undoSnapshot&&<button type="button" onClick={undoDelete}>復原</button>}</div>}
  </div>;
}

/** Editorial highlights: the things a club member actually gossips about. */
function monthHighlights(data:AppState) {
  const month=today.slice(0,7);
  const confirmed=data.matches.filter(m=>m.status==="confirmed");
  const inMonth=confirmed.filter(m=>m.playedOn.slice(0,7)===month);
  const byId=new Map(data.players.map(p=>[p.id,p]));
  const played=new Map<string,number>();
  for(const m of inMonth) for(const id of [m.a,m.b]){
    if(!byId.has(id))continue;
    played.set(id,(played.get(id)??0)+1);
  }
  const pick=(source:Map<string,number>)=>[...source.entries()].sort((a,b)=>b[1]-a[1])[0];
  const busiest=pick(played);
  const breaks=inMonth.flatMap(m=>(m.highBreaks??[]).filter(x=>byId.has(x.playerId)).map(x=>({...x,at:m.playedOn})))
    .sort((a,b)=>b.value-a.value)[0];
  return {
    best:breaks?{player:byId.get(breaks.playerId)!,value:breaks.value}:null,
    busiest:busiest?{player:byId.get(busiest[0])!,value:busiest[1]}:null
  };
}

function Highlights({data,onPlayer}:{data:AppState;onPlayer:(p:Player)=>void}) {
  const h=useMemo(()=>monthHighlights(data),[data]);
  const cards=[
    h.best&&{key:"best",ball:"yellow",label:"本月最高單桿",player:h.best.player,value:String(h.best.value),unit:"分"},
    h.busiest&&{key:"busiest",ball:"green",label:"本月最活躍",player:h.busiest.player,value:String(h.busiest.value),unit:"場"}
  ].filter(Boolean) as {key:string;ball:string;label:string;player:Player;value:string;unit:string}[];
  if(!cards.length)return null;
  return <section className="highlights" aria-label="本月焦點">
    {cards.map(card=><button key={card.key} className={`highlight-card ball-${card.ball}`} onClick={()=>onPlayer(card.player)}>
      <small>{card.label}</small>
      <b>{card.value}<em>{card.unit}</em></b>
      <span><i style={avatarStyle(card.player.colour)}>{card.player.short}</i>{card.player.name}</span>
    </button>)}
  </section>;
}

/**
 * The three headline club stats used to live in their own full-width card
 * above the podium; folded in here as an inline strip so the leaderboard
 * reaches its actual content (the standings) sooner.
 */
function Overview({top,data,onPlayer,players,month,total}:{top:Player[];data:AppState;onPlayer:(p:Player)=>void;players:number;month:number;total:number}) {
  // DOM order is always rank order (1, 2, 3) so mobile — a vertical stack —
  // reads top to bottom correctly. The classic "winner in the middle" podium
  // look is applied with CSS `order` on the desktop 3-column layout only.
  return <section className="podium-section" aria-label="總覽及排名前三">
    <div className="podium-stats">
      <span><b>{players}</b><small>活躍球員</small></span>
      <span><b>{month}</b><small>本月比賽</small></span>
      <span><b>{total}</b><small>歷來總場數</small></span>
    </div>
    {top.length>=3&&<div className="podium">
      {top.map((player,index)=>{const place=index+1;return <button key={player.id} className={`podium-card place-${place}`} onClick={()=>onPlayer(player)}>
        <span className="podium-place">{place===1?"♛":place}</span>
        <i style={avatarStyle(player.colour)}>{player.short}</i>
        <h3>{player.name}</h3>
        <b>{Math.round(player.rating)}<em>ELO</em></b>
        <span className="form">{player.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <small>建議讓分 {Math.round(suggestedHandicap(player,data))}</small>
      </button>})}
    </div>}
  </section>;
}

function Leaderboard({ranked,data,onRecord,onPlayer}:{ranked:Player[];data:AppState;onRecord:()=>void;onPlayer:(p:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[breakView,setBreakView]=useState<"players"|"overall">("players");
  const leader=ranked[0],confirmed=data.matches.filter(m=>m.status==="confirmed");
  const month=confirmed.filter(m=>m.playedOn.slice(0,7)===today.slice(0,7)).length,total=confirmed.length;
  const shown=sortPlayers(ranked,data,sort,dir),rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  const ratings=ranked.map(p=>p.rating),minRating=Math.min(...ratings),maxRating=Math.max(...ratings),range=Math.max(1,maxRating-minRating);
  // Movement compares today's table against the standings 30 days ago. A single
  // match day is too small a window — most clubs play a handful of matches a
  // week, so it would leave nearly every arrow flat and tell the reader nothing.
  const movement=useMemo(()=>{
    const recent=confirmed.filter(m=>m.playedOn>thirtyDaysAgo);
    if(!recent.length)return {map:new Map<string,number>(),active:false};
    const before=data.players.map(p=>{
      const swing=recent.filter(m=>m.a===p.id||m.b===p.id)
        .reduce((sum,m)=>sum+(m.a===p.id?m.deltaA:-m.deltaA),0);
      return {id:p.id,rating:p.rating-swing,name:p.name};
    }).sort((a,b)=>b.rating-a.rating||a.name.localeCompare(b.name));
    const priorRank=new Map(before.map((p,i)=>[p.id,i+1]));
    return {map:new Map(ranked.map((p,i)=>[p.id,(priorRank.get(p.id)??i+1)-(i+1)])),active:true};
  },[confirmed,data.players,ranked]);
  const breakRecords=useMemo(()=>{
    const playerById=new Map(data.players.map(player=>[player.id,player]));
    const records=data.matches.flatMap(match=>match.status==="confirmed"?(match.highBreaks??[])
      .filter(item=>Number.isFinite(item.value)&&item.value>0&&item.value<=147&&playerById.has(item.playerId))
      .map((item,index)=>({player:playerById.get(item.playerId)!,opponent:playerById.get(match.a===item.playerId?match.b:match.a)?.name??"已移除球員",value:item.value,date:match.playedOn,createdAt:match.createdAt,key:`${match.id}-${index}`})):[])
      .sort((a,b)=>b.value-a.value||b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
    const seen=new Set<string>();
    return {overall:records.slice(0,10),players:records.filter(record=>seen.has(record.player.id)?false:(seen.add(record.player.id),true)).slice(0,10)};
  },[data.matches,data.players]);
  const displayedBreaks=breakRecords[breakView];
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  return <><section className="hero"><div><p className="kicker">SCAA CLUB RANKING</p><h1>讓每一局，<br/><span>都推動進步。</span></h1><p>追蹤實力、看見成長，找到旗鼓相當的下一位對手。</p></div><button className="primary hero-action" onClick={onRecord}><span aria-hidden="true">＋</span><b>記錄新賽果</b><small>更新排名與近期狀態</small></button></section>
    <Highlights data={data} onPlayer={onPlayer}/>
    <Overview top={ranked.slice(0,3)} data={data} onPlayer={onPlayer} players={ranked.length} month={month} total={total}/>
    {ranked.length>0&&<section className="visual-grid analytics-grid" aria-label="排行榜分析">
      <details className="analytics-card"><summary><span><small>實力分布</small><b>ELO／建議評分</b></span>{chevron}</summary><div className="analytics-content"><div className="chart-head"><span>ELO／建議評分<br/>柱長按 ELO 顯示</span></div><div className="bar-chart">{ranked.map((p,i)=>{const suggested=suggestedHandicap(p,data);return <button key={p.id} onClick={()=>onPlayer(p)} aria-label={`${p.name}，${Math.round(p.rating)} ELO，建議評分 ${Math.round(suggested)}`}><span><i>{i+1}</i>{p.name}</span><em><i style={{width:`${18+(p.rating-minRating)/range*82}%`}}/></em><b>{Math.round(p.rating)} / {Math.round(suggested)}</b></button>})}</div><p className="chart-summary">目前由 {leader.name} 領先；柱長按榜內 ELO 相對位置顯示，數字格式為 ELO／建議評分；建議評分越低代表球員越強。</p></div></details>
      <details className="analytics-card break-leaderboard"><summary><span><small>龍虎榜</small><b>最高單桿記錄</b></span>{chevron}</summary><div className="analytics-content"><div className="mini-toggle break-toggle" aria-label="龍虎榜顯示方式"><button aria-pressed={breakView==="players"} className={breakView==="players"?"active":""} onClick={()=>setBreakView("players")}>球員最高</button><button aria-pressed={breakView==="overall"} className={breakView==="overall"?"active":""} onClick={()=>setBreakView("overall")}>歷史最高</button></div><ol className="break-ranking">{Array.from({length:10},(_,index)=>{const record=displayedBreaks[index];const medal=["gold","silver","bronze"][index];return <li key={record?.key??`empty-${index}`} className={`${record?"":"empty-rank"}${medal?` medal medal-${medal}`:""}`}><span className="break-position">{medal?<i className="medal-icon" aria-hidden="true">{["🥇","🥈","🥉"][index]}</i>:index+1}</span>{record?<><i style={avatarStyle(record.player.colour)}>{record.player.short}</i><b><span>{record.player.name}</span><small>對 {record.opponent}<span className="break-date-inline"> · {record.date}</span></small></b><time dateTime={record.date}>{record.date}</time><strong>{record.value>=100&&<em className="century-badge" title="破百單桿">破百</em>}{record.value}</strong></>:<b>N/A</b>}</li>})}</ol><p className="chart-summary">{breakView==="players"?"每位球員只顯示其最高單桿。":"按所有已確認賽事的單桿記錄排名，同一球員可重複上榜。"}</p></div></details>
    </section>}
    <section className="section-title"><div><p className="kicker">即時競爭形勢</p><h2>目前排名</h2><p>每場結果都會即時反映在 ELO 與近期狀態。</p></div><span className="pill">● 已同步</span></section>
    <SortControls sort={sort} dir={dir} onSort={sortBy}/>
    <div className="table-card">{ranked.length===0?<Empty text="尚未有球員" sub="前往球員頁面新增第一位球員。"/>:<><div className="table-head sortable"><button title="箭嘴為較 30 天前的排名升跌" onClick={()=>sortBy("rank")}>排名<SortArrow active={sort==="rank"} dir={dir}/></button><button onClick={()=>sortBy("name")}>球員<SortArrow active={sort==="name"} dir={dir}/></button><button title="最近五筆比賽；較近期結果權重較高" onClick={()=>sortBy("form")}>近況<SortArrow active={sort==="form"} dir={dir}/></button><button onClick={()=>sortBy("winRate")}>場數／勝率<SortArrow active={sort==="winRate"} dir={dir}/></button><button onClick={()=>sortBy("suggested")}>建議／正式評分<SortArrow active={sort==="suggested"} dir={dir}/></button><button title="ELO 及近五場淨變化" onClick={()=>sortBy("rating")}>ELO<SortArrow active={sort==="rating"} dir={dir}/></button></div>
      {shown.map(p=>{const rank=rankOf.get(p.id)??0,suggested=Math.round(suggestedHandicap(p,data)),swing=recentDelta(p,data,5),played=games(p),rate=played?Math.round(p.wins/played*100):0;
        return <button className={`row ${rank===1?"top":""}`} key={p.id} onClick={()=>onPlayer(p)} aria-label={`${p.name}，排名 ${rank}，ELO ${Math.round(p.rating)}，近五場淨變化 ${swing>=0?"+":""}${Math.round(swing)}，建議讓分 ${suggested}`}>
        <span className="rank">{rank===1?"♛":rank}{(()=>{if(!movement.active)return null;const move=movement.map.get(p.id)??0;
          return move===0?<em className="move flat" aria-label="30 天內排名不變">–</em>
          :<em className={`move ${move>0?"up":"down"}`} aria-label={`較 30 天前${move>0?"上升":"下跌"} ${Math.abs(move)} 位`}>{move>0?"▲":"▼"}{Math.abs(move)}</em>})()}</span><span className="person"><i style={avatarStyle(p.colour)}>{p.short}</i><b>{p.name}<small>{played<data.settings.provisionalGames?"臨時":"正式"}<span className="rating-kind-suffix">評分</span><em className="person-meta"> · {played} 場</em></small></b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{played} 場<small>{rate}% 勝率</small></span><span className="dual-rating"><b>{suggested}</b><small>正式 {p.handicap==null?"—":p.handicap}</small></span>
        <span className="elo"><b>{Math.round(p.rating)}</b><small className={swing>=0?"positive":"negative"}>{swing>=0?"+":""}{Math.round(swing)}</small><em className="elo-suggested">建議 {suggested}</em></span></button>})}</>}</div></>;
}

function Matches({data,onEdit,onVoid,view,setView,pair,setPair}:{data:AppState;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;view:"history"|"headToHead";setView:(view:"history"|"headToHead")=>void;pair:{a:string;b:string};setPair:(pair:{a:string;b:string})=>void}) {
  const [sortBy,setSortBy]=useState<"playedOn"|"createdAt">("playedOn");
  const [sortDirection,setSortDirection]=useState<"desc"|"asc">("desc");
  const [focusPlayer,setFocusPlayer]=useState("");
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  const roster=[...data.players].sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const matches=useMemo(()=>[...data.matches]
    .filter(m=>!focusPlayer||m.a===focusPlayer||m.b===focusPlayer)
    .sort((left,right)=>{
      const primary=left[sortBy].localeCompare(right[sortBy]);
      const tieBreak=left.createdAt.localeCompare(right.createdAt);
      return sortDirection==="asc"?(primary||tieBreak):-(primary||tieBreak);
    }),[data.matches,sortBy,sortDirection,focusPlayer]);
  // When one player is in focus, their record across the filtered set is the
  // headline; the raw list alone makes you tally it yourself.
  const focusSummary=useMemo(()=>{
    if(!focusPlayer)return null;
    return matches.reduce((total,m)=>{
      if(m.status!=="confirmed")return total;
      const first=m.a===focusPlayer,own=first?m.scoreA:m.scoreB,other=first?m.scoreB:m.scoreA;
      total.net+=first?m.deltaA:-m.deltaA;
      if(own>other)total.wins++;else if(own<other)total.losses++;else total.draws++;
      return total;
    },{wins:0,losses:0,draws:0,net:0});
  },[matches,focusPlayer]);
  return <><section className="hero small"><div><p className="kicker">完整可追溯</p><h1>比賽記錄</h1><p>查看比分、讓分與每場 ELO 變化。</p></div></section>
    <div className="match-view-toggle" role="tablist" aria-label="比賽資料檢視"><button role="tab" aria-selected={view==="history"} className={view==="history"?"active":""} onClick={()=>setView("history")}>賽事記錄</button><button role="tab" aria-selected={view==="headToHead"} className={view==="headToHead"?"active":""} onClick={()=>setView("headToHead")}>對賽</button></div>
    {view==="headToHead"?<HeadToHead data={data} pair={pair} setPair={setPair} onEdit={onEdit} onVoid={onVoid}/>:<><div className="filters match-sort"><label>排序依據<select value={sortBy} onChange={event=>setSortBy(event.target.value as "playedOn"|"createdAt")}><option value="playedOn">比賽日期</option><option value="createdAt">加入日期</option></select></label><label>次序<select value={sortDirection} onChange={event=>setSortDirection(event.target.value as "desc"|"asc")}><option value="desc">最新至最舊</option><option value="asc">最舊至最新</option></select></label><label>球員<select value={focusPlayer} onChange={event=>setFocusPlayer(event.target.value)}><option value="">全部球員</option>{roster.map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label></div>
    {focusPlayer&&focusSummary&&<div className="focus-summary"><div><i style={avatarStyle(data.players.find(p=>p.id===focusPlayer)?.colour)}>{data.players.find(p=>p.id===focusPlayer)?.short}</i><span><small>已篩選</small><b>{name(focusPlayer)}</b></span></div>
      <div className="focus-record"><span><small>場數</small><b>{matches.length}</b></span><span><small>勝／負／和</small><b>{focusSummary.wins}／{focusSummary.losses}／{focusSummary.draws}</b></span><span><small>ELO 淨變化</small><b className={focusSummary.net>=0?"positive":"negative"}>{focusSummary.net>=0?"+":""}{Math.round(focusSummary.net)}</b></span></div>
      <button type="button" className="focus-clear" onClick={()=>setFocusPlayer("")}>清除篩選</button></div>}
    <div className="match-list">{matches.length===0?<Empty text={focusPlayer?"沒有符合的比賽記錄":"尚未有比賽記錄"} sub={focusPlayer?"這位球員暫時沒有已記錄的賽事。":"記錄第一場比賽後，詳情會顯示在這裡。"}/>:matches.map(m=>
      <article className={`match ${m.status}`} key={m.id}>
        {/* Fixture board first: date, score, then the ELO swing below on paper.
            Status pills only earn their place when they say something unusual. */}
        <div className="match-board"><div className="match-top"><span className="match-when"><time dateTime={m.playedOn}>{m.playedOn}</time>{m.status==="void"&&<span className="pill">已作廢</span>}{m.entryMode==="aggregate"&&<span className="pill muted">歷史匯總</span>}</span>
          <span className="card-tools"><button className="card-tool" aria-label={`編輯 ${name(m.a)} 對 ${name(m.b)} 的賽事`} onClick={()=>onEdit(m)}>✎</button><button className="card-tool danger" aria-label={`刪除 ${name(m.a)} 對 ${name(m.b)} 的賽事`} onClick={()=>onVoid(m)}>✕</button></span></div>
        <Scoreline left={name(m.a)} right={name(m.b)} scoreLeft={m.scoreA} scoreRight={m.scoreB}/>
        </div><div className="match-body">
        <div className="elo-impact" aria-label="本場 ELO 影響">
          <div><span>{name(m.a)}</span><b>{Math.round(m.beforeA)} <i>→</i> {Math.round(m.afterA)}</b><em className={m.deltaA>=0?"positive":"negative"}>{m.deltaA>=0?"+":""}{Math.round(m.deltaA)}</em></div>
          <div><span>{name(m.b)}</span><b>{Math.round(m.beforeB)} <i>→</i> {Math.round(m.afterB)}</b><em className={-m.deltaA>=0?"positive":"negative"}>{-m.deltaA>=0?"+":""}{Math.round(-m.deltaA)}</em></div>
          <small>預測 {name(m.a)} 局數比例 {Math.round(m.expectedA*100)}%</small>
        </div>
        {!!m.highBreaks?.length&&<div className="match-breaks"><span>單桿</span>{m.highBreaks.map((item,index)=><b key={`${item.playerId}-${index}`}>{name(item.playerId)} {item.value}</b>)}</div>}
        <p><Term label="實際讓分" tip="該筆比賽雙方真正採用的每局讓分；它會影響賽前預期及 ELO 變化。"/> {m.actual>0?`${name(m.a)} 讓 ${m.actual}`:m.actual<0?`${name(m.b)} 讓 ${Math.abs(m.actual)}`:"無"} · <Term label="額外讓分" tip="實際讓分與正式讓分參考之間的差距；正式讓分缺失時以 0 作比較基準。"/> {m.extra}</p>
        <small className="match-added">加入於 {new Date(m.createdAt).toLocaleString("zh-HK")}</small></div></article>)}</div></>}</>;
}

function HeadToHead({data,pair,setPair,onEdit,onVoid}:{data:AppState;pair:{a:string;b:string};setPair:(pair:{a:string;b:string})=>void;onEdit:(match:Match)=>void;onVoid:(match:Match)=>void}) {
  const [from,setFrom]=useState(""),[to,setTo]=useState("");
  const players=[...data.players].filter(player=>player.active).sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const a=data.players.find(player=>player.id===pair.a),b=data.players.find(player=>player.id===pair.b);
  const invalidRange=Boolean(from&&to&&from>to);
  const matches=useMemo(()=>data.matches.filter(match=>match.status==="confirmed"&&((match.a===pair.a&&match.b===pair.b)||(match.a===pair.b&&match.b===pair.a))&&(!from||match.playedOn>=from)&&(!to||match.playedOn<=to)).sort((left,right)=>right.playedOn.localeCompare(left.playedOn)||right.createdAt.localeCompare(left.createdAt)),[data.matches,pair,from,to]);
  const stats=useMemo(()=>matches.reduce((total,match)=>{const first=match.a===pair.a,scoreA=first?match.scoreA:match.scoreB,scoreB=first?match.scoreB:match.scoreA;total.framesA+=scoreA;total.framesB+=scoreB;if(scoreA>scoreB)total.winsA++;else if(scoreA<scoreB)total.winsB++;else total.draws++;return total;},{winsA:0,winsB:0,draws:0,framesA:0,framesB:0}),[matches,pair.a]);
  const update=(key:"a"|"b",value:string)=>setPair({...pair,[key]:value}),totalFrames=stats.framesA+stats.framesB;
  const decided=Math.max(1,stats.winsA+stats.winsB+stats.draws),filtered=Boolean(from||to);
  const share=(count:number)=>Math.round(count/decided*100);
  return <section className="head-to-head">
    <div className="h2h-picker">
      <label>球員 A<select value={pair.a} onChange={event=>update("a",event.target.value)}><option value="">選擇球員</option>{players.map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
      <label>球員 B<select value={pair.b} onChange={event=>update("b",event.target.value)}><option value="">選擇球員</option>{players.map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
    </div>
    <details className="h2h-range"><summary><span>日期範圍</span><em>{filtered?`${from||"最早"} → ${to||"最新"}`:"全部記錄"}</em></summary>
      <div className="h2h-range-body"><div className="h2h-date-fields"><label>開始日期<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>結束日期<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div><button type="button" className="h2h-clear" onClick={()=>{setFrom("");setTo("")}} disabled={!from&&!to}>清除日期</button>{invalidRange&&<p className="h2h-filter-error">開始日期不能晚於結束日期。</p>}</div>
    </details>
    {!a||!b||a.id===b.id?<Empty text="選擇兩位不同球員" sub="查看他們的直接交手成績、局數表現與每場 ELO 變化。"/>:<><div className="h2h-summary"><div className="h2h-player"><i>{a.short}</i><small>目前 ELO</small><b>{Math.round(a.rating)}</b><span>{a.name}</span></div><div className="h2h-score"><small>兩人交手成績</small><b>{stats.winsA}<em>勝</em> <span>–</span> {stats.winsB}<em>勝</em></b><p>{matches.length} 場 · {stats.draws} 和</p></div><div className="h2h-player right"><i>{b.short}</i><small>目前 ELO</small><b>{Math.round(b.rating)}</b><span>{b.name}</span></div>
      <div className="h2h-share">{matches.length===0?<p className="h2h-share-empty">尚未有交手記錄</p>:<><em aria-hidden="true"><i className="share-a" style={{width:`${share(stats.winsA)}%`}}/><i className="share-d" style={{width:`${share(stats.draws)}%`}}/><i className="share-b" style={{width:`${share(stats.winsB)}%`}}/></em><div className="h2h-share-legend"><span>{a.short} 勝 {share(stats.winsA)}%</span>{stats.draws>0&&<span>和 {share(stats.draws)}%</span>}<span>{b.short} 勝 {share(stats.winsB)}%</span></div></>}</div>
      <div className="h2h-frames"><span><small>{a.name} 局數</small><b>{stats.framesA}</b><em>{totalFrames?Math.round(stats.framesA/totalFrames*100):0}%</em></span><span><small>合計局數</small><b>{totalFrames}</b><em>{matches.length?`共 ${matches.length} 場`:"尚未交手"}</em></span><span><small>{b.name} 局數</small><b>{stats.framesB}</b><em>{totalFrames?Math.round(stats.framesB/totalFrames*100):0}%</em></span></div></div>
      <div className="h2h-list-head"><h3>逐場賽果</h3><span>{matches.length} 場{filtered?" · 已篩選日期":""}</span></div>
      <div className="h2h-list">{matches.length===0?<Empty text="沒有符合的對賽記錄" sub="調整日期範圍，或在選定兩人後記錄第一場比賽。"/>:matches.map(match=>{const first=match.a===a.id,scoreA=first?match.scoreA:match.scoreB,scoreB=first?match.scoreB:match.scoreA,beforeA=first?match.beforeA:match.beforeB,afterA=first?match.afterA:match.afterB,beforeB=first?match.beforeB:match.beforeA,afterB=first?match.afterB:match.afterA,deltaA=afterA-beforeA,deltaB=afterB-beforeB;return <article key={match.id} className="h2h-match"><div className="match-board"><div className="match-top"><small>{match.playedOn}{match.entryMode==="aggregate"?" · 歷史匯總":""}</small><span className="card-tools"><button className="card-tool" aria-label={`編輯 ${match.playedOn} 的賽事`} onClick={()=>onEdit(match)}>✎</button><button className="card-tool danger" aria-label={`刪除 ${match.playedOn} 的賽事`} onClick={()=>onVoid(match)}>✕</button></span></div><Scoreline left={a.name} right={b.name} scoreLeft={scoreA} scoreRight={scoreB}/></div><div className="match-body"><div className="h2h-elo-heading"><span>ELO 變化</span><small>本場比賽後</small></div><div className="h2h-elo-changes" aria-label="本場比賽 ELO 變化"><div className="h2h-elo-card" aria-label={`${a.name} ELO 變化`}><span className="h2h-elo-player"><i aria-hidden="true">{a.short}</i></span><div className="h2h-elo-values"><span>{Math.round(beforeA)}</span><em>→</em><strong>{Math.round(afterA)}</strong></div><b className={`h2h-elo-delta ${deltaA>=0?"positive":"negative"}`}>{deltaA>=0?"+":""}{Math.round(deltaA)}<small>ELO</small></b></div><div className="h2h-elo-card" aria-label={`${b.name} ELO 變化`}><span className="h2h-elo-player"><i aria-hidden="true">{b.short}</i></span><div className="h2h-elo-values"><span>{Math.round(beforeB)}</span><em>→</em><strong>{Math.round(afterB)}</strong></div><b className={`h2h-elo-delta ${deltaB>=0?"positive":"negative"}`}>{deltaB>=0?"+":""}{Math.round(deltaB)}<small>ELO</small></b></div></div></div></article>})}</div></>}</section>;
}

function ConfirmDeleteMatch({match,data,onCancel,onConfirm}:{match:Match;data:AppState;onCancel:()=>void;onConfirm:()=>void}) {
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  const later=data.matches.filter(m=>m.status==="confirmed"&&m.id!==match.id&&(m.playedOn||m.createdAt)>=(match.playedOn||match.createdAt)).length;
  return <><p className="kicker">需要確認</p><h2>刪除這場比賽？</h2>
    <p className="sub">確認後會由這場比賽起重新計算，其後所有 ELO、勝負、局數及近況都會重建。</p>
    <div className="confirm-target">
      <small>比賽日期 {match.playedOn}</small>
      <div className="confirm-scoreline"><span>{name(match.a)}</span><b>{match.scoreA}</b><em>–</em><b>{match.scoreB}</b><span>{name(match.b)}</span></div>
      <p>{match.actual>0?`${name(match.a)} 讓 ${match.actual} 分`:match.actual<0?`${name(match.b)} 讓 ${Math.abs(match.actual)} 分`:"沒有讓分"} · ELO {match.deltaA>=0?"+":""}{Math.round(match.deltaA)} / {-match.deltaA>=0?"+":""}{Math.round(-match.deltaA)}</p>
      {!!match.highBreaks?.length&&<div className="match-breaks"><span>單桿</span>{match.highBreaks.map((item,index)=><b key={`${item.playerId}-${index}`}>{name(item.playerId)} {item.value}</b>)}</div>}
    </div>
    {later>1&&<p className="confirm-impact">此賽事之後還有 <b>{later-1}</b> 場比賽會一併重新計算。</p>}
    <div className="confirm-actions"><button type="button" className="confirm-cancel" onClick={onCancel}>保留賽事</button><button type="button" className="confirm-delete" onClick={onConfirm}>刪除賽事</button></div>
    <p className="confirm-hint">刪除後可在提示訊息按「復原」還原。</p></>;
}


function Players({data,onAdd,onEdit,onDelete,onOpen,onCompare}:{data:AppState;onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void;onCompare:(p:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[view,setView]=useState<"cards"|"list">("cards");
  const ranked=[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),shown=sortPlayers(data.players,data,sort,dir),rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  return <><section className="hero small"><div><p className="kicker">球會名單</p><h1>球員</h1><p>管理職員提供的正式評分，並比較 ELO 建議評分。</p></div><button className="primary" onClick={onAdd}>＋ 新增球員</button></section>
    <div className="player-toolbar"><SortControls sort={sort} dir={dir} onSort={sortBy}/><div className="view-toggle" aria-label="顯示模式"><button className={view==="cards"?"active":""} onClick={()=>setView("cards")}>卡片</button><button className={view==="list"?"active":""} onClick={()=>setView("list")}>列表</button></div></div>
    <div className={`player-grid ${view==="list"?"list-view":""}`}>{data.players.length===0?<Empty text="尚未有球員" sub="新增球員後便可開始記錄比賽。"/>:shown.map(p=>{const suggested=suggestedHandicap(p,data),difference=p.handicap==null?null:suggested-p.handicap;return <article className="player-card rich" key={p.id}><button className="profile-hit" onClick={()=>onOpen(p)}><i style={avatarStyle(p.colour)}>{p.short}</i><div className="player-main"><div><small>排名 #{rankOf.get(p.id)}</small><h3>{p.name}</h3><p><b>{Math.round(p.rating)}</b> ELO · {games(p)} 場 · {Math.round(winRate(p)*100)}% 勝率</p></div><Sparkline values={playerSeries(p,data)} label={`${p.name} ELO 趨勢`}/></div></button><div className="rating-compare"><span><small>正式評分</small><b>{p.handicap??"—"}</b></span><span><small>建議評分</small><b>{suggested==null?"—":Math.round(suggested)}</b></span><span><small>差異</small><b className={difference!=null&&difference>0?"positive":difference!=null&&difference<0?"negative":""}>{difference==null?"—":`${difference>0?"+":""}${Math.round(difference)}`}</b></span><span><small>局數勝率</small><b>{Math.round(frameRate(p)*100)}%</b></span></div><div className="player-card-foot"><span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span><div className="player-actions"><button className="more" onClick={()=>onEdit(p)}>編輯</button><button className="danger-link static" onClick={()=>onDelete(p)}>刪除</button></div></div></article>})}</div></>;
}

function SettingsView({data,onEdit,onReset}:{data:AppState;onEdit:()=>void;onReset:()=>void}) {
  const s=data.settings,c=s.calibration; return <><section className="hero small"><div><p className="kicker">公開設定</p><h1>ELO 設定</h1><p>實際讓分直接影響 ELO；正式讓分只作參考。</p></div><button className="primary" onClick={onEdit}>編輯設定</button></section>
    <div className="settings-grid"><div className="setting"><small><Term label="起始 ELO" tip="球員加入時的評分起點；個別球員可另行設定，修改後會重播歷史賽果。"/></small><b>{s.start}</b></div><div className="setting"><small><Term label="臨時門檻" tip="球員完成此數量的比賽前會標示為臨時評分，並使用較大的臨時 K 值。"/></small><b>{s.provisionalGames} 場</b></div><div className="setting"><small><Term label="K 值" tip="控制每次賽果令 ELO 改變多少；數值越高，評分調整越快。"/></small><b>{s.kProvisional} / {s.kRated}</b></div><div className="setting"><small><Term label="持續校準換算率" tip="10 分附近每 1 分實際讓分相當於多少 ELO；會按累積賽果逐步重新估算。"/></small><b>{s.conversion} ELO／分</b></div><div className="setting"><small><Term label="讓分曲線" tip="大讓分難度的非線性增幅；1 為線性，數值越高，20、40、100 分的難度上升越快。"/></small><b>{s.curvature??1.25}</b></div><div className="setting"><small><Term label="軟上限" tip="用平滑曲線限制極端讓分的等效 ELO；額外讓分仍有影響，但不會無限增長。"/></small><b>±{s.handicapSoftCap??800} ELO</b></div><div className="setting"><small><Term label="勝者獎勵" tip="勝方加入的虛擬局數；預設半局，使 3–2 略優於 3–3，但不會出現巨大跳升。"/></small><b>{s.winnerBonus??.5} 局</b></div><div className="setting"><small><Term label="超額讓分加乘" tip="球員承受比雙方 ELO 公平線更艱難的讓分，仍打和或勝出時，額外放大其 ELO 回報；不利程度越高，加乘越大。"/></small><b>最高 +{Math.round((s.overHandicapBoost??.75)*100)}%</b></div><div className="setting"><small><Term label="加乘尺度" tip="控制超額讓分加乘增長速度；數值越小，加乘越快接近上限。"/></small><b>{s.overHandicapScale??200} ELO</b></div></div>
    <section className="calibration-card"><div><p className="kicker">每場自動更新</p><h2><Term label="讓分換算持續學習" tip="每次賽果變動後，同時估計 10 分附近的 ELO 換算率與大讓分的非線性曲線。"/></h2><p>目前每讓 1 分約等於 <b>{s.conversion} ELO</b>，曲線為 <b>{s.curvature??1.25}</b>。系統比較預測與真實局數比例，最多採計每筆 20 局；正式讓分不參與計算。</p>{c?.history&&c.history.length>1&&<small className="calibration-history">最近校準：{c.history.slice(-5).map(x=>x.estimate).join(" → ")} ELO／分</small>}</div><div className="calibration-stats"><span><small><Term label="可用記錄" tip="具備有效局數、賽前 ELO，而且實際讓分不為 0 的記錄數量。"/></small><b>{c?.usableMatches??0}</b></span><span><small><Term label="實際讓分種類" tip="歷史資料出現過多少種不同的非零實際讓分數值；例如 4、8、12 分代表 3 種。"/></small><b>{c?.handicapLevels??0}</b></span><span><small><Term label="信心" tip="按可用記錄數及實際讓分種類評估校準可靠程度。"/></small><b>{c?.confidence??"資料不足"}</b></span><span><small><Term label="換算率範圍" tip="與最佳估算表現接近的一段 ELO／分換算率。"/></small><b>{c?`${c.lower}–${c.upper}`:"—"}</b></span><span><small><Term label="曲線範圍" tip="數據支持的非線性曲線範圍；資料不足時會保持接近 1.25。"/></small><b>{c?.curvatureLower!=null?`${c.curvatureLower}–${c.curvatureUpper}`:"—"}</b></span></div></section>
    {c?.history&&c.history.length>1&&<CalibrationTrend history={c.history} lower={c.lower} upper={c.upper} conversion={s.conversion} confidence={c.confidence} example={{points:10,elo:Math.round(handicapAdjustment(10,s))}}/>}
    <section className="audit"><h2>審計記錄</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString("zh-HK")}</small></div>)}</section>
    <section className="danger-zone"><div><h2>清除並重設資料</h2><p>永久刪除共用資料庫內所有球員、比賽及審計記錄，並恢復預設 ELO 設定。</p></div><button onClick={onReset}>清除所有資料</button></section></>;
}

function MatchForm({data,draft,setDraft,preview,a,b,editing,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;editing:boolean;onSave:()=>void}) {
  const [breakInput,setBreakInput]=useState<Record<string,string>>({});
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  const players=[...data.players].filter(p=>p.active).sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const addBreak=(playerId:string)=>{
    const value=Number(breakInput[playerId]);
    if(!Number.isInteger(value)||value<1||value>147)return;
    setDraft((d:any)=>({...d,highBreaks:[...(d.highBreaks??[]),{playerId,value}]}));
    setBreakInput(current=>({...current,[playerId]:""}));
  };
  const removeBreak=(index:number)=>setDraft((d:any)=>({...d,highBreaks:(d.highBreaks??[]).filter((_:unknown,itemIndex:number)=>itemIndex!==index)}));
  const fairActual=preview?eloToHandicap(a.rating-b.rating,data.settings):null;
  const probabilities=preview?matchProbabilities(preview.expectedA,+draft.scoreA+ +draft.scoreB):null;
  const applyFair=()=>{
    if(fairActual==null)return;
    setDraft((d:any)=>({...d,giver:fairActual>=0?a.id:b.id,points:Math.round(Math.abs(fairActual))}));
  };
  return <><p className="kicker">{editing?"修正賽事":"快速記錄"}</p><h2>{editing?"編輯比賽":"記錄比賽"}</h2><p className="sub">{editing?"儲存後會按日期重播全部賽事，重建雙方及後續 ELO。":"自由賽制，只需輸入最終局數；同分即為和局。"}</p>
    {data.players.length<2&&<p className="warning">請先新增至少兩位活躍球員。</p>}
    <div className="step-label"><b>1</b> 球員與日期</div><div className="two"><label>球員 A<select value={draft.a} onChange={e=>update("a",e.target.value)}>{players.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>球員 B<select value={draft.b} onChange={e=>update("b",e.target.value)}>{players.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label></div>
    <label>比賽日期<input type="date" value={draft.date} onChange={e=>update("date",e.target.value)}/></label>
    <div className="step-label"><b>2</b> <Term label="實際讓分" tip="雙方在這筆比賽真正採用的每局讓分，不需要跟正式讓分相同。"/></div>{fairActual!=null&&<div className="fair-tip"><div><small><Term label="ELO 建議公平讓分" tip="按目前 ELO 差及持續校準換算率反推，令雙方預測局數比例接近 50／50 的讓分。"/></small><b>{fairActual>=0?a.name:b.name} 讓 {Math.round(Math.abs(fairActual))} 分</b><span>套用後預測勝率接近 50／50</span></div><button type="button" onClick={applyFair}>套用建議</button></div>}<div className="two"><label>讓分提供者<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">沒有讓分</option><option value={a?.id}>{a?.name}</option><option value={b?.id}>{b?.name}</option></select></label><label>每局讓分<input type="number" min="0" step="1" value={draft.points} onChange={e=>update("points",+e.target.value)}/></label></div>
    <div className="step-label"><b>3</b> 最終比分</div><div className="score-input"><label>{a?.short}<input type="number" min="0" value={draft.scoreA} onChange={e=>update("scoreA",+e.target.value)}/></label><strong>–</strong><label>{b?.short}<input type="number" min="0" value={draft.scoreB} onChange={e=>update("scoreB",+e.target.value)}/></label></div>
    <div className="step-label"><b>4</b> 單桿記錄 <span className="optional">選填 · 可加入多次</span></div>
    <div className="break-entry">{[a,b].filter(Boolean).map(player=><section key={player.id}><div className="break-player"><i>{player.short}</i><b>{player.name}</b></div><div className="break-add"><input aria-label={`${player.name} 單桿分數`} type="number" inputMode="numeric" min="1" max="147" placeholder="分數" value={breakInput[player.id]??""} onChange={event=>setBreakInput(current=>({...current,[player.id]:event.target.value}))} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();addBreak(player.id)}}}/><button type="button" onClick={()=>addBreak(player.id)}>加入</button></div><div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===player.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={`移除 ${player.name} 的 ${item.value} 分單桿`}>{item.value}<span>×</span></button>:null)}</div></section>)}</div>
    {preview&&<div className="preview"><div><small>{a.name}</small><b>{Math.round(a.rating)} <em className={preview.deltaA>=0?"positive":"negative"}>{preview.deltaA>=0?"+":""}{Math.round(preview.deltaA)}</em></b></div><div><small><Term label="預測局數比例" tip="非線性計入雙方賽前 ELO 與實際讓分後，預測球員 A／B 應取得的局數比例。"/></small><b>{Math.round(preview.expectedA*100)}% / {Math.round((1-preview.expectedA)*100)}%</b>{probabilities&&<small>A 勝 {Math.round(probabilities.win*100)}% · 和 {Math.round(probabilities.draw*100)}%</small>}</div><div><small>{b.name}</small><b>{Math.round(b.rating)} <em className={preview.deltaA<=0?"positive":"negative"}>{-preview.deltaA>=0?"+":""}{Math.round(-preview.deltaA)}</em></b></div><p>單場 · 表現分 {Math.round(preview.performanceScore*100)}% · 證據權重 ×{preview.evidenceWeight.toFixed(2)} · 讓分等效 {preview.adjustment>=0?"+":""}{Math.round(preview.adjustment)} ELO{preview.overHandicapMultiplier>1.001?` · 超額難度 ${Math.round(preview.overHandicapElo)} ELO · 表現加乘 ×${preview.overHandicapMultiplier.toFixed(2)}`:""} · 曲線 {data.settings.curvature??1.25} · 換算率 {data.settings.conversion} ELO／分</p></div>}
    <button className="primary full" disabled={data.players.length<2} onClick={onSave}>{editing?"儲存並重建 ELO":"確認並更新 ELO"}</button></>;
}

function SettingsForm({data,onSave}:{data:AppState;onSave:(s:Settings)=>void}) { const [s,setS]=useState(data.settings);const field=(k:"start"|"provisionalGames"|"kProvisional"|"kRated"|"conversion"|"curvature"|"handicapSoftCap"|"winnerBonus"|"overHandicapBoost"|"overHandicapScale",label:string,step=1)=><label>{label}<input type="number" step={step} value={s[k]??""} onChange={e=>setS({...s,[k]:+e.target.value})}/></label>;return <><p className="kicker">公開管理</p><h2>編輯 ELO 設定</h2><p className="warning">任何人都可修改。儲存後會以新規則重播全部歷史評分。</p><div className="two">{field("start","起始 ELO")}{field("provisionalGames","臨時門檻")}{field("kProvisional","臨時 K")}{field("kRated","正式 K")}{field("conversion","10 分附近每點換算",.25)}{field("curvature","非線性讓分曲線",.01)}{field("handicapSoftCap","讓分等效 ELO 軟上限")}{field("winnerBonus","勝者虛擬局數",.1)}{field("overHandicapBoost","超額讓分最高加乘",.05)}{field("overHandicapScale","超額讓分加乘尺度")}</div><button className="primary full" onClick={()=>confirm("確定更新並重播全部歷史 ELO？")&&onSave(s)}>儲存並重播</button></>}
type RivalSnapshot = {
  opponent:Player; wins:number; losses:number; draws:number; matches:number;
  framesWon:number; framesLost:number; frameRate:number; winRate:number;
  latest:string; hasAggregate:boolean; label?:string;
};

function rivalSnapshots(player:Player,data:AppState):RivalSnapshot[] {
  const byOpponent=new Map<string,RivalSnapshot>();
  for(const match of data.matches){
    if(match.status!=="confirmed"||(match.a!==player.id&&match.b!==player.id))continue;
    const opponentId=match.a===player.id?match.b:match.a;
    const opponent=data.players.find(candidate=>candidate.id===opponentId);
    if(!opponent)continue;
    const first=match.a===player.id;
    const scored=first?match.scoreA:match.scoreB,conceded=first?match.scoreB:match.scoreA;
    const current=byOpponent.get(opponentId)??{opponent,wins:0,losses:0,draws:0,matches:0,framesWon:0,framesLost:0,frameRate:0,winRate:0,latest:"",hasAggregate:false};
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
    return {...rival,frameRate:totalFrames?rival.framesWon/totalFrames:0,winRate:rival.matches?rival.wins/rival.matches:0};
  });
  const picks:{label:string;sort:(a:RivalSnapshot,b:RivalSnapshot)=>number}[]=[
    {label:"最多交手",sort:(a,b)=>b.matches-a.matches||(b.framesWon+b.framesLost)-(a.framesWon+a.framesLost)},
    {label:"最難應付",sort:(a,b)=>a.winRate-b.winRate||b.matches-a.matches},
    {label:"最佳對賽",sort:(a,b)=>b.winRate-a.winRate||b.matches-a.matches},
    {label:"勢均力敵",sort:(a,b)=>Math.abs(a.winRate-.5)-Math.abs(b.winRate-.5)||b.matches-a.matches},
    {label:"最近交手",sort:(a,b)=>b.latest.localeCompare(a.latest)}
  ];
  const selected:RivalSnapshot[]=[];
  for(const pick of picks){
    const rival=[...rivals].filter(item=>!selected.some(chosen=>chosen.opponent.id===item.opponent.id)).sort(pick.sort)[0];
    if(rival)selected.push({...rival,label:pick.label});
  }
  return selected;
}

function RivalrySnapshot({player,data,onCompare}:{player:Player;data:AppState;onCompare:(opponent:Player)=>void}) {
  const rivals=rivalSnapshots(player,data);
  return <section className="rivalry-snapshot"><div className="rivalry-heading"><div><p className="kicker">對賽概覽</p><h3>主要對手</h3></div><span>最多顯示 5 位</span></div>
    {rivals.length===0?<div className="rivalry-empty"><b>尚未有對賽記錄</b><span>記錄第一場比賽後，主要對手會顯示在這裡。</span></div>:<div className="rivalry-list">{rivals.map(rival=>{
      const percent=Math.round((rival.matches?rival.winRate:rival.frameRate)*100);
      const confidence=Math.min(1,.28+Math.max(rival.matches,(rival.framesWon+rival.framesLost)/12)*.18);
      return <button key={rival.opponent.id} className="rivalry-row" onClick={()=>onCompare(rival.opponent)} aria-label={`查看 ${player.name} 對 ${rival.opponent.name} 的詳細對賽`}>
        <i>{rival.opponent.short}</i><span className="rivalry-person"><small>{rival.label}</small><b>{rival.opponent.name}</b><em>{rival.matches?`${rival.wins} 勝 · ${rival.losses} 負 · ${rival.draws} 和`:`歷史局數匯總`}{rival.hasAggregate&&rival.matches?" · 另有匯總":""}</em></span>
        <span className="rivalry-heat"><b>{percent}%</b><small>{rival.matches?"場數勝率":"局數勝率"}</small><em aria-hidden="true"><i style={{width:`${percent}%`,opacity:confidence}}/></em></span><strong>›</strong>
      </button>;
    })}</div>}
  </section>;
}

const BREAK_LIST_LIMIT=8;
/** Lists each distinct break value the player has recorded, highest first, merging repeats into a ×N count. */
function BreakStats({player,data}:{player:Player;data:AppState}) {
  const breaks=data.matches.filter(m=>m.status==="confirmed").flatMap(m=>
    (m.highBreaks??[]).filter(item=>item.playerId===player.id&&item.value>0&&item.value<=147).map(item=>item.value));
  if(!breaks.length)return null;
  const highest=Math.max(...breaks);
  const counts=new Map<number,number>();
  [...breaks].sort((a,b)=>b-a).forEach(v=>counts.set(v,(counts.get(v)??0)+1));
  const entries=Array.from(counts.entries());
  const shown=entries.slice(0,BREAK_LIST_LIMIT),hidden=entries.length-shown.length;
  return <section className="break-stats">
    <div className="break-stats-head"><div><p className="kicker">單桿表現</p><h3>最高單桿</h3></div><b>{highest}</b></div>
    <div className="break-tally">{shown.map(([value,count])=><span key={value}>{value}{count>1&&<em>×{count}</em>}</span>)}{hidden>0&&<span className="break-tally-more">+{hidden}</span>}</div>
    <p className="chart-summary">共 {breaks.length} 桿記錄{entries.length>1?`，${entries.length} 個不同分數`:""}。</p>
  </section>;
}

function PlayerDetail({player,rank,data,onCompare}:{player:Player;rank:number;data:AppState;onCompare:(opponent:Player)=>void}) { const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data),series=playerSeries(player,data),trendPoints=playerTrendPoints(player,data),high=Math.max(...series),low=Math.min(...series);return <><div className="profile-head"><i style={avatarStyle(player.colour)}>{player.short}</i><div><p className="kicker">排名 #{rank||"—"}</p><h2>{player.name}</h2><p>{g<data.settings.provisionalGames?"臨時 ELO":"正式 ELO"}</p></div></div><div className="profile-stats"><div><small>目前 ELO</small><b>{Math.round(player.rating)}</b></div><div><small>正式讓分評分</small><b>{player.handicap??"未提供"}</b></div><div><small>ELO 建議評分</small><b>{suggested==null?"未提供":Math.round(suggested)}</b></div><div><small>勝／負／和</small><b>{player.wins}/{player.losses}/{player.draws}</b></div></div><BreakStats player={player} data={data}/><RecentMatches points={trendPoints}/><section className="detail-chart interactive-detail"><div className="chart-head"><div><p className="kicker">評分軌跡</p><h3>ELO 走勢</h3></div><span>最高 {Math.round(high)} · 最低 {Math.round(low)}</span></div><InteractiveEloChart points={trendPoints} label={`${player.name} 從起始評分至目前的互動 ELO 走勢`}/><div className="chart-axis"><span>起始 {Math.round(series[0])}</span><span>目前 {Math.round(player.rating)}</span></div></section><RivalrySnapshot player={player} data={data} onCompare={onCompare}/><h3>表現摘要</h3><p className="summary">{player.name} 目前為 {Math.round(player.rating)} ELO，最近五場錄得 {player.form.filter(x=>x==="W").length} 勝、{player.form.filter(x=>x==="L").length} 負、{player.form.filter(x=>x==="D").length} 和；局數勝率為 {Math.round(frameRate(player)*100)}%。ELO 曾介乎 {Math.round(low)} 至 {Math.round(high)}，共有 {related.length} 筆可追溯賽事記錄。</p></>}
