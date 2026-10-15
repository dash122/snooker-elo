"use client";

import {useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent} from "react";
import Link from "next/link";
import {
  S900_SHOT_OPTIONS_MS,
  S900_TAP_GUARD_MS,
  breakOff,
  canStart,
  createS900State,
  endFrameEarly,
  frameTally,
  getS900View,
  loadS900State,
  recordFrame,
  setPaused,
  takeTable,
  tapShot,
  toReady,
  undoTap,
  type S900Player,
  type S900State,
  type S900View,
} from "../../lib/snooker900";
import { Button, FormField, SegmentedControl } from "../components/ui/Primitives";
import { Dialog, Sheet } from "../components/ui/Overlay";
import { useT } from "../components/I18nProvider";
import type { Translator } from "../../lib/i18n/translate";
import { INTL_LOCALE } from "../../lib/i18n/locales";

const STORAGE_KEY = "elo-900-session";
const SETTINGS_KEY = "elo-900-settings";
const HOLD_MS = 2000;
const UNDO_WINDOW_MS = 4000;
const FOUL_FLASH_MS = 3000;
const FRAME_CALLOUTS = [5 * 60_000, 60_000, 30_000];
const RING = 2 * Math.PI * 45;

type CueKind = "tick" | "time" | "buzzer";

const nameOf = (state: S900State, player: S900Player) => (player === "a" ? state.playerA : state.playerB);

function formatClock(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function readStorage(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string | null) {
  try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* private mode: the timer still runs */ }
}

/** Beeps through Web Audio and short spoken calls, so players never need to look at the phone. */
function useCues(t: Translator, voice: boolean) {
  const context = useRef<AudioContext | null>(null);
  const unlock = useCallback(() => {
    try {
      const Ctor = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (Ctor) context.current ??= new Ctor();
      if (context.current?.state === "suspended") void context.current.resume();
      // iOS only lets speech start from a gesture; an empty utterance here unlocks later calls.
      if (voice && "speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    } catch { /* audio is a convenience */ }
  }, [voice]);
  const cue = useCallback((kind: CueKind, say?: string) => {
    if (!voice) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(kind === "tick" ? 20 : [90, 50, 120]);
    try {
      const ctx = context.current;
      if (ctx) {
        const now = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
        const length = kind === "buzzer" ? 0.9 : kind === "time" ? 0.35 : 0.08;
        osc.type = kind === "tick" ? "sine" : "square";
        osc.frequency.setValueAtTime(kind === "tick" ? 880 : kind === "time" ? 330 : 220, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(kind === "tick" ? 0.08 : 0.18, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + length + 0.02);
      }
      if (say && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(say);
        utterance.lang = INTL_LOCALE[t.locale];
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    } catch { /* timing stays usable when the browser refuses audio */ }
  }, [t.locale, voice]);
  return {cue, unlock};
}

/** Keep the screen awake while a frame is on. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(sentinel => { if (cancelled) void sentinel.release(); else lock = sentinel; }).catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", acquire); void lock?.release(); };
  }, [active]);
}

/** Fires spoken/beep cues when the clocks cross their thresholds. */
function useClockCues(t: Translator, view: S900View | null, cue: (kind: CueKind, say?: string) => void) {
  const previous = useRef<S900View | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (!view || !before || before.status !== "live" || view.paused) return;
    if (view.status === "frame-over") { cue("buzzer", t("本局完結")); return; }
    const secs = (ms: number) => Math.ceil(ms / 1000);
    const shotNow = secs(view.shotRemainingMs), shotBefore = secs(before.shotRemainingMs);
    if (view.active === before.active && shotNow !== shotBefore) {
      if (shotNow <= 0 && shotBefore > 0) cue("time", t("時間到"));
      else if (shotNow >= 1 && shotNow <= 5) cue("tick");
    }
    const frameNow = secs(view.frameRemainingMs), frameBefore = secs(before.frameRemainingMs);
    if (frameNow === frameBefore) return;
    const crossed = FRAME_CALLOUTS.find(mark => before.frameRemainingMs > mark && view.frameRemainingMs <= mark);
    if (crossed === 5 * 60_000) cue("time", t("剩餘五分鐘"));
    else if (crossed === 60_000) cue("time", t("剩餘一分鐘"));
    else if (crossed === 30_000) cue("time", t("剩餘三十秒"));
    else if (frameNow <= 10 && frameNow >= 1) cue("tick");
  }, [cue, t, view]);
}

function SetupScreen({state, voice, onChange, onToggleVoice, onStart}: {
  state: S900State;
  voice: boolean;
  onChange: (next: S900State) => void;
  onToggleVoice: () => void;
  onStart: () => void;
}) {
  const t = useT();
  const sameName = Boolean(state.playerA.trim()) && state.playerA.trim() === state.playerB.trim();
  return <div role="main" className="s900-page s900-setup">
    <div className="s900-setup-header">
      <Link href="/" className="s900-back">{t("返回 Snooker ELO")}</Link>
      <span className="s900-kicker">SNOOKER 900</span>
      <h1>{t("十五分鐘一局，每一桿都要快。")}</h1>
      <p>{t("只計時，不計分。手機放在球枱旁，由坐下的球員按鍵。")}</p>
    </div>

    <form className="s900-card s900-form" onSubmit={event => { event.preventDefault(); if (canStart(state)) onStart(); }}>
      <FormField label={t("球員 A")}>
        <input value={state.playerA} onChange={event => onChange({...state, playerA: event.target.value})} placeholder={t("輸入球員姓名")} maxLength={24} autoComplete="off"/>
      </FormField>
      <FormField label={t("球員 B")} error={sameName ? t("兩位球員名稱不能相同") : undefined}>
        <input value={state.playerB} onChange={event => onChange({...state, playerB: event.target.value})} placeholder={t("輸入球員姓名")} maxLength={24} autoComplete="off"/>
      </FormField>
      <div className="s900-field">
        <span>{t("開球球員")}</span>
        <SegmentedControl label={t("開球球員")} value={state.breaker} onChange={value => onChange({...state, breaker: value as S900Player})}
          items={[{value: "a", label: state.playerA.trim() || t("球員 A")}, {value: "b", label: state.playerB.trim() || t("球員 B")}]}/>
      </div>
      <div className="s900-field">
        <span>{t("出桿時限")}</span>
        <SegmentedControl label={t("出桿時限")} value={String(state.shotClockMs)} onChange={value => onChange({...state, shotClockMs: Number(value), shotRemainingMs: Number(value)})}
          items={S900_SHOT_OPTIONS_MS.map(ms => ({value: String(ms), label: t("{n} 秒", {n: ms / 1000})}))}/>
      </div>
      <button type="button" className={`s900-toggle${voice ? " is-on" : ""}`} aria-pressed={voice} onClick={onToggleVoice}>
        <span><strong>{t("聲音及語音提示")}</strong><small>{t("倒數嗶聲、「時間到」及剩餘時間報時")}</small></span>
        <i aria-hidden="true"/>
      </button>
      <Button type="submit" disabled={!canStart(state)}>{t("準備開球")}</Button>
    </form>

    <section className="s900-card" aria-labelledby="s900-how">
      <h2 id="s900-how">{t("使用方法")}</h2>
      <ol className="s900-steps">
        <li><b>{t("輕按畫面")}</b><span>{t("每桿完結、球停定後，坐下的球員輕按一下，出桿鐘重新計時。")}</span></li>
        <li><b>{t("按自己的名字")}</b><span>{t("輪到你上枱時，經過手機按自己的名字。")}</span></li>
        <li><b>{t("長按暫停")}</b><span>{t("按住畫面兩秒暫停，可復原、結束本局。")}</span></li>
      </ol>
    </section>

    <section className="s900-card" aria-labelledby="s900-rules">
      <h2 id="s900-rules">{t("900 規則重點")}</h2>
      <ul className="s900-rules">
        <li><b>15:00</b><span>{t("每局十五分鐘，時間到時分數領先者勝；平分以藍球決勝。")}</span></li>
        <li><b>{t("{n} 秒", {n: state.shotClockMs / 1000})}</b><span>{t("每桿限時，球停定後開始計；超時當犯規。")}</span></li>
        <li><b>{t("碰邊")}</b><span>{t("每桿必須入球，或有球碰到台邊。")}</span></li>
        <li><b>{t("自由球")}</b><span>{t("任何犯規後，對手可把白球放在任何位置。")}</span></li>
      </ul>
    </section>
  </div>;
}

function ReadyScreen({state, onBreakOff, onEdit, onReset}: {state: S900State; onBreakOff: () => void; onEdit: () => void; onReset: () => void}) {
  const t = useT();
  const tally = frameTally(state);
  const frameNo = state.frames.length + 1;
  return <div role="main" className="s900-page s900-stage-page s900-ready">
    <p className="s900-kicker">{t("第 {n} 局", {n: frameNo})}</p>
    {state.frames.length > 0 && <p className="s900-tally" aria-label={t("局數")}><span>{state.playerA}</span><b>{tally.a} – {tally.b}</b><span>{state.playerB}</span></p>}
    <button type="button" className="s900-break" onClick={onBreakOff}>
      <small>{t("{name} 開球", {name: nameOf(state, state.breaker)})}</small>
      <strong>{t("開球")}</strong>
      <span>{t("按下即開始十五分鐘計時")}</span>
    </button>
    <p className="s900-hint">{t("提示：把手機橫放在球枱旁，坐下的球員伸手可及。")}</p>
    <div className="s900-ready-actions">
      <Button variant="quiet" type="button" onClick={onEdit}>{t("更改設定")}</Button>
      {state.frames.length > 0 && <Button variant="quiet" type="button" onClick={onReset}>{t("結束對局")}</Button>}
    </div>
  </div>;
}

function LiveScreen({view, undoVisible, onShot, onTake, onUndo, onMenu}: {
  view: S900View;
  undoVisible: boolean;
  onShot: () => void;
  onTake: (player: S900Player) => void;
  onUndo: () => void;
  onMenu: () => void;
}) {
  const t = useT();
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  const [holding, setHolding] = useState(false);
  const shotSecs = Math.max(0, Math.ceil(view.shotRemainingMs / 1000));
  const progress = Math.min(1, Math.max(0, view.shotRemainingMs / view.shotClockMs));
  const tone = view.shotExpired ? "over" : shotSecs <= 5 ? "red" : shotSecs <= 10 ? "amber" : "go";
  const frameTone = view.frameRemainingMs <= 30_000 ? "red" : view.frameRemainingMs <= 120_000 ? "amber" : "go";
  const foulFlash = view.shotExpired && view.shotRemainingMs > -FOUL_FLASH_MS;
  const tally = frameTally(view);

  const clearHold = () => { if (hold.current !== null) window.clearTimeout(hold.current); hold.current = null; setHolding(false); };
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    held.current = false;
    setHolding(true);
    hold.current = window.setTimeout(() => { held.current = true; clearHold(); onMenu(); }, HOLD_MS);
  };
  const onUp = () => { const wasHeld = held.current; clearHold(); if (!wasHeld) onShot(); held.current = false; };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onShot(); } };

  return <div role="main" className={`s900-page s900-stage-page s900-live s900-tone-${tone}`}>
    <div className="s900-live-top">
      <div className={`s900-frame-clock s900-frame-${frameTone}`} aria-label={t("本局剩餘時間")}>
        <small>{t("第 {n} 局", {n: view.frames.length + 1})}{view.frames.length > 0 && ` · ${tally.a}–${tally.b}`}</small>
        <strong>{formatClock(view.frameRemainingMs)}</strong>
      </div>
      <button type="button" className="s900-pause" onClick={onMenu} aria-label={t("暫停")}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>
      </button>
    </div>

    <div className={`s900-shot-stage${holding ? " is-holding" : ""}`} role="button" tabIndex={0}
      aria-label={t("球停定後輕按，重新計算出桿時間；長按兩秒暫停")}
      onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={clearHold} onPointerLeave={clearHold} onKeyDown={onKey}
      onContextMenu={event => event.preventDefault()}>
      <svg className="s900-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="45" className="s900-ring-track"/>
        <circle cx="50" cy="50" r="45" className="s900-ring-fill" style={{strokeDasharray: RING, strokeDashoffset: RING * (1 - progress)}}/>
      </svg>
      <div className="s900-shot-readout" aria-live="off">
        <strong>{shotSecs}</strong>
        <span>{foulFlash ? t("超時犯規・自由球") : view.shotExpired ? t("已超時") : t("球停定後輕按")}</span>
      </div>
      <span className="s900-hold-bar" aria-hidden="true"/>
    </div>

    <nav className="s900-players" aria-label={t("輪到誰出桿")}>
      {(["a", "b"] as const).map(player => {
        const atTable = view.active === player;
        return <button key={player} type="button" className={`s900-player${atTable ? " is-active" : ""}`} aria-pressed={atTable} onClick={() => onTake(player)}>
          <strong>{nameOf(view, player)}</strong>
          <small>{atTable ? t("出桿中") : t("上枱時按這裡")}</small>
        </button>;
      })}
    </nav>

    {undoVisible && <button type="button" className="s900-undo" onClick={onUndo}>{t("按錯？復原")}</button>}
  </div>;
}

export default function Snooker900Client() {
  const t = useT();
  const [state, setState] = useState<S900State | null>(null);
  const [now, setNow] = useState(0);
  const [voice, setVoice] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [undoUntil, setUndoUntil] = useState(0);
  const [level, setLevel] = useState(false);
  const {cue, unlock} = useCues(t, voice);

  // Hydrate once from storage after mount, so the server render and first client render match.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = loadS900State(readStorage(STORAGE_KEY));
    setVoice(readStorage(SETTINGS_KEY) !== "muted");
    setNow(Date.now());
    setState(saved ?? createS900State());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => { if (state) writeStorage(STORAGE_KEY, JSON.stringify(state)); }, [state]);
  useEffect(() => {
    if (state?.status !== "live" || state.paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [state?.status, state?.paused]);

  const view = state ? getS900View(state, now) : null;
  useClockCues(t, view, cue);
  useWakeLock(state?.status === "live" || state?.status === "ready");

  const apply = useCallback((change: (current: S900State, at: number) => S900State) => {
    const at = Date.now();
    setNow(at);
    setState(current => (current ? change(current, at) : current));
  }, []);

  if (!state || !view) return <div role="main" className="s900-page s900-loading" aria-busy="true">SNOOKER 900</div>;

  if (state.status === "setup") {
    return <SetupScreen state={state} voice={voice}
      onChange={setState}
      onToggleVoice={() => { const next = !voice; setVoice(next); writeStorage(SETTINGS_KEY, next ? "on" : "muted"); }}
      onStart={() => setState(toReady(state))}/>;
  }

  if (state.status === "ready") {
    return <ReadyScreen state={state}
      onBreakOff={() => { unlock(); apply(breakOff); }}
      onEdit={() => setState({...state, status: "setup"})}
      onReset={() => setState({...createS900State(state.playerA, state.playerB, state.shotClockMs), breaker: state.breaker})}/>;
  }

  const frameOver = view.status === "frame-over";
  const tapped = (change: (current: S900State, at: number) => S900State) => {
    const before = state.lastTapAt;
    apply(change);
    // Only offer undo when the tap registered (not swallowed by the double-tap guard).
    const at = Date.now();
    if (before === null || at - before >= S900_TAP_GUARD_MS) setUndoUntil(at + UNDO_WINDOW_MS);
  };
  const finish = (winner: S900Player, blueBall: boolean) => { setLevel(false); apply((current, at) => recordFrame(current, winner, blueBall, at)); };

  return <>
    <LiveScreen view={view} undoVisible={now < undoUntil && !frameOver}
      onShot={() => tapped(tapShot)}
      onTake={player => tapped((current, at) => takeTable(current, player, at))}
      onUndo={() => { setUndoUntil(0); apply(undoTap); }}
      onMenu={() => { setMenuOpen(true); apply((current, at) => setPaused(current, true, at)); }}/>

    <Sheet open={menuOpen && !frameOver} title={t("已暫停")} onClose={() => { setMenuOpen(false); apply((current, at) => setPaused(current, false, at)); }}>
      <div className="s900-menu">
        <Button type="button" onClick={() => { setMenuOpen(false); apply((current, at) => setPaused(current, false, at)); }}>{t("繼續計時")}</Button>
        <Button type="button" variant="secondary" disabled={!state.undo.length} onClick={() => apply(undoTap)}>{t("復原上一下按鍵")}</Button>
        <Button type="button" variant="secondary" onClick={() => { setMenuOpen(false); apply(endFrameEarly); }}>{t("提早結束本局")}</Button>
        <Button type="button" variant="quiet" onClick={() => { setMenuOpen(false); setState({...createS900State(state.playerA, state.playerB, state.shotClockMs), breaker: state.breaker}); }}>{t("放棄並返回設定")}</Button>
      </div>
    </Sheet>

    <Dialog open={frameOver} title={level ? t("藍球決勝") : t("本局完結・誰領先？")} onClose={() => setLevel(false)}>
      {level ? <>
        <p className="s900-dialog-note">{t("按你們約定的方式以藍球決勝，然後選出勝方。")}</p>
        <div className="s900-menu">
          {(["a", "b"] as const).map(player => <Button key={player} type="button" onClick={() => finish(player, true)}>{t("{name} 勝出", {name: nameOf(state, player)})}</Button>)}
          <Button type="button" variant="quiet" onClick={() => setLevel(false)}>{t("返回")}</Button>
        </div>
      </> : <div className="s900-menu">
        {(["a", "b"] as const).map(player => <Button key={player} type="button" onClick={() => finish(player, false)}>{nameOf(state, player)}</Button>)}
        <Button type="button" variant="secondary" onClick={() => setLevel(true)}>{t("平分・藍球決勝")}</Button>
      </div>}
    </Dialog>
  </>;
}
