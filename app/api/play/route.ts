import { after } from "next/server";
import { requireMember } from "../../../db/auth";
import { recordEvents } from "../../../db/analytics";
import { isPlayReady, playDatabase } from "../../../db/play.pg";
import { PlayError, playDashboard, playWrite, type PlayAction } from "../../../db/play-store";
import { getTranslator } from "../../../lib/i18n/server";
import type { Translator } from "../../../lib/i18n/translate";

const headers = { "cache-control": "no-store" };
const ACTIONS: PlayAction[] = [
  "intent.post", "intent.cancel",
  "session.create", "session.respond", "session.leave", "session.cancel", "session.invite", "session.played",
  "avoid.add", "avoid.remove", "venue.create",
];

function failure(t: Translator, error: unknown, request: Request) {
  if (error instanceof PlayError) return Response.json({ error: t(error.message) }, { status: error.status, headers });
  const detail = error && typeof error === "object" ? (error as { name?: string; message?: string; code?: string; constraint?: string }) : {};
  console.error(JSON.stringify({
    level: "error", msg: "play_failed", route: "/api/play", requestId: request.headers.get("x-vercel-id"),
    error: detail.name ?? "unknown", detail: detail.message?.slice(0, 240) ?? null, code: detail.code ?? null, constraint: detail.constraint ?? null,
  }));
  // A constraint the application checks first can still fire under a race; say so plainly.
  if (detail.code === "23514") return Response.json({ error: t("此約戰剛剛有變動，請重新載入後再試。") }, { status: 409, headers });
  return Response.json({ error: t("約戰暫時未能更新，請重新載入後再試。") }, { status: 500, headers });
}

/** The board. Guests get per-day counts only, never names. */
export async function GET(request: Request) {
  const { t } = await getTranslator();
  try {
    const [ready, member] = await Promise.all([isPlayReady(), requireMember()]);
    if (!ready) return Response.json({ ready: false }, { headers });
    const url = new URL(request.url);
    const dashboard = await playDashboard(playDatabase(), member?.statePlayerId ?? null, Boolean(member), { city: url.searchParams.get("city"), date: url.searchParams.get("date"), session: url.searchParams.get("session") });
    return Response.json(dashboard, { headers });
  } catch (error) { return failure(t, error, request); }
}

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
    if (!ACTIONS.includes(body.action as PlayAction)) return Response.json({ error: t("無效操作。") }, { status: 400, headers });
    const result = await playWrite(playDatabase(), member.statePlayerId, body.action as PlayAction, body);
    const playerId = member.statePlayerId;
    // Analytics are best effort and never delay or fail the member's request.
    after(async () => {
      try { await recordEvents(playerId, result.events.map((event) => ({ event: event.event, props: event.props ?? null, at: new Date().toISOString() }))); } catch { /* best effort */ }
    });
    return Response.json({ ok: true, id: result.id, duplicates: result.duplicates }, { headers });
  } catch (error) { return failure(t, error, request); }
}
