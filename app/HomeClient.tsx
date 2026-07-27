"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CalibrationTrend, DEFAULT_AVATAR, Empty, InteractiveEloChart, NavIcon, PlayerBadge, PlayerCombobox, PlayerForm, RecentMatches, Scoreline, SortArrow, SortControls, Sparkline, Term, avatarHex, sortLabels, type EloTrendPoint, type SortKey } from "./UiBits";
import Availability from "./Availability";

type Player = {
  id: string; name: string; short: string; handicap: number | null; rating: number; colour?: string; avatar?: string | null;
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
const tenDaysAgo = new Date(Date.now()-10*864e5).toISOString().slice(0,10);
function isInPastThirtyDays(playedOn:string){
  return playedOn>=thirtyDaysAgo&&playedOn<=today;
}
function isInPastTenDays(playedOn:string){
  return playedOn>=tenDaysAgo&&playedOn<=today;
}
export default function Home({user}:{user:{displayName:string;email:string;role:"admin"|"member";statePlayerId?:string}|null}) {
  const [data,setData] = useState<AppState>(seed);
  const [tab,setTab] = useState("leaderboard");
  const [matchesView,setMatchesView] = useState<"history"|"calendar">("history");
  const [headToHead,setHeadToHead] = useState({a:"",b:""});
  const [highlightMatch,setHighlightMatch] = useState<string|null>(null);
  // localStorage can't be read during render without a hydration mismatch, so
  // the restore lands in an effect — which means the writer must skip its own
  // first run or it would persist the pre-restore default over the real value.
  const focusRestored = useRef(false);
  const [modal,setModal] = useState<"match"|"player"|"settings"|"detail"|"deleteMatch"|"signIn"|null>(null);
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
  const ownPlayerId=user?.statePlayerId;
  const isAdmin=user?.role==="admin";
  const canManageMatch=(match:Match)=>Boolean(isAdmin||ownPlayerId&&(match.a===ownPlayerId||match.b===ownPlayerId));

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
  // The match tab is egocentric in practice — a member opens it to check their
  // own last result, not the club archive. Restore whatever they were last
  // looking at; failing that, start a signed-in member on their own record.
  useEffect(()=>{
    const stored=localStorage.getItem("scaa-match-focus");
    if(stored){
      try{
        const value=JSON.parse(stored);
        if(typeof value?.a==="string"&&typeof value?.b==="string"){setHeadToHead({a:value.a,b:value.b});return;}
      }catch{}
    }
    if(ownPlayerId)setHeadToHead({a:ownPlayerId,b:""});
  },[ownPlayerId]);
  useEffect(()=>{
    if(!focusRestored.current){focusRestored.current=true;return;}
    localStorage.setItem("scaa-match-focus",JSON.stringify(headToHead));
  },[headToHead]);
  // A restored id can outlive the player it points at; drop it once the roster
  // arrives so the filter never names someone who is no longer in the club.
  useEffect(()=>{
    if(!data.players.length)return;
    setHeadToHead(pair=>{
      const known=(id:string)=>!id||data.players.some(p=>p.id===id);
      if(known(pair.a)&&known(pair.b))return pair;
      return known(pair.a)?{a:pair.a,b:""}:{a:"",b:""};
    });
  },[data.players]);
  // Navigating away retires the highlight, so returning later doesn't re-flash
  // a result the user has already seen. Cleared on the click rather than in an
  // effect keyed on `tab` — saveMatch sets both in one batch, and an effect
  // would race that.
  const goTab=(next:string)=>{setHighlightMatch(null);setTab(next)};
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
    if(!user){setToast("請先登入會員帳戶，才可更改球會資料。");return;}
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
    if(user?.role!=="admin"){setToast("只有管理員可以清除並重設資料。");return;}
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
    setMatchesView("history");
    goTab("matches");
  };
  const openPlayerMatches=(player:Player)=>{
    setHeadToHead({a:player.id,b:""});
    setMatchesView("history");
    goTab("matches");
  };

  function saveMatch(){
    if(!isAdmin&&(!ownPlayerId||(a?.id!==ownPlayerId&&b?.id!==ownPlayerId))){setToast("你只能記錄或修改自己參與的比賽。");return;}
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
    localStorage.removeItem("scaa-draft"); setEditingMatch(null); setModal(null);
    // Land on the saved card rather than a toast that vanishes: focus the list
    // on the recorder (or clear it, for an admin logging someone else's game)
    // so the new row is guaranteed to be in the filtered set, and drop the
    // comparison — the date range only applies while comparing, and a stale
    // range could otherwise hide the very match we just navigated to.
    setHeadToHead({a:ownPlayerId&&(match.a===ownPlayerId||match.b===ownPlayerId)?ownPlayerId:"",b:""});
    setHighlightMatch(id); setMatchesView("history"); setTab("matches");
    persist(next,editingMatch?"賽事已更新，所有後續 ELO 已重建。":"賽果已儲存，雙方 ELO 已更新。");
  }

  function editMatch(m:Match){
    if(!canManageMatch(m)){setToast("你只能修改自己參與的比賽。");return;}
    setEditingMatch(m);
    setDraft({
      a:m.a,b:m.b,scoreA:m.scoreA,scoreB:m.scoreB,
      date:m.playedOn,giver:m.actual>0?m.a:m.actual<0?m.b:"",points:Math.abs(m.actual),highBreaks:m.highBreaks??[]
    });
    setModal("match");
  }

  function newMatch(){
    if(!user){setModal("signIn");return;}
    setEditingMatch(null);
    const sorted=[...data.players].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,"zh-HK"));
    setDraft({
      a:ownPlayerId&&sorted.some(player=>player.id===ownPlayerId)?ownPlayerId:sorted[0]?.id??"",b:(ownPlayerId&&sorted.some(player=>player.id===ownPlayerId)?sorted.find(player=>player.id!==ownPlayerId):sorted[1])?.id??"",
      scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[]
    });
    setModal("match");
  }

  function savePlayer(){
    if(!isAdmin&&(!editingPlayer||editingPlayer.id!==ownPlayerId)){setToast("你只能修改自己的球員資料。");return;}
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
    if(!isAdmin&&p.id!==ownPlayerId){setToast("你只能修改自己的球員資料。");return;}
    setEditingPlayer(p);
    setPlayerForm({name:p.name,short:p.short,handicap:p.handicap==null?"":String(p.handicap),rating:String(Math.round(p.initialRating)),colour:p.colour||DEFAULT_AVATAR});
    setModal("player");
  }

  function deletePlayer(p:Player){
    if(!isAdmin){setToast("只有管理員可以刪除球員。");return;}
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

  return <><style>{`.read-only .card-tools,.read-only .hero.small > .primary{display:none}`}</style><div className={`shell${user?"":" read-only"}`}>
    <aside className="side">
      <div className="brand"><span>S</span><div><b>SCAA</b><small>Snooker ELO</small></div></div>
      <nav>{[["leaderboard","排行榜"],["matches","比賽"],["availability","可配對"],["players","球員"],["settings","設定"]].map(([id,label])=>
        <button key={id} className={tab===id?"active":""} onClick={()=>goTab(id)}><i><NavIcon id={id as "leaderboard"|"matches"|"availability"|"players"|"settings"} active={tab===id}/></i>{label}</button>)}</nav>
      <div className="public-note"><b>{user?"會員模式":"公開瀏覽"}</b><span>{user?"已登入，可更新球會資料":"登入會員後即可記錄比賽"}</span></div>
    </aside>
    <main>
      <header><div className="mobile-brand">SCAA <span>Snooker ELO</span></div><div className="account-actions"><div className="status"><i/> 共用資料庫 · {saving?"儲存中…":"已同步"}</div><button className={`header-settings${tab==="settings"?" active":""}`} aria-label="評分設定與紀錄" aria-current={tab==="settings"?"page":undefined} onClick={()=>goTab("settings")}><NavIcon id="settings" active={tab==="settings"}/></button>{user?<a className="account-link" href="/account" title={user.email}>{user.displayName}</a>:<a className="account-link sign-in" href="/login">登入／註冊</a>}</div></header>
      {tab==="leaderboard"&&<Leaderboard ranked={ranked} data={data} onRecord={newMatch} onPlayer={(p)=>{setDetail(p);setModal("detail")}} onMatch={(match)=>{setHeadToHead({a:"",b:""});setHighlightMatch(match.id);setMatchesView("history");setTab("matches")}} onRivalry={(first,second)=>openHeadToHead(first,second)}/>}
      {tab==="matches"&&<Matches data={data} canManageMatch={canManageMatch} onEdit={editMatch} onVoid={requestDeleteMatch} onPlayer={(player)=>{setDetail(player);setModal("detail")}} view={matchesView} setView={setMatchesView} pair={headToHead} setPair={setHeadToHead} highlight={highlightMatch}/>}
      {tab==="availability"&&<Availability userPlayerId={ownPlayerId} matches={data.matches}/>}
      {tab==="players"&&<Players data={data} canAdd={Boolean(isAdmin)} canManagePlayer={player=>Boolean(isAdmin||player.id===ownPlayerId)} onAdd={()=>{if(!isAdmin){setToast("只有管理員可以新增球員。");return;}setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal("player")}} onEdit={editPlayer} onDelete={deletePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}} onCompare={openHeadToHead}/>}
      {tab==="settings"&&<SettingsView data={data} onEdit={()=>isAdmin?setModal("settings"):setToast("只有管理員可以修改 ELO 設定。")} onReset={resetAll} canReset={user?.role==="admin"}/>}
    </main>
    {/* Record sits dead centre as the one thing this app exists to do; the four content tabs split
        evenly around it. 設定 is not a peer of them — it lives with the account controls instead. */}
    <nav className="bottom" aria-label="主導覽">{[["leaderboard","排行榜"],["matches","比賽"],["record","記錄"],["availability","配對"],["players","球員"]].map(([id,label])=>
      <button key={id} className={id==="record"?"bottom-record":tab===id?"active":""} aria-current={tab===id?"page":undefined} onClick={()=>id==="record"?newMatch():goTab(id)}>
        <i>{id==="record"?"＋":<NavIcon id={id as "leaderboard"|"matches"|"availability"|"players"|"settings"} active={tab===id}/>}</i>
        <small>{label}</small>
      </button>)}</nav>
    {modal&&<div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&closeModal()}>
      <section className={`sheet${modal==="deleteMatch"?" confirm-sheet":""}`} role="dialog" aria-modal="true"><button className="close" aria-label="關閉" onClick={closeModal}>×</button>
        {modal==="match"&&<MatchForm data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} editing={!!editingMatch} onSave={saveMatch}/>}
        {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} editing={!!editingPlayer} onSave={savePlayer}/>}
        {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{const applied={...settings,modelVersion:3},rebuilt=replay(data.players,data.matches,applied);setModal(null);persist({...data,settings:applied,...rebuilt,audits:[{id:crypto.randomUUID(),text:"更新 ELO 設定；完整重播歷史評分",at:new Date().toISOString()},...data.audits]},"設定已更新，歷史 ELO 已重播。")}}/>}
        {modal==="deleteMatch"&&deletingMatch&&<ConfirmDeleteMatch match={deletingMatch} data={data} onCancel={closeModal} onConfirm={confirmDeleteMatch}/>}
        {modal==="signIn"&&<><p className="kicker">會員功能</p><h2>先登入或建立帳戶</h2><p className="sub">記錄賽果前，請登入會員帳戶；新會員註冊時會同時建立球員檔案。</p><div className="auth-buttons"><a className="primary" href="/login">登入</a><a className="more" href="/login?mode=signup">建立帳戶</a></div></>}
        {modal==="detail"&&detail&&<PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data} onCompare={opponent=>{setModal(null);openHeadToHead(detail,opponent)}} onViewAllMatches={()=>{setModal(null);openPlayerMatches(detail)}} onMatch={matchId=>{setModal(null);setHeadToHead({a:detail.id,b:""});setHighlightMatch(matchId);setMatchesView("history");setTab("matches")}}/>}
      </section></div>}
    {toast&&<div className="toast" role="status"><span>{toast}</span>{undoSnapshot&&<button type="button" onClick={undoDelete}>復原</button>}</div>}
  </div></>;
}

/**
 * The three headline club stats used to live in their own full-width card
 * above the podium; folded in here as an inline strip so the leaderboard
 * reaches its actual content (the standings) sooner.
 */
function Overview({top,data,onPlayer}:{top:Player[];data:AppState;onPlayer:(p:Player)=>void}) {
  // DOM order is always rank order (1, 2, 3) so mobile — a vertical stack —
  // reads top to bottom correctly. The classic "winner in the middle" podium
  // look is applied with CSS `order` on the desktop 3-column layout only.
  return <section className="podium-section" aria-label="總覽及排名前三">
    {top.length>=3&&<div className="podium">
      {top.map((player,index)=>{const place=index+1;return <button key={player.id} className={`podium-card place-${place}`} onClick={()=>onPlayer(player)}>
        <span className="podium-place">{place===1?"♛":place}</span>
        <PlayerBadge player={player}/>
        <h3>{player.name}</h3>
        <b>{Math.round(player.rating)}<em>ELO</em></b>
        <span className="form">{player.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <small>建議讓分 {Math.round(suggestedHandicap(player,data))}</small>
      </button>})}
    </div>}
  </section>;
}

function Leaderboard({ranked,data,onRecord,onPlayer,onMatch,onRivalry}:{ranked:Player[];data:AppState;onRecord:()=>void;onPlayer:(p:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[breakView,setBreakView]=useState<"players"|"overall">("players"),[homeView,setHomeView]=useState<"ranking"|"breaks"|"recent">("ranking");
  const confirmed=data.matches.filter(m=>m.status==="confirmed");
  const month=confirmed.filter(m=>m.playedOn.slice(0,7)===today.slice(0,7)).length,total=confirmed.length;
  const shown=sortPlayers(ranked,data,sort,dir),rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  // Movement compares today's table against the standings 30 days ago. A single
  // Ten days balances recent momentum with enough matches for a meaningful comparison.
  const movement=useMemo(()=>{
    const recent=confirmed.filter(m=>isInPastTenDays(m.playedOn));
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
  return <><section className="hero"><div><p className="kicker">SCAA CLUB RANKING</p><h1>讓每一局，<br/><span>都推動進步。</span></h1><p>追蹤實力、看見成長，找到旗鼓相當的下一位對手。</p>
      <div className="podium-stats">
        <span><b>{ranked.length}</b><small>活躍球員</small></span>
        <span><b>{month}</b><small>本月比賽</small></span>
        <span><b>{total}</b><small>歷來總場數</small></span>
      </div>
    </div><button className="primary hero-action" onClick={onRecord}><span aria-hidden="true">＋</span><b>記錄新賽果</b><small>更新排名與近期狀態</small></button></section>
    <nav className="home-view-nav" aria-label="首頁內容" role="tablist">
      <button role="tab" aria-selected={homeView==="ranking"} className={homeView==="ranking"?"active":""} onClick={()=>setHomeView("ranking")}><span>目前排名</span></button>
      <button role="tab" aria-selected={homeView==="breaks"} className={homeView==="breaks"?"active":""} onClick={()=>setHomeView("breaks")}><span>最高單桿紀錄</span></button>
      <button role="tab" aria-selected={homeView==="recent"} className={homeView==="recent"?"active":""} onClick={()=>setHomeView("recent")}><span>近三十日統計</span></button>
    </nav>
    {homeView==="ranking"&&<>
    <Overview top={ranked.slice(0,3)} data={data} onPlayer={onPlayer}/>
    <section className="section-title"><div><p className="kicker">即時競爭形勢</p><h2>目前排名</h2><p>每場結果都會即時反映在 ELO 與近期狀態。</p></div><span className="pill">● 已同步</span></section>
    <SortControls sort={sort} dir={dir} onSort={sortBy}/>
    <div className="table-card">{ranked.length===0?<Empty text="尚未有球員" sub="前往球員頁面新增第一位球員。"/>:<><div className="table-head sortable"><button title="箭嘴為過去 10 天的排名升跌" onClick={()=>sortBy("rank")}>排名<SortArrow active={sort==="rank"} dir={dir}/></button><button onClick={()=>sortBy("name")}>球員<SortArrow active={sort==="name"} dir={dir}/></button><button title="最近五筆比賽；較近期結果權重較高" onClick={()=>sortBy("form")}>近況<SortArrow active={sort==="form"} dir={dir}/></button><button onClick={()=>sortBy("winRate")}>場數／勝率<SortArrow active={sort==="winRate"} dir={dir}/></button><button onClick={()=>sortBy("suggested")}>建議／正式評分<SortArrow active={sort==="suggested"} dir={dir}/></button><button title="ELO 及近五場淨變化" onClick={()=>sortBy("rating")}>ELO<SortArrow active={sort==="rating"} dir={dir}/></button></div>
      {shown.map(p=>{const rank=rankOf.get(p.id)??0,suggested=Math.round(suggestedHandicap(p,data)),swing=recentDelta(p,data,5),played=games(p),rate=played?Math.round(p.wins/played*100):0,provisional=played<data.settings.provisionalGames;
        return <button className={`row ${rank===1?"top":""} ${provisional?"provisional":""}`} key={p.id} onClick={()=>onPlayer(p)} aria-label={`${p.name}，排名 ${rank}，ELO ${Math.round(p.rating)}，近五場淨變化 ${swing>=0?"+":""}${Math.round(swing)}，建議讓分 ${suggested}${provisional?"，臨時評分":""}`}>
        <span className="rank">{rank===1?"♛":rank}{(()=>{if(!movement.active)return null;const move=movement.map.get(p.id)??0;
          return move===0?<em className="move flat" aria-label="10 天內排名不變">–</em>
          :<em className={`move ${move>0?"up":"down"}`} aria-label={`較 10 天前${move>0?"上升":"下跌"} ${Math.abs(move)} 位`}>{move>0?"▲":"▼"}{Math.abs(move)}</em>})()}</span><span className="person"><PlayerBadge player={p}/><b>{p.name}<small>{played<data.settings.provisionalGames?"臨時":"正式"}<span className="rating-kind-suffix">評分</span><em className="person-meta"> · {played} 場</em></small></b></span>
        <span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>
        <span>{played} 場<small>{rate}% 勝率</small></span><span className="dual-rating"><b>{suggested}</b><small>正式 {p.handicap==null?"—":p.handicap}</small></span>
        <span className="elo"><b>{Math.round(p.rating)}</b><small className={swing>=0?"positive":"negative"}>{swing>=0?"+":""}{Math.round(swing)}</small><em className="elo-suggested">建議 {suggested}</em></span></button>})}</>}</div></>}
    {homeView==="breaks"&&<section className="home-view-panel break-records-panel" aria-labelledby="break-records-title">
      <div className="home-panel-head"><div><p className="kicker">ALL-TIME RECORDS</p><h2 id="break-records-title">最高單桿紀錄</h2><p>查看每位球員的個人最佳，或所有已確認賽事的歷史最高紀錄。</p></div><div className="mini-toggle break-toggle" aria-label="單桿紀錄顯示方式"><button aria-pressed={breakView==="players"} className={breakView==="players"?"active":""} onClick={()=>setBreakView("players")}>球員最高</button><button aria-pressed={breakView==="overall"} className={breakView==="overall"?"active":""} onClick={()=>setBreakView("overall")}>歷史最高</button></div></div>
      <ol className="break-ranking">{Array.from({length:10},(_,index)=>{const record=displayedBreaks[index];const medal=["gold","silver","bronze"][index];return <li key={record?.key??`empty-${index}`} className={`${record?"":"empty-rank"}${medal?` medal medal-${medal}`:""}`}><span className="break-position">{medal?<i className="medal-icon" aria-hidden="true">{["🥇","🥈","🥉"][index]}</i>:index+1}</span>{record?<><PlayerBadge player={record.player}/><b><span>{record.player.name}</span><small>對 {record.opponent}<span className="break-date-inline"> · {record.date}</span></small></b><time dateTime={record.date}>{record.date}</time><strong>{record.value>=100&&<em className="century-badge" title="破百單桿">破百</em>}{record.value}</strong></>:<b>N/A</b>}</li>})}</ol>
      <p className="chart-summary">{breakView==="players"?"每位球員只顯示其最高單桿。":"按所有已確認賽事的單桿記錄排名，同一球員可重複上榜。"}</p>
    </section>}
    {homeView==="recent"&&<ThirtyDayStats data={data} onPlayer={onPlayer} onMatch={onMatch} onRivalry={onRivalry}/>}</>;
}

function RecentStatIcon({kind}:{kind:"matches"|"frames"|"players"|"average"|"active"|"elo"|"win"|"break"}) {
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
function ThirtyDayStats({data,onPlayer,onMatch,onRivalry}:{data:AppState;onPlayer:(player:Player)=>void;onMatch:(match:Match)=>void;onRivalry:(first:Player,second:Player)=>void}){
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
    const topBreak=matches.flatMap(match=>(match.highBreaks??[]).map(item=>({player:playerById.get(item.playerId),value:item.value,date:match.playedOn}))).filter(item=>item.player&&item.value>0&&item.value<=147).sort((a,b)=>b.value-a.value||b.date.localeCompare(a.date))[0];
    const pairCounts=new Map<string,{a:string;b:string;matches:number;framesA:number;framesB:number}>();
    for(const match of matches){const first=match.a<match.b,key=first?`${match.a}|${match.b}`:`${match.b}|${match.a}`,record=pairCounts.get(key)??{a:first?match.a:match.b,b:first?match.b:match.a,matches:0,framesA:0,framesB:0};record.matches++;record.framesA+=first?match.scoreA:match.scoreB;record.framesB+=first?match.scoreB:match.scoreA;pairCounts.set(key,record)}
    const rivalry=[...pairCounts.values()].filter(pair=>playerById.has(pair.a)&&playerById.has(pair.b)).sort((a,b)=>b.matches-a.matches||(b.framesA+b.framesB)-(a.framesA+a.framesB))[0];
    const closest=matches.slice().sort((a,b)=>Math.abs(a.scoreA-a.scoreB)-Math.abs(b.scoreA-b.scoreB)||(b.scoreA+b.scoreB)-(a.scoreA+a.scoreB)||b.playedOn.localeCompare(a.playedOn))[0];
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
    return typeof player?.name==="string"?player.name:"已移除球員";
  };
  if(!stats.matches.length)return <section className="home-view-panel recent-stats-panel"><div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2>近三十日統計</h2><p>最近三十日暫時未有已確認賽事。</p></div></div><Empty text="未有近期賽事" sub="記錄新賽果後，活躍度與近期焦點會顯示在這裡。"/></section>;
  const maxWeek=Math.max(1,...stats.weekCounts);
  return <section className="home-view-panel recent-stats-panel" aria-labelledby="recent-stats-title">
    <div className="home-panel-head"><div><p className="kicker">LAST 30 DAYS</p><h2 id="recent-stats-title">近三十日統計</h2><p>{thirtyDaysAgo} 至 {today} 的已確認賽事。</p></div></div>
    <div className="recent-stat-metrics">
      <div><RecentStatIcon kind="matches"/><span><small>比賽場數</small><b>{stats.matches.length}</b></span></div>
      <div><RecentStatIcon kind="frames"/><span><small>總局數</small><b>{stats.totalFrames}</b></span></div>
      <div><RecentStatIcon kind="players"/><span><small>活躍球員</small><b>{stats.active}</b></span></div>
      <div><RecentStatIcon kind="average"/><span><small>平均每場</small><b>{stats.average.toFixed(1)}<em>局</em></b></span></div>
    </div>
    <div className="recent-focus-grid">
      {stats.busiest&&<button onClick={()=>onPlayer(stats.busiest!.player)}><span className="recent-focus-label"><RecentStatIcon kind="active"/>最活躍球員</span><PlayerBadge className="recent-player-badge" player={stats.busiest.player}/><span className="recent-focus-person"><b>{stats.busiest.player.name}</b><em>{stats.busiest.matches} 場 · {stats.busiest.frames} 局</em></span></button>}
      {stats.mover&&<button onClick={()=>onPlayer(stats.mover!.player)}><span className="recent-focus-label"><RecentStatIcon kind="elo"/>ELO 升幅最高</span><PlayerBadge className="recent-player-badge" player={stats.mover.player}/><span className="recent-focus-person"><b>{stats.mover.player.name}</b><em className={stats.mover.delta>=0?"positive":"negative"}>{stats.mover.delta>=0?"+":""}{Math.round(stats.mover.delta)} ELO</em></span></button>}
      {stats.winRate&&<button onClick={()=>onPlayer(stats.winRate!.player)}><span className="recent-focus-label"><RecentStatIcon kind="win"/>最高勝率 · 至少 3 場</span><PlayerBadge className="recent-player-badge" player={stats.winRate.player}/><span className="recent-focus-person"><b>{stats.winRate.player.name}</b><em>{Math.round(stats.winRate.wins/stats.winRate.matches*100)}% · {stats.winRate.wins}/{stats.winRate.matches} 勝</em></span></button>}
      {stats.topBreak&&<button onClick={()=>onPlayer(stats.topBreak!.player!)}><span className="recent-focus-label"><RecentStatIcon kind="break"/>近三十日最高單桿</span><PlayerBadge className="recent-player-badge" player={stats.topBreak.player!}/><span className="recent-focus-person"><b>{stats.topBreak.player!.name}</b><em>{stats.topBreak.value} 分 · {stats.topBreak.date}</em></span></button>}
    </div>
    <div className="recent-chart-grid">
      <article className="recent-chart-card recent-activity-chart"><header><div><small>ACTIVITY</small><h3>每週比賽走勢</h3></div><strong>{stats.matches.length}<small>場</small></strong></header><div className="recent-week-chart" aria-label={`過去四週比賽場數：${stats.weekCounts.join("、")}`}>{stats.weekCounts.map((value,index)=><div key={`week-${index}`}><span><i style={{height:`${Math.max(8,value/maxWeek*100)}%`}}/></span><b>{value}</b><small>第 {index+1} 週</small></div>)}</div></article>
      <article className="recent-chart-card recent-outcome-chart"><header><div><small>OUTCOMES</small><h3>賽事結果分布</h3></div></header><div className="recent-donut-wrap"><div className="recent-donut" style={{"--decisive":`${stats.decisive/stats.matches.length*360}deg`} as Record<string,string>}><span><b>{Math.round(stats.decisive/stats.matches.length*100)}%</b><small>分勝負</small></span></div><div className="recent-chart-legend"><span><i className="decisive"/><b>分勝負</b><em>{stats.decisive} 場</em></span><span><i className="draw"/><b>和局</b><em>{stats.draws} 場</em></span></div></div></article>
      <article className="recent-chart-card recent-balance-chart"><header><div><small>COMPETITION</small><h3>對賽緊湊度</h3></div></header><div className="recent-balance-hero"><b>{Math.round(stats.closeMatches/stats.matches.length*100)}<small>%</small></b><span>賽事僅相差一局或以下</span></div><footer><span>緊湊賽事 <b>{stats.closeMatches}</b></span><span>平均差距 <b>{stats.averageMargin.toFixed(1)} 局</b></span></footer></article>
    </div>
    <div className="recent-detail-grid">
      {stats.rivalry&&<button className="recent-detail-card" onClick={()=>onRivalry(stats.rivalry!.aPlayer,stats.rivalry!.bPlayer)} aria-label={`查看 ${stats.rivalry.aPlayer.name} 對 ${stats.rivalry.bPlayer.name} 的對賽紀錄`}><small>熱門對賽</small><b>{stats.rivalry.aPlayer.name} × {stats.rivalry.bPlayer.name}</b><p>{stats.rivalry.matches} 場 · 局數 {stats.rivalry.framesA}–{stats.rivalry.framesB}</p><span>查看對賽紀錄 →</span></button>}
      {stats.closest&&<button className="recent-detail-card recent-close-card" onClick={()=>onMatch(stats.closest!)} aria-label={`查看 ${playerName(stats.closest.a)} 對 ${playerName(stats.closest.b)} 的賽事`}><small>最接近賽事</small><b>{playerName(stats.closest.a)} {stats.closest.scoreA}–{stats.closest.scoreB} {playerName(stats.closest.b)}</b><p>{stats.closest.playedOn} · 相差 {Math.abs(stats.closest.scoreA-stats.closest.scoreB)} 局</p><span>查看賽事 →</span></button>}
    </div>  </section>;
}
function fadeHex(hex:string,alpha:number){
  const value=hex.replace("#","");
  const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const monthGroupLabel=(month:string)=>{
  const [y,m]=month.split("-").map(Number);
  const now=new Date(),thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  if(month===thisMonth)return "本月";
  const last=shiftMonth(thisMonth,-1);
  if(month===last)return "上月";
  return `${y}年${m}月`;
};

function Matches({data,canManageMatch,onEdit,onVoid,onPlayer,view,setView,pair,setPair,highlight}:{data:AppState;canManageMatch:(match:Match)=>boolean;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;onPlayer:(player:Player)=>void;view:"history"|"calendar";setView:(view:"history"|"calendar")=>void;pair:{a:string;b:string};setPair:(pair:{a:string;b:string})=>void;highlight:string|null}) {
  const [sortBy,setSortBy]=useState<"playedOn"|"createdAt">("playedOn");
  const [monthOpen,setMonthOpen]=useState<Record<string,boolean>>({});
  const [sortDirection,setSortDirection]=useState<"desc"|"asc">("desc");
  const [from,setFrom]=useState(""),[to,setTo]=useState("");
  const [filterOpen,setFilterOpen]=useState(false);
  // This component unmounts on every trip to another tab, so without a round
  // trip through storage a scouting session loses its sort and date range the
  // moment the user glances at 排行榜. Same restore-then-write shape as the
  // focus above, including the skipped first write.
  const prefsRestored=useRef(false);
  useEffect(()=>{
    const stored=localStorage.getItem("scaa-match-prefs");
    if(!stored)return;
    try{
      const value=JSON.parse(stored);
      if(value?.sortBy==="playedOn"||value?.sortBy==="createdAt")setSortBy(value.sortBy);
      if(value?.sortDirection==="asc"||value?.sortDirection==="desc")setSortDirection(value.sortDirection);
      if(typeof value?.from==="string")setFrom(value.from);
      if(typeof value?.to==="string")setTo(value.to);
    }catch{}
  },[]);
  useEffect(()=>{
    if(!prefsRestored.current){prefsRestored.current=true;return;}
    localStorage.setItem("scaa-match-prefs",JSON.stringify({sortBy,sortDirection,from,to}));
  },[sortBy,sortDirection,from,to]);
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
  const roster=[...data.players].sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  const focusPlayer=pair.a;
  const opponent=data.players.find(p=>p.id===pair.b);
  const a=data.players.find(p=>p.id===pair.a);
  // Picking a second player switches the same list into a head-to-head
  // comparison instead of jumping to a separate screen — one mental model,
  // one match card, for both "my results" and "us against each other".
  const comparing=Boolean(a&&opponent&&a.id!==opponent.id);
  const invalidRange=Boolean(from&&to&&from>to),filtered=Boolean(from||to);
  const matches=useMemo(()=>{
    if(comparing){
      return data.matches
        .filter(m=>m.status==="confirmed"&&((m.a===a!.id&&m.b===opponent!.id)||(m.a===opponent!.id&&m.b===a!.id))&&(!from||m.playedOn>=from)&&(!to||m.playedOn<=to))
        .sort((left,right)=>right.playedOn.localeCompare(left.playedOn)||right.createdAt.localeCompare(left.createdAt));
    }
    return [...data.matches]
      .filter(m=>!focusPlayer||m.a===focusPlayer||m.b===focusPlayer)
      .sort((left,right)=>{
        const primary=left[sortBy].localeCompare(right[sortBy]);
        const tieBreak=left.createdAt.localeCompare(right.createdAt);
        return sortDirection==="asc"?(primary||tieBreak):-(primary||tieBreak);
      });
  },[data.matches,sortBy,sortDirection,focusPlayer,comparing,a,opponent,from,to]);
  // When one player is in focus, their record across the filtered set is the
  // headline; the raw list alone makes you tally it yourself.
  const focusSummary=useMemo(()=>{
    if(!focusPlayer||comparing)return null;
    return matches.reduce((total,m)=>{
      if(m.status!=="confirmed")return total;
      const first=m.a===focusPlayer,own=first?m.scoreA:m.scoreB,other=first?m.scoreB:m.scoreA;
      total.net+=first?m.deltaA:-m.deltaA;
      if(own>other)total.wins++;else if(own<other)total.losses++;else total.draws++;
      return total;
    },{wins:0,losses:0,draws:0,net:0});
  },[matches,focusPlayer,comparing]);
  const h2hStats=useMemo(()=>{
    if(!comparing)return null;
    return matches.reduce((total,match)=>{const first=match.a===a!.id,scoreA=first?match.scoreA:match.scoreB,scoreB=first?match.scoreB:match.scoreA;total.framesA+=scoreA;total.framesB+=scoreB;if(scoreA>scoreB)total.winsA++;else if(scoreA<scoreB)total.winsB++;else total.draws++;return total;},{winsA:0,winsB:0,draws:0,framesA:0,framesB:0});
  },[matches,comparing,a]);
  const decided=Math.max(1,(h2hStats?.winsA??0)+(h2hStats?.winsB??0)+(h2hStats?.draws??0));
  const aShare=h2hStats?Math.round((h2hStats.winsA+h2hStats.draws/2)/decided*100):50;
  // Last 5 meetings, most recent first — the quick "who's hot" read that a
  // plain win/loss tally can't give you.
  const recentForm=useMemo(()=>{
    if(!comparing||!a)return [];
    return matches.slice(0,5).map(match=>{
      const first=match.a===a.id,own=first?match.scoreA:match.scoreB,other=first?match.scoreB:match.scoreA;
      return own>other?"W":own<other?"L":"D";
    });
  },[matches,comparing,a]);
  const setFocus=(id:string)=>setPair({a:id,b:id===pair.b?"":pair.b});
  const setOpponent=(id:string)=>setPair({...pair,b:id});
  const clearAll=()=>{setPair({a:"",b:""});setFrom("");setTo("")};
  const filterLabel=comparing?`${name(focusPlayer)} 對 ${opponent!.name}`:focusPlayer?name(focusPlayer):"全部球員";
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
  const newestMonth=groups.reduce((latest,group)=>group.key>latest?group.key:latest,"");
  return <><section className="hero small"><div><p className="kicker">完整可追溯</p><h1>比賽記錄</h1><p>查看比分、讓分與每場 ELO 變化。</p></div></section>
    <div className="match-view-toggle" role="tablist" aria-label="比賽資料檢視"><button role="tab" aria-selected={view==="history"} className={view==="history"?"active":""} onClick={()=>setView("history")}>賽事記錄</button><button role="tab" aria-selected={view==="calendar"} className={view==="calendar"?"active":""} onClick={()=>setView("calendar")}>日曆</button></div>
    {view==="calendar"?<CalendarView data={data} canManageMatch={canManageMatch} onPlayer={onPlayer} onEdit={onEdit} onVoid={onVoid}/>:<>
    <div className="match-filter-bar">
      <button type="button" className={`match-filter-pill${focusPlayer?" active":""}`} aria-haspopup="dialog" aria-expanded={filterOpen} onClick={()=>setFilterOpen(value=>!value)}>
        <i aria-hidden="true">⇅</i>{filterLabel}<i aria-hidden="true">{filterOpen?"︿":"﹀"}</i>
      </button>
      {focusPlayer&&<button type="button" className="match-filter-clear" onClick={clearAll}>清除</button>}
    </div>
    {filterOpen&&<div className="match-filter-sheet" role="dialog" aria-label="篩選比賽記錄">
      <label>球員<PlayerCombobox players={roster} value={focusPlayer} onChange={setFocus} placeholder="全部球員" clearLabel="全部球員" ariaLabel="球員" allowClear/></label>
      {focusPlayer&&<label>比較對手<PlayerCombobox players={roster.filter(p=>p.id!==focusPlayer)} value={pair.b} onChange={setOpponent} placeholder="不比較" clearLabel="不比較" ariaLabel="比較對手" allowClear/></label>}
      {!comparing&&<label>排序依據<select value={sortBy} onChange={event=>setSortBy(event.target.value as "playedOn"|"createdAt")}><option value="playedOn">比賽日期</option><option value="createdAt">加入日期</option></select></label>}
      {!comparing&&<label>次序<select value={sortDirection} onChange={event=>setSortDirection(event.target.value as "desc"|"asc")}><option value="desc">最新至最舊</option><option value="asc">最舊至最新</option></select></label>}
      {comparing&&<div className="h2h-date-fields"><label>開始日期<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>結束日期<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div>}
      {comparing&&filtered&&<button type="button" className="h2h-clear" onClick={()=>{setFrom("");setTo("")}}>清除日期</button>}
      {invalidRange&&<p className="h2h-filter-error">開始日期不能晚於結束日期。</p>}
    </div>}
    {focusPlayer&&!comparing&&focusSummary&&<p className="insight-strip">{matches.length} 場 · {focusSummary.wins} 勝 {focusSummary.losses} 負 {focusSummary.draws} 和 · ELO <b className={focusSummary.net>=0?"positive":"negative"}>{focusSummary.net>=0?"+":""}{Math.round(focusSummary.net)}</b></p>}
    {comparing&&a&&opponent&&h2hStats&&<div className="h2h-summary neutral">
      <div className="h2h-hero-players">
        <div className="h2h-hero-player"><PlayerBadge player={a}/><b>{a.name}</b><small>{Math.round(a.rating)} ELO</small></div>
        <div className="h2h-hero-score"><span><b>{h2hStats.winsA}</b><em>–</em><b>{h2hStats.winsB}</b></span>{h2hStats.draws>0&&<small>{h2hStats.draws} 和</small>}</div>
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
      {recentForm.length>0&&<div className="h2h-hero-form"><small>近{recentForm.length}場</small><div className="h2h-form-dots">{recentForm.map((result,index)=><i key={index} className={`form-dot ${result.toLowerCase()}`} aria-label={result==="W"?"勝":result==="L"?"負":"和"}>{result}</i>)}</div></div>}
      <div className="h2h-hero-stats">
        <div><small>局數比例</small><b>{h2hStats.framesA}<em>–</em>{h2hStats.framesB}</b></div>
        <div><small>總場數</small><b>{matches.length}</b></div>
        <div><small>最近交手</small><b>{matches[0]?.playedOn??"—"}</b></div>
      </div>
    </div>}
    <div className="match-list">{groups.length===0?<Empty text={comparing?"沒有符合的對賽記錄":focusPlayer?"沒有符合的比賽記錄":"尚未有比賽記錄"} sub={comparing?"調整日期範圍，或記錄兩人的第一場比賽。":focusPlayer?"這位球員暫時沒有已記錄的賽事。":"記錄第一場比賽後，詳情會顯示在這裡。"}/>:groups.map(group=>{
      const cards=group.matches.map(m=><MatchCard key={m.id} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid} highlighted={m.id===highlight}/>);
      if(comparing)return <Fragment key={group.key}>{cards}</Fragment>;
      const open=monthOpen[group.key]??(group.key===newestMonth||group.matches.some(m=>m.id===highlight));
      const panelId=`match-month-${group.key}`;
      return <section className="match-month-group" key={group.key}>
        <button type="button" className="match-month-header" aria-expanded={open} aria-controls={panelId} onClick={()=>setMonthOpen(value=>({...value,[group.key]:!open}))}>
          <span>{monthGroupLabel(group.key)}</span><small>{group.matches.length} 場</small><i aria-hidden="true"/>
        </button>
        {open&&<div className="match-month-cards" id={panelId}>{cards}</div>}
      </section>;
    })}</div></>}</>;
}

// Collapsed by default: who played, the score, and each player's own ELO
// swing — the facts a user scans for. Edit/delete controls and the deeper
// math (before→after, predicted ratio, handicap detail) stay one tap away.
function MatchCard({match:m,canManage,name,onPlayer,onEdit,onVoid,highlighted=false}:{match:Match;canManage:boolean;name:(id:string)=>string;onPlayer:(id:string)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void;highlighted?:boolean}) {
  const [open,setOpen]=useState(false);
  // Scrolling to the card beats trusting it to be at the top: a backdated
  // result, or an ascending sort, can drop it anywhere in the month groups.
  const card=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!highlighted)return;
    card.current?.scrollIntoView({behavior:"smooth",block:"center"});
  },[highlighted]);
  // Only the highest break per player is worth a glance — a player who ran
  // three centuries in one match still shows once, at their best number.
  const topBreaks=[m.a,m.b]
    .map(id=>{
      const best=m.highBreaks?.filter(b=>b.playerId===id).reduce((max,item)=>Math.max(max,item.value),0)??0;
      return best>0?{playerId:id,value:best}:null;
    })
    .filter((entry):entry is {playerId:string;value:number}=>entry!=null);
  return <article ref={card} className={`match ${m.status}${highlighted?" just-saved":""}`}>
    <div className="match-board"><div className="match-top"><span className="match-when"><time dateTime={m.playedOn}>{m.playedOn}</time><small className="match-net-elo" aria-label={`ELO ${Math.round(Math.abs(m.deltaA))}`}>ELO {Math.round(Math.abs(m.deltaA))}</small>{highlighted&&<span className="pill just-saved-pill">剛剛記錄</span>}{m.status==="void"&&<span className="pill">已作廢</span>}{m.entryMode==="aggregate"&&<span className="pill muted">歷史匯總</span>}</span>
      {canManage&&<span className="card-tools"><button className="card-tool" aria-label={`編輯 ${name(m.a)} 對 ${name(m.b)} 的賽事`} onClick={()=>onEdit(m)}>✎</button><button className="card-tool danger" aria-label={`刪除 ${name(m.a)} 對 ${name(m.b)} 的賽事`} onClick={()=>onVoid(m)}>✕</button></span>}</div>
    <Scoreline left={name(m.a)} right={name(m.b)} onLeftClick={()=>onPlayer(m.a)} onRightClick={()=>onPlayer(m.b)} scoreLeft={m.scoreA} scoreRight={m.scoreB}
      eloLeft={{before:m.beforeA,after:m.afterA,delta:m.deltaA}} eloRight={{before:m.beforeB,after:m.afterB,delta:-m.deltaA}}/>
    <button type="button" className="match-summary-row" aria-expanded={open} aria-label={open?"收起比賽詳情":"展開比賽詳情"} onClick={()=>setOpen(value=>!value)}>
      {!!topBreaks.length&&<span className="match-net-breaks">★ {topBreaks.map((item,index)=><Fragment key={item.playerId}>{index>0&&"、"}{name(item.playerId)} 單桿 {item.value}</Fragment>)}</span>}
      <span className="match-expand-toggle" aria-hidden="true"><i/></span>
    </button>
    </div>
    {open&&<div className="match-body">
    <div className="elo-impact" aria-label="本場 ELO 影響">
      <small>預測 {name(m.a)} 局數比例 {Math.round(m.expectedA*100)}%</small>
    </div>
    {!!topBreaks.length&&<div className="match-breaks"><span>單桿</span>{topBreaks.map(item=><b key={item.playerId}>{name(item.playerId)} {item.value}</b>)}</div>}
    <p><Term label="實際讓分" tip="該筆比賽雙方真正採用的每局讓分；它會影響賽前預期及 ELO 變化。"/> {m.actual>0?`${name(m.a)} 讓 ${m.actual}`:m.actual<0?`${name(m.b)} 讓 ${Math.abs(m.actual)}`:"無"} · <Term label="額外讓分" tip="實際讓分與正式讓分參考之間的差距；正式讓分缺失時以 0 作比較基準。"/> {m.extra}</p>
    <small className="match-added">加入於 {new Date(m.createdAt).toLocaleString("zh-HK")}</small></div>}
  </article>;
}

const weekdayLabels=["一","二","三","四","五","六","日"];
function shiftMonth(month:string,delta:number){
  const [y,m]=month.split("-").map(Number);
  const d=new Date(y,m-1+delta,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function monthGrid(month:string){
  const [y,m]=month.split("-").map(Number);
  const startOffset=(new Date(y,m-1,1).getDay()+6)%7;
  const daysInMonth=new Date(y,m,0).getDate();
  const cells:(string|null)[]=Array.from({length:startOffset},()=>null);
  for(let d=1;d<=daysInMonth;d++)cells.push(`${month}-${String(d).padStart(2,"0")}`);
  while(cells.length%7!==0)cells.push(null);
  return cells;
}
function monthLabel(month:string){
  const [y,m]=month.split("-").map(Number);
  return `${y}年${m}月`;
}

function CalendarView({data,canManageMatch,onPlayer,onEdit,onVoid}:{data:AppState;canManageMatch:(match:Match)=>boolean;onPlayer:(player:Player)=>void;onEdit:(m:Match)=>void;onVoid:(m:Match)=>void}) {
  const name=(id:string)=>data.players.find(p=>p.id===id)?.name??"已刪除球員";
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
  const grid=useMemo(()=>monthGrid(month),[month]);
  const goToMonth=(next:string)=>{setMonth(next);setSelectedDay(null)};
  const selectedMatches=selectedDay?dayMatches.get(selectedDay)??[]:[];
  return <section className="calendar-view">
    <div className="calendar-nav">
      <button type="button" className="calendar-nav-btn" aria-label="上一個月" disabled={month<=bounds.min} onClick={()=>goToMonth(shiftMonth(month,-1))}>‹</button>
      <b>{monthLabel(month)}</b>
      <button type="button" className="calendar-nav-btn" aria-label="下一個月" disabled={month>=bounds.max} onClick={()=>goToMonth(shiftMonth(month,1))}>›</button>
    </div>
    <div className="calendar-body">
      <div className="calendar-weekdays">{weekdayLabels.map(w=><span key={w}>{w}</span>)}</div>
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
          aria-pressed={isSelected} aria-label={`${date}${count?`，${count} 場比賽`:"，沒有比賽"}`}
          onClick={()=>setSelectedDay(isSelected?null:date)}>
          <span className="calendar-date">{Number(date.slice(8))}</span>
          {count>0&&<span className="calendar-count">{count}</span>}
          {hasCentury&&<i className="calendar-century" aria-hidden="true" title="破百單桿">★</i>}
        </button>;
      })}</div>
      {dayMatches.size===0&&<div className="calendar-empty-overlay"><Empty text="本月沒有比賽記錄" sub="使用上方箭嘴切換到有記錄的月份。"/></div>}
    </div>
    {selectedDay&&<div className="calendar-day-detail">
      <div className="calendar-day-head"><h3><time dateTime={selectedDay}>{selectedDay}</time></h3><span>{selectedMatches.length} 場</span></div>
      <div className="calendar-day-list">{selectedMatches.map(m=>
        <MatchCard key={m.id} match={m} canManage={canManageMatch(m)} name={name} onPlayer={id=>{const player=data.players.find(item=>item.id===id);if(player)onPlayer(player)}} onEdit={onEdit} onVoid={onVoid}/>)}</div>
    </div>}
  </section>;
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


function Players({data,canAdd,canManagePlayer,onAdd,onEdit,onDelete,onOpen,onCompare}:{data:AppState;canAdd:boolean;canManagePlayer:(player:Player)=>boolean;onAdd:()=>void;onEdit:(p:Player)=>void;onDelete:(p:Player)=>void;onOpen:(p:Player)=>void;onCompare:(p:Player)=>void}) {
  const [sort,setSort]=useState<SortKey>("rank"),[dir,setDir]=useState<"asc"|"desc">("asc"),[view,setView]=useState<"cards"|"list">("cards"),[query,setQuery]=useState("");
  const ranked=[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),sorted=sortPlayers(data.players,data,sort,dir),rankOf=new Map(ranked.map((p,i)=>[p.id,i+1]));
  const q=query.trim().toLowerCase(),shown=q?sorted.filter(p=>p.name.toLowerCase().includes(q)||p.short.toLowerCase().includes(q)):sorted;
  const sortBy=(key:SortKey)=>{if(sort===key)setDir(x=>x==="asc"?"desc":"asc");else{setSort(key);setDir(key==="rank"||key==="name"?"asc":"desc")}};
  return <><section className="hero small"><div><p className="kicker">球會名單</p><h1>球員</h1><p>管理職員提供的正式評分，並比較 ELO 建議評分。</p></div>{canAdd&&<button className="primary" onClick={onAdd}>＋ 新增球員</button>}</section>
    <div className="player-toolbar"><SortControls sort={sort} dir={dir} onSort={sortBy}/><div className="player-combobox toolbar-search"><input type="text" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜尋球員…" aria-label="搜尋球員"/></div><div className="view-toggle" aria-label="顯示模式"><button className={view==="cards"?"active":""} onClick={()=>setView("cards")}>卡片</button><button className={view==="list"?"active":""} onClick={()=>setView("list")}>列表</button></div></div>
    <div className={`player-grid ${view==="list"?"list-view":""}`}>{data.players.length===0?<Empty text="尚未有球員" sub="新增球員後便可開始記錄比賽。"/>:shown.length===0?<Empty text="找不到符合的球員" sub="試試其他名稱或縮寫。"/>:shown.map(p=>{const suggested=suggestedHandicap(p,data),difference=p.handicap==null?null:suggested-p.handicap;return <article className="player-card rich" key={p.id}><button className="profile-hit" onClick={()=>onOpen(p)}><PlayerBadge player={p}/><div className="player-main"><div><small>排名 #{rankOf.get(p.id)}</small><h3>{p.name}</h3><p><b>{Math.round(p.rating)}</b> ELO · {games(p)} 場 · {Math.round(winRate(p)*100)}% 勝率</p></div><Sparkline values={playerSeries(p,data)} label={`${p.name} ELO 趨勢`}/></div></button><div className="rating-compare"><span><small>正式評分</small><b>{p.handicap??"—"}</b></span><span><small>建議評分</small><b>{suggested==null?"—":Math.round(suggested)}</b></span><span><small>差異</small><b className={difference!=null&&difference>0?"positive":difference!=null&&difference<0?"negative":""}>{difference==null?"—":`${difference>0?"+":""}${Math.round(difference)}`}</b></span><span><small>局數勝率</small><b>{Math.round(frameRate(p)*100)}%</b></span></div><div className="player-card-foot"><span className="form">{p.form.map((x,j)=><i className={x.toLowerCase()} key={j}>{x}</i>)}</span>{canManagePlayer(p)&&<span className="card-tools player-actions"><button className="card-tool" aria-label={`編輯 ${p.name}`} onClick={()=>onEdit(p)}>✎</button>{canAdd&&<button className="card-tool danger" aria-label={`刪除 ${p.name}`} onClick={()=>onDelete(p)}>✕</button>}</span>}</div></article>})}</div></>;
}

function SettingsView({data,onEdit,onReset,canReset}:{data:AppState;onEdit:()=>void;onReset:()=>void;canReset:boolean}) {
  const s=data.settings,c=s.calibration; return <><section className="hero small"><div><p className="kicker">公開設定</p><h1>ELO 設定</h1><p>實際讓分直接影響 ELO；正式讓分只作參考。</p></div><button className="primary" onClick={onEdit}>編輯設定</button></section>
    <div className="settings-grid"><div className="setting"><small><Term label="起始 ELO" tip="球員加入時的評分起點；個別球員可另行設定，修改後會重播歷史賽果。"/></small><b>{s.start}</b></div><div className="setting"><small><Term label="臨時門檻" tip="球員完成此數量的比賽前會標示為臨時評分，並使用較大的臨時 K 值。"/></small><b>{s.provisionalGames} 場</b></div><div className="setting"><small><Term label="K 值" tip="控制每次賽果令 ELO 改變多少；數值越高，評分調整越快。"/></small><b>{s.kProvisional} / {s.kRated}</b></div><div className="setting"><small><Term label="持續校準換算率" tip="10 分附近每 1 分實際讓分相當於多少 ELO；會按累積賽果逐步重新估算。"/></small><b>{s.conversion} ELO／分</b></div><div className="setting"><small><Term label="讓分曲線" tip="大讓分難度的非線性增幅；1 為線性，數值越高，20、40、100 分的難度上升越快。"/></small><b>{s.curvature??1.25}</b></div><div className="setting"><small><Term label="軟上限" tip="用平滑曲線限制極端讓分的等效 ELO；額外讓分仍有影響，但不會無限增長。"/></small><b>±{s.handicapSoftCap??800} ELO</b></div><div className="setting"><small><Term label="勝者獎勵" tip="勝方加入的虛擬局數；預設半局，使 3–2 略優於 3–3，但不會出現巨大跳升。"/></small><b>{s.winnerBonus??.5} 局</b></div><div className="setting"><small><Term label="超額讓分加乘" tip="球員承受比雙方 ELO 公平線更艱難的讓分，仍打和或勝出時，額外放大其 ELO 回報；不利程度越高，加乘越大。"/></small><b>最高 +{Math.round((s.overHandicapBoost??.75)*100)}%</b></div><div className="setting"><small><Term label="加乘尺度" tip="控制超額讓分加乘增長速度；數值越小，加乘越快接近上限。"/></small><b>{s.overHandicapScale??200} ELO</b></div></div>
    <section className="calibration-card"><div><p className="kicker">每場自動更新</p><h2><Term label="讓分換算持續學習" tip="每次賽果變動後，同時估計 10 分附近的 ELO 換算率與大讓分的非線性曲線。"/></h2><p>目前每讓 1 分約等於 <b>{s.conversion} ELO</b>，曲線為 <b>{s.curvature??1.25}</b>。系統比較預測與真實局數比例，最多採計每筆 20 局；正式讓分不參與計算。</p>{c?.history&&c.history.length>1&&<small className="calibration-history">最近校準：{c.history.slice(-5).map(x=>x.estimate).join(" → ")} ELO／分</small>}</div><div className="calibration-stats"><span><small><Term label="可用記錄" tip="具備有效局數、賽前 ELO，而且實際讓分不為 0 的記錄數量。"/></small><b>{c?.usableMatches??0}</b></span><span><small><Term label="實際讓分種類" tip="歷史資料出現過多少種不同的非零實際讓分數值；例如 4、8、12 分代表 3 種。"/></small><b>{c?.handicapLevels??0}</b></span><span><small><Term label="信心" tip="按可用記錄數及實際讓分種類評估校準可靠程度。"/></small><b>{c?.confidence??"資料不足"}</b></span><span><small><Term label="換算率範圍" tip="與最佳估算表現接近的一段 ELO／分換算率。"/></small><b>{c?`${c.lower}–${c.upper}`:"—"}</b></span><span><small><Term label="曲線範圍" tip="數據支持的非線性曲線範圍；資料不足時會保持接近 1.25。"/></small><b>{c?.curvatureLower!=null?`${c.curvatureLower}–${c.curvatureUpper}`:"—"}</b></span></div></section>
    {c?.history&&c.history.length>1&&<CalibrationTrend history={c.history} lower={c.lower} upper={c.upper} conversion={s.conversion} confidence={c.confidence} example={{points:10,elo:Math.round(handicapAdjustment(10,s))}}/>}
    <section className="audit"><h2>審計記錄</h2>{data.audits.slice(0,12).map(a=><div key={a.id}><span>{a.text}</span><small>{new Date(a.at).toLocaleString("zh-HK")}</small></div>)}</section>
    {canReset&&<section className="danger-zone"><div><h2>清除並重設資料</h2><p>永久刪除共用資料庫內所有球員、比賽及審計記錄，並恢復預設 ELO 設定。</p></div><button onClick={onReset}>清除所有資料</button></section>}</>;
}

function MatchForm({data,draft,setDraft,preview,a,b,editing,onSave}:{data:AppState;draft:any;setDraft:any;preview:any;a:Player;b:Player;editing:boolean;onSave:()=>void}) {
  const [breakInput,setBreakInput]=useState<Record<string,string>>({});
  const eloPreviewRef=useRef<HTMLElement|null>(null);
  const hadEloPreview=useRef(false);
  const [breakOpen,setBreakOpen]=useState<Record<string,boolean>>({});
  const [customHandicap,setCustomHandicap]=useState(editing||Boolean(draft.giver));
  const update=(k:string,v:any)=>setDraft((d:any)=>({...d,[k]:v}));
  const players=[...data.players].filter(p=>p.active).sort((left,right)=>left.name.localeCompare(right.name,"zh-HK"));
  // The job here is "log the match I just played" — once one side is picked,
  // the very next thing the person needs is the opponent, so each slot hides
  // whoever is already chosen on the other side (no accidental self-match)
  // and picking one side jumps straight into the other, so two taps read as
  // one motion instead of "pick, look up, tap again".
  const playersForA=players.filter(p=>p.id!==draft.b);
  const playersForB=players.filter(p=>p.id!==draft.a);
  const [openASignal,setOpenASignal]=useState(0);
  const [openBSignal,setOpenBSignal]=useState(0);
  const pickA=(id:string)=>{update("a",id);if(id&&!draft.b)setOpenBSignal(s=>s+1)};
  const pickB=(id:string)=>{update("b",id);if(id&&!draft.a)setOpenASignal(s=>s+1)};
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
    setCustomHandicap(false);
  };
  const setNoHandicap=()=>{
    setDraft((d:any)=>({...d,giver:"",points:0}));
    setCustomHandicap(false);
  };
  const changeScore=(key:"scoreA"|"scoreB",amount:number)=>setDraft((d:any)=>({...d,[key]:Math.max(0,+d[key]+amount)}));
  const totalFrames=+draft.scoreA + +draft.scoreB;
  const hasEloPreview=Boolean(preview&&totalFrames>0);
  useEffect(()=>{
    if(hasEloPreview&&!hadEloPreview.current){
      requestAnimationFrame(()=>eloPreviewRef.current?.scrollIntoView({behavior:"smooth",block:"center"}));
    }
    hadEloPreview.current=hasEloPreview;
  },[hasEloPreview]);
  const valid=Boolean(a&&b&&a.id!==b.id&&totalFrames>0);
  const resultLabel=!valid?"輸入最終比分":draft.scoreA===draft.scoreB?`${draft.scoreA}–${draft.scoreB} 和局`:draft.scoreA>draft.scoreB?`${a.name} 勝 ${draft.scoreA}–${draft.scoreB}`:`${b.name} 勝 ${draft.scoreB}–${draft.scoreA}`;
  const handicapLabel=draft.giver&&+draft.points>0?`${draft.giver===a?.id?a?.name:b?.name} 每局讓 ${draft.points} 分`:"沒有讓分";
  const dateLabel=draft.date===today?"今天":draft.date;
  const fairPoints=Math.round(Math.abs(fairActual??0));
  return <div className="match-form"><div className="match-form-head"><div className="match-title-row"><h2 className="accent">{editing?"編輯比賽":"記錄比賽"}</h2><div className="match-date-chip"><span aria-hidden="true">{dateLabel}<i aria-hidden="true">›</i></span><input aria-label={`比賽日期，目前為${dateLabel}`} type="date" value={draft.date} onChange={e=>update("date",e.target.value)} onClick={e=>{const input=e.currentTarget;if(typeof input.showPicker==="function")input.showPicker()}}/></div></div></div>
    {editing&&<p className="sub">儲存後會按日期重播全部賽事，重建雙方及後續 ELO。</p>}
    {data.players.length<2&&<p className="warning">請先新增至少兩位活躍球員。</p>}
    <section className="match-players" aria-labelledby="match-players-title"><h3 id="match-players-title" className="visually-hidden">選擇球員</h3><div className="matchup-card">
      <div className="matchup-slot"><PlayerCombobox players={playersForA} value={draft.a} onChange={pickA} placeholder="選擇球員" ariaLabel="球員 A" autoOpenSignal={openASignal}
        renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true"> <PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO`:"—"}</small></span></button>}/></div>
      <span className="matchup-vs" aria-hidden="true">對</span>
      <div className="matchup-slot"><PlayerCombobox players={playersForB} value={draft.b} onChange={pickB} placeholder="選擇球員" ariaLabel="球員 B" autoOpenSignal={openBSignal}
        renderTrigger={(selected,open)=><button type="button" className="matchup-trigger" onClick={open}><span aria-hidden="true"> <PlayerBadge player={selected??{short:"?"}} className="matchup-avatar"/></span><span className="matchup-player-info"><b>{selected?.name??"選擇球員"}</b><small>{selected?`${Math.round(selected.rating)} ELO`:"—"}</small></span></button>}/></div>
    </div></section>
    <section className="quick-handicap" aria-labelledby="handicap-title"><h3 id="handicap-title">讓分 <small>{handicapLabel}</small></h3><div className="handicap-segment"><button type="button" className={!draft.giver&&!customHandicap?"active":""} onClick={setNoHandicap}>沒有讓分</button><button type="button" disabled={fairActual==null} className={draft.giver&&+draft.points===fairPoints&&!customHandicap?"active":""} onClick={fairPoints===0?setNoHandicap:applyFair}>ELO 建議</button><button type="button" className={customHandicap?"active":""} onClick={()=>setCustomHandicap(value=>!value)}>自訂</button></div>
      {customHandicap&&<div className="custom-handicap"><label>讓分球員<select value={draft.giver} onChange={e=>update("giver",e.target.value)}><option value="">沒有讓分</option><option value={a?.id}>{a?.name}</option><option value={b?.id}>{b?.name}</option></select></label><label>每局分數<input type="number" inputMode="numeric" min="0" step="1" value={draft.points} onChange={e=>update("points",Math.max(0,+e.target.value))}/></label></div>}
    </section>
    <section className="score-panel" aria-labelledby="score-title">{preview&&<div className="predicted-ratio"><div><span>預測局數比例</span><b>{a.short} {Math.round(preview.expectedA*100)}% · {Math.round((1-preview.expectedA)*100)}% {b.short}</b></div><em aria-label={`${a.name} ${Math.round(preview.expectedA*100)}%，${b.name} ${Math.round((1-preview.expectedA)*100)}%`}><i style={{width:`${Math.round(preview.expectedA*100)}%`}}/></em></div>}<h3 id="score-title">最終比分</h3><div className="scoreboard-entry">
      <div><b>{a?.name??"球員 A"}</b><div className="score-row"><button type="button" aria-label={`${a?.name??"球員 A"}減一局`} onClick={()=>changeScore("scoreA",-1)}>−</button><input className="score-value" aria-label={`${a?.name??"球員 A"}局數`} type="number" inputMode="numeric" min="0" value={draft.scoreA} onChange={e=>update("scoreA",Math.max(0,+e.target.value))}/><button type="button" aria-label={`${a?.name??"球員 A"}加一局`} onClick={()=>changeScore("scoreA",1)}>＋</button></div>
        {a&&<div className="break-inline">{(breakOpen[a.id]||(draft.highBreaks??[]).some((item:{playerId:string})=>item.playerId===a.id))&&<p className="break-heading">單桿度數</p>}<div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===a.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={`移除 ${a.name} 的 ${item.value} 分單桿度數`}>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[a.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(a.id)}}><input autoFocus className="break-value" aria-label={`${a.name} 單桿度數`} type="number" inputMode="numeric" min="1" max="147" placeholder="度數" value={breakInput[a.id]??""} onChange={event=>setBreakInput(current=>({...current,[a.id]:event.target.value}))}/><button type="submit">加入</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[a.id]:true}))}>＋ 單桿度數</button>}
        </div>}
      </div>
      <strong aria-hidden="true">–</strong>
      <div><b>{b?.name??"球員 B"}</b><div className="score-row"><button type="button" aria-label={`${b?.name??"球員 B"}減一局`} onClick={()=>changeScore("scoreB",-1)}>−</button><input className="score-value" aria-label={`${b?.name??"球員 B"}局數`} type="number" inputMode="numeric" min="0" value={draft.scoreB} onChange={e=>update("scoreB",Math.max(0,+e.target.value))}/><button type="button" aria-label={`${b?.name??"球員 B"}加一局`} onClick={()=>changeScore("scoreB",1)}>＋</button></div>
        {b&&<div className="break-inline">{(breakOpen[b.id]||(draft.highBreaks??[]).some((item:{playerId:string})=>item.playerId===b.id))&&<p className="break-heading">單桿度數</p>}<div className="break-chips">{(draft.highBreaks??[]).map((item:{playerId:string;value:number},index:number)=>item.playerId===b.id?<button type="button" key={index} onClick={()=>removeBreak(index)} aria-label={`移除 ${b.name} 的 ${item.value} 分單桿度數`}>{item.value}<span>×</span></button>:null)}</div>
          {breakOpen[b.id]?<form className="break-add" onSubmit={event=>{event.preventDefault();addBreak(b.id)}}><input autoFocus className="break-value" aria-label={`${b.name} 單桿度數`} type="number" inputMode="numeric" min="1" max="147" placeholder="度數" value={breakInput[b.id]??""} onChange={event=>setBreakInput(current=>({...current,[b.id]:event.target.value}))}/><button type="submit">加入</button></form>:<button type="button" className="break-add-toggle" onClick={()=>setBreakOpen(current=>({...current,[b.id]:true}))}>＋ 單桿度數</button>}
        </div>}
      </div>
    </div></section>
    {preview&&totalFrames>0&&<section ref={eloPreviewRef} className="elo-preview"><div><span><small>{a.name}</small><b className={preview.deltaA>=0?"positive":"negative"}>{preview.deltaA>=0?"+":""}{Math.round(preview.deltaA)} ELO</b></span><i aria-hidden="true">↔</i><span className="right"><small>{b.name}</small><b className={preview.deltaA<=0?"positive":"negative"}>{-preview.deltaA>=0?"+":""}{Math.round(-preview.deltaA)} ELO</b></span></div><details><summary>查看計算詳情</summary><p>{probabilities?`A 勝 ${Math.round(probabilities.win*100)}% · 和 ${Math.round(probabilities.draw*100)}% · `:""}表現分 {Math.round(preview.performanceScore*100)}% · 證據權重 ×{preview.evidenceWeight.toFixed(2)} · 讓分等效 {preview.adjustment>=0?"+":""}{Math.round(preview.adjustment)} ELO</p></details></section>}
    <div className="match-save"><button className="primary full" disabled={!valid||data.players.length<2} onClick={onSave}>{editing?"儲存變更":"儲存賽果"}<small>{resultLabel}</small></button></div>
  </div>;
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
        <PlayerBadge player={rival.opponent}/><span className="rivalry-person"><small>{rival.label}</small><b>{rival.opponent.name}</b><em>{rival.matches?`${rival.wins} 勝 · ${rival.losses} 負 · ${rival.draws} 和`:`歷史局數匯總`}{rival.hasAggregate&&rival.matches?" · 另有匯總":""}</em></span>
        <span className="rivalry-heat"><b>{percent}%</b><small>{rival.matches?"場數勝率":"局數勝率"}</small><em aria-hidden="true"><i style={{width:`${percent}%`,opacity:confidence}}/></em></span><strong>›</strong>
      </button>;
    })}</div>}
  </section>;
}

/** Buckets a break value into its ten-point band, e.g. 47→"40-49", 100+→"100+". */
function breakBand(value:number){ return value>=100?"100+":`${Math.floor(value/10)*10}-${Math.floor(value/10)*10+9}`; }
/** Groups the player's recorded breaks into ten-point bands (20-29 up to 100+) so the shape of their form shows at a glance, rather than a flat list of individual scores. */
function BreakStats({player,data}:{player:Player;data:AppState}) {
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
  return <section className="break-stats">
    <div className="break-stats-head"><div><p className="kicker">單桿表現</p><h3>最高單桿</h3></div><b>{highest}</b></div>
    <div className="break-bar-chart">{allBands.map(band=>{const count=counts.get(band)??0;return <div className="break-bar-row" key={band}>
      <span className="break-bar-label">{band}</span>
      <span className="break-bar-track"><i style={{width:count?`${8+count/maxCount*92}%`:"0%"}}/></span>
      <span className="break-bar-count">{count||""}</span>
    </div>})}</div>
    <p className="chart-summary">共 {breaks.length} 桿記錄。</p>
  </section>;
}

function PlayerDetail({player,rank,data,onCompare,onViewAllMatches,onMatch}:{player:Player;rank:number;data:AppState;onCompare:(opponent:Player)=>void;onViewAllMatches:()=>void;onMatch:(matchId:string)=>void}) { const g=games(player),related=data.matches.filter(m=>m.a===player.id||m.b===player.id),suggested=suggestedHandicap(player,data),series=playerSeries(player,data),trendPoints=playerTrendPoints(player,data),high=Math.max(...series),low=Math.min(...series);return <><div className="profile-head"><PlayerBadge player={player}/><div><p className="kicker">排名 #{rank||"—"}</p><h2>{player.name}</h2><p>{g<data.settings.provisionalGames?"臨時 ELO":"正式 ELO"}</p></div></div><div className="profile-stats"><div><small>目前 ELO</small><b>{Math.round(player.rating)}</b></div><div><small>正式讓分評分</small><b>{player.handicap??"未提供"}</b></div><div><small>ELO 建議評分</small><b>{suggested==null?"未提供":Math.round(suggested)}</b></div><div><small>勝／負／和</small><b>{player.wins}/{player.losses}/{player.draws}</b></div></div><BreakStats player={player} data={data}/><RecentMatches points={trendPoints} onViewAll={onViewAllMatches} onMatch={onMatch}/><section className="detail-chart interactive-detail"><div className="chart-head"><div><p className="kicker">評分軌跡</p><h3>ELO 走勢</h3></div><span>最高 {Math.round(high)} · 最低 {Math.round(low)}</span></div><InteractiveEloChart points={trendPoints} label={`${player.name} 從起始評分至目前的互動 ELO 走勢`}/><div className="chart-axis"><span>起始 {Math.round(series[0])}</span><span>目前 {Math.round(player.rating)}</span></div></section><RivalrySnapshot player={player} data={data} onCompare={onCompare}/><h3>表現摘要</h3><p className="summary">{player.name} 目前為 {Math.round(player.rating)} ELO，最近五場錄得 {player.form.filter(x=>x==="W").length} 勝、{player.form.filter(x=>x==="L").length} 負、{player.form.filter(x=>x==="D").length} 和；局數勝率為 {Math.round(frameRate(player)*100)}%。ELO 曾介乎 {Math.round(low)} 至 {Math.round(high)}，共有 {related.length} 筆可追溯賽事記錄。</p></>}
