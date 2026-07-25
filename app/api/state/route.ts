import { requireMember } from "../../../db/auth";
import { getState, putState, deleteState } from "../../../db/state";

const defaultState = {
  players: [],
  matches: [],
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature: 1.25, handicapSoftCap: 800, winnerBonus: .5, overHandicapBoost: .75, overHandicapScale: 200, modelVersion: 3 },
  audits: [],
};

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
    await putState(data);
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
