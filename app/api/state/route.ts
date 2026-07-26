import { requireMember, syncMemberPlayerProfiles } from "../../../db/auth";
import { getState, putState, deleteState } from "../../../db/state";

const defaultState = {
  players: [],
  matches: [],
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature: 1.25, handicapSoftCap: 800, winnerBonus: .5, overHandicapBoost: .75, overHandicapScale: 200, modelVersion: 3 },
  audits: [],
};

function memberCanWrite(current: any, next: any, playerId?: string) {
  if (!playerId || !current || !next || JSON.stringify(current.settings) !== JSON.stringify(next.settings)) return false;
  const currentPlayers = new Map((current.players ?? []).map((player: any) => [player.id, player]));
  const nextPlayers = new Map((next.players ?? []).map((player: any) => [player.id, player]));
  if (currentPlayers.size !== nextPlayers.size || !currentPlayers.has(playerId) || !nextPlayers.has(playerId)) return false;
  const profile = (player: any) => JSON.stringify({ id: player.id, name: player.name, short: player.short, handicap: player.handicap, initialRating: player.initialRating, colour: player.colour, avatar: player.avatar, active: player.active });
  for (const [id, player] of currentPlayers) if (!nextPlayers.has(id) || (id !== playerId && profile(player) !== profile(nextPlayers.get(id)))) return false;
  const matches = (items: any[]) => new Map(items.map(match => [match.id, match]));
  const before = matches(current.matches ?? []), after = matches(next.matches ?? []);
  const matchShape = (match: any) => JSON.stringify({ a: match.a, b: match.b, scoreA: match.scoreA, scoreB: match.scoreB, playedOn: match.playedOn, actual: match.actual, giver: match.giver, highBreaks: match.highBreaks, status: match.status, entryMode: match.entryMode });
  for (const id of new Set([...before.keys(), ...after.keys()])) { const was = before.get(id), is = after.get(id); if (matchShape(was ?? {}) !== matchShape(is ?? {}) && ((was && was.a !== playerId && was.b !== playerId) || (is && is.a !== playerId && is.b !== playerId))) return false; }
  return true;
}

function storageError(error: unknown) {
  console.error("state storage error:", error);
  const message = error instanceof Error ? error.message : "storage unavailable";
  return Response.json({ error: message }, { status: 503 });
}

export async function GET() {
  try {
    const data = await getState();
    return Response.json(data ? JSON.parse(data) : defaultState, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return storageError(error);
  }
}

export async function PUT(request: Request) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const data = await request.text();
    if (user.role !== "admin") {
      const current = await getState();
      let next: unknown; try { next = JSON.parse(data); } catch { return Response.json({ error: "Invalid state" }, { status: 400 }); }
      if (!memberCanWrite(current ? JSON.parse(current) : null, next, user.statePlayerId)) return Response.json({ error: "You may only change your player profile or matches involving you" }, { status: 403 });
    }
    await putState(data);
    const next = JSON.parse(data) as { players?: { id: string; name: string; short: string; colour?: string | null }[] };
    await syncMemberPlayerProfiles(next.players ?? []);
    return Response.json({ ok: true });
  } catch (error) {
    return storageError(error);
  }
}

export async function DELETE() {
  const user = await requireMember("admin");
  if (!user) return Response.json({ error: "Admin access required" }, { status: 403 });
  try {
    await deleteState();
    return Response.json(defaultState);
  } catch (error) {
    return storageError(error);
  }
}
