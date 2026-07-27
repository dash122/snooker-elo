type StateLike = {
  settings?: unknown;
  players?: Array<Record<string, unknown>>;
  matches?: Array<Record<string, unknown>>;
};

const competitivePlayer = (player: Record<string, unknown>) => ({
  id: player.id,
  rating: player.rating,
  wins: player.wins,
  losses: player.losses,
  draws: player.draws,
  framesWon: player.framesWon,
  framesLost: player.framesLost,
  lastChange: player.lastChange,
  form: player.form,
});

const ratedMatches = (state: StateLike) =>
  (state.matches ?? []).filter(match => match.mode !== "2v2");

const entertainmentMatches = (state: StateLike) =>
  (state.matches ?? []).filter(match => match.mode === "2v2");

export function entertainmentOnlyWritePreservesOfficialState(current: StateLike, next: StateLike) {
  const ratedUnchanged = JSON.stringify(ratedMatches(current)) === JSON.stringify(ratedMatches(next));
  const entertainmentChanged = JSON.stringify(entertainmentMatches(current)) !== JSON.stringify(entertainmentMatches(next));
  if (!ratedUnchanged || !entertainmentChanged) return true;
  const settingsUnchanged = JSON.stringify(current.settings) === JSON.stringify(next.settings);
  const playersUnchanged = JSON.stringify((current.players ?? []).map(competitivePlayer)) ===
    JSON.stringify((next.players ?? []).map(competitivePlayer));
  return settingsUnchanged && playersUnchanged;
}