/* The "today's high break target" strip on the home page. Pure so the scenarios can be
   unit tested: it works off the past-30-days board (one best break per player, top 10,
   sorted by value then newest date first — so matching a score today ranks above it). */

export type BoardEntry = { playerId: string; value: number; date: string };

export type BreakNudge =
  | { kind: "top"; target: number; current: number; runnerUp: number | null }
  | { kind: "climb"; target: number; current: number; position: number; nextPosition: number; topTarget: number }
  | { kind: "expiring"; target: number; current: number; position: number; daysLeft: number }
  | { kind: "enter"; target: number; lastValue: number }
  | { kind: "open"; openSlots: number };

export const BREAK_BOARD_SIZE = 10;
const WINDOW_DAYS = 30;
const EXPIRY_WARNING_DAYS = 3;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

export function breakNudge(board: BoardEntry[], playerId: string, today: string): BreakNudge {
  const top = board.slice(0, BREAK_BOARD_SIZE);
  const index = top.findIndex(entry => entry.playerId === playerId);
  if (index < 0) {
    if (top.length < BREAK_BOARD_SIZE) return { kind: "open", openSlots: BREAK_BOARD_SIZE - top.length };
    const last = top[top.length - 1].value;
    return { kind: "enter", target: last, lastValue: last };
  }
  const own = top[index];
  // A break counts on the board until the day it turns 30 days old.
  const daysLeft = WINDOW_DAYS - daysBetween(own.date, today);
  if (daysLeft <= EXPIRY_WARNING_DAYS) return { kind: "expiring", target: own.value, current: own.value, position: index + 1, daysLeft: Math.max(daysLeft, 0) };
  if (index === 0) return { kind: "top", target: Math.min(own.value + 1, 147), current: own.value, runnerUp: top[1]?.value ?? null };
  // Ties order newest first, so equalling the player above today is enough to pass them.
  return { kind: "climb", target: top[index - 1].value, current: own.value, position: index + 1, nextPosition: index, topTarget: top[0].value };
}
