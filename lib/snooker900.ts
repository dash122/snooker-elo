/* Snooker 900 timer — pure state for a frame played against a 15-minute frame clock and a per-shot clock.
   Time only: no score is kept. The seated player taps once per shot (restarting the shot clock) and the
   incoming player taps their own name to take the table. Remaining times are settled against wall-clock
   timestamps, so a refresh or a locked phone never loses time. */

export const S900_FRAME_MS = 15 * 60 * 1000;
export const S900_SHOT_OPTIONS_MS = [15_000, 20_000, 25_000] as const;
export const S900_DEFAULT_SHOT_MS = 20_000;
/** Taps closer together than this are treated as one: a double-tap or a bump while reaching for the phone. */
export const S900_TAP_GUARD_MS = 800;

export type S900Player = "a" | "b";
export type S900Status = "setup" | "ready" | "live" | "frame-over";

export interface S900Frame {
  winner: S900Player;
  /** Level at the buzzer and settled by the blue-ball shoot-out. */
  blueBall: boolean;
}

interface Snapshot {
  at: number;
  active: S900Player;
  shotRemainingMs: number;
}

export interface S900State {
  version: 1;
  playerA: string;
  playerB: string;
  shotClockMs: number;
  frameMs: number;
  breaker: S900Player;
  status: S900Status;
  active: S900Player | null;
  frameRemainingMs: number;
  /** Can go below zero: an expired shot clock keeps counting until the next tap. */
  shotRemainingMs: number;
  paused: boolean;
  lastUpdatedAt: number | null;
  lastTapAt: number | null;
  shots: number;
  undo: Snapshot[];
  frames: S900Frame[];
}

export interface S900View extends S900State {
  shotExpired: boolean;
}

export const otherPlayer = (player: S900Player): S900Player => (player === "a" ? "b" : "a");

export function createS900State(playerA = "", playerB = "", shotClockMs = S900_DEFAULT_SHOT_MS): S900State {
  return {
    version: 1,
    playerA,
    playerB,
    shotClockMs,
    frameMs: S900_FRAME_MS,
    breaker: "a",
    status: "setup",
    active: null,
    frameRemainingMs: S900_FRAME_MS,
    shotRemainingMs: shotClockMs,
    paused: false,
    lastUpdatedAt: null,
    lastTapAt: null,
    shots: 0,
    undo: [],
    frames: [],
  };
}

export function canStart(state: S900State): boolean {
  const a = state.playerA.trim(), b = state.playerB.trim();
  return Boolean(a && b && a !== b);
}

/** Lock in the players and settings and wait for the break-off tap. */
export function toReady(state: S900State): S900State {
  if (!canStart(state)) return state;
  return {
    ...state,
    playerA: state.playerA.trim(),
    playerB: state.playerB.trim(),
    status: "ready",
    active: state.breaker,
    frameRemainingMs: state.frameMs,
    shotRemainingMs: state.shotClockMs,
    paused: false,
    lastUpdatedAt: null,
    lastTapAt: null,
    shots: 0,
    undo: [],
  };
}

export function getS900View(state: S900State, now: number): S900View {
  if (state.status !== "live" || state.lastUpdatedAt === null || state.paused) {
    return {...state, shotExpired: state.status === "live" && state.shotRemainingMs <= 0};
  }
  const elapsed = Math.max(0, now - state.lastUpdatedAt);
  const frameRemainingMs = Math.max(0, state.frameRemainingMs - elapsed);
  const shotRemainingMs = state.shotRemainingMs - elapsed;
  const status: S900Status = frameRemainingMs <= 0 ? "frame-over" : "live";
  return {...state, frameRemainingMs, shotRemainingMs, status, shotExpired: shotRemainingMs <= 0};
}

/** Fold elapsed time into the stored clocks. */
export function settle(state: S900State, now: number): S900State {
  if (state.status !== "live" || state.lastUpdatedAt === null) return state;
  const view = getS900View(state, now);
  return {...state, frameRemainingMs: view.frameRemainingMs, shotRemainingMs: view.shotRemainingMs, status: view.status, lastUpdatedAt: now};
}

export function breakOff(state: S900State, now: number): S900State {
  const ready = state.status === "ready" ? state : toReady(state);
  if (ready.status !== "ready") return state;
  return {...ready, status: "live", active: ready.breaker, lastUpdatedAt: now, lastTapAt: now};
}

const guarded = (state: S900State, now: number) => state.lastTapAt !== null && now - state.lastTapAt < S900_TAP_GUARD_MS;

const snapshot = (state: S900State, now: number): Snapshot[] =>
  [...state.undo, {at: now, active: state.active as S900Player, shotRemainingMs: state.shotRemainingMs}].slice(-12);

/** The balls have stopped: restart the shot clock for the same player. */
export function tapShot(state: S900State, now: number): S900State {
  const current = settle(state, now);
  if (current.status !== "live" || current.paused || !current.active || guarded(current, now)) return current;
  return {...current, shotRemainingMs: current.shotClockMs, shots: current.shots + 1, lastTapAt: now, undo: snapshot(current, now)};
}

/** A player taps their own name on the way to the table. Tapping the player already at the table counts as a shot. */
export function takeTable(state: S900State, player: S900Player, now: number): S900State {
  const current = settle(state, now);
  if (current.status !== "live" || current.paused || !current.active || guarded(current, now)) return current;
  if (current.active === player) return tapShot(state, now);
  return {...current, active: player, shotRemainingMs: current.shotClockMs, lastTapAt: now, undo: snapshot(current, now)};
}

/** Put back the last tap, as if it never happened: the earlier shot clock keeps the time it would have run. */
export function undoTap(state: S900State, now: number): S900State {
  const current = settle(state, now);
  const previous = current.undo.at(-1);
  if (current.status !== "live" || !previous) return current;
  const shotRemainingMs = previous.shotRemainingMs - (current.paused ? 0 : Math.max(0, now - previous.at));
  return {
    ...current,
    active: previous.active,
    shotRemainingMs,
    shots: previous.active === current.active ? Math.max(0, current.shots - 1) : current.shots,
    lastTapAt: null,
    undo: current.undo.slice(0, -1),
  };
}

export function setPaused(state: S900State, paused: boolean, now: number): S900State {
  const current = settle(state, now);
  if (current.status !== "live" || current.paused === paused) return current;
  return {...current, paused, lastUpdatedAt: now, lastTapAt: null};
}

/** Stop the frame before the buzzer (a concession, or the last ball potted). */
export function endFrameEarly(state: S900State, now: number): S900State {
  const current = settle(state, now);
  if (current.status !== "live") return current;
  return {...current, status: "frame-over", paused: false, lastUpdatedAt: now};
}

export function recordFrame(state: S900State, winner: S900Player, blueBall: boolean, now: number): S900State {
  const current = settle(state, now);
  if (current.status !== "frame-over") return current;
  const next: S900State = {...current, frames: [...current.frames, {winner, blueBall}], breaker: otherPlayer(current.breaker)};
  return toReady(next);
}

export function frameTally(state: S900State): Record<S900Player, number> {
  return state.frames.reduce((tally, frame) => ({...tally, [frame.winner]: tally[frame.winner] + 1}), {a: 0, b: 0});
}

export function loadS900State(raw: string | null): S900State | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<S900State>;
    if (parsed?.version !== 1 || typeof parsed.playerA !== "string" || typeof parsed.playerB !== "string") return null;
    if (!Array.isArray(parsed.undo) || !Array.isArray(parsed.frames)) return null;
    const base = createS900State(parsed.playerA, parsed.playerB, typeof parsed.shotClockMs === "number" ? parsed.shotClockMs : S900_DEFAULT_SHOT_MS);
    return {...base, ...parsed} as S900State;
  } catch {
    return null;
  }
}
