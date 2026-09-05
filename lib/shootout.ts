export const SHOOTOUT_MATCH_MS = 10 * 60 * 1000;
export const SHOOTOUT_LONG_SHOT_MS = 15 * 1000;
export const SHOOTOUT_SHORT_SHOT_MS = 10 * 1000;
export const SHOOTOUT_PHASE_CHANGE_MS = 5 * 60 * 1000;

export type ShootoutPlayer = "a" | "b";
export type ShootoutPhase = "long" | "short";
export type ShootoutStatus = "setup" | "ready" | "live" | "expired" | "complete";
export type ShootoutPauseTarget = "shot" | "match" | "both";
export type ShootoutEventKind =
  | "start"
  | "switch"
  | "expiry"
  | "phase-change"
  | "pause"
  | "resume"
  | "reset-shot"
  | "correction"
  | "complete";

export interface ShootoutEvent {
  id: string;
  kind: ShootoutEventKind;
  at: number;
  label: string;
  player?: ShootoutPlayer;
}

interface TurnUndo {
  at: number;
  activePlayer: ShootoutPlayer;
  status: "live" | "expired";
  shotRemainingMs: number;
  shotClockPaused: boolean;
}

export interface ShootoutState {
  version: 1;
  playerA: string;
  playerB: string;
  openingPlayer: ShootoutPlayer | null;
  activePlayer: ShootoutPlayer | null;
  status: ShootoutStatus;
  phase: ShootoutPhase;
  matchRemainingMs: number;
  shotRemainingMs: number;
  matchClockPaused: boolean;
  shotClockPaused: boolean;
  lastUpdatedAt: number | null;
  events: ShootoutEvent[];
  undo: TurnUndo[];
}

export interface ShootoutView extends ShootoutState {
  matchRemainingMs: number;
  shotRemainingMs: number;
  phase: ShootoutPhase;
  status: ShootoutStatus;
}

const phaseFor = (matchRemainingMs: number): ShootoutPhase =>
  matchRemainingMs <= SHOOTOUT_PHASE_CHANGE_MS ? "short" : "long";

export const shotLimitFor = (phase: ShootoutPhase): number =>
  phase === "short" ? SHOOTOUT_SHORT_SHOT_MS : SHOOTOUT_LONG_SHOT_MS;

const otherPlayer = (player: ShootoutPlayer): ShootoutPlayer => (player === "a" ? "b" : "a");

const eventId = (kind: ShootoutEventKind, at: number): string => `${kind}-${at}-${Math.random().toString(36).slice(2, 8)}`;

const withEvent = (state: ShootoutState, kind: ShootoutEventKind, at: number, label: string, player?: ShootoutPlayer): ShootoutState => ({
  ...state,
  events: [...state.events, {id: eventId(kind, at), kind, at, label, player}].slice(-80),
});

export function createShootoutState(playerA = "", playerB = ""): ShootoutState {
  return {
    version: 1,
    playerA,
    playerB,
    openingPlayer: null,
    activePlayer: null,
    status: "setup",
    phase: "long",
    matchRemainingMs: SHOOTOUT_MATCH_MS,
    shotRemainingMs: SHOOTOUT_LONG_SHOT_MS,
    matchClockPaused: false,
    shotClockPaused: false,
    lastUpdatedAt: null,
    events: [],
    undo: [],
  };
}

export function canEnterReady(state: ShootoutState): boolean {
  return Boolean(state.playerA.trim() && state.playerB.trim() && state.playerA.trim() !== state.playerB.trim() && state.openingPlayer);
}

export function toReady(state: ShootoutState): ShootoutState {
  if (!canEnterReady(state)) return state;
  return {
    ...state,
    status: "ready",
    phase: "long",
    matchRemainingMs: SHOOTOUT_MATCH_MS,
    shotRemainingMs: SHOOTOUT_LONG_SHOT_MS,
    matchClockPaused: false,
    shotClockPaused: false,
    activePlayer: state.openingPlayer,
    lastUpdatedAt: null,
    events: [],
    undo: [],
  };
}

export function getShootoutView(state: ShootoutState, now: number): ShootoutView {
  if (state.lastUpdatedAt === null || (state.status !== "live" && state.status !== "expired")) {
    return {...state, phase: phaseFor(state.matchRemainingMs)};
  }

  const elapsed = Math.max(0, now - state.lastUpdatedAt);
  const matchElapsed = state.matchClockPaused ? 0 : elapsed;
  const shotElapsed = state.shotClockPaused || state.status === "expired" ? 0 : elapsed;
  const matchRemainingMs = Math.max(0, state.matchRemainingMs - matchElapsed);
  const phase = phaseFor(matchRemainingMs);
  let shotRemainingMs = Math.max(0, state.shotRemainingMs - shotElapsed);
  if (phase === "short") shotRemainingMs = Math.min(SHOOTOUT_SHORT_SHOT_MS, shotRemainingMs);

  let status: ShootoutStatus = state.status;
  if (matchRemainingMs <= 0) status = "complete";
  else if (status === "live" && shotRemainingMs <= 0) status = "expired";

  return {...state, matchRemainingMs, shotRemainingMs, phase, status};
}

export function reconcileShootout(state: ShootoutState, now: number): ShootoutState {
  if (state.lastUpdatedAt === null || (state.status !== "live" && state.status !== "expired")) return state;

  const view = getShootoutView(state, now);
  let next: ShootoutState = {
    ...state,
    matchRemainingMs: view.matchRemainingMs,
    shotRemainingMs: view.shotRemainingMs,
    phase: view.phase,
    status: view.status,
    lastUpdatedAt: now,
  };

  if (state.phase !== "short" && view.phase === "short") {
    next = withEvent(next, "phase-change", now, "進入 10 秒階段");
  }
  if (state.status === "live" && view.status === "expired") {
    next = withEvent(next, "expiry", now, "出桿鐘時間已過", state.activePlayer ?? undefined);
  }
  if (view.status === "complete") {
    next = withEvent(next, "complete", now, "比賽時間完結");
    next = {...next, matchClockPaused: true, shotClockPaused: true};
  }
  return next;
}

export function startShootout(state: ShootoutState, now: number): ShootoutState {
  const ready = toReady(state);
  if (ready.status !== "ready" || !ready.openingPlayer) return state;
  const next: ShootoutState = {
    ...ready,
    status: "live",
    activePlayer: ready.openingPlayer,
    matchRemainingMs: SHOOTOUT_MATCH_MS,
    shotRemainingMs: SHOOTOUT_LONG_SHOT_MS,
    phase: "long",
    matchClockPaused: false,
    shotClockPaused: false,
    lastUpdatedAt: now,
  };
  return withEvent(next, "start", now, `開始比賽・${ready.openingPlayer === "a" ? ready.playerA : ready.playerB} 出桿`, ready.openingPlayer);
}

export function switchShootoutTurn(state: ShootoutState, now: number): ShootoutState {
  const current = reconcileShootout(state, now);
  if ((current.status !== "live" && current.status !== "expired") || !current.activePlayer) return current;
  if (current.matchRemainingMs <= 0) return reconcileShootout(current, now);

  const incoming = otherPlayer(current.activePlayer);
  const next: ShootoutState = {
    ...current,
    status: "live",
    activePlayer: incoming,
    shotRemainingMs: shotLimitFor(current.phase),
    shotClockPaused: false,
    lastUpdatedAt: now,
    undo: [
      ...current.undo,
      {
        at: now,
        activePlayer: current.activePlayer,
        status: current.status,
        shotRemainingMs: current.shotRemainingMs,
        shotClockPaused: current.shotClockPaused,
      },
    ].slice(-8),
  };
  return withEvent(next, "switch", now, `轉換至${incoming === "a" ? current.playerA : current.playerB}`, incoming);
}

export function restorePreviousTurn(state: ShootoutState, now: number): ShootoutState {
  const current = reconcileShootout(state, now);
  const previous = current.undo.at(-1);
  if (!previous || !current.activePlayer || current.status === "complete") return current;

  const timeSinceSwitch = Math.max(0, now - previous.at);
  const shotRemainingMs = previous.status === "live" && !previous.shotClockPaused
    ? Math.max(0, previous.shotRemainingMs - timeSinceSwitch)
    : previous.shotRemainingMs;
  const status: ShootoutStatus = previous.status === "expired" || shotRemainingMs <= 0 ? "expired" : "live";
  const next: ShootoutState = {
    ...current,
    status,
    activePlayer: previous.activePlayer,
    shotRemainingMs: Math.min(shotLimitFor(current.phase), shotRemainingMs),
    shotClockPaused: previous.shotClockPaused,
    lastUpdatedAt: now,
    undo: current.undo.slice(0, -1),
  };
  return withEvent(next, "correction", now, `復原上次轉換・${previous.activePlayer === "a" ? current.playerA : current.playerB} 繼續`, previous.activePlayer);
}

export function setPause(state: ShootoutState, target: ShootoutPauseTarget, now: number): ShootoutState {
  const current = reconcileShootout(state, now);
  if (current.status !== "live" && current.status !== "expired") return current;
  const next: ShootoutState = {
    ...current,
    matchClockPaused: target === "match" || target === "both",
    shotClockPaused: target === "shot" || target === "both",
    lastUpdatedAt: now,
  };
  return withEvent(next, "pause", now, target === "both" ? "暫停全部計時" : target === "match" ? "暫停比賽鐘" : "暫停出桿鐘");
}

export function resumeShootout(state: ShootoutState, now: number): ShootoutState {
  const current = reconcileShootout(state, now);
  if (current.status !== "live" && current.status !== "expired") return current;
  const next: ShootoutState = {...current, matchClockPaused: false, shotClockPaused: false, lastUpdatedAt: now};
  return withEvent(next, "resume", now, "繼續計時");
}

export function resetShotClock(state: ShootoutState, now: number, correction = false): ShootoutState {
  const current = reconcileShootout(state, now);
  if ((current.status !== "live" && current.status !== "expired") || current.matchRemainingMs <= 0) return current;
  const next: ShootoutState = {
    ...current,
    status: "live",
    shotRemainingMs: shotLimitFor(current.phase),
    shotClockPaused: false,
    lastUpdatedAt: now,
  };
  return withEvent(next, correction ? "correction" : "reset-shot", now, correction ? "裁判取消到時・恢復出桿鐘" : "重設出桿鐘", current.activePlayer ?? undefined);
}

export function loadShootoutState(raw: string | null): ShootoutState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ShootoutState>;
    if (parsed?.version !== 1 || typeof parsed.playerA !== "string" || typeof parsed.playerB !== "string") return null;
    if (!Array.isArray(parsed.events) || !Array.isArray(parsed.undo)) return null;
    return {
      ...createShootoutState(parsed.playerA, parsed.playerB),
      ...parsed,
      openingPlayer: parsed.openingPlayer === "a" || parsed.openingPlayer === "b" ? parsed.openingPlayer : null,
      activePlayer: parsed.activePlayer === "a" || parsed.activePlayer === "b" ? parsed.activePlayer : null,
    } as ShootoutState;
  } catch {
    return null;
  }
}
