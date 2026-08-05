// Shared write-authorization rules for /api/state and unit tests.

// Saving any 1v1 match recalibrates conversion/curvature and stamps
// calibration.updatedAt with the current time (see recalibrate() in
// HomeClient.tsx), so those fields differ on essentially every save. Compare
// only the knobs an admin actually sets by hand — otherwise no ordinary
// member could ever save a normal match.
function settingsForCompare(settings: any) {
  if (!settings) return settings;
  const { conversion, curvature, calibration, ...rest } = settings;
  return rest;
}

export function memberCanWrite(current: any, next: any, playerId?: string) {
  if (!playerId || !current || !next || JSON.stringify(settingsForCompare(current.settings)) !== JSON.stringify(settingsForCompare(next.settings))) return false;
  const currentPlayers = new Map((current.players ?? []).map((player: any) => [player.id, player]));
  const nextPlayers = new Map((next.players ?? []).map((player: any) => [player.id, player]));
  if (currentPlayers.size !== nextPlayers.size || !currentPlayers.has(playerId) || !nextPlayers.has(playerId)) return false;
  const profile = (player: any) => JSON.stringify({ id: player.id, name: player.name, short: player.short, handicap: player.handicap, initialRating: player.initialRating, colour: player.colour, avatar: player.avatar, active: player.active });
  for (const [id, player] of currentPlayers) if (!nextPlayers.has(id) || (id !== playerId && profile(player) !== profile(nextPlayers.get(id)))) return false;
  const matches = (items: any[]) => new Map(items.map(match => [match.id, match]));
  const before = matches(current.matches ?? []), after = matches(next.matches ?? []);
  const matchShape = (match: any) => JSON.stringify({ a: match.a, b: match.b, a2: match.a2, b2: match.b2, mode: match.mode, teamAName: match.teamAName, teamBName: match.teamBName, scoreA: match.scoreA, scoreB: match.scoreB, playedOn: match.playedOn, actual: match.actual, giver: match.giver, highBreaks: match.highBreaks, status: match.status, entryMode: match.entryMode, tournamentId: match.tournamentId, tournamentRound: match.tournamentRound, tournamentMatchIndex: match.tournamentMatchIndex });
  const isParticipant = (match: any, id: string | undefined) => !!id && (match.a === id || match.b === id || match.a2 === id || match.b2 === id);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(id), is = after.get(id);
    const changed = matchShape(was ?? {}) !== matchShape(is ?? {});
    const participant = (m: any) => m && isParticipant(m, playerId);
    if (changed && !participant(was) && !participant(is)) return false;
  }

  const tournaments = (items: any[]) => new Map(items.map((tournament: any) => [tournament.id, tournament]));
  const beforeTournaments = tournaments(current.tournaments ?? []), afterTournaments = tournaments(next.tournaments ?? []);
  if (beforeTournaments.size !== afterTournaments.size) return false;
  for (const id of beforeTournaments.keys()) {
    const beforeTournament = beforeTournaments.get(id);
    const afterTournament = afterTournaments.get(id);
    if (!afterTournament) return false;
    const beforeCore = JSON.stringify({ id: beforeTournament.id, name: beforeTournament.name, handicapMode: beforeTournament.handicapMode, signupDeadline: beforeTournament.signupDeadline, createdAt: beforeTournament.createdAt, createdBy: beforeTournament.createdBy });
    const afterCore = JSON.stringify({ id: afterTournament.id, name: afterTournament.name, handicapMode: afterTournament.handicapMode, signupDeadline: afterTournament.signupDeadline, createdAt: afterTournament.createdAt, createdBy: afterTournament.createdBy });
    if (beforeCore !== afterCore) return false;
    const beforeSignups = new Set(beforeTournament.signups ?? []);
    const afterSignups = new Set(afterTournament.signups ?? []);
    if (beforeSignups.size !== afterSignups.size) {
      if (!playerId) return false;
      const changedIds = [...new Set([...(beforeSignups ?? []), ...(afterSignups ?? [])])].filter((value) => beforeSignups.has(value) !== afterSignups.has(value));
      if (changedIds.length !== 1 || changedIds[0] !== playerId) return false;
    } else {
      for (const signup of beforeSignups) if (!afterSignups.has(signup)) return false;
    }
  }

  return true;
}
