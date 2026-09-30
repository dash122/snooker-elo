/* 球隊 rivalry — what a squad table shows beyond the club's own columns: each squad-mate's record
   against the viewer, rating movement over a month rather than ten days, and who has gone quiet.
   Pure functions over the club's match list, so the squad view needs no extra data. */

export type RivalryMatch = {
  a: string; b: string; a2?: string; b2?: string; mode?: string; status: string;
  scoreA: number; scoreB: number; deltaA: number; playedOn?: string; createdAt: string;
};

/* A month shows movement in a group of eight, where the club's ten-day window is mostly flat. */
export const SQUAD_SWING_DAYS = 30;
/* Past this, a squad-mate is shown as inactive so a player who stopped can't sit at #1 unchallenged. */
export const SQUAD_INACTIVE_DAYS = 60;

const DAY = 864e5;
const dayOf = (match: RivalryMatch) => match.playedOn || match.createdAt.slice(0, 10);
/* Doubles are entertainment frames with a shared rating, so they don't count as anyone's record. */
const counts = (match: RivalryMatch) => match.status === "confirmed" && match.mode !== "2v2";

export type HeadToHead = { wins: number; losses: number; draws: number };

/** `playerId`'s record against `opponentId` in confirmed singles (league and cup). */
export function headToHead(matches: RivalryMatch[], playerId: string, opponentId: string): HeadToHead {
  const record = { wins: 0, losses: 0, draws: 0 };
  for (const match of matches) {
    if (!counts(match)) continue;
    const side = match.a === playerId && match.b === opponentId ? "A" : match.b === playerId && match.a === opponentId ? "B" : null;
    if (!side) continue;
    const mine = side === "A" ? match.scoreA : match.scoreB, theirs = side === "A" ? match.scoreB : match.scoreA;
    if (mine > theirs) record.wins++; else if (mine < theirs) record.losses++; else record.draws++;
  }
  return record;
}

/** Rating change over the last `days` days, today included. */
export function ratingSwing(matches: RivalryMatch[], playerId: string, days: number, now = Date.now()): number {
  const from = new Date(now - days * DAY).toISOString().slice(0, 10), to = new Date(now).toISOString().slice(0, 10);
  let swing = 0;
  for (const match of matches) {
    if (!counts(match)) continue;
    const day = dayOf(match);
    if (day < from || day > to) continue;
    if (match.a === playerId) swing += match.deltaA;
    else if (match.b === playerId) swing -= match.deltaA;
  }
  return swing;
}

/** Whole days since `playerId` last played a confirmed singles match, or null if they never have. */
export function daysSinceLastMatch(matches: RivalryMatch[], playerId: string, now = Date.now()): number | null {
  let last = "";
  for (const match of matches) {
    if (!counts(match) || (match.a !== playerId && match.b !== playerId)) continue;
    const day = dayOf(match);
    if (day > last) last = day;
  }
  if (!last) return null;
  return Math.max(0, Math.floor((now - Date.parse(`${last}T00:00:00Z`)) / DAY));
}

export function isInactive(daysSince: number | null) {
  return daysSince === null || daysSince >= SQUAD_INACTIVE_DAYS;
}
