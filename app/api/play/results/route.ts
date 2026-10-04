import { after } from "next/server";
import { requireMember } from "../../../../db/auth";
import { recordEvents } from "../../../../db/analytics";
import { isPlayReady, playDatabase, stateGateway } from "../../../../db/play.pg";
import { linkMatch, recordResult } from "../../../../db/play-results";
import { PlayError } from "../../../../db/play-store";
import { getTranslator } from "../../../../lib/i18n/server";

const headers = { "cache-control": "no-store" };

/** Record a result for a session (`action: "record"`), or attach a match entered through the ordinary
    match form to its session (`action: "link"`). Recording takes effect immediately; nobody confirms. */
export async function POST(request: Request) {
  const { t } = await getTranslator();
  try {
    const member = await requireMember();
    if (!member) return Response.json({ error: t("請先登入。") }, { status: 401, headers });
    if (!member.statePlayerId) return Response.json({ error: t("請先連結球員檔案。") }, { status: 403, headers });
    if (!(await isPlayReady())) return Response.json({ error: t("約戰暫時未能使用。") }, { status: 503, headers });
    let body: Record<string, unknown>;
    try {
      const raw = await request.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
      body = raw as Record<string, unknown>;
    } catch { return Response.json({ error: t("請提交有效約戰資料。") }, { status: 400, headers }); }

    const playerId = member.statePlayerId;
    const track = (event: string, props: Record<string, unknown>) => after(async () => {
      try { await recordEvents(playerId, [{ event, props, at: new Date().toISOString() }]); } catch { /* best effort */ }
    });

    if (body.action === "link") {
      const out = await linkMatch(playDatabase(), stateGateway(), playerId, { sessionId: String(body.sessionId ?? ""), matchId: String(body.matchId ?? "") });
      track("play_result_linked", { id: String(body.sessionId ?? "") });
      return Response.json({ ok: true, ...out }, { headers });
    }
    if (body.action !== "record") return Response.json({ error: t("無效操作。") }, { status: 400, headers });
    const out = await recordResult(playDatabase(), stateGateway(), playerId, {
      sessionId: String(body.sessionId ?? ""), a: String(body.a ?? ""), b: String(body.b ?? ""),
      scoreA: Number(body.scoreA), scoreB: Number(body.scoreB),
      giver: typeof body.giver === "string" ? body.giver : null, points: Number(body.points) || 0,
      another: body.another === true,
    });
    if (out.status === "recorded") track("play_result_recorded", { id: String(body.sessionId ?? ""), linked: out.linked });
    return Response.json({ ok: true, ...out }, { headers });
  } catch (error) {
    if (error instanceof PlayError) return Response.json({ error: t(error.message) }, { status: error.status, headers });
    console.error(JSON.stringify({ level: "error", msg: "play_result_failed", error: error instanceof Error ? error.name : "unknown", detail: error instanceof Error ? error.message.slice(0, 240) : null }));
    return Response.json({ error: t("賽果暫時未能儲存，請稍後再試。") }, { status: 500, headers });
  }
}
