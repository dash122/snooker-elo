// Shared write-authorization rules for /api/state and unit tests.

// A player who hasn't finished the rating questionnaire yet has no real
// initial rating to play from — recording a match for them would seed the
// ELO model off the 1500 placeholder and then have to be replayed once they
// do finish it. Legacy players already have an established rating (either
// match history or a rating that has moved from its starting value), even
// though the questionnaire marker was added after their account was created.
// Block any write that adds or edits a match involving a genuinely unfinished
// player, whoever submits it (self or admin); the questionnaire's own save
// never touches state.matches, so it can never trip this itself.
export function blockedByUnfinishedOnboarding(current: any, next: any): string | null {
  const players = new Map(((next?.players ?? []) as any[]).map(player => [player.id, player]));
  const previousMatches = (current?.matches ?? []) as any[];
  const start = Number(next?.settings?.start ?? 1500);
  const hasEstablishedRating = (player: any) => {
    if (player?.preliminaryRating !== null && player?.preliminaryRating !== undefined) return true;
    const hasHistory = Number.isFinite(player?.rating)
      && previousMatches.some(match => [match.a, match.b, match.a2, match.b2].includes(player?.id));
    const ratingMoved = Number.isFinite(player?.rating) && Number.isFinite(player?.initialRating)
      && player.rating !== player.initialRating;
    const nonDefaultStartingRating = Number.isFinite(player?.initialRating) && Number.isFinite(start)
      && player.initialRating !== start;
    return hasHistory || ratingMoved || nonDefaultStartingRating;
  };
  const unfinished = (id: unknown) => {
    const player = typeof id === "string" ? players.get(id) : undefined;
    return player && !hasEstablishedRating(player);
  };
  const before = new Map(previousMatches.map((match: any) => [match.id, match]));
  for (const match of (next?.matches ?? []) as any[]) {
    const previous = before.get(match.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(match)) continue;
    for (const id of [match.a, match.b, match.a2, match.b2]) {
      if (unfinished(id)) return players.get(id)?.name ?? "該球員";
    }
  }
  return null;
}


// Rating fields are derived by replaying matches; settings are otherwise fully
// admin-controlled, so a member write must leave them byte-for-byte identical.
export function memberCanWrite(current: any, next: any, playerId?: string) {
  if (!playerId || !current || !next || JSON.stringify(current.settings) !== JSON.stringify(next.settings)) return false;
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
    // The draw, presentation order and any walkovers are the bracket's spine: once frozen they decide
    // who plays whom, how the roster is shown after completion, and who advances without playing.
    // They belong in the core comparison rather than being left as unlisted fields a member write
    // could carry; the dedicated redraw route writes them under the state lock.
    const coHostIds = (tournament: any) => [...new Set(Array.isArray(tournament.coHosts) ? tournament.coHosts.filter((id: unknown): id is string => typeof id === "string" && Boolean(id)) : [])];
    const isTournamentManager = (tournament: any) => Boolean(playerId && (tournament.createdBy === playerId || coHostIds(tournament).includes(playerId)));
    const core = (tournament: any) => JSON.stringify({ id: tournament.id, name: tournament.name, handicapMode: tournament.handicapMode, startAt: tournament.startAt ?? null, signupDeadline: tournament.signupDeadline, createdAt: tournament.createdAt, createdBy: tournament.createdBy, coHosts: coHostIds(tournament), draw: tournament.draw ?? null, drawnAt: tournament.drawnAt ?? null, rosterOrder: tournament.rosterOrder ?? null, walkovers: tournament.walkovers ?? null });
    const beforeCore = core(beforeTournament);
    const afterCore = core(afterTournament);
    if (beforeTournament.createdBy !== afterTournament.createdBy) return false;
    if (beforeCore !== afterCore) {
      if (!isTournamentManager(beforeTournament)) return false;
      // Co-host access is deliberately delegated by the host, not by another co-host.
      if (JSON.stringify(coHostIds(beforeTournament)) !== JSON.stringify(coHostIds(afterTournament)) && beforeTournament.createdBy !== playerId) return false;
    }
    const beforeSignups = new Set(beforeTournament.signups ?? []);
    const afterSignups = new Set(afterTournament.signups ?? []);
    if (beforeSignups.size !== afterSignups.size) {
      if (isTournamentManager(beforeTournament)) continue;
      if (!playerId) return false;
      // Entering after the draw would mean a name in the roster that no box in the bracket knows
      // about. Withdrawing after it is worse: it silently deletes a tie someone else is waiting on.
      // Either way, once the cup is drawn the roster is closed to members.
      if (beforeTournament.draw?.length) return false;
      const changedIds = [...new Set([...(beforeSignups ?? []), ...(afterSignups ?? [])])].filter((value) => beforeSignups.has(value) !== afterSignups.has(value));
      if (changedIds.length !== 1 || changedIds[0] !== playerId) return false;
    } else {
      if (!isTournamentManager(beforeTournament)) {
        for (const signup of beforeSignups) if (!afterSignups.has(signup)) return false;
      }
    }
  }

  return true;
}
