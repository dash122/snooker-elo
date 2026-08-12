import { requireMember, syncMemberPlayerProfiles } from "../../../db/auth";
import { getState, putState, deleteState } from "../../../db/state";
import { entertainmentOnlyWritePreservesOfficialState } from "../../../lib/entertainment-state";
import { memberCanWrite } from "../../../lib/state-write-rules";

const defaultState = {
  players: [],
  matches: [],
  tournaments: [],
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature: 1.25, handicapSoftCap: 800, winnerBonus: .5, overHandicapBoost: .75, overHandicapScale: 200, modelVersion: 4 },
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
    const currentRaw = await getState();
    let parsedNext: any; try { parsedNext = JSON.parse(data); } catch { return Response.json({ error: "Invalid state" }, { status: 400 }); }
    if (currentRaw && !entertainmentOnlyWritePreservesOfficialState(JSON.parse(currentRaw), parsedNext)) return Response.json({ error: "Entertainment matches cannot change official ratings or statistics" }, { status: 400 });
    if (user.role !== "admin") {
      if (!memberCanWrite(currentRaw ? JSON.parse(currentRaw) : null, parsedNext, user.statePlayerId)) return Response.json({ error: "You may only change your player profile or matches involving you" }, { status: 403 });
    }
    await putState(data);
    const next = parsedNext as { players?: { id: string; name: string; short: string; colour?: string | null }[] };
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
