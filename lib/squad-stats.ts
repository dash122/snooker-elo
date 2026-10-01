/* 球隊 stats — what a squad has played among itself. Only confirmed singles where BOTH players are
   squad members count, so the numbers describe the group rather than its members' wider careers. */

export type StatsMatch = {
  a: string; b: string; mode?: string; status: string; scoreA: number; scoreB: number;
  playedOn?: string; createdAt: string; highBreaks?: { playerId: string; value: number }[];
};

export type SquadPeriod = "30d" | "all";

export type MemberLine = { id: string; matches: number; wins: number; frames: number; framesWon: number };
export type PairLine = { a: string; b: string; matches: number; winsA: number; winsB: number; draws: number };
export type SquadStats = {
  matches: number; frames: number; draws: number; averageFrames: number;
  /** Decided in a deciding frame or by a single frame. */
  closeMatches: number;
  /** Members who played at least one in-squad match. */
  active: number;
  /** Distinct pairings that have met, out of every pairing the squad could make. */
  pairsMet: number; pairsPossible: number;
  members: MemberLine[];
  topPair: PairLine | null;
  topBreak: { playerId: string; value: number; date: string } | null;
  /** Matches per week, oldest first, the last `weeks` weeks ending today. */
  weekly: number[];
};

const DAY = 864e5;
const dayOf = (match: StatsMatch) => match.playedOn || match.createdAt.slice(0, 10);

export function squadStats(matches: StatsMatch[], memberIds: string[], period: SquadPeriod, now = Date.now(), weeks = 8): SquadStats {
  const members = new Set(memberIds);
  const from = period === "30d" ? new Date(now - 30 * DAY).toISOString().slice(0, 10) : "";
  const to = new Date(now).toISOString().slice(0, 10);
  const inSquad = matches.filter(match => {
    if (match.status !== "confirmed" || match.mode === "2v2" || !members.has(match.a) || !members.has(match.b) || match.a === match.b) return false;
    const day = dayOf(match);
    return day >= from && day <= to;
  });

  const lines = new Map<string, MemberLine>();
  const line = (id: string) => { let l = lines.get(id); if (!l) lines.set(id, l = { id, matches: 0, wins: 0, frames: 0, framesWon: 0 }); return l; };
  const pairs = new Map<string, PairLine>();
  let frames = 0, draws = 0, close = 0, topBreak: SquadStats["topBreak"] = null;
  const weekly = Array<number>(weeks).fill(0);
  const todayMs = Date.parse(`${to}T00:00:00Z`);

  for (const match of inSquad) {
    const total = match.scoreA + match.scoreB;
    frames += total;
    if (match.scoreA === match.scoreB) draws++;
    if (Math.abs(match.scoreA - match.scoreB) <= 1) close++;
    const a = line(match.a), b = line(match.b);
    a.matches++; b.matches++; a.frames += total; b.frames += total; a.framesWon += match.scoreA; b.framesWon += match.scoreB;
    if (match.scoreA > match.scoreB) a.wins++; else if (match.scoreB > match.scoreA) b.wins++;

    const first = match.a < match.b, key = first ? `${match.a}|${match.b}` : `${match.b}|${match.a}`;
    let pair = pairs.get(key);
    if (!pair) pairs.set(key, pair = { a: first ? match.a : match.b, b: first ? match.b : match.a, matches: 0, winsA: 0, winsB: 0, draws: 0 });
    pair.matches++;
    const winnerA = match.scoreA > match.scoreB ? match.a : match.scoreB > match.scoreA ? match.b : null;
    if (!winnerA) pair.draws++; else if (winnerA === pair.a) pair.winsA++; else pair.winsB++;

    for (const item of match.highBreaks ?? []) {
      if (!members.has(item.playerId) || !(item.value > 0 && item.value <= 147)) continue;
      const date = dayOf(match);
      if (!topBreak || item.value > topBreak.value || (item.value === topBreak.value && date > topBreak.date)) topBreak = { playerId: item.playerId, value: item.value, date };
    }
    const age = Math.floor((todayMs - Date.parse(`${dayOf(match)}T00:00:00Z`)) / DAY);
    const bucket = Math.floor(age / 7);
    if (bucket >= 0 && bucket < weeks) weekly[weeks - 1 - bucket]++;
  }

  const topPair = [...pairs.values()].sort((x, y) => y.matches - x.matches || x.a.localeCompare(y.a))[0] ?? null;
  const n = members.size;
  return {
    matches: inSquad.length, frames, draws, averageFrames: inSquad.length ? frames / inSquad.length : 0,
    closeMatches: close, active: lines.size, pairsMet: pairs.size, pairsPossible: n * (n - 1) / 2,
    members: [...lines.values()].sort((x, y) => y.matches - x.matches || y.wins - x.wins || x.id.localeCompare(y.id)),
    topPair, topBreak, weekly,
  };
}
