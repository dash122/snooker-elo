export type RatedPlayer = { id: string; rating: number };

export function isEntertainmentMode(mode?: string) {
  return mode === "2v2";
}

export function roundedTeamAverage(players: RatedPlayer[]) {
  if (!players.length) return 0;
  return Math.round(players.reduce((sum, player) => sum + player.rating, 0) / players.length);
}

export function roundedTeamEloDifference(teamA: RatedPlayer[], teamB: RatedPlayer[]) {
  return roundedTeamAverage(teamA) - roundedTeamAverage(teamB);
}

export function neutralRatingSnapshot(player: RatedPlayer) {
  return { before: player.rating, after: player.rating, delta: 0 };
}
