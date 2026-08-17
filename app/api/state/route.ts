import { requireMember, syncMemberPlayerProfiles } from "../../../db/auth";
import { getState, putState, deleteState } from "../../../db/state";
import { entertainmentOnlyWritePreservesOfficialState } from "../../../lib/entertainment-state";
import { memberCanWrite } from "../../../lib/state-write-rules";

const defaultState = {
  players: [],
  matches: [],
  tournaments: [],
  settings: { start: 1500, provisionalGames: 10, frameScaleCoefficient: 150, frameScaleNumeratorOffset: 15, frameScaleDenominator: 10, handicapEloScale: 500, handicapPointsToElo: 25, handicapMinimumElo: 7, handicapSensitivityRange: 16, handicapSensitivityWidth: 250, compressionWidthBase: 3, compressionWidthExponent: .1, repetitionDecayBase: 2, repetitionDecayPeriod: 7, handicapEffectiveness: .7, modelVersion: 9 },
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
    const current = currentRaw ? JSON.parse(currentRaw) : null;
    // A normal save must never interpret a partial or failed client fetch as a
    // request to erase the club. Full reset has its own explicit DELETE route.
    if (current?.players?.length && (!Array.isArray(parsedNext?.players) || parsedNext.players.length === 0)) {
      return Response.json({ error: "Incomplete state; existing data was preserved" }, { status: 409 });
    }
    if (current && !entertainmentOnlyWritePreservesOfficialState(current, parsedNext)) return Response.json({ error: "Entertainment matches cannot change official ratings or statistics" }, { status: 400 });
    if (user.role !== "admin") {
      if (!memberCanWrite(current, parsedNext, user.statePlayerId)) return Response.json({ error: "You may only change your player profile or matches involving you" }, { status: 403 });
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
