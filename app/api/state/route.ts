import { requireMember, syncMemberPlayerProfiles } from "../../../db/auth";
import { getStateDocument, getStateVersion, putState, deleteState } from "../../../db/state";
import { entertainmentOnlyWritePreservesOfficialState } from "../../../lib/entertainment-state";
import { blockedByUnfinishedOnboarding, memberCanWrite } from "../../../lib/state-write-rules";

const defaultState = {
  players: [],
  matches: [],
  tournaments: [],
  settings: { start: 1500, provisionalGames: 10, frameScaleCoefficient: 250, frameScaleNumeratorOffset: 15, frameScaleDenominator: 10, handicapEloScale: 1250, handicapPointsToElo: 25, handicapMinimumElo: 7, handicapSensitivityRange: 16, handicapSensitivityWidth: 250, compressionWidthBase: 3, compressionWidthExponent: .1, repetitionDecayBase: 2, repetitionDecayPeriod: 7, handicapEffectiveness: 1, modelVersion: 15 },
  audits: [],
};



const AUDIT_LOG_LIMIT = 300;

function storageError(error: unknown) {
  console.error("state storage error:", error);
  const message = error instanceof Error ? error.message : "storage unavailable";
  return Response.json({ error: message }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    /* The club document is the largest thing this app sends, and most page loads ask for a
       copy of one that has not changed since the visitor's last one. A client holding a
       cached copy sends its ETag; when the cheap version probe says nothing has moved we
       answer 304 with no body — no document query, no megabytes over the wire. The fetch is
       deliberately `no-store`, so the browser will not do this on its own; HomeClient sends
       the header explicitly from its own cache. */
    const cached = request.headers.get("if-none-match");
    if (cached) {
      const version = await getStateVersion();
      if (cached.replace(/^W\//, "").replace(/"/g, "") === version) {
        return new Response(null, { status: 304, headers: { etag: `"${version}"`, "cache-control": "no-store" } });
      }
    }
    const { data, version } = await getStateDocument();
    return Response.json(data ? JSON.parse(data) : defaultState, {
      headers: { "cache-control": "no-store", etag: `"${version}"` },
    });
  } catch (error) {
    return storageError(error);
  }
}

export async function PUT(request: Request) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    // Optimistic concurrency: a client that sends the version it last read is asserting
    // "nothing else changed since I built this payload". Two members saving around the same
    // time otherwise race silently — whoever's PUT lands second wins outright and the first
    // save's changes (a different match, a different player edit) are gone with no error and
    // no trace, because this handler always writes the client's full document as-is. Rejecting
    // a stale base turns that silent loss into a 409 the client already knows how to recover
    // from: refetch, re-merge its edit onto the latest document, retry.
    const baseVersion = request.headers.get("if-match")?.replace(/^W\//, "").replace(/"/g, "");
    const data = await request.text();
    const { data: currentRaw, version: currentVersion } = await getStateDocument();
    if (baseVersion && baseVersion !== currentVersion) {
      return Response.json({ error: "Club data changed since you loaded it. Please retry." }, { status: 409 });
    }
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
    const onboardingBlock = blockedByUnfinishedOnboarding(current, parsedNext);
    if (onboardingBlock) return Response.json({ error: `${onboardingBlock} 尚未完成新會員評級，需先完成 /onboarding 先可以記錄比賽。` }, { status: 403 });
    // The audit log is prepended to on every write and never trimmed, so a club with enough history
    // eventually ships a body big enough to hit the platform's request-size limit — the write then
    // fails before it ever reaches this handler, on the least forgiving action to retry: recording a
    // match. Capping what actually gets stored keeps the payload bounded without touching what the UI
    // already only ever shows the first 12 entries of.
    if (Array.isArray(parsedNext?.audits) && parsedNext.audits.length > AUDIT_LOG_LIMIT) {
      parsedNext.audits = parsedNext.audits.slice(0, AUDIT_LOG_LIMIT);
    }
    const capped = JSON.stringify(parsedNext);
    await putState(capped);
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
