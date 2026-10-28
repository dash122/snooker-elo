"use client";
/* Experience: a playable computer match inside the club's existing green/gold world.
   Reference: BBC yellow name panels, white points, teal frame count; textured rigged human.
   Structure: one 3D viewport with score, cue-ball and shot controls in an integrated HUD.
   Interaction: pointer/keyboard aim; both players animate a stroke before physical cue contact.
   Scope: simplified single-frame rules; original graphics, no broadcast branding. */
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button, ButtonLink, FormField, SegmentedControl } from '../components/ui/Primitives';
import { COLOURS, computerShot, deliverShot, moving, NAMES, planShot, PRO_ERROR_SCALE, step, type ShotPlan, type Spin } from '../../lib/snooker-game';
import { describePlan, EMPTY_STATS, focus, record, reviewShot, type CoachStats } from '../../lib/snooker-coach';
import { beginShot, finishShot, newMatch } from '../../lib/snooker-match';
import Table from './Table';
import { nearestAim } from '../../lib/snooker-aim';
import { type Stroke, STROKE_CONTACT_MS, STROKE_END_MS } from '../../lib/snooker-presentation';
import '../styles/snooker-game.css';

export default function Game(){
  const [initial]=useState(newMatch),match=useRef(initial),[snapshot,setSnapshot]=useState(initial),[angle,setAngle]=useState(()=>nearestAim(initial.balls,initial.target)),[power,setPower]=useState(45),[camera,setCamera]=useState('auto'),[top,setTop]=useState(0),[side,setSide]=useState(0),[busy,setBusy]=useState(false),[confirmReset,setConfirmReset]=useState(false);
  const active=useRef(false);
  const [precise,setPrecise]=useState(false);
  const pending=useRef<Stroke|null>(null),sequence=useRef(0);
  const [stroke,setStroke]=useState<Stroke|null>(null);
  const [preparing,setPreparing]=useState(false);
  // Coach: an on-demand professional's plan, a review of each of your shots,
  // and running stats (kept on this device) that choose what to practise next.
  const [advice,setAdvice]=useState<{text:string;plan?:ShotPlan}|null>(null),[review,setReview]=useState<{headline:string;tip:string}|null>(null);
  const [stats,setStats]=useState<CoachStats>(EMPTY_STATS),[coachOpen,setCoachOpen]=useState(true);
  const yourShot=useRef<{power:number;spin:Spin;advised?:ShotPlan}|null>(null);
  useEffect(()=>{const frame=requestAnimationFrame(()=>{try{const saved=localStorage.getItem('snooker-coach-stats');if(saved)setStats({...EMPTY_STATS,...JSON.parse(saved)});}catch{}});return()=>cancelAnimationFrame(frame);},[]);
  useEffect(()=>{
    let frame=0,last=0,accumulator=0,aiAt=0,releaseAt=0;
    function tick(time:number){
      const m=match.current;
      if(pending.current&&time-pending.current.startedAt>=STROKE_CONTACT_MS){
        releaseAt=pending.current.startedAt+STROKE_END_MS;
        beginShot(m,pending.current.angle,pending.current.power,pending.current.spin);pending.current=null;active.current=true;setPreparing(false);
      }
      accumulator+=Math.min((time-last)/1000,.05);last=time;
      while(accumulator>=1/240){
        if(active.current)step(m.balls,1/240,v=>{if(m.first===null)m.first=v;},b=>m.potted.push(b));
        accumulator-=1/240;
      }
      if(active.current&&!moving(m.balls)&&time>=releaseAt) {active.current=false;
        const shooter=m.turn,shotTarget=m.shotTarget,first=m.first,pottedValues=m.potted.map(b=>b.value);
        const valid=(v:number)=>shotTarget===-1?v>1&&v===first:v===shotTarget,foul=first===null||!valid(first)||pottedValues.some(v=>!valid(v));
        finishShot(m);
        if(shooter===0&&yourShot.current){
          const shot=yourShot.current,r={potted:!foul&&pottedValues.length>0,foul,power:shot.power,spin:shot.spin,target:shotTarget,pottedValues,ballsAfter:m.balls,targetAfter:m.target,stillTurn:m.turn===0&&!m.finished,advised:shot.advised};
          const verdict=reviewShot(r),breakNow=m.break;yourShot.current=null;setReview(verdict);setAdvice(null);
          setStats(current=>{const next=record(current,r,verdict,breakNow);try{localStorage.setItem('snooker-coach-stats',JSON.stringify(next));}catch{}return next;});
        }
setTop(0);setSide(0);setPrecise(false);if(m.turn===0&&!m.finished)setAngle(nearestAim(m.balls,m.target));setBusy(false);setSnapshot({...m,scores:[...m.scores]});aiAt=time+1200;}
      if(!active.current&&!pending.current&&m.turn===1&&!m.finished&&time>=aiAt){
        const shot=deliverShot(computerShot(m.balls,m.target),Math.random,PRO_ERROR_SCALE);
        const next={id:++sequence.current,angle:shot.angle,power:shot.power,spin:shot.spin,origin:{x:m.balls[0].x,z:m.balls[0].z},startedAt:time,player:1};
        pending.current=next;setStroke(next);setBusy(true);setPreparing(true);
      }
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[]);
  const m=snapshot,canShoot=!busy&&m.turn===0&&!m.finished;
  function shoot(){if(!canShoot||pending.current||active.current)return;const ball=match.current.balls[0];const delivered=deliverShot({angle,power,spin:{top,side}});yourShot.current={power,spin:{top,side},advised:advice?.plan};const next={id:++sequence.current,angle:delivered.angle,power,spin:{top,side},origin:{x:ball.x,z:ball.z},startedAt:performance.now(),player:0};pending.current=next;setStroke(next);setBusy(true);setPreparing(true);}
  function askCoach(){
    if(!canShoot)return;setAdvice({text:'教練分析緊…'});
    // Let the message paint before the (blocking) search runs.
    setTimeout(()=>{const plan=planShot(match.current.balls,match.current.target,PRO_ERROR_SCALE);setAdvice(plan?{text:describePlan(plan),plan}:{text:'冇明顯入球或防守線路，輕力碰最近嘅目標球。'});},50);
  }
  function applyAdvice(){const plan=advice?.plan;if(!plan||!canShoot)return;setAngle(plan.shot.angle);setPower(plan.shot.power);setTop(plan.shot.spin.top);setSide(plan.shot.spin.side);}
  const practice=focus(stats),potRate=stats.shots?Math.round(stats.pots/stats.shots*100):0,positionRate=stats.positions?Math.round(stats.positionsOk/stats.positions*100):0;
  function placeTip(event:PointerEvent<HTMLButtonElement>){
    if(!canShoot)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const x=(event.clientX-rect.left-rect.width/2)/(rect.width*.38),y=-(event.clientY-rect.top-rect.height/2)/(rect.height*.38),length=Math.max(1,Math.hypot(x,y));
    setSide(Math.round(x/length*100)/100);setTop(Math.round(y/length*100)/100);
  }
  const tipDescription=[top>.05?'高桿 / 跟進':top<-.05?'低桿 / 拉桿':'中桿',side>.05?'右旋':side<-.05?'左旋':'無側旋'].join(' · ');
  function reset(){active.current=false;pending.current=null;setStroke(null);setPreparing(false);const next=newMatch();match.current=next;setSnapshot(next);setBusy(false);setAngle(nearestAim(next.balls,next.target));setPrecise(false);setTop(0);setSide(0);setConfirmReset(false);}
  return <div role="main" className="snooker-game">
    <div className="snooker-heading"><div><h1>3D 桌球</h1><p>一張球檯，一場較量。</p></div><ButtonLink href="/" variant="secondary">返回球會</ButtonLink></div>
    <section className="snooker-arena" aria-label="桌球對戰">
      <div className="snooker-broadcast"><span>SNOOKER ELO</span><span>人機對戰 · 單局賽</span></div>
      <Table balls={m.balls} angle={angle} power={power} spin={{top,side}} camera={camera==='auto'?(m.turn===0&&!m.finished?'firstPerson':'broadcast'):camera} precise={precise} aiming={canShoot} stroke={stroke} onAim={setAngle}/>
      <div className="snooker-score" role="group" aria-label={`比分：你 ${m.scores[0]}，電腦 ${m.scores[1]}；一局決勝`}>
        <span className={`snooker-score-name${m.turn===0&&!m.finished?' is-playing':''}`}>你<i aria-hidden="true"/></span>
        <strong className="snooker-score-points">{m.scores[0]}</strong>
        <span className="snooker-score-frames" aria-label="局數"><b>{m.finished&&m.scores[0]>m.scores[1]?1:0}</b><small>(1)</small><b>{m.finished&&m.scores[1]>m.scores[0]?1:0}</b></span>
        <strong className="snooker-score-points">{m.scores[1]}</strong>
        <span className={`snooker-score-name snooker-score-name--right${m.turn===1&&!m.finished?' is-playing':''}`}><i aria-hidden="true"/>電腦</span>
        {m.break>0?<div className={`snooker-score-break${m.turn===1?' snooker-score-break--right':''}`} role="status" aria-label={`${m.turn===0?'你':'電腦'}，目前單桿 ${m.break} 分，共 ${m.breakBalls.length} 球`}>
          <span className="snooker-break-total">單桿 <strong>{m.break}</strong></span>
          <span className="snooker-break-balls">{COLOURS.slice(1).map((colour,index)=>{
            const value=index+1,count=m.breakBalls.filter(ball=>ball===value).length;
            return count>0?<span className="snooker-break-ball" key={value} aria-label={`${NAMES[value]} ${count} 球`}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill={colour}/><ellipse cx="7" cy="6" rx="3" ry="2" fill="white" opacity=".45"/></svg><b aria-hidden="true">{count}</b></span>:null;
          })}</span>
          <span className="snooker-break-count">{m.breakBalls.length} 球</span>
        </div>:<span className="snooker-score-caption">SNOOKER ELO · 單局賽</span>}
      </div>
    <div className="snooker-status" role="status" aria-live="polite"><strong>{m.finished?'本局完結':preparing?'準備出桿':busy?'球運行中':m.turn===1?'電腦思考中…':'輪到你出桿'}</strong><span>{m.message}</span></div>
    <section className="snooker-desk" aria-label="出桿控制">
      <aside className="snooker-coach" aria-label="教練" aria-live="polite">
        <div className="snooker-coach-head"><strong>教練</strong><Button type="button" variant="quiet" aria-expanded={coachOpen} onClick={()=>setCoachOpen(open=>!open)}>{coachOpen?'收起':'展開'}</Button></div>
        {coachOpen&&<>
          {advice?<p>{advice.text}</p>:review?<p><b>{review.headline}</b>{review.tip?'　'+review.tip:''}</p>:<p>出桿前講出：打邊粒、入邊個袋、白球停邊。唔肯定就問教練。</p>}
          <div className="snooker-coach-actions">
            <Button type="button" variant="secondary" disabled={!canShoot} onClick={askCoach}>教練建議</Button>
            {advice?.plan&&<Button type="button" variant="quiet" disabled={!canShoot} onClick={applyAdvice}>套用建議</Button>}
          </div>
          <details className="snooker-coach-focus"><summary>{practice.title} · 入球 {potRate}% · 走位 {positionRate}% · 最高 {stats.best}</summary><p><b>遊戲：</b>{practice.game}</p><p><b>真球枱：</b>{practice.table}</p></details>
        </>}
      </aside>
      <div className="snooker-shot">
        <div className="snooker-contact" role="group" aria-label="白球擊點">
          <strong>白球擊點</strong><small id="tip-help" className="snooker-sr-only">點選或拖動白球，決定落桿位置</small>
          <button type="button" className="snooker-tip" disabled={!canShoot} aria-label={'白球擊點：'+tipDescription} aria-describedby="tip-help tip-keys"
            onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);placeTip(event);}}
            onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))placeTip(event);}}
            onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
            onKeyDown={event=>{
              const changes:Record<string,[number,number]>={ArrowUp:[0,.05],ArrowDown:[0,-.05],ArrowLeft:[-.05,0],ArrowRight:[.05,0]};
              if(event.key==='Home'){event.preventDefault();setTop(0);setSide(0);return;}
              const delta=changes[event.key];if(!delta)return;event.preventDefault();
              const x=side+delta[0],y=top+delta[1],length=Math.max(1,Math.hypot(x,y));setSide(x/length);setTop(y/length);
            }}>
            <span className="snooker-tip-cross" aria-hidden="true"/>
            <i style={{left:(50+side*38)+'%',top:(50-top*38)+'%'}} aria-hidden="true"/>
          </button>
          <output aria-live="polite">{tipDescription}</output>
          <Button type="button" variant="quiet" disabled={!canShoot} onClick={()=>{setTop(0);setSide(0);}}>回復中桿</Button>
          <small id="tip-keys" className="snooker-sr-only">方向鍵調整擊點 · Home 回復中桿</small>
        </div>
        <div className="snooker-strike">
          <Button type="button" variant="secondary" aria-pressed={precise} disabled={!canShoot} onClick={()=>setPrecise(value=>!value)}>{precise?'精細調整：開':'精細調整：關'}</Button>
          <FormField label={'出桿力度 · '+power+'%'} hint="輕推至大力出桿"><input type="range" min="5" max="100" value={power} disabled={!canShoot} onChange={e=>setPower(Number(e.target.value))}/></FormField>
          <Button type="button" variant="featured" disabled={!canShoot} onClick={shoot}>{preparing?'準備出桿…':busy?'球運行中…':m.finished?'本局完結':m.turn===1?'電腦回合':'出桿'}</Button>
        </div>
      </div>
      <details className="snooker-tools"><summary>鏡頭與選項</summary><SegmentedControl label="鏡頭" value={camera} onChange={setCamera} items={[{value:'auto',label:'自動鏡頭'},{value:'firstPerson',label:'第一身'},{value:'broadcast',label:'轉播鏡頭'},{value:'overhead',label:'俯瞰球檯'},{value:'player',label:'球員鏡頭'}]}/><p>目標：<b>{m.target===-1?'任何彩色球':NAMES[m.target]??'—'}</b>　單桿：<b>{m.break}</b>　最高單桿：<b>{m.best}</b></p><Button type="button" variant="quiet" onClick={()=>setConfirmReset(true)}>重新開局</Button><ButtonLink href="/" variant="quiet" className="snooker-tools-back">返回球會</ButtonLink></details>
      {confirmReset&&<div className="snooker-reset" role="group" aria-label="確認重新開局"><span>放棄目前比分並重新開局？</span><Button type="button" onClick={reset}>確認重新開局</Button><Button type="button" variant="secondary" onClick={()=>setConfirmReset(false)}>繼續本局</Button></div>}
    </section>
    </section>
    <details className="snooker-help"><summary>玩法、瞄準線與模擬範圍</summary><p id="table-aim-help">每次出桿前會先瞄準最近的合法目標球。第一身鏡頭左右滑動可快速轉向；開啟「精細調整」後，同樣的滑動幅度只會輕微調整角度。放開手指保持方向。其他鏡頭可點選球檯瞄準；方向鍵及 Shift 亦可微調。</p><p>金色虛線：瞄準 · 金色空心圈：碰撞位置 · 實線：目標球 · 白色虛線：白球完整預測路線 · 白色空心圈：白球預計停留位置（落袋時不顯示）。路線為估算，隨力度及旋轉改變。側旋主要改變碰庫後的角度。</p><p>出桿一定有少許誤差，大力及加側旋時誤差較大，你與電腦同樣適用：長台及薄切球會被放大，所以要靠走位留下易打的下一球，而唔係靠運氣。</p><p>先打紅球，再打彩色球。未有入球或犯規便交換出桿；紅球清空後，依黃、綠、啡、藍、粉紅、黑的次序清枱。白球落袋後自動放回空位。電腦以職業球員水準出桿（誤差約為一般球員四分之一），會計算入球把握、走位及防守，使用同一套物理模擬。「教練建議」用同一套思考為你分析，入球率、走位成功率同最高分只儲存在此裝置，用嚟揀你下一步練習重點。</p><p>此版本採用簡化規則：自動判定彩球目標，沒有指定球、讓打、自由球或犯規重打。物理包含滑動轉滾動、跟進與拉桿、側旋碰庫、等質量球碰撞及落袋；係數為近似值，未模擬跳球、弧線、袋角及球與球之間的旋轉摩擦。遊戲成績不計入球會 ELO。</p><p>視覺向經典世界桌球賽遊戲及英國電視轉播致意；並非 BBC 或 WSC 官方產品。</p></details>
  </div>;
}
