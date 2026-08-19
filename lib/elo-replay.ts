import { isEntertainmentMode, neutralRatingSnapshot } from "./entertainment-match.ts";
import { handicapEloPerPoint, suggestedHandicap } from "./handicap.ts";
import { calculateSnookerElo } from "./snooker-elo.ts";

export type ReplayPlayer = {
  id: string;
  name: string;
  short: string;
  handicap: number | null;
  rating: number;
  initialRating: number;
  active: boolean;
  wins: number;
  losses: number;
  draws: number;
  framesWon: number;
  framesLost: number;
  lastChange: number;
  form: string[];
  colour?: string;
  avatar?: string | null;
};

export type ReplayMatch = {
  id: string;
  a: string;
  b: string;
  a2?: string;
  b2?: string;
  mode?: string;
  teamAName?: string;
  teamBName?: string;
  scoreA: number;
  scoreB: number;
  playedOn: string;
  actual: number;
  giver: string | null;
  official: number | null;
  extra: number;
  expectedA: number;
  beforeA: number;
  beforeB: number;
  afterA: number;
  afterB: number;
  beforeA2?: number;
  afterA2?: number;
  beforeB2?: number;
  afterB2?: number;
  deltaA: number;
  deltaB?: number;
  deltaA2?: number;
  deltaB2?: number;
  frameEvidence?: number;
  performanceScore?: number;
  evidenceWeight?: number;
  handicapAdjustment?: number;
  overHandicapElo?: number;
  overHandicapMultiplier?: number;
  status: "confirmed" | "void";
  createdAt: string;
  entryMode?: "match" | "aggregate";
  highBreaks?: { playerId: string; value: number }[];
  marginMultiplier?: number;
  tournamentId?: string;
  tournamentRound?: number;
  tournamentMatchIndex?: number;
};

export type ReplaySettings = {
  start?: number;
  handicapEloScale?: number;
  handicapPointsToElo?: number;
  handicapMinimumElo?: number;
  handicapSensitivityRange?: number;
  handicapSensitivityWidth?: number;
  frameScaleCoefficient?: number;
  frameScaleNumeratorOffset?: number;
  frameScaleDenominator?: number;
  compressionWidthBase?: number;
  compressionWidthExponent?: number;
  repetitionDecayBase?: number;
  repetitionDecayPeriod?: number;
  handicapEffectiveness?: number;
};

function games(player: ReplayPlayer) {
  return player.wins + player.losses + player.draws;
}

function provisionalMultiplier(matchCount: number) {
  return matchCount === 0 ? 2 : matchCount === 1 ? 1.5 : matchCount === 2 ? 1.25 : 1;
}

function handicapSettings(settings: ReplaySettings) {
  return {
    handicapPointsToElo: settings.handicapPointsToElo ?? 25,
    handicapMinimumElo: settings.handicapMinimumElo ?? 7,
    handicapSensitivityRange: settings.handicapSensitivityRange ?? 16,
    handicapSensitivityWidth: settings.handicapSensitivityWidth ?? 250,
    start: settings.start ?? 1500,
  };
}

function teamMemberIds(match: ReplayMatch, side: "A" | "B") {
  return (side === "A" ? [match.a, match.a2] : [match.b, match.b2]).filter(Boolean) as string[];
}

function teamLabel(match: ReplayMatch, players: ReplayPlayer[], side: "A" | "B") {
  if (isEntertainmentMode(match.mode)) {
    const custom = (side === "A" ? match.teamAName : match.teamBName)?.trim();
    return custom || `Team ${side}`;
  }
  return players.find(player => player.id === teamMemberIds(match, side)[0])?.short || "?";
}

function teamRating(match: ReplayMatch, players: ReplayPlayer[], side: "A" | "B") {
  const ratings = teamMemberIds(match, side)
    .map(id => players.find(player => player.id === id)?.rating)
    .filter((value): value is number => typeof value === "number");
  return ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0;
}

function teamHandicap(match: ReplayMatch, players: ReplayPlayer[], side: "A" | "B", settings: ReplaySettings) {
  const team = teamMemberIds(match, side)
    .map(id => players.find(player => player.id === id))
    .filter((player): player is ReplayPlayer => Boolean(player));
  return team.length ? Math.round(team.reduce((sum, player) => sum + suggestedHandicap(player, players, handicapSettings(settings)), 0) / team.length) : null;
}

function sameMatchup(left: ReplayMatch, right: ReplayMatch) {
  const side = (match: ReplayMatch, which: "A" | "B") => new Set(teamMemberIds(match, which));
  const equal = (first: Set<string>, second: Set<string>) => first.size === second.size && [...first].every(id => second.has(id));
  return equal(side(left, "A"), side(right, "A")) && equal(side(left, "B"), side(right, "B"))
    || equal(side(left, "A"), side(right, "B")) && equal(side(left, "B"), side(right, "A"));
}

function priorMeetings(match: ReplayMatch, matches: ReplayMatch[], beforeDate: string) {
  const cutoff = new Date(`${beforeDate}T00:00:00Z`).getTime() - 30 * 864e5;
  return matches.filter(candidate => candidate.status === "confirmed"
    && sameMatchup(match, candidate)
    && new Date(`${candidate.playedOn || candidate.createdAt.slice(0, 10)}T00:00:00Z`).getTime() >= cutoff).length;
}

function calculateMatch(a: ReplayPlayer, b: ReplayPlayer, match: ReplayMatch, settings: ReplaySettings, repetitionCount: number, giverSide?: "A" | "B") {
  const points = Math.abs(match.actual);
  const actual = giverSide === "A" ? points : giverSide === "B" ? -points : match.giver === a.id ? points : match.giver === b.id ? -points : 0;
  const formula = calculateSnookerElo({
    ratingA: a.rating,
    ratingB: b.rating,
    handicapA: -actual,
    framesA: match.scoreA,
    framesB: match.scoreB,
    handicapEloScale: settings.handicapEloScale,
    handicapEloPerPoint: handicapEloPerPoint((a.rating + b.rating) / 2, handicapSettings(settings)),
    handicapEffectiveness: settings.handicapEffectiveness,
    frameScaleCoefficient: settings.frameScaleCoefficient,
    frameScaleNumeratorOffset: settings.frameScaleNumeratorOffset,
    frameScaleDenominator: settings.frameScaleDenominator,
    compressionWidthBase: settings.compressionWidthBase,
    compressionWidthExponent: settings.compressionWidthExponent,
    repetitionDecayBase: settings.repetitionDecayBase,
    repetitionDecayPeriod: settings.repetitionDecayPeriod,
    repetitionCount,
  });
  const totalFrames = match.scoreA + match.scoreB;
  return {
    actual,
    expectedA: formula.probabilityA,
    deltaA: formula.deltaA,
    frameEvidence: totalFrames,
    performanceScore: formula.performance,
    evidenceWeight: 1,
    handicapAdjustment: -actual,
    overHandicapElo: 0,
    overHandicapMultiplier: 1,
  };
}

export function replay<TPlayer extends ReplayPlayer, TMatch extends ReplayMatch>(players: TPlayer[], matches: TMatch[], settings: ReplaySettings) {
  const rebuilt = players.map(player => ({
    ...player,
    rating: player.initialRating,
    wins: 0,
    losses: 0,
    draws: 0,
    framesWon: 0,
    framesLost: 0,
    lastChange: 0,
    form: [] as string[],
  }));
  const byId = new Map(rebuilt.map(player => [player.id, player]));
  const ordered = [...matches]
    .filter(match => match.status === "confirmed")
    .sort((left, right) => (left.playedOn || left.createdAt).localeCompare(right.playedOn || right.createdAt) || left.createdAt.localeCompare(right.createdAt));
  const updated = new Map<string, TMatch>();

  for (const match of ordered) {
    const a = byId.get(match.a);
    const b = byId.get(match.b);
    if (!a || !b) continue;
    const a2 = match.a2 ? byId.get(match.a2) : null;
    const b2 = match.b2 ? byId.get(match.b2) : null;
    if (isEntertainmentMode(match.mode)) {
      if (!a2 || !b2) continue;
      const averageA = teamRating(match, rebuilt, "A");
      const averageB = teamRating(match, rebuilt, "B");
      const snapshotA = neutralRatingSnapshot(a);
      const snapshotA2 = neutralRatingSnapshot(a2);
      const snapshotB = neutralRatingSnapshot(b);
      const snapshotB2 = neutralRatingSnapshot(b2);
      updated.set(match.id, {
        ...match,
        beforeA: snapshotA.before,
        beforeA2: snapshotA2.before,
        beforeB: snapshotB.before,
        beforeB2: snapshotB2.before,
        afterA: snapshotA.after,
        afterA2: snapshotA2.after,
        afterB: snapshotB.after,
        afterB2: snapshotB2.after,
        deltaA: snapshotA.delta,
        expectedA: 1 / (1 + 10 ** ((averageB - averageA) / 400)),
        frameEvidence: 0,
        evidenceWeight: 0,
        overHandicapElo: 0,
        overHandicapMultiplier: 1,
      });
      continue;
    }

    const teamA = a2 ? [a, a2] : [a];
    const teamB = b2 ? [b, b2] : [b];
    const teamAEntity = a2 ? { ...a, id: "teamA", name: teamLabel(match, rebuilt, "A"), short: teamLabel(match, rebuilt, "A"), handicap: teamHandicap(match, rebuilt, "A", settings), rating: teamRating(match, rebuilt, "A") } : a;
    const teamBEntity = b2 ? { ...b, id: "teamB", name: teamLabel(match, rebuilt, "B"), short: teamLabel(match, rebuilt, "B"), handicap: teamHandicap(match, rebuilt, "B", settings), rating: teamRating(match, rebuilt, "B") } : b;
    const repetitionCount = priorMeetings(match, ordered.slice(0, ordered.indexOf(match)), match.playedOn || match.createdAt.slice(0, 10));
    const giverSide = match.giver && teamA.some(player => player.id === match.giver) ? "A" : match.giver && teamB.some(player => player.id === match.giver) ? "B" : undefined;
    const result = calculateMatch(teamAEntity, teamBEntity, match, settings, repetitionCount, giverSide);
    const resultA = match.scoreA === match.scoreB ? "D" : match.scoreA > match.scoreB ? "W" : "L";
    const resultB = resultA === "D" ? "D" : resultA === "W" ? "L" : "W";
    const beforeA = teamAEntity.rating;
    const beforeB = teamBEntity.rating;
    const beforeA2 = a2?.rating;
    const beforeB2 = b2?.rating;
    const deltaA = result.deltaA * provisionalMultiplier(games(a));
    const deltaA2 = a2 ? result.deltaA * provisionalMultiplier(games(a2)) : undefined;
    const deltaB = -result.deltaA * provisionalMultiplier(games(b));
    const deltaB2 = b2 ? -result.deltaA * provisionalMultiplier(games(b2)) : undefined;

    for (const [index, player] of teamA.entries()) {
      const delta = index === 0 ? deltaA : deltaA2!;
      player.rating += delta;
      player.lastChange = delta;
      player.wins += resultA === "W" ? 1 : 0;
      player.losses += resultA === "L" ? 1 : 0;
      player.draws += resultA === "D" ? 1 : 0;
      player.framesWon += match.scoreA;
      player.framesLost += match.scoreB;
      player.form = [resultA, ...player.form].slice(0, 5);
    }
    for (const [index, player] of teamB.entries()) {
      const delta = index === 0 ? deltaB : deltaB2!;
      player.rating += delta;
      player.lastChange = delta;
      player.wins += resultB === "W" ? 1 : 0;
      player.losses += resultB === "L" ? 1 : 0;
      player.draws += resultB === "D" ? 1 : 0;
      player.framesWon += match.scoreB;
      player.framesLost += match.scoreA;
      player.form = [resultB, ...player.form].slice(0, 5);
    }

    const updatedMatch = {
      ...match,
      expectedA: result.expectedA,
      beforeA,
      beforeB,
      afterA: beforeA + deltaA,
      afterB: beforeB + deltaB,
      deltaA,
      deltaB,
      frameEvidence: result.frameEvidence,
      performanceScore: result.performanceScore,
      evidenceWeight: result.evidenceWeight,
      handicapAdjustment: result.handicapAdjustment,
      overHandicapElo: result.overHandicapElo,
      overHandicapMultiplier: result.overHandicapMultiplier,
    } as TMatch;
    if (a2) {
      updatedMatch.beforeA2 = beforeA2;
      updatedMatch.afterA2 = beforeA2! + deltaA2!;
      updatedMatch.deltaA2 = deltaA2;
    }
    if (b2) {
      updatedMatch.beforeB2 = beforeB2;
      updatedMatch.afterB2 = beforeB2! + deltaB2!;
      updatedMatch.deltaB2 = deltaB2;
    }
    updated.set(match.id, updatedMatch);
  }

  return {
    players: rebuilt,
    matches: matches.filter(match => match.status === "confirmed").map(match => updated.get(match.id) ?? match),
  };
}
