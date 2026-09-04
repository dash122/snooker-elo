"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import Link from "next/link";
import {
  canEnterReady,
  createShootoutState,
  getShootoutView,
  loadShootoutState,
  reconcileShootout,
  resetShotClock,
  restorePreviousTurn,
  resumeShootout,
  setPause,
  startShootout,
  switchShootoutTurn,
  toReady,
  type ShootoutEvent,
  type ShootoutPauseTarget,
  type ShootoutPlayer,
  type ShootoutState,
} from "../../lib/shootout";

const STORAGE_KEY = "scaa-shootout-session";
const SETTINGS_KEY = "scaa-shootout-settings";

type IconName = "arrow" | "back" | "check" | "clock" | "fullscreen" | "pause" | "play" | "reset" | "sound" | "undo" | "x";

function Icon({name}: {name: IconName}) {
  const common = {fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8};
  if (name === "arrow") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M5 12h13M13 6l6 6-6 6"/></svg>;
  if (name === "back") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M19 12H5M11 6l-6 6 6 6"/></svg>;
  if (name === "check") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="m5 12 4.2 4.2L19 6.5"/></svg>;
  if (name === "clock") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg>;
  if (name === "fullscreen") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M8.5 4.5H4.5v4M15.5 4.5h4v4M19.5 15.5v4h-4M4.5 15.5v4h4"/></svg>;
  if (name === "pause") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M9 6v12M15 6v12"/></svg>;
  if (name === "play") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="m9 6 9 6-9 6z"/></svg>;
  if (name === "reset") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M5 9a7.5 7.5 0 1 1 1.7 7.6M5 9V4.5M5 9h4.5"/></svg>;
  if (name === "sound") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M5 10h3l4-3v10l-4-3H5zM16 9.2a4.2 4.2 0 0 1 0 5.6M18.5 6.8a7.5 7.5 0 0 1 0 10.4"/></svg>;
  if (name === "undo") return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M9 8H4.5l3.2-3.2M4.5 8c1.8-2 4.1-3 7-3 4.7 0 8 2.6 8 7s-3.3 7-8 7c-2.3 0-4.4-.7-5.9-2"/></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
}

function formatTime(milliseconds: number) {
  const safe = Math.max(0, milliseconds);
  const tenths = Math.floor((safe % 1000) / 100);
  const wholeSeconds = Math.floor(safe / 1000);
  const seconds = wholeSeconds % 60;
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function displayName(state: ShootoutState, player: ShootoutPlayer | null) {
  if (player === "a") return state.playerA || "球員 A";
  if (player === "b") return state.playerB || "球員 B";
  return "—";
}

function describeEvent(event: ShootoutEvent) {
  const time = new Intl.DateTimeFormat("zh-Hant-HK", {hour: "2-digit", minute: "2-digit", second: "2-digit"}).format(event.at);
  return {time, label: event.label};
}

function useShootoutClock() {
  const [origin] = useState(() => ({wall: Date.now(), mono: typeof performance === "undefined" ? 0 : performance.now()}));
  return useCallback(() => {
    const mono = typeof performance === "undefined" ? 0 : performance.now();
    return origin.wall + (mono - origin.mono);
  }, [origin]);
}

function useCue(soundEnabled: boolean, hapticsEnabled: boolean) {
  const audioContext = useRef<AudioContext | null>(null);
  return useCallback((kind: "phase" | "warning" | "countdown" | "expiry" | "complete" | "switch") => {
    if (hapticsEnabled && typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(kind === "expiry" || kind === "complete" ? [80, 45, 110] : kind === "switch" ? 24 : 36);
    }
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioContextConstructor = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AudioContextConstructor) return;
      audioContext.current ??= new AudioContextConstructor();
      const context = audioContext.current;
      if (context.state === "suspended") void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const frequency = kind === "phase" ? 660 : kind === "warning" ? 760 : kind === "countdown" ? 920 : kind === "switch" ? 540 : kind === "complete" ? 420 : 250;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.type = kind === "expiry" || kind === "complete" ? "square" : "sine";
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(kind === "expiry" || kind === "complete" ? 0.16 : 0.08, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "phase" ? 0.18 : 0.1));
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + (kind === "phase" ? 0.2 : 0.12));
    } catch {
      // Audio is a convenience. Timing remains usable when the browser refuses it.
    }
  }, [hapticsEnabled, soundEnabled]);
}

function Toggle({label,description,pressed,onChange,icon}: {label: string; description: string; pressed: boolean; onChange: () => void; icon: IconName}) {
  return <button type="button" className={`shootout-toggle${pressed ? " is-on" : ""}`} aria-pressed={pressed} onClick={onChange}>
    <span className="shootout-toggle-icon"><Icon name={icon}/></span>
    <span><strong>{label}</strong><small>{description}</small></span>
    <span className="shootout-toggle-switch" aria-hidden="true"><i/></span>
  </button>;
}

function SetupScreen({
  state,
  error,
  soundEnabled,
  hapticsEnabled,
  onChange,
  onSelectOpening,
  onToggleSound,
  onToggleHaptics,
  onReady,
  onStart,
  onReset,
}: {
  state: ShootoutState;
  error: string;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  onChange: (field: "playerA" | "playerB", value: string) => void;
  onSelectOpening: (player: ShootoutPlayer) => void;
  onToggleSound: () => void;
  onToggleHaptics: () => void;
  onReady: () => void;
  onStart: () => void;
  onReset: () => void;
}) {
  const isReady = state.status === "ready";
  return <div className="shootout-page shootout-setup-page">
    <header className="shootout-header shootout-header--light">
      <Link className="shootout-brand" href="/" aria-label="返回 SCAA Snooker ELO">
        <span className="shootout-brand-mark">S</span>
        <span><strong>SHOOTOUT</strong><small>限時賽計時器</small></span>
      </Link>
      <span className="shootout-header-note">計時員模式</span>
    </header>

    <main className="shootout-setup-main">
      <section className="shootout-intro">
        <div>
          <h1>一場十分鐘，<br/><em>每一桿都要準時。</em></h1>
          <p>專為一位計時員設計的 Shoot Out 計時器。只顯示比賽鐘、出桿鐘與目前出桿球員，讓你把注意力留在球枱。</p>
        </div>
        <div className="shootout-intro-mark" aria-hidden="true"><span>10</span><small>MIN</small></div>
      </section>

      <section className="shootout-setup-grid">
        <form className="shootout-panel shootout-form-panel" onSubmit={event => {event.preventDefault(); isReady ? onStart() : onReady();}}>
          <div className="shootout-panel-heading"><div><h2>{isReady ? "準備開始" : "建立一場計時"}</h2><p>{isReady ? "確認開球球員後，按下開始。" : "先輸入兩位球員，再選擇誰先開球。"}</p></div><span className="shootout-step-mark">{isReady ? "READY" : "SET"}</span></div>

          <div className="shootout-player-fields">
            <label className="shootout-field"><span>球員 A</span><input value={state.playerA} onChange={event => onChange("playerA", event.target.value)} placeholder="輸入球員姓名" maxLength={32} autoComplete="off" disabled={isReady}/></label>
            <div className="shootout-vs" aria-hidden="true">VS</div>
            <label className="shootout-field"><span>球員 B</span><input value={state.playerB} onChange={event => onChange("playerB", event.target.value)} placeholder="輸入球員姓名" maxLength={32} autoComplete="off" disabled={isReady}/></label>
          </div>

          <fieldset className="shootout-opening-fieldset">
            <legend>開球球員</legend>
            <div className="shootout-opening-options">
              {(["a", "b"] as ShootoutPlayer[]).map(player => <button key={player} type="button" className={`shootout-opening-option${state.openingPlayer === player ? " is-selected" : ""}`} aria-pressed={state.openingPlayer === player} onClick={() => onSelectOpening(player)} disabled={isReady}>
                <span className="shootout-player-initial">{player.toUpperCase()}</span><span><strong>{displayName(state, player)}</strong><small>{state.openingPlayer === player ? "先開球" : "按此選擇"}</small></span><Icon name="check"/>
              </button>)}
            </div>
          </fieldset>

          {error && <p className="shootout-form-error" role="alert">{error}</p>}

          <div className="shootout-setup-actions">
            <button className="shootout-button shootout-button--primary" type="submit" disabled={!isReady && !canEnterReady(state)}>{isReady ? <><Icon name="play"/>開始比賽</> : <>進入準備畫面<Icon name="arrow"/></>}</button>
            {isReady && <button className="shootout-button shootout-button--quiet" type="button" onClick={onReset}>重新設定</button>}
          </div>
        </form>

        <div className="shootout-setup-side">
          <section className="shootout-panel shootout-format-panel">
            <div className="shootout-panel-heading"><div><h2>固定規則</h2><p>跟隨比賽時間自動切換。</p></div><span className="shootout-rule-dot"/></div>
            <div className="shootout-format-rows">
              <div><strong>10:00</strong><span>比賽總時間</span></div>
              <div><strong>15 秒</strong><span>前五分鐘每一桿</span></div>
              <div><strong>10 秒</strong><span>最後五分鐘每一桿</span></div>
            </div>
            <p className="shootout-format-footnote"><span className="shootout-inline-dot"/> 到時不會自動轉換球員；請由計時員按鍵確認。</p>
          </section>
          <section className="shootout-panel shootout-preferences-panel">
            <div className="shootout-panel-heading"><div><h2>操作偏好</h2><p>可在開始後繼續使用。</p></div></div>
            <div className="shootout-toggle-list">
              <Toggle label="聲音提示" description="五秒、三秒與到時提示" icon="sound" pressed={soundEnabled} onChange={onToggleSound}/>
              <Toggle label="震動提示" description="裝置支援時輕微震動" icon="clock" pressed={hapticsEnabled} onChange={onToggleHaptics}/>
            </div>
          </section>
        </div>
      </section>

      <p className="shootout-setup-disclaimer">計時器只協助記錄時間與轉換球員，裁判決定仍然有效。</p>
    </main>
  </div>;
}

function ActivityRail({events}: {events: ShootoutEvent[]}) {
  const recent = events.slice(-8).reverse();
  return <aside className="shootout-activity-rail" aria-label="時間紀錄">
    <div className="shootout-rail-heading"><div><span>LIVE LOG</span><h2>時間紀錄</h2></div><span className="shootout-rail-count">{events.length}</span></div>
    {recent.length ? <ol className="shootout-event-list">{recent.map(event => {const item = describeEvent(event); return <li key={event.id}><span className={`shootout-event-dot shootout-event-dot--${event.kind}`} aria-hidden="true"/><div><time>{item.time}</time><strong>{item.label}</strong></div></li>;})}</ol> : <p className="shootout-empty-log">開始後，球員轉換與計時狀態會顯示在這裡。</p>}
    <div className="shootout-rail-footer"><Icon name="check"/><span>每次操作都會自動保存</span></div>
  </aside>;
}

function PauseSheet({
  open,
  isPaused,
  target,
  setTarget,
  onClose,
  onPause,
  onResume,
  onReset,
}: {
  open: boolean;
  isPaused: boolean;
  target: ShootoutPauseTarget;
  setTarget: (value: ShootoutPauseTarget) => void;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {if (event.key === "Escape") onClose();};
    document.addEventListener("keydown", onKeyDown);
    return () => {document.removeEventListener("keydown", onKeyDown); previous?.focus();};
  }, [onClose, open]);
  if (!open) return null;
  return <div className="shootout-overlay" onMouseDown={event => {if (event.target === event.currentTarget) onClose();}}>
    <section ref={sheetRef} className="shootout-sheet" role="dialog" aria-modal="true" aria-labelledby="shootout-pause-title" onMouseDown={event => event.stopPropagation()}>
      <button className="shootout-sheet-close" type="button" onClick={onClose} aria-label="關閉"><Icon name="x"/></button>
      <span className="shootout-sheet-mark"><Icon name={isPaused ? "play" : "pause"}/></span>
      <h2 id="shootout-pause-title">{isPaused ? "繼續計時" : "暫停計時"}</h2>
      <p>{isPaused ? "選擇繼續目前時間，或重設出桿鐘後繼續。" : "按裁判指示暫停出桿鐘、比賽鐘，或兩者。"}</p>
      {isPaused ? <div className="shootout-sheet-actions"><button className="shootout-button shootout-button--primary" type="button" onClick={onResume}><Icon name="play"/>繼續目前時間</button><button className="shootout-button shootout-button--secondary" type="button" onClick={onReset}><Icon name="reset"/>重設出桿鐘並繼續</button></div> : <>
        <div className="shootout-pause-options" role="radiogroup" aria-label="選擇暫停範圍">
          {(["shot", "match", "both"] as ShootoutPauseTarget[]).map(value => <button type="button" key={value} className={`shootout-pause-option${target === value ? " is-selected" : ""}`} role="radio" aria-checked={target === value} onClick={() => setTarget(value)}><span>{target === value ? <Icon name="check"/> : null}</span><strong>{value === "shot" ? "只暫停出桿鐘" : value === "match" ? "只暫停比賽鐘" : "全部暫停"}</strong><small>{value === "shot" ? "比賽鐘繼續倒數" : value === "match" ? "出桿鐘繼續倒數" : "兩個時鐘都暫停"}</small></button>)}
        </div>
        <button className="shootout-button shootout-button--primary" type="button" onClick={onPause}>確認暫停</button>
      </>}
    </section>
  </div>;
}

function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {if (event.key === "Escape") onClose();};
    document.addEventListener("keydown", onKeyDown);
    return () => {document.removeEventListener("keydown", onKeyDown); previous?.focus();};
  }, [onClose, open]);
  if (!open) return null;
  return <div className="shootout-overlay" onMouseDown={event => {if (event.target === event.currentTarget) onClose();}}>
    <section ref={sheetRef} className="shootout-sheet shootout-confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="shootout-confirm-title" onMouseDown={event => event.stopPropagation()}>
      <button className="shootout-sheet-close" type="button" onClick={onClose} aria-label="關閉"><Icon name="x"/></button>
      <span className="shootout-sheet-mark shootout-sheet-mark--warning"><Icon name="clock"/></span>
      <h2 id="shootout-confirm-title">{title}</h2>
      <p>{description}</p>
      <div className="shootout-sheet-actions"><button className="shootout-button shootout-button--secondary" type="button" onClick={onClose}>取消</button><button className="shootout-button shootout-button--primary" type="button" onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>;
}

function LiveScreen({
  state,
  view,
  soundEnabled,
  onBack,
  onPause,
  onSwitch,
  onUndo,
  onResetExpired,
  onRestart,
  onToggleSound,
  onFullscreen,
  isFullscreen,
}: {
  state: ShootoutState;
  view: ShootoutState;
  soundEnabled: boolean;
  onBack: () => void;
  onPause: () => void;
  onSwitch: () => void;
  onUndo: () => void;
  onResetExpired: () => void;
  onRestart: () => void;
  onToggleSound: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}) {
  const active = view.activePlayer;
  const incoming = active === "a" ? "b" : "a";
  const isPaused = view.matchClockPaused || view.shotClockPaused;
  const isExpired = view.status === "expired";
  const isComplete = view.status === "complete";
  const progress = Math.min(100, Math.max(0, (1 - view.matchRemainingMs / (10 * 60 * 1000)) * 100));
  const phaseLabel = view.phase === "long" ? "15 秒階段" : "10 秒階段";
  const actionLabel = isExpired ? `確認・轉換至${displayName(view, incoming)}` : `轉換至${displayName(view, incoming)}`;
  return <div className={`shootout-page shootout-live-page shootout-live-page--${view.status}${isPaused ? " is-paused" : ""}`}>
    <header className="shootout-header shootout-header--dark">
      <button type="button" className="shootout-back-button" onClick={onBack}><Icon name="back"/><span>離開計時器</span></button>
      <div className="shootout-live-brand"><span className="shootout-brand-mark">S</span><span><strong>SHOOTOUT</strong><small>限時賽計時器</small></span></div>
      <div className="shootout-live-tools"><button type="button" className={`shootout-tool-button${soundEnabled ? " is-on" : ""}`} onClick={onToggleSound} aria-pressed={soundEnabled} aria-label={soundEnabled ? "關閉聲音提示" : "開啟聲音提示"}><Icon name="sound"/></button><button type="button" className="shootout-tool-button" onClick={onFullscreen} aria-label={isFullscreen ? "退出全螢幕" : "進入全螢幕"}><Icon name="fullscreen"/></button></div>
    </header>

    <main className="shootout-live-main">
      <div className="shootout-live-layout">
        <section className="shootout-live-board" aria-label="Shootout 計時控制器">
          <div className="shootout-live-topline"><span className="shootout-live-label">{isComplete ? "MATCH COMPLETE" : "LIVE MATCH"}</span><span className={`shootout-status-chip${isExpired ? " is-danger" : isPaused ? " is-paused" : ""}`}><i aria-hidden="true"/>{isComplete ? "已完成" : isExpired ? "等待轉換" : isPaused ? "已暫停" : "計時中"}</span></div>

          <section className="shootout-match-clock-block">
            <div className="shootout-clock-label"><span>比賽鐘</span><small>10 分鐘總時限</small></div>
            <strong className="shootout-match-time">{formatTime(view.matchRemainingMs)}</strong>
            <div className="shootout-match-progress" aria-hidden="true"><i style={{transform: `scaleX(${progress / 100})`}}/></div>
            <div className="shootout-match-meta"><span>{isComplete ? "比賽時間完結" : view.phase === "long" ? "前五分鐘" : "最後五分鐘"}</span><span className="shootout-phase-badge">{phaseLabel}</span></div>
          </section>

          <section className="shootout-player-strip" aria-label={`目前由${displayName(view, active)}出桿`}>
            {(["a", "b"] as ShootoutPlayer[]).map((player, index) => <div key={player} className={`shootout-live-player${active === player ? " is-active" : ""}`} aria-current={active === player ? "true" : undefined}><span className="shootout-live-player-index">{player.toUpperCase()}</span><div><strong>{displayName(view, player)}</strong><small>{active === player ? "出桿中" : "等待中"}</small></div>{active === player && <span className="shootout-active-mark"><Icon name="arrow"/></span>}{index === 0 && <span className="shootout-player-divider" aria-hidden="true"/>}</div>)}
          </section>

          <section className={`shootout-shot-clock-block${isExpired ? " is-expired" : ""}${isPaused ? " is-paused" : ""}`} aria-live="off">
            <div className="shootout-shot-heading"><div><span>出桿鐘</span><small>{isExpired ? "按鍵後才會轉換球員" : isPaused ? "時鐘已暫停" : "目前球員的出桿時間"}</small></div><span className="shootout-limit-label">{view.phase === "long" ? "15 秒" : "10 秒"}</span></div>
            <strong className="shootout-shot-time">{formatTime(view.shotRemainingMs)}</strong>
            <div className="shootout-shot-state">{isExpired ? <><span className="shootout-state-dot"/>時間已過 · {displayName(view, active)}仍為目前球員</> : isPaused ? <><span className="shootout-state-dot"/>已暫停 · 等待計時員操作</> : <>每次轉換後重新開始 {view.phase === "long" ? "15" : "10"} 秒</>}</div>
          </section>

          <section className="shootout-action-deck">
            {isComplete ? <div className="shootout-complete-message"><span className="shootout-complete-icon"><Icon name="check"/></span><div><strong>比賽時間完結</strong><small>計時已停止。請依現場記分與裁判決定處理賽果。</small></div></div> : <button type="button" className={`shootout-button shootout-button--switch${isExpired ? " is-expired" : ""}`} onClick={onSwitch} disabled={isPaused}><span>{actionLabel}</span><Icon name="arrow"/></button>}
            <div className="shootout-secondary-actions"><button type="button" className="shootout-button shootout-button--secondary" onClick={onPause} disabled={isComplete}><Icon name={isPaused ? "play" : "pause"}/>{isPaused ? "計時選項" : "暫停計時"}</button><button type="button" className="shootout-button shootout-button--quiet" onClick={onUndo} disabled={!state.undo.length || isComplete}><Icon name="undo"/>復原上次轉換</button></div>
            {isExpired && !isComplete && <button type="button" className="shootout-correction-button" onClick={onResetExpired}><Icon name="reset"/>裁判取消到時・恢復出桿鐘</button>}
          </section>

          <div className="shootout-live-note"><span className="shootout-note-pip"/><span>{isExpired ? "出桿鐘到時後，比賽鐘仍然繼續倒數。" : "只有球員真正完成一桿後，才按轉換球員。"}</span></div>
        </section>
        <ActivityRail events={state.events}/>
      </div>
      <div className="shootout-live-footer"><span>一位計時員 · 只記錄時間與轉換</span><button type="button" onClick={onRestart}>結束並開始新一場</button></div>
    </main>
  </div>;
}

export default function ShootoutClient() {
  const getNow = useShootoutClock();
  const [state, setState] = useState<ShootoutState>(() => createShootoutState());
  const [now, setNow] = useState(() => Date.now());
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState("");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseTarget, setPauseTarget] = useState<ShootoutPauseTarget>("both");
  const [confirmAction, setConfirmAction] = useState<"reset-expired" | "restart" | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cue = useCue(soundEnabled, hapticsEnabled);
  const cueState = useRef({phase: "long", warning: false, second: 99, status: "setup"});

  const view = useMemo(() => getShootoutView(state, now), [now, state]);

  /* Local storage is an external persistence source. The initial mount must reconcile it into the
     client state before the live controller is shown, so these synchronous updates are intentional. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = loadShootoutState(localStorage.getItem(STORAGE_KEY));
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as {sound?: boolean; haptics?: boolean} | null;
      if (typeof settings?.sound === "boolean") setSoundEnabled(settings.sound);
      if (typeof settings?.haptics === "boolean") setHapticsEnabled(settings.haptics);
      if (saved && (saved.status === "ready" || saved.status === "live" || saved.status === "expired" || saved.status === "complete")) {
        setState(reconcileShootout(saved, getNow()));
        setRestored(saved.status !== "complete");
      }
    } catch {
      // A damaged local session should never block a new one.
    }
    setNow(getNow());
    setHydrated(true);
  }, [getNow]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const id = window.setInterval(() => setNow(getNow()), 100);
    return () => window.clearInterval(id);
  }, [getNow]);

  /* The state machine commits boundary transitions discovered by its timestamp projection. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!hydrated) return;
    if (view.phase !== state.phase || view.status !== state.status) {
      setState(previous => reconcileShootout(previous, getNow()));
    }
  }, [getNow, hydrated, state.phase, state.status, view.phase, view.status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    try {localStorage.setItem(STORAGE_KEY, JSON.stringify(state));} catch { /* best effort */ }
  }, [hydrated, state]);

  useEffect(() => {
    if (!hydrated) return;
    const save = () => {try {localStorage.setItem(STORAGE_KEY, JSON.stringify(reconcileShootout(state, getNow())));} catch { /* best effort */ }};
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [getNow, hydrated, state]);

  useEffect(() => {
    if (!hydrated) return;
    const current = cueState.current;
    if (view.phase === "short" && current.phase !== "short") {cue("phase"); current.phase = "short";}
    if (view.shotRemainingMs > 5000) {current.warning = false; current.second = 99;}
    if (view.status === "live" && !view.shotClockPaused && view.shotRemainingMs <= 5000 && view.shotRemainingMs > 3000 && !current.warning) {cue("warning"); current.warning = true;}
    if (view.status === "live" && !view.shotClockPaused && view.shotRemainingMs <= 3000 && view.shotRemainingMs > 0) {
      const second = Math.ceil(view.shotRemainingMs / 1000);
      if (second !== current.second) {cue("countdown"); current.second = second;}
    }
    if (view.status === "expired" && current.status !== "expired") {cue("expiry"); current.status = "expired";}
    if (view.status === "complete" && current.status !== "complete") {cue("complete"); current.status = "complete";}
    if (view.status === "live" && current.status !== "live") current.status = "live";
  }, [cue, hydrated, view.phase, view.shotClockPaused, view.shotRemainingMs, view.status]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const applySettings = useCallback((sound: boolean, haptics: boolean) => {
    setSoundEnabled(sound);
    setHapticsEnabled(haptics);
    try {localStorage.setItem(SETTINGS_KEY, JSON.stringify({sound, haptics}));} catch { /* best effort */ }
  }, []);

  const updateSetup = (field: "playerA" | "playerB", value: string) => {
    setState(previous => ({...previous, [field]: value}));
    setError("");
  };

  const selectOpening = (player: ShootoutPlayer) => {
    setState(previous => ({...previous, openingPlayer: player}));
    setError("");
  };

  const enterReady = () => {
    if (!canEnterReady(state)) {setError("請先輸入兩位不同的球員姓名，並選擇開球球員。"); return;}
    setState(previous => toReady(previous));
    setError("");
  };

  const start = () => {
    const at = getNow();
    if (!canEnterReady(state)) {setError("請先完成球員與開球設定。"); return;}
    setState(previous => startShootout(previous, at));
    setRestored(false);
    setNow(at);
    cue("switch");
  };

  const switchTurn = () => {
    const at = getNow();
    setState(previous => switchShootoutTurn(previous, at));
    setNow(at);
    cue("switch");
  };

  const undo = () => {
    const at = getNow();
    setState(previous => restorePreviousTurn(previous, at));
    setNow(at);
  };

  const pause = () => {
    const at = getNow();
    setState(previous => setPause(previous, pauseTarget, at));
    setPauseOpen(false);
    setNow(at);
  };

  const resume = () => {
    const at = getNow();
    setState(previous => resumeShootout(previous, at));
    setPauseOpen(false);
    setNow(at);
  };

  const resetExpired = () => {
    const at = getNow();
    setState(previous => resetShotClock(previous, at, true));
    setNow(at);
    cue("switch");
  };

  const resetAndResume = () => {
    const at = getNow();
    setState(previous => resumeShootout(resetShotClock(previous, at, true), at));
    setPauseOpen(false);
    setNow(at);
  };

  const reset = () => {
    setState(createShootoutState());
    setRestored(false);
    setError("");
    setConfirmAction(null);
    try {localStorage.removeItem(STORAGE_KEY);} catch { /* best effort */ }
  };

  const leave = () => {
    if (view.status === "live" || view.status === "expired") {setConfirmAction("restart"); return;}
    reset();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("此瀏覽器未能開啟全螢幕模式。");
    }
  };

  if (!hydrated) return <div className="shootout-loading"><span className="shootout-loading-mark">S</span><span>載入計時器…</span></div>;

  const isLiveSurface = view.status === "live" || view.status === "expired" || view.status === "complete";
  if (!isLiveSurface) return <SetupScreen state={state} error={error} soundEnabled={soundEnabled} hapticsEnabled={hapticsEnabled} onChange={updateSetup} onSelectOpening={selectOpening} onToggleSound={() => applySettings(!soundEnabled, hapticsEnabled)} onToggleHaptics={() => applySettings(soundEnabled, !hapticsEnabled)} onReady={enterReady} onStart={start} onReset={reset}/>;

  return <>
    <LiveScreen state={state} view={view} soundEnabled={soundEnabled} onBack={leave} onPause={() => setPauseOpen(true)} onSwitch={switchTurn} onUndo={undo} onResetExpired={() => setConfirmAction("reset-expired")} onRestart={() => setConfirmAction("restart")} onToggleSound={() => applySettings(!soundEnabled, hapticsEnabled)} onFullscreen={toggleFullscreen} isFullscreen={isFullscreen}/>
    <PauseSheet open={pauseOpen} isPaused={Boolean(view.matchClockPaused || view.shotClockPaused)} target={pauseTarget} setTarget={setPauseTarget} onClose={() => setPauseOpen(false)} onPause={pause} onResume={resume} onReset={resetAndResume}/>
    <ConfirmSheet open={confirmAction === "reset-expired"} title="恢復這一個出桿鐘？" description="這會取消目前的到時狀態，保留目前球員，並按照現階段重設出桿鐘。請只在裁判指示後使用。" confirmLabel="恢復出桿鐘" onClose={() => setConfirmAction(null)} onConfirm={() => {setConfirmAction(null); resetExpired();}}/>
    <ConfirmSheet open={confirmAction === "restart"} title="結束目前這場？" description="目前的計時會停止，並返回賽前設定。時間紀錄會留在本機，下一場會重新開始。" confirmLabel="結束並開始新一場" onClose={() => setConfirmAction(null)} onConfirm={reset}/>
    {error && <div className="shootout-live-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="關閉提示"><Icon name="x"/></button></div>}
    {restored && <div className="shootout-restored-note" role="status"><Icon name="check"/><span>已恢復上一場計時</span><button type="button" onClick={reset}>開始新一場</button></div>}
  </>;
}
