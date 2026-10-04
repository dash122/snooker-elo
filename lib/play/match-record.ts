import { msg } from "../i18n/translate.ts";
import { replay, type ReplayMatch, type ReplayPlayer, type ReplaySettings } from "../elo-replay.ts";

/* Turning a session result into a club match, on the server. The rating pipeline is a replay of the
   whole match history (`replay`), which recomputes every before/after/delta from the scores, so a new
   match only needs its identity, scores, date and handicap; the rating fields below are placeholders
   that the replay overwrites. This mirrors what HomeClient's match form submits for a 1v1. */

export type StateDocument = {
  players: (ReplayPlayer & Record<string, unknown>)[];
  matches: (ReplayMatch & Record<string, unknown>)[];
  settings: ReplaySettings & Record<string, unknown>;
  tournaments?: unknown[];
  audits: { id: string; text: string; at: string }[];
};

export type ResultInput = {
  matchId: string;
  a: string;
  b: string;
  scoreA: number;
  scoreB: number;
  playedOn: string;
  /** Who gives the handicap, and how many points. Omitted or zero means level. */
  giver?: string | null;
  points?: number;
  now: string;
};

export class ResultError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function validateScores(scoreA: unknown, scoreB: unknown) {
  const a = Number(scoreA), b = Number(scoreB);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a + b === 0 || a > 99 || b > 99) {
    throw new ResultError(msg("比分總局數必須大於 0。"));
  }
  return { scoreA: a, scoreB: b };
}

/** The 1v1 match as the club stores it. `actual` is signed: positive when `a` gives the points. */
export function buildFriendlyMatch(state: StateDocument, input: ResultInput): ReplayMatch {
  const a = state.players.find((p) => p.id === input.a);
  const b = state.players.find((p) => p.id === input.b);
  if (!a || !b || a.id === b.id) throw new ResultError(msg("找不到這位球員。"), 404);
  const points = Math.max(0, Math.round(Number(input.points) || 0));
  const giver = points > 0 && (input.giver === a.id || input.giver === b.id) ? input.giver : null;
  const actual = giver === a.id ? points : giver === b.id ? -points : 0;
  const official = a.handicap == null || b.handicap == null ? null : b.handicap - a.handicap;
  const { scoreA, scoreB } = validateScores(input.scoreA, input.scoreB);
  return {
    id: input.matchId, a: a.id, b: b.id, mode: "1v1", scoreA, scoreB, playedOn: input.playedOn,
    actual, giver: giver ?? null, official, extra: actual - (official ?? 0),
    expectedA: 0.5, beforeA: a.rating, beforeB: b.rating, afterA: a.rating, afterB: b.rating, deltaA: 0,
    entryMode: "match", highBreaks: [], status: "confirmed", createdAt: input.now,
  } as ReplayMatch;
}

export type SimilarMatch = { id: string; scoreA: number; scoreB: number; recordedAt: string };

/** An existing confirmed result between the same two people, with the same score and date, recorded
    in the last twelve hours. Never merged automatically: the person entering decides whether it is
    the same game or a second one. */
export function findSimilar(state: StateDocument, input: Pick<ResultInput, "a" | "b" | "scoreA" | "scoreB" | "playedOn" | "now">): SimilarMatch | null {
  const cutoff = Date.parse(input.now) - 12 * 3_600_000;
  for (const m of state.matches) {
    if (m.status !== "confirmed" || m.mode === "2v2" || m.mode === "cup" || m.playedOn !== input.playedOn) continue;
    if (Date.parse(m.createdAt) < cutoff) continue;
    const same = m.a === input.a && m.b === input.b && m.scoreA === input.scoreA && m.scoreB === input.scoreB;
    const swapped = m.a === input.b && m.b === input.a && m.scoreA === input.scoreB && m.scoreB === input.scoreA;
    if (same || swapped) return { id: m.id, scoreA: m.scoreA, scoreB: m.scoreB, recordedAt: m.createdAt };
  }
  return null;
}

/** The state after adding the match and replaying history, with an audit line like the form writes. */
export function applyResult(state: StateDocument, match: ReplayMatch, label: string, now: string): { next: StateDocument; before: Record<string, number>; after: Record<string, number> } {
  const before = { [match.a]: rating(state, match.a), [match.b]: rating(state, match.b) };
  const matches = [match as StateDocument["matches"][number], ...state.matches];
  const rebuilt = replay(state.players, matches, state.settings);
  const next: StateDocument = {
    ...state,
    ...(rebuilt as unknown as Pick<StateDocument, "players" | "matches">),
    audits: [{ id: `play-${match.id}`, text: `記錄賽果：${label}；重播歷史 ELO`, at: now }, ...state.audits],
  };
  return { next, before, after: { [match.a]: rating(next, match.a), [match.b]: rating(next, match.b) } };
}

const rating = (state: StateDocument, id: string) => state.players.find((p) => p.id === id)?.rating ?? 0;
