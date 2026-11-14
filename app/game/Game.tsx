"use client";
/* Experience: a playable frame against the computer that feels like standing at the table.
   Reference: televised snooker and modern mobile cue-sports games; original graphics, no branding.
   Structure: the table fills the screen; a slim score strip above, three thumb controls below.
   Interaction: tap a ball to line it up, drag to adjust, pull the power bar and let go to strike.
   Teaching: the guides show the contact, the object ball's line and where the cue ball finishes,
   so every shot is practice at choosing the next one. Simplified single-frame rules. */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, ButtonLink, IconButton, SegmentedControl, StatTile } from '../components/ui/Primitives';
import { Sheet } from '../components/ui/Overlay';
import { aimAtBall, bestAim, COLOURS, computerPlan, cueSpotInD, deliverComputerShot, deliverShot, LEVELS, moving, NAMES, planShot, PLAYER_ERROR_SCALE, predictShot, PRO_ERROR_SCALE, step, type Level, type ShotPlan, type Spin } from '../../lib/snooker-game';
import { describePlan, EMPTY_STATS, focus, POCKET_NAMES, powerWord, record, reviewShot, spinWord, type CoachStats } from '../../lib/snooker-coach';
import { beginShot, finishShot, newMatch, newPractice, placeCueBall, pointsRemaining } from '../../lib/snooker-match';
import Table, { type Assist, type TableView } from './Table';
import { nearestAim } from '../../lib/snooker-aim';
import { type Stroke, STROKE_CONTACT_MS, STROKE_END_MS } from '../../lib/snooker-presentation';
import { createSound } from './sound';
import '../styles/snooker-game.css';

type Settings={assist:Assist;level:Level;sound:'on'|'off';camera:'auto'|'top'|'player';mode:'match'|'practice'};
const DEFAULT_SETTINGS:Settings={assist:'full',level:'club',sound:'on',camera:'auto',mode:'match'};
// Your stroke starts already drawn back, so it lands 180 ms after you let go.
const QUICK_STROKE_MS=STROKE_CONTACT_MS-180;
const wrap=(angle:number)=>((angle+180)%360+360)%360-180;
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value));
function thickness(fraction:number){return fraction>.93?'全球':fraction>.66?'3/4 球':fraction>.4?'半球':fraction>.18?'1/4 球':'薄邊';}

export default function Game(){
  const [initial]=useState(newMatch),match=useRef(initial),[snapshot,setSnapshot]=useState(initial);
  const [angle,setAngle]=useState(()=>nearestAim(initial.balls,initial.target)),[power,setPower]=useState(45),[top,setTop]=useState(0),[side,setSide]=useState(0);
  const [busy,setBusy]=useState(false),[pulling,setPulling]=useState(false),[layout,setLayout]=useState(0);
  const [settings,setSettings]=useState(DEFAULT_SETTINGS),[topView,setTopView]=useState(false);
  const [sheet,setSheet]=useState<null|'menu'|'coach'>(null),[spinOpen,setSpinOpen]=useState(false),[confirmReset,setConfirmReset]=useState(false);
  const [stroke,setStroke]=useState<Stroke|null>(null);
  // Coach: an on-demand professional's plan, a review of each of your shots,
  // and running stats (kept on this device) that choose what to practise next.
  const [advice,setAdvice]=useState<{text:string;plan?:ShotPlan}|null>(null),[applied,setApplied]=useState<ShotPlan|null>(null);
  const [review,setReview]=useState<{headline:string;tip:string}|null>(null),[note,setNote]=useState('');
  const [stats,setStats]=useState<CoachStats>(EMPTY_STATS);
  const active=useRef(false),pending=useRef<Stroke|null>(null),sequence=useRef(0);
  const planner=useRef<Worker|null>(null),requests=useRef(0),thinking=useRef(0),coachRequest=useRef(0);
  const yourShot=useRef<{power:number;spin:Spin;advised?:ShotPlan}|null>(null),picked=useRef({id:-1,cycle:0});
  const live=useRef(settings),sound=useRef<ReturnType<typeof createSound>|null>(null);
  useEffect(()=>{live.current=settings;sound.current?.setEnabled(settings.sound==='on');},[settings]);
  const lineUp=useCallback((assist:Assist)=>{
    const m=match.current;picked.current={id:-1,cycle:0};
    setAngle((assist==='full'?bestAim(m.balls,m.target)?.angle:undefined)??nearestAim(m.balls,m.target));
  },[]);
  function showAdvice(plan:ShotPlan|null){setAdvice(plan?{text:describePlan(plan),plan}:{text:'冇明顯入球或防守線路，輕力碰最近嘅目標球。'});}
  function computerPlayed(id:number,plan:ShotPlan,spot?:{x:number;z:number}){
    const m=match.current;if(id!==thinking.current)return;thinking.current=0;
    if(m.turn!==1||m.finished||active.current||pending.current)return;
    if(spot)placeCueBall(m,spot.x,spot.z);
    const shot=deliverComputerShot(plan.shot,m.balls,Math.random,live.current.level);
    setNote(plan.kind==='pot'&&plan.option?`電腦：打${NAMES[plan.option.value]}入${POCKET_NAMES[plan.option.pocket]}`:'電腦：打防守');
    const next={id:++sequence.current,angle:shot.angle,power:shot.power,spin:shot.spin,origin:{x:m.balls[0].x,z:m.balls[0].z},startedAt:performance.now(),player:1};
    pending.current=next;setStroke(next);setBusy(true);
  }
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      let assist=DEFAULT_SETTINGS.assist;
      try{
        const saved=localStorage.getItem('snooker-coach-stats');if(saved)setStats({...EMPTY_STATS,...JSON.parse(saved)});
        const options=localStorage.getItem('snooker-settings');
        if(options){const next={...DEFAULT_SETTINGS,...JSON.parse(options)} as Settings;assist=next.assist;setSettings(next);if(next.mode==='practice'){const drill=newPractice();match.current=drill;setSnapshot(drill);}}
      }catch{}
      lineUp(assist);
    });
    return()=>cancelAnimationFrame(frame);
  },[lineUp]);
  useEffect(()=>{
    let frame=0,last=0,accumulator=0,aiAt=0,releaseAt=0;
    sound.current=createSound();
    // The look-ahead search takes a second or two; a worker keeps the table
    // animating. Without one (old browsers) it runs inline.
    try{planner.current=new Worker(new URL('./planner.worker.ts',import.meta.url),{type:'module'});}catch{planner.current=null;}
    const worker=planner.current;
    if(worker)worker.onmessage=(event:MessageEvent<{id:number;kind:'computer'|'coach';plan:ShotPlan|null;spot?:{x:number;z:number}}>)=>{
      const {id,kind,plan,spot}=event.data;
      if(kind==='computer'&&plan)computerPlayed(id,plan,spot);else if(kind==='coach'&&id===coachRequest.current)showAdvice(plan);
    };
    function tick(time:number){
      const m=match.current;
      if(pending.current&&time-pending.current.startedAt>=STROKE_CONTACT_MS){
        releaseAt=pending.current.startedAt+STROKE_END_MS;
        beginShot(m,pending.current.angle,pending.current.power,pending.current.spin);
        sound.current?.impact('cue',.4+pending.current.power/100*2.6);
        pending.current=null;active.current=true;
      }
      accumulator+=Math.min((time-last)/1000,.05);last=time;
      while(accumulator>=1/240){
        if(active.current)step(m.balls,1/240,v=>{if(m.first===null)m.first=v;},b=>m.potted.push(b),(kind,speed)=>sound.current?.impact(kind,speed));
        accumulator-=1/240;
      }
      if(active.current&&!moving(m.balls)&&time>=releaseAt) {active.current=false;
        const shooter=m.turn,shotTarget=m.shotTarget,pottedValues=m.potted.map(b=>b.value);
        finishShot(m);
        const foul=!!m.last?.foul;
        if(shooter===0&&yourShot.current){
          const shot=yourShot.current,r={potted:!foul&&pottedValues.length>0,foul,power:shot.power,spin:shot.spin,target:shotTarget,pottedValues,ballsAfter:m.balls,targetAfter:m.target,stillTurn:m.turn===0&&!m.finished,advised:shot.advised};
          const verdict=reviewShot(r),breakNow=m.break;yourShot.current=null;setReview(verdict);
          setStats(current=>{const next=record(current,r,verdict,breakNow);try{localStorage.setItem('snooker-coach-stats',JSON.stringify(next));}catch{}return next;});
        }else setReview(null);
        setAdvice(null);setApplied(null);setNote('');setTop(0);setSide(0);
        if(m.turn===0&&!m.finished)lineUp(live.current.assist);
        setBusy(false);setSnapshot({...m,scores:[...m.scores]});aiAt=time+900;
      }
      if(!active.current&&!pending.current&&!thinking.current&&m.turn===1&&!m.finished&&time>=aiAt){
        const id=++requests.current;thinking.current=id;
        if(planner.current)planner.current.postMessage({id,kind:'computer',balls:m.balls,target:m.target,level:live.current.level,inHand:m.inHand});
        else{
          const spot=m.inHand?cueSpotInD(m.balls,m.target):undefined;
          if(spot)placeCueBall(m,spot.x,spot.z);
          computerPlayed(id,computerPlan(m.balls,m.target,live.current.level));
        }
      }
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);worker?.terminate();planner.current=null;};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one game loop for the life of the page; it reads refs.
  },[]);
  const m=snapshot,canShoot=!busy&&m.turn===0&&!m.finished;
  const spin=useMemo(()=>({top,side}),[top,side]);
  // One prediction per aim, shared by the guides on the cloth and the readout.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `layout` and `m.shots` stand in for the mutable ball array.
  const prediction=useMemo(()=>canShoot?predictShot(m.balls,angle,power,spin):null,[canShoot,angle,power,spin,m.shots,layout]);
  const legal=(value:number,first:number|null)=>m.target===-1?value>1&&value===first:value===m.target;
  const outcome=!prediction?null:prediction.cueEnd.potted?'inoff':prediction.first===null?'miss':!legal(prediction.first,prediction.first)||prediction.pots.some(p=>!legal(p.value,prediction.first))?'foul':prediction.pots.length?'pot':'safe';
  const view:TableView=settings.camera==='player'?'player':settings.camera==='top'||topView?'top':canShoot?'aim':'tv';
  function update(change:Partial<Settings>){
    const next={...settings,...change};setSettings(next);
    try{localStorage.setItem('snooker-settings',JSON.stringify(next));}catch{}
    if(change.mode&&change.mode!==settings.mode)reset(change.mode);
    else if(change.assist&&canShoot)lineUp(change.assist);
  }
  function shoot(strength:number){
    if(!canShoot||pending.current||active.current)return;
    const m=match.current,ball=m.balls[0],shot={angle,power:strength,spin:{top,side}};
    const delivered=deliverShot(shot,Math.random,PLAYER_ERROR_SCALE,m.balls);
    yourShot.current={power:strength,spin:shot.spin,advised:applied??advice?.plan};coachRequest.current=0;
    const next={id:++sequence.current,angle:delivered.angle,power:strength,spin:shot.spin,origin:{x:ball.x,z:ball.z},startedAt:performance.now()-QUICK_STROKE_MS,player:0};
    pending.current=next;setStroke(next);setBusy(true);setReview(null);setNote('');setSpinOpen(false);
    try{navigator.vibrate?.(12);}catch{}
  }
  function askCoach(){
    if(!canShoot)return;setAdvice({text:'教練分析緊…'});
    const id=++requests.current;coachRequest.current=id;
    if(planner.current)planner.current.postMessage({id,kind:'coach',balls:match.current.balls,target:match.current.target});
    else setTimeout(()=>showAdvice(planShot(match.current.balls,match.current.target,PRO_ERROR_SCALE,true)),50);
  }
  function openCoach(){setSheet('coach');if(canShoot&&!advice)askCoach();}
  function applyAdvice(){
    const plan=advice?.plan;if(!plan||!canShoot)return;
    setAngle(plan.shot.angle);setPower(Math.round(plan.shot.power));setTop(plan.shot.spin.top);setSide(plan.shot.spin.side);setApplied(plan);setSheet(null);
    setNote(`教練：${powerWord(plan.shot.power)} ${Math.round(plan.shot.power)}% · ${spinWord(plan.shot.spin)}，拉到綠色刻度放手`);
  }
  function pickBall(id:number){
    if(!canShoot)return;
    const m=match.current,ball=m.balls.find(b=>b.id===id);if(!ball)return;
    const cycle=picked.current.id===id?picked.current.cycle+1:0;picked.current={id,cycle};
    const aim=aimAtBall(m.balls,id,cycle,power,{top,side});setAngle(aim.angle);setApplied(null);
    setNote(aim.pocket>=0?`瞄準${NAMES[ball.value]} → ${POCKET_NAMES[aim.pocket]}（再點一下轉袋）`:`${NAMES[ball.value]}冇直接入袋線路`);
  }
  function place(x:number,z:number){if(canShoot&&placeCueBall(match.current,x,z)){setLayout(value=>value+1);setApplied(null);}}
  function reset(mode=settings.mode){
    thinking.current=0;coachRequest.current=0;active.current=false;pending.current=null;yourShot.current=null;
    const next=mode==='practice'?newPractice():newMatch();match.current=next;setSnapshot(next);setStroke(null);setBusy(false);setTop(0);setSide(0);setPower(45);
    setAdvice(null);setApplied(null);setReview(null);setNote('');setConfirmReset(false);setSheet(null);setTopView(false);lineUp(settings.assist);
  }
  // Power: pull the bar down and let go. The cue draws back with your thumb.
  const pull=useRef<{id:number;y:number;armed:boolean}|null>(null);
  function pullTo(event:ReactPointerEvent<HTMLDivElement>){
    const rect=event.currentTarget.getBoundingClientRect();
    return Math.round(clamp((event.clientY-rect.top-rect.height*.08)/(rect.height*.84),0,1)*100);
  }
  function pullStart(event:ReactPointerEvent<HTMLDivElement>){
    if(!canShoot||!event.isPrimary)return;
    sound.current?.unlock();event.currentTarget.setPointerCapture(event.pointerId);
    pull.current={id:event.pointerId,y:event.clientY,armed:false};
  }
  function pullMove(event:ReactPointerEvent<HTMLDivElement>){
    const state=pull.current;if(!state||state.id!==event.pointerId)return;
    // A stray tap never fires a shot: the bar arms only once it is dragged.
    if(!state.armed&&Math.abs(event.clientY-state.y)<8)return;
    state.armed=true;setPulling(true);setPower(Math.max(1,pullTo(event)));
  }
  function pullEnd(event:ReactPointerEvent<HTMLDivElement>,fire:boolean){
    const state=pull.current;if(!state||state.id!==event.pointerId)return;
    pull.current=null;setPulling(false);
    if(!state.armed){setNote('向下拉力度條，放手出桿');return;}
    const strength=pullTo(event);
    if(fire&&strength>=4)shoot(strength);else{setPower(45);setNote('已取消出桿');}
  }
  // Fine tuning: a ruler that turns the cue a fraction of a millimetre per pixel.
  const fine=useRef<{id:number;x:number}|null>(null),[fineShift,setFineShift]=useState(0);
  function fineMove(event:ReactPointerEvent<HTMLDivElement>){
    const state=fine.current;if(!state||state.id!==event.pointerId||!canShoot)return;
    const dx=event.clientX-state.x;state.x=event.clientX;
    const reach=clamp(prediction?.approach??1,.2,3);
    setAngle(value=>wrap(value+dx*.00005/reach*180/Math.PI));setFineShift(value=>(value+dx)%12);
  }
  function placeTip(event:ReactPointerEvent<HTMLButtonElement>){
    if(!canShoot)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const x=(event.clientX-rect.left-rect.width/2)/(rect.width*.38),y=-(event.clientY-rect.top-rect.height/2)/(rect.height*.38),length=Math.max(1,Math.hypot(x,y));
    setSide(Math.round(x/length*100)/100);setTop(Math.round(y/length*100)/100);
  }
  const tipDescription=[top>.05?'高桿 · 跟進':top<-.05?'低桿 · 拉桿':'中桿',side>.05?'右塞':side<-.05?'左塞':'無側旋'].join(' · ');
  const practice=focus(stats),potRate=stats.shots?Math.round(stats.pots/stats.shots*100):0,positionRate=stats.positions?Math.round(stats.positionsOk/stats.positions*100):0;
  const remaining=pointsRemaining(m),lead=m.scores[0]-m.scores[1],targetName=m.target===-1?'彩色球':NAMES[m.target]??'—';
  const status=m.finished||pulling?'':note||(busy?''
    :m.turn===1?'電腦思考中…'
    :review?review.headline+(review.tip?'　'+review.tip:'')
    :m.practice&&m.shots===0?m.message
    :m.inHand?'白球在手：拖動白球擺位，或者直接瞄準'
    :m.shots===0?'點一粒球自動瞄準 · 拖動微調 · 右邊拉桿出手':m.message);
  const readout=outcome==='pot'?'入袋':outcome==='inoff'?'白球落袋':outcome==='foul'?'犯規':outcome==='miss'?'碰唔到球':'';
  const won=m.scores[0]>m.scores[1];
  return <div role="main" className="sg" data-turn={m.turn} onPointerDownCapture={()=>sound.current?.unlock()}>
    <h1 className="sg-sr">3D 桌球</h1>
    <Table balls={m.balls} angle={angle} power={power} spin={spin} view={view} aiming={canShoot} pulling={pulling} inHand={m.inHand} showD={m.inHand&&!m.practice} turnKey={m.shots} stroke={stroke}
      prediction={prediction} assist={settings.assist} potOn={outcome==='pot'} marker={applied?.cueEnd??null} onAim={value=>{setAngle(value);setApplied(null);}} onPickBall={pickBall} onPlace={place}/>
    <div className="sg-top">
      <IconButton type="button" label="選單" className="sg-round" onClick={()=>setSheet('menu')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg></IconButton>
      <div className="sg-board">
        {m.practice?<div className="sg-score sg-score--solo" role="group" aria-label={`練習：總分 ${m.scores[0]}，單桿 ${m.break}，最高單桿 ${m.best}`}>
          <span className="sg-name is-solo">總分</span><strong>{m.scores[0]}</strong>
          <span className="sg-frames"><small>單桿</small><b>{m.break}</b></span>
          <strong>{m.best}</strong><span className="sg-name is-solo">最高</span>
        </div>:<div className="sg-score" role="group" aria-label={`比分：你 ${m.scores[0]}，電腦 ${m.scores[1]}；一局決勝`}>
          <span className={`sg-name${m.turn===0&&!m.finished?' is-playing':''}`}>你</span>
          <strong>{m.scores[0]}</strong>
          <span className="sg-frames" aria-label="局數"><b>{m.finished&&won?1:0}</b><small>(1)</small><b>{m.finished&&!won?1:0}</b></span>
          <strong>{m.scores[1]}</strong>
          <span className={`sg-name sg-name--right${m.turn===1&&!m.finished?' is-playing':''}`}>電腦<small>{LEVELS[settings.level].label}</small></span>
        </div>}
        <div className="sg-info">
          <span className="sg-target"><i style={{background:m.target===-1?undefined:COLOURS[m.target]}} data-any={m.target===-1||undefined} aria-hidden="true"/>{m.turn===0?'你打':'電腦打'}{targetName}</span>
          {m.break>0?<span role="status" aria-label={`${m.turn===0?'你':'電腦'}，目前單桿 ${m.break} 分，共 ${m.breakBalls.length} 球`}>{m.practice?'':<>單桿 <b>{m.break}</b></>}<span className="sg-run" aria-hidden="true">{m.breakBalls.slice(-6).map((value,index)=><i key={index} style={{background:COLOURS[value]}}/>)}</span></span>
            :m.practice?<span>Line-up</span>:<span>{lead===0?'平手':lead>0?<>領先 <b>{lead}</b></>:<>落後 <b>{-lead}</b></>}</span>}
          <span>枱面 <b>{remaining}</b></span>
        </div>
      </div>
      <IconButton type="button" label={topView?'返回瞄準視角':'俯瞰全枱'} aria-pressed={topView} className="sg-round" disabled={settings.camera!=='auto'} onClick={()=>setTopView(value=>!value)}>
        {topView?<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="16" r="3"/><path d="M12 13V4M8 7l4-3 4 3"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.500" y="3" width="11" height="18" rx="1.500"/><path d="M6.500 16h11"/><circle cx="12" cy="8" r="1.200"/></svg>}
      </IconButton>
    </div>
    <p className="sg-status" role="status" aria-live="polite" data-tone={review&&!note&&!busy&&m.turn===0?'review':undefined}>{status}</p>
    {!m.finished&&<>
      <div className="sg-left">
        <Button type="button" variant="quiet" className="sg-pill" onClick={openCoach}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a6 6 0 0 0-3.5 10.9V17h7v-2.100A6 6 0 0 0 12 4zM9.500 20h5"/></svg>教練</Button>
        <button type="button" className="sg-spin" disabled={!canShoot} aria-haspopup="dialog" aria-expanded={spinOpen} aria-label={'白球擊點：'+tipDescription} onClick={()=>setSpinOpen(open=>!open)}>
          <i style={{left:(50+side*34)+'%',top:(50-top*34)+'%'}} aria-hidden="true"/>
        </button>
      </div>
      <div className="sg-aim" data-disabled={!canShoot||undefined}>
        {prediction?.object&&<div className="sg-read" data-outcome={outcome}>
          <svg viewBox="0 0 48 26" aria-hidden="true"><circle cx="24" cy="13" r="10" fill={COLOURS[prediction.object.value]}/><circle cx={24+prediction.side*(1-prediction.fraction)*20} cy="13" r="10" className="sg-read-cue"/></svg>
          <span>{prediction.fraction>.93?'':prediction.side>0?'右':'左'}{thickness(prediction.fraction)}</span>
          {readout&&<b>{readout}</b>}
        </div>}
        <div className="sg-fine" role="slider" tabIndex={canShoot?0:-1} aria-label="微調瞄準" aria-valuemin={-180} aria-valuemax={180} aria-valuenow={Math.round(angle*10)/10} aria-valuetext={`${angle.toFixed(2)} 度`} aria-disabled={!canShoot}
          style={{backgroundPositionX:fineShift+'px'}}
          onPointerDown={event=>{if(!canShoot)return;event.currentTarget.setPointerCapture(event.pointerId);fine.current={id:event.pointerId,x:event.clientX};}}
          onPointerMove={fineMove} onPointerUp={()=>{fine.current=null;}} onPointerCancel={()=>{fine.current=null;}}
          onKeyDown={event=>{if(!canShoot||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();setAngle(value=>wrap(value+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?.1:.01)));}}>
          <span aria-hidden="true">‹ 微調 ›</span>
        </div>
      </div>
      <div className="sg-power" role="slider" tabIndex={canShoot?0:-1} aria-label="出桿力度" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={power} aria-valuetext={`${power}% ${powerWord(power)}`} aria-disabled={!canShoot} aria-describedby="sg-power-help"
        data-pulling={pulling||undefined} style={{'--sg-power':power/100,'--sg-advice':applied?applied.shot.power/100:-1} as React.CSSProperties}
        onPointerDown={pullStart} onPointerMove={pullMove} onPointerUp={event=>pullEnd(event,true)} onPointerCancel={event=>pullEnd(event,false)}
        onKeyDown={event=>{
          if(!canShoot)return;
          if(event.key==='Enter'||event.key===' '){event.preventDefault();sound.current?.unlock();shoot(power);return;}
          const change=event.key==='ArrowDown'||event.key==='ArrowRight'?2:event.key==='ArrowUp'||event.key==='ArrowLeft'?-2:0;
          if(change){event.preventDefault();setPower(value=>clamp(value+change,1,100));}
        }}>
        <span className="sg-power-track" aria-hidden="true"><i className="sg-power-fill"/><i className="sg-power-advice"/><i className="sg-power-knob"/></span>
        <span className="sg-power-label" aria-hidden="true">{pulling?'放手出桿':'下拉出桿'}</span>
        <small id="sg-power-help" className="sg-sr">向下拉設定力度，放手出桿；拉返上頂取消。鍵盤：上下鍵調整，Enter 出桿。</small>
      </div>
      {pulling&&<div className="sg-pull" aria-hidden="true"><strong>{power}<small>%</small></strong><span>{power<4?'放手取消':powerWord(power)}</span></div>}
      {spinOpen&&canShoot&&<>
        <button type="button" className="sg-scrim" aria-label="關閉擊點" onClick={()=>setSpinOpen(false)}/>
        <div className="sg-spin-panel" role="dialog" aria-label="白球擊點">
          <strong>白球擊點</strong>
          <button type="button" className="snooker-tip" aria-label={'白球擊點：'+tipDescription} aria-describedby="tip-keys"
            onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);placeTip(event);}}
            onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))placeTip(event);}}
            onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
            onKeyDown={event=>{
              const changes:Record<string,[number,number]>={ArrowUp:[0,.05],ArrowDown:[0,-.05],ArrowLeft:[-.05,0],ArrowRight:[.05,0]};
              if(event.key==='Home'){event.preventDefault();setTop(0);setSide(0);return;}
              if(event.key==='Escape'){setSpinOpen(false);return;}
              const delta=changes[event.key];if(!delta)return;event.preventDefault();
              const x=side+delta[0],y=top+delta[1],length=Math.max(1,Math.hypot(x,y));setSide(x/length);setTop(y/length);
            }}>
            <span className="snooker-tip-cross" aria-hidden="true"/>
            <i style={{left:(50+side*38)+'%',top:(50-top*38)+'%'}} aria-hidden="true"/>
          </button>
          <output aria-live="polite">{tipDescription}</output>
          <small id="tip-keys">高桿跟進、低桿拉回、中桿定桿。未練熟唔好用側旋。</small>
          <div className="sg-row"><Button type="button" variant="quiet" onClick={()=>{setTop(0);setSide(0);}}>回復中桿</Button><Button type="button" variant="featured" onClick={()=>setSpinOpen(false)}>完成</Button></div>
        </div>
      </>}
    </>}
    {m.finished&&<section className="sg-result" aria-label="本局結果">
      <small>{m.practice?'練習完成':'本局完結'}</small>
      <h2>{m.practice?'清枱！':won?'你贏咗呢一局':'電腦勝出'}</h2>
      {m.practice?<p className="sg-result-score"><b>{m.best}</b><span>最高單桿</span></p>:<p className="sg-result-score"><b>{m.scores[0]}</b><span>–</span><b>{m.scores[1]}</b></p>}
      <div className="sg-tiles"><StatTile label="最高單桿" value={stats.best}/><StatTile label="入球率" value={potRate+'%'}/><StatTile label="走位" value={positionRate+'%'}/></div>
      <p>{practice.title}　{practice.game}</p>
      <div className="sg-row"><ButtonLink href="/" variant="secondary">返回球會</ButtonLink><Button type="button" variant="featured" onClick={()=>reset()}>{m.practice?'再練一次':'再打一局'}</Button></div>
    </section>}
    <Sheet open={sheet==='coach'} title="教練" onClose={()=>setSheet(null)} className="sg-sheet">
      <p className="sg-coach-text" aria-live="polite">{advice?advice.text:review?<><b>{review.headline}</b>{review.tip?'　'+review.tip:''}</>:canShoot?'出桿前講出：打邊粒、入邊個袋、白球停邊。':'等到你出桿先可以分析。'}</p>
      <div className="sg-row">
        <Button type="button" variant="featured" disabled={!canShoot||!advice?.plan} onClick={applyAdvice}>幫我擺好呢一桿</Button>
        <Button type="button" variant="secondary" disabled={!canShoot} onClick={askCoach}>再分析</Button>
      </div>
      <div className="sg-tiles"><StatTile label="入球率" value={potRate+'%'}/><StatTile label="走位成功" value={positionRate+'%'}/><StatTile label="最高單桿" value={stats.best}/></div>
      <h3>{practice.title}</h3>
      <p><b>遊戲入面：</b>{practice.game}</p>
      <p><b>真球枱：</b>{practice.table}</p>
      <p className="sg-fine-print">枱面嘅白圈係白球預計停低嘅位置，藍綠圈係教練想你停嘅位置。厚薄顯示（全球／半球／薄邊）同真枱瞄準一樣，可以直接帶去練波。</p>
    </Sheet>
    <Sheet open={sheet==='menu'} title="3D 桌球" onClose={()=>{setSheet(null);setConfirmReset(false);}} className="sg-sheet">
      <div className="sg-setting"><span>模式</span><SegmentedControl label="模式" value={settings.mode} onChange={value=>update({mode:value as Settings['mode']})} items={[{value:'match',label:'對電腦一局'},{value:'practice',label:'Line-up 練習'}]}/><small>Line-up：15 粒紅排喺中線，自己一個練紅、彩、紅走位；失手唔使交換，單桿由零再計。轉模式會即時重新開始。</small></div>
      <div className="sg-setting"><span>視角</span><SegmentedControl label="視角" value={settings.camera} onChange={value=>update({camera:value as Settings['camera']})} items={[{value:'auto',label:'自動'},{value:'top',label:'俯瞰'},{value:'player',label:'球員'}]}/></div>
      <div className="sg-setting"><span>輔助線</span><SegmentedControl label="輔助線" value={settings.assist} onChange={value=>update({assist:value as Assist})} items={[{value:'full',label:'完整'},{value:'guide',label:'簡化'},{value:'off',label:'關閉'}]}/><small>完整：顯示入袋線同白球落點；簡化：只有短方向線；關閉：只有瞄準線同假想球。</small></div>
      <div className="sg-setting"><span>對手</span><SegmentedControl label="對手" value={settings.level} onChange={value=>update({level:value as Level})} items={(Object.keys(LEVELS) as Level[]).map(value=>({value,label:LEVELS[value].label}))}/><small>初哥乜都搏；球會級識得做防守；職業計兩步走位，冇六成把握唔出手。</small></div>
      <div className="sg-setting"><span>音效</span><SegmentedControl label="音效" value={settings.sound} onChange={value=>update({sound:value as Settings['sound']})} items={[{value:'on',label:'開'},{value:'off',label:'關'}]}/></div>
      <details className="sg-help"><summary>玩法同模擬範圍</summary>
        <p id="table-aim-help"><b>瞄準：</b>點一粒球，球桿會自動對準最易入嘅袋（再點轉袋）；點枱面任何位置就瞄向嗰度。喺枱面拖動可以轉向：慢慢拖係精細調整，快掃係大幅轉向；下面嘅微調尺再細十倍。鍵盤可用左右鍵，Shift 更精細。</p>
        <p><b>出桿：</b>右邊力度條向下拉，球桿會跟住拉後，放手即出桿；拉返上頂取消。左下角白球可以揀高低桿同側旋。</p>
        <p><b>輔助線：</b>白線去到假想球（白球撞到目標球嗰刻嘅位置），金線係目標球路線，淡白線同白圈係白球之後嘅路線同停低位置。袋口發光代表呢個角度同力度入到。你嘅出桿只有好輕微嘅誤差。</p>
        <p><b>規則：</b>先紅後彩，紅球清晒就順序打黃、綠、啡、藍、粉紅、黑。開波同白球落袋之後，白球可以喺 D 區內自由擺位。簡化規則：自動判定彩球目標，冇自由球同犯規重打。成績唔計入球會 ELO。</p>
        <p><b>物理：</b>滑動轉滾動、跟進同拉桿、側旋碰庫、切球嘅「投擲」效應、圓角袋口（輕力可以擦袋角入，大力會彈出）。係數係近似值，未模擬跳球同弧線球。</p>
        <p>視覺向電視轉播同經典桌球遊戲致意，並非任何官方產品。</p>
      </details>
      {confirmReset?<div className="sg-row" role="group" aria-label="確認重新開局"><span>放棄目前比分？</span><Button type="button" onClick={()=>reset()}>確認重新開局</Button><Button type="button" variant="secondary" onClick={()=>setConfirmReset(false)}>繼續本局</Button></div>
        :<div className="sg-row"><Button type="button" variant="secondary" onClick={()=>setConfirmReset(true)}>重新開局</Button><ButtonLink href="/" variant="quiet">返回球會</ButtonLink></div>}
    </Sheet>
  </div>;
}
