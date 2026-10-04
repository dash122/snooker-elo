import { randomUUID } from "node:crypto";
import { msg } from "../lib/i18n/translate.ts";
import { applyResult, buildFriendlyMatch, findSimilar, validateScores, ResultError, type SimilarMatch, type StateDocument } from "../lib/play/match-record.ts";
import { accepted } from "../lib/play/session.ts";
import { zonedDate } from "../lib/play/time.ts";
import type { PlaySession } from "../lib/play/types.ts";
import { LOCK_KEY, PlayError, loadSession, type PlayDatabase } from "./play-store.ts";

/* Recording a result is trust-based and takes effect immediately: the first entry sets the score,
   both ratings update, and nobody has to confirm. The club's rating state is one document that is
   replayed from history, so the new match is added to it and the whole history replayed, exactly as
   the match form does in the browser. State and the play tables live behind separate writers, so the
   state write comes first and the link to the session second: if the link fails the result still
   stands (it is the record that matters), and `linkMatch` can attach it later. */

export type StateGateway = {
  read(): Promise<{ json: string; version: string } | null>;
  /** Writes only if the document is still at `version`. False means someone else wrote first. */
  write(json: string, version: string): Promise<boolean>;
};

export type RecordInput = {
  sessionId: string; a: string; b: string; scoreA: number; scoreB: number;
  giver?: string | null; points?: number;
  /** Set when the person has been asked "same game or another?" and said another. */
  another?: boolean;
};

export type RecordOutcome =
  | { status: "recorded"; matchId: string; before: Record<string, number>; after: Record<string, number>; linked: boolean }
  | { status: "similar"; similar: SimilarMatch };

const GRACE = 7 * 86_400_000;
const MAX_ATTEMPTS = 3;

function requireParticipants(session: PlaySession, actorId: string, ids: string[], now: number) {
  if (session.status === "cancelled") throw new PlayError(msg("此約戰已關閉。"));
  if (Date.parse(session.startAt) > now) throw new PlayError(msg("此約戰尚未開始。"));
  if (Date.parse(session.endAt) + GRACE < now) throw new PlayError(msg("此約戰已結束太久，請使用一般賽果表格記錄。"));
  const going = new Set(accepted(session.members).map((m) => m.playerId));
  if (!going.has(actorId)) throw new PlayError(msg("只有已加入的球友才可以記錄賽果。"), 403);
  if (ids.some((id) => !going.has(id))) throw new PlayError(msg("兩位球員都必須在此約戰中。"));
}

async function sessionZone(db: PlayDatabase, session: PlaySession) {
  const rows = await db.query<{ tz: string | null }>(`SELECT tz FROM venues WHERE id=$1`, [session.venueId]);
  return rows[0]?.tz ?? (session.city === "london" ? "Europe/London" : "Asia/Hong_Kong");
}

export async function recordResult(db: PlayDatabase, state: StateGateway, actorId: string, input: RecordInput, now = Date.now()): Promise<RecordOutcome> {
  if (!input.a || !input.b || input.a === input.b) throw new PlayError(msg("請選擇兩位不同的球員。"));
  const { scoreA, scoreB } = (() => { try { return validateScores(input.scoreA, input.scoreB); } catch (e) { throw new PlayError((e as Error).message); } })();
  const session = await loadSession(db, input.sessionId, false);
  requireParticipants(session, actorId, [input.a, input.b], now);
  const actor = await db.query(`SELECT 1 FROM members WHERE state_player_id=$1 AND active`, [actorId]);
  if (!actor.length) throw new PlayError(msg("請先連結球員檔案。"), 403);

  const playedOn = zonedDate(session.startAt, await sessionZone(db, session));
  const stamp = new Date(now).toISOString();
  const matchId = randomUUID();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const read = await state.read();
    if (!read) throw new PlayError(msg("球會資料暫時未能讀取。"), 503);
    const doc = JSON.parse(read.json) as StateDocument;
    if (!input.another) {
      const similar = findSimilar(doc, { a: input.a, b: input.b, scoreA, scoreB, playedOn, now: stamp });
      if (similar) return { status: "similar", similar };
    }
    let outcome: ReturnType<typeof applyResult>;
    try {
      const match = buildFriendlyMatch(doc, { matchId, a: input.a, b: input.b, scoreA, scoreB, playedOn, giver: input.giver, points: input.points, now: stamp });
      const names = new Map(doc.players.map((p) => [p.id, p.name]));
      outcome = applyResult(doc, match, `${names.get(input.a)} ${scoreA}–${scoreB} ${names.get(input.b)}`, stamp);
    } catch (error) {
      if (error instanceof ResultError) throw new PlayError(error.message, error.status);
      throw error;
    }
    if (await state.write(JSON.stringify(outcome.next), read.version)) {
      const linked = await link(db, session.id, matchId, actorId, [input.a, input.b]);
      return { status: "recorded", matchId, before: outcome.before, after: outcome.after, linked };
    }
  }
  throw new PlayError(msg("球會資料剛剛有更新，請再試一次。"), 409);
}

/** Attaches a match to its session and counts both players as having played. Best effort by design:
    the match is already saved, so a failure here must not look like a failed result. */
async function link(db: PlayDatabase, sessionId: string, matchId: string, recordedBy: string, players: string[]) {
  try {
    await db.transaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock($1,$2)`, [...LOCK_KEY]);
      await tx.query(`INSERT INTO play_session_results(match_id,session_id,recorded_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [matchId, sessionId, recordedBy]);
      await tx.query(`UPDATE play_session_members SET played=true,updated_at=now() WHERE session_id=$1 AND player_id IN (SELECT jsonb_array_elements_text($2::text::jsonb)) AND played IS NULL`,
        [sessionId, JSON.stringify(players)]);
      await tx.query(`UPDATE play_sessions SET status='played',played_at=COALESCE(played_at,now()),revision=revision+1,updated_at=now() WHERE id=$1 AND status<>'cancelled'`, [sessionId]);
    });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "play_result_link_failed", error: error instanceof Error ? error.name : "unknown" }));
    return false;
  }
}

/** Links a match recorded through the ordinary match form to the session it came from, so results
    entered either way count. The match must be a confirmed 1v1 between two accepted members. */
export async function linkMatch(db: PlayDatabase, state: StateGateway, actorId: string, input: { sessionId: string; matchId: string }, now = Date.now()) {
  const session = await loadSession(db, input.sessionId, false);
  const read = await state.read();
  const doc = read ? (JSON.parse(read.json) as StateDocument) : null;
  const match = doc?.matches.find((m) => m.id === input.matchId && m.status === "confirmed" && (!m.mode || m.mode === "1v1"));
  if (!match) throw new PlayError(msg("找不到這場賽果。"), 404);
  requireParticipants(session, actorId, [match.a, match.b], now);
  const ok = await link(db, session.id, match.id, actorId, [match.a, match.b]);
  if (!ok) throw new PlayError(msg("未能連結賽果，請稍後再試。"), 500);
  return { matchId: match.id };
}
