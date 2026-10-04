import { randomUUID } from "node:crypto";
import { msg } from "../lib/i18n/translate.ts";
import { parseConditions, parseStoredConditions, parseStringArray } from "../lib/play/conditions.ts";
import { toDashboard, type Dashboard } from "../lib/play/dashboard.ts";
import { avoidSet, compatible, groupCompatible, type FitSide } from "../lib/play/fit.ts";
import { CITIES, OTHER_CITY, cityById, cityForPin, likelyDuplicates } from "../lib/play/geo.ts";
import { accepted, deriveStatus, isLive, joinBlock, type JoinBlock } from "../lib/play/session.ts";
import { isValidZone, zonedDate } from "../lib/play/time.ts";
import {
  GROUP_PRESETS, validateGroupRange,
  type GroupRange, type IntentKind, type MemberStatus, type PlayConditions, type PlayIntent, type PlayPlayer,
  type PlaySession, type PlayVenue, type Strength, type TableStatus, type VenueScope,
} from "../lib/play/types.ts";

/* The repository for the session-based matchmaking. It talks to an injected connection, never to a
   global, so the same code runs against the production pool and against PGlite in the tests.

   Every write runs in one transaction under a single advisory lock. The lock is coarse on purpose:
   at club scale a write takes milliseconds, and it removes a whole class of races (two people taking
   the last seat, an invite racing a leave) without per-row reasoning. A deferred constraint trigger
   in the database backs it up for capacity and double-booking. */

export type PlayConnection = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };
export type PlayDatabase = PlayConnection & { transaction<T>(fn: (db: PlayConnection) => Promise<T>): Promise<T> };

export class PlayError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const fail = (message: string, status = 400): never => { throw new PlayError(message, status); };

const LOCK = [726342, 1] as const;
const ts = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const DAY = 86_400_000;

export const PLAY_TABLES = ["play_intents", "play_avoids", "play_sessions", "play_session_members", "play_session_results"] as const;

export async function playReady(db: PlayConnection) {
  // Constants only, so interpolating the names is safe; no array parameter crosses the pooler.
  const checks = PLAY_TABLES.map((t) => `to_regclass('public.${t}') IS NOT NULL`).join(" AND ");
  const rows = await db.query<{ ok: boolean }>(`SELECT (${checks}) AS ok`);
  return rows[0]?.ok === true;
}

/* ---------------------------------------------------------------- reads */

export type Snapshot = {
  players: Map<string, PlayPlayer>;
  venues: PlayVenue[];
  intents: PlayIntent[];
  sessions: PlaySession[];
  avoids: { playerId: string; otherId: string }[];
};

type IntentRow = Omit<PlayIntent, "conditions" | "venueIds"> & { conditions: unknown; venueIds: unknown };
type SessionRow = Omit<PlaySession, "members" | "terms"> & { terms: unknown };

export async function readSnapshot(db: PlayConnection, now: number): Promise<Snapshot> {
  const playerRows = await db.query<PlayPlayer>(`SELECT p.id,p.name,p.rating::float8 AS rating FROM state_players p
    WHERE p.active AND (NOT EXISTS(SELECT 1 FROM members m WHERE m.state_player_id=p.id)
      OR EXISTS(SELECT 1 FROM members m WHERE m.state_player_id=p.id AND m.active))`);
  const venues = await db.query<PlayVenue>(`SELECT id,name,name_en AS "nameEn",COALESCE(city,'${OTHER_CITY}') AS city,COALESCE(tz,'UTC') AS tz,lat,lng,status
    FROM venues WHERE active AND merged_into IS NULL AND status<>'rejected' ORDER BY name,id`);
  const intentRows = await db.query<IntentRow>(`SELECT id,player_id AS "playerId",kind,strength,${ts("start_at")} AS "startAt",${ts("end_at")} AS "endAt",
    min_minutes AS "minMinutes",venue_scope AS "venueScope",venue_ids::text AS "venueIds",city,
    min_players AS "minPlayers",target_size AS "targetSize",max_players AS "maxPlayers",conditions::text AS conditions,note,quiet,status
    FROM play_intents WHERE status='active' AND end_at>$1 ORDER BY start_at,id`, [new Date(now).toISOString()]);
  const sessionRows = await db.query<SessionRow>(`SELECT id,created_by AS "createdBy",venue_id AS "venueId",city,${ts("start_at")} AS "startAt",${ts("end_at")} AS "endAt",
    min_players AS "minPlayers",target_size AS "targetSize",max_players AS "maxPlayers",table_status AS "tableStatus",status,note,terms::text AS terms,revision
    FROM play_sessions WHERE status<>'cancelled' AND end_at>$1 ORDER BY start_at,id`, [new Date(now - 7 * DAY).toISOString()]);
  const memberRows = await db.query<{ sessionId: string } & PlaySession["members"][number]>(`SELECT m.session_id AS "sessionId",m.player_id AS "playerId",m.status,m.source,m.came,m.played
    FROM play_session_members m JOIN play_sessions s ON s.id=m.session_id WHERE s.status<>'cancelled' AND s.end_at>$1`, [new Date(now - 7 * DAY).toISOString()]);
  const avoids = await db.query<{ playerId: string; otherId: string }>(`SELECT player_id AS "playerId",other_id AS "otherId" FROM play_avoids`);

  const byId = new Map(sessionRows.map((s) => [s.id, { ...s, terms: parseStoredConditions(s.terms), members: [] as PlaySession["members"] } as PlaySession]));
  for (const { sessionId, ...member } of memberRows) byId.get(sessionId)?.members.push(member);
  return {
    players: new Map(playerRows.map((p) => [p.id, p])),
    venues,
    intents: intentRows.map((i) => ({ ...i, venueIds: parseStringArray(i.venueIds), conditions: parseStoredConditions(i.conditions) })),
    sessions: [...byId.values()],
    avoids,
  };
}

/** The city a viewer most likely means: where they last had a session or an intent, else Hong Kong. */
export function defaultCity(snapshot: Snapshot, viewerId: string | null) {
  if (viewerId) {
    const mine = snapshot.sessions.filter((s) => s.members.some((m) => m.playerId === viewerId)).map((s) => s.city);
    const intents = snapshot.intents.filter((i) => i.playerId === viewerId).map((i) => i.city);
    const last = [...mine, ...intents].at(-1);
    if (last) return last;
  }
  return CITIES[0].id;
}

export function cityZone(snapshot: Snapshot, city: string) {
  return cityById(city)?.tz ?? snapshot.venues.find((v) => v.city === city)?.tz ?? "UTC";
}

export async function playDashboard(db: PlayConnection, viewerId: string | null, signedIn: boolean, query: { city?: string | null; date?: string | null }, now = Date.now()): Promise<Dashboard> {
  const snapshot = await readSnapshot(db, now);
  const city = query.city && (cityById(query.city) || snapshot.venues.some((v) => v.city === query.city)) ? query.city : defaultCity(snapshot, viewerId);
  const tz = cityZone(snapshot, city);
  const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : zonedDate(now, tz);
  return toDashboard({
    viewerId: viewerId ?? "", city, tz, date, now,
    players: snapshot.players, venues: snapshot.venues, intents: snapshot.intents, sessions: snapshot.sessions,
    avoids: avoidSet(snapshot.avoids),
  }, signedIn && !!viewerId);
}

/* --------------------------------------------------------------- writes */

export type PlayEvent = { event: string; props?: Record<string, unknown> };
export type PlayResult = { id?: string; events: PlayEvent[]; duplicates?: PlayVenue[] };

export type PlayAction =
  | "intent.post" | "intent.cancel"
  | "session.create" | "session.respond" | "session.leave" | "session.cancel" | "session.invite" | "session.played"
  | "avoid.add" | "avoid.remove"
  | "venue.create";

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const iso = (value: unknown) => {
  if (typeof value !== "string") return fail(msg("時間格式不正確。"));
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : fail(msg("時間格式不正確。"));
};

function parseWindow(input: Record<string, unknown>, now: number) {
  const startAt = iso(input.startAt);
  const endAt = iso(input.endAt);
  const start = Date.parse(startAt), end = Date.parse(endAt);
  if (end <= start) fail(msg("結束時間必須遲過開始時間。"));
  if (end - start > DAY) fail(msg("時段最長 24 小時。"));
  if (end <= now) fail(msg("這個時段已經過去。"));
  if (start > now + 30 * DAY) fail(msg("只可預約 30 日內嘅時段。"));
  return { startAt, endAt };
}

function parseRange(input: Record<string, unknown>): GroupRange {
  const raw = input.range;
  if (raw == null) return { ...GROUP_PRESETS.open };
  const r = raw as Record<string, unknown>;
  try { return validateGroupRange({ minPlayers: Number(r.minPlayers), targetSize: Number(r.targetSize), maxPlayers: Number(r.maxPlayers) }); }
  catch { return fail(msg("人數必須符合 2 ≤ 最少 ≤ 理想 ≤ 最多 ≤ 6。")); }
}

function parseConditionsInput(value: unknown): PlayConditions {
  try { return parseConditions(value); } catch { return fail(msg("要求格式不正確。")); }
}

const side = (p: PlayPlayer, conditions: PlayConditions): FitSide => ({ playerId: p.id, rating: p.rating, conditions });

async function requireActor(db: PlayConnection, actorId: string): Promise<PlayPlayer> {
  const rows = await db.query<PlayPlayer>(`SELECT p.id,p.name,p.rating::float8 AS rating FROM state_players p
    JOIN members m ON m.state_player_id=p.id WHERE p.id=$1 AND p.active AND m.active`, [actorId]);
  return rows[0] ?? fail(msg("請先連結球員檔案。"), 403);
}

async function loadVenue(db: PlayConnection, id: string) {
  const rows = await db.query<PlayVenue>(`SELECT id,name,name_en AS "nameEn",COALESCE(city,'${OTHER_CITY}') AS city,COALESCE(tz,'UTC') AS tz,lat,lng,status
    FROM venues WHERE id=$1 AND active AND merged_into IS NULL AND status<>'rejected'`, [id]);
  return rows[0] ?? fail(msg("搵唔到呢間場地。"), 404);
}

/** One live session with its members, row-locked for the rest of the transaction. */
async function loadSession(db: PlayConnection, id: unknown): Promise<PlaySession> {
  if (typeof id !== "string") return fail(msg("搵唔到呢個約戰。"), 404);
  const rows = await db.query<SessionRow>(`SELECT id,created_by AS "createdBy",venue_id AS "venueId",city,${ts("start_at")} AS "startAt",${ts("end_at")} AS "endAt",
    min_players AS "minPlayers",target_size AS "targetSize",max_players AS "maxPlayers",table_status AS "tableStatus",status,note,terms::text AS terms,revision
    FROM play_sessions WHERE id=$1 FOR UPDATE`, [id]);
  const row = rows[0] ?? fail(msg("搵唔到呢個約戰。"), 404);
  const members = await db.query<PlaySession["members"][number]>(`SELECT player_id AS "playerId",status,source,came,played FROM play_session_members WHERE session_id=$1`, [id]);
  return { ...row, terms: parseStoredConditions(row.terms), members } as PlaySession;
}

async function playersById(db: PlayConnection, ids: string[]) {
  if (!ids.length) return new Map<string, PlayPlayer>();
  const rows = await db.query<PlayPlayer>(`SELECT p.id,p.name,p.rating::float8 AS rating FROM state_players p WHERE p.id IN (SELECT jsonb_array_elements_text($1::jsonb)) AND p.active`, [JSON.stringify(ids)]);
  return new Map(rows.map((p) => [p.id, p]));
}

async function avoidsFor(db: PlayConnection) {
  return avoidSet(await db.query<{ playerId: string; otherId: string }>(`SELECT player_id AS "playerId",other_id AS "otherId" FROM play_avoids`));
}

/** The windows of every other live session this player is "in", which block a new seat. */
async function conflictsFor(db: PlayConnection, playerId: string, excludeId: string | null, now: number) {
  return db.query<{ startAt: string; endAt: string }>(`SELECT ${ts("s.start_at")} AS "startAt",${ts("s.end_at")} AS "endAt"
    FROM play_sessions s JOIN play_session_members m ON m.session_id=s.id AND m.player_id=$1 AND m.status='in'
    WHERE s.status IN ('forming','playable','full') AND s.end_at>$2 AND ($3::text IS NULL OR s.id<>$3)`,
  [playerId, new Date(now).toISOString(), excludeId]);
}

const BLOCK_MESSAGES: Record<JoinBlock, string> = {
  closed: msg("呢個約戰已經關閉。"),
  ended: msg("呢個約戰已經完結。"),
  full: msg("呢個約戰已經滿額。"),
  "already-in": msg("你已經喺呢個約戰入面。"),
  conflict: msg("呢段時間你已有其他安排。"),
  incompatible: msg("呢個約戰暫時唔適合你。"),
};

/** Recomputes the status from the members and bumps the revision. An empty session closes itself. */
async function settle(db: PlayConnection, id: string): Promise<PlaySession> {
  const session = await loadSession(db, id);
  let status = deriveStatus(session);
  if (isLive(session.status) && accepted(session.members).length === 0) status = "cancelled";
  if (status !== session.status) {
    await db.query(`UPDATE play_sessions SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1`, [id, status]);
    return { ...session, status };
  }
  await db.query(`UPDATE play_sessions SET revision=revision+1,updated_at=now() WHERE id=$1`, [id]);
  return session;
}

export async function playWrite(database: PlayDatabase, actorId: string, action: PlayAction, input: Record<string, unknown>, now = Date.now()): Promise<PlayResult> {
  return database.transaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock($1,$2)`, [...LOCK]);
    const actor = await requireActor(db, actorId);
    switch (action) {
      case "intent.post": return postIntent(db, actor, input, now);
      case "intent.cancel": return cancelIntent(db, actor, input);
      case "session.create": return createSession(db, actor, input, now);
      case "session.respond": return respond(db, actor, input, now);
      case "session.leave": return leave(db, actor, input);
      case "session.cancel": return cancelSession(db, actor, input);
      case "session.invite": return invite(db, actor, input, now);
      case "session.played": return played(db, actor, input, now);
      case "avoid.add": return avoid(db, actor, input, true);
      case "avoid.remove": return avoid(db, actor, input, false);
      case "venue.create": return createVenue(db, actor, input);
      default: return fail(msg("無效操作。"));
    }
  });
}

async function postIntent(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>, now: number): Promise<PlayResult> {
  const kind: IntentKind = input.kind === "open" ? "open" : input.kind === "wants" ? "wants" : fail(msg("無效操作。"));
  const strength: Strength = input.strength === "could" ? "could" : "likely";
  const window = parseWindow(input, now);
  const range = parseRange(input);
  const minMinutes = Math.min(240, Math.max(30, Math.round(Number(input.minMinutes ?? 60)) || 60));
  const venueIds = [...new Set(parseStringArray(input.venueIds))].slice(0, 6);
  const venueScope: VenueScope = venueIds.length ? "listed" : "city";
  let city = str(input.city, 40);
  for (const id of venueIds) {
    const venue = await loadVenue(db, id);
    city = venue.city;
  }
  if (!city || (!cityById(city) && city !== OTHER_CITY && !(await db.query(`SELECT 1 FROM venues WHERE city=$1 AND active LIMIT 1`, [city])).length)) fail(msg("請揀城市。"));
  const live = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM play_intents WHERE player_id=$1 AND status='active' AND end_at>$2`, [actor.id, new Date(now).toISOString()]);
  if ((live[0]?.n ?? 0) >= 5) fail(msg("你已有太多進行中嘅約戰請求，請先取消一個。"));
  const id = randomUUID();
  await db.query(`INSERT INTO play_intents(id,player_id,kind,strength,start_at,end_at,min_minutes,venue_scope,venue_ids,city,min_players,target_size,max_players,conditions,note,quiet)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
  [id, actor.id, kind, strength, window.startAt, window.endAt, minMinutes, venueScope, JSON.stringify(venueIds), city, range.minPlayers, range.targetSize, range.maxPlayers,
    JSON.stringify(parseConditionsInput(input.conditions)), str(input.note, 140) || null, input.quiet === true]);
  return { id, events: [{ event: kind === "wants" ? "play_wants_posted" : "play_open_posted", props: { id, group: range.maxPlayers > 2 } }] };
}

async function cancelIntent(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>): Promise<PlayResult> {
  const rows = await db.query(`UPDATE play_intents SET status='cancelled',updated_at=now() WHERE id=$1 AND player_id=$2 AND status='active' RETURNING id`, [input.id, actor.id]);
  if (!rows.length) fail(msg("搵唔到呢個請求。"), 404);
  return { id: String(input.id), events: [{ event: "play_intent_cancelled" }] };
}

async function createSession(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>, now: number): Promise<PlayResult> {
  const window = parseWindow(input, now);
  const range = parseRange(input);
  const tableStatus: TableStatus = input.tableStatus === "booked" ? "booked" : "walkin";
  const terms = parseConditionsInput(input.terms);
  let venueId: string | null = null;
  let city = str(input.city, 40);
  if (typeof input.venueId === "string" && input.venueId) {
    const venue = await loadVenue(db, input.venueId);
    venueId = venue.id; city = venue.city;
  }
  if (!city) fail(msg("請揀城市。"));
  const clash = await conflictsFor(db, actor.id, null, now);
  if (clash.some((c) => Date.parse(c.startAt) < Date.parse(window.endAt) && Date.parse(window.startAt) < Date.parse(c.endAt))) fail(BLOCK_MESSAGES.conflict, 409);
  const id = randomUUID();
  await db.query(`INSERT INTO play_sessions(id,created_by,venue_id,city,start_at,end_at,min_players,target_size,max_players,table_status,status,note,terms)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'forming',$11,$12::jsonb)`,
  [id, actor.id, venueId, city, window.startAt, window.endAt, range.minPlayers, range.targetSize, range.maxPlayers, tableStatus, str(input.note, 140) || null, JSON.stringify(terms)]);
  await db.query(`INSERT INTO play_session_members(session_id,player_id,status,source) VALUES($1,$2,'in','creator')`, [id, actor.id]);
  const invited = await addInvites(db, actor, await loadSession(db, id), parseStringArray(input.invitees), now);
  await settle(db, id);
  return { id, events: [{ event: "play_session_created", props: { id, invited, booked: tableStatus === "booked", group: range.maxPlayers > 2 } }] };
}

/** Invitations are asks, not commitments. People who cannot or would rather not be asked are skipped
    silently: the inviter never learns that someone avoided them or already declined. */
async function addInvites(db: PlayConnection, actor: PlayPlayer, session: PlaySession, ids: string[], now: number) {
  const wanted = [...new Set(ids)].filter((id) => id !== actor.id).slice(0, 5);
  if (!wanted.length) return 0;
  const players = await playersById(db, wanted);
  const avoids = await avoidsFor(db);
  const present = new Set(session.members.map((m) => m.playerId));
  const going = accepted(session.members).map((m) => players.get(m.playerId)).filter(Boolean) as PlayPlayer[];
  let sent = 0;
  for (const id of wanted) {
    const player = players.get(id);
    if (!player || present.has(id)) continue;
    const pending = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM play_session_members m JOIN play_sessions s ON s.id=m.session_id
      WHERE m.player_id=$1 AND m.status='invited' AND s.end_at>$2`, [id, new Date(now).toISOString()]);
    if ((pending[0]?.n ?? 0) >= 5) continue;
    const ok = groupCompatible([side(actor, session.terms), ...going.filter((g) => g.id !== actor.id).map((g) => side(g, session.terms)), side(player, session.terms)], avoids);
    if (!ok) continue;
    await db.query(`INSERT INTO play_session_members(session_id,player_id,status,source) VALUES($1,$2,'invited','invited') ON CONFLICT DO NOTHING`, [session.id, id]);
    sent += 1;
  }
  return sent;
}

async function invite(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>, now: number): Promise<PlayResult> {
  const session = await loadSession(db, input.id);
  if (!isLive(session.status) || Date.parse(session.endAt) <= now) fail(BLOCK_MESSAGES.closed);
  if (!accepted(session.members).some((m) => m.playerId === actor.id)) fail(msg("只有已加入嘅人先可以邀請其他人。"), 403);
  const sent = await addInvites(db, actor, session, parseStringArray(input.playerIds), now);
  await settle(db, session.id);
  return { id: session.id, events: [{ event: "play_invited", props: { id: session.id, sent } }] };
}

async function respond(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>, now: number): Promise<PlayResult> {
  const response = input.response;
  if (response !== "in" && response !== "maybe" && response !== "declined") return fail(msg("無效操作。"));
  const session = await loadSession(db, input.id);
  const existing = session.members.find((m) => m.playerId === actor.id);
  if (response === "declined") {
    // Declining is silent and only meaningful for someone who was asked.
    if (existing && existing.status !== "declined") {
      await db.query(`UPDATE play_session_members SET status='declined',updated_at=now() WHERE session_id=$1 AND player_id=$2`, [session.id, actor.id]);
      await settle(db, session.id);
    }
    return { id: session.id, events: [{ event: "play_declined", props: { id: session.id } }] };
  }
  const avoids = await avoidsFor(db);
  const players = await playersById(db, accepted(session.members).map((m) => m.playerId));
  const sides = [...players.values()].filter((p) => p.id !== actor.id).map((p) => side(p, session.terms));
  const compatibleWithTable = groupCompatible([side(actor, session.terms), ...sides], avoids);
  const block = joinBlock({ session, playerId: actor.id, conflicts: await conflictsFor(db, actor.id, session.id, now), compatible: compatibleWithTable, now });
  // A maybe is not a commitment, so a clash or a full table does not stop someone saying "maybe".
  const tolerated: (JoinBlock | null)[] = response === "maybe" ? [null, "conflict", "full", "already-in"] : [null];
  if (!tolerated.includes(block)) fail(BLOCK_MESSAGES[block as JoinBlock], block === "conflict" || block === "full" ? 409 : 400);
  await db.query(`INSERT INTO play_session_members(session_id,player_id,status,source) VALUES($1,$2,$3,$4)
    ON CONFLICT (session_id,player_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`, [session.id, actor.id, response, existing?.source ?? "joined"]);
  await settle(db, session.id);
  return { id: session.id, events: [{ event: response === "in" ? "play_joined" : "play_maybe", props: { id: session.id, invited: existing?.status === "invited" } }] };
}

async function leave(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>): Promise<PlayResult> {
  const session = await loadSession(db, input.id);
  const own = session.members.find((m) => m.playerId === actor.id);
  if (!own || (own.status !== "in" && own.status !== "maybe")) fail(msg("你唔喺呢個約戰入面。"), 400);
  await db.query(`UPDATE play_session_members SET status='left',updated_at=now() WHERE session_id=$1 AND player_id=$2`, [session.id, actor.id]);
  const after = await settle(db, session.id);
  return { id: session.id, events: [{ event: "play_left", props: { id: session.id, reopened: after.status === "forming" && session.status !== "forming" } }] };
}

async function cancelSession(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>): Promise<PlayResult> {
  const session = await loadSession(db, input.id);
  if (session.createdBy !== actor.id) fail(msg("只有開局嘅人可以取消。"), 403);
  if (!isLive(session.status)) fail(BLOCK_MESSAGES.closed);
  await db.query(`UPDATE play_sessions SET status='cancelled',revision=revision+1,updated_at=now() WHERE id=$1`, [session.id]);
  return { id: session.id, events: [{ event: "play_session_cancelled", props: { id: session.id } }] };
}

async function played(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>, now: number): Promise<PlayResult> {
  const session = await loadSession(db, input.id);
  const own = session.members.find((m) => m.playerId === actor.id);
  if (!own || own.status !== "in") fail(msg("只有已加入嘅人先可以回覆。"), 403);
  if (session.status === "cancelled") fail(BLOCK_MESSAGES.closed);
  if (Date.parse(session.startAt) > now) fail(msg("呢個約戰仲未開始。"));
  const didPlay = input.played === true;
  if (didPlay && accepted(session.members).length < 2) fail(msg("至少要有兩位球友先可以記錄打過波。"));
  await db.query(`UPDATE play_session_members SET played=$3,updated_at=now() WHERE session_id=$1 AND player_id=$2`, [session.id, actor.id, didPlay]);
  if (Array.isArray(input.came)) {
    const came = new Set(parseStringArray(input.came));
    if (didPlay) came.add(actor.id);
    // "Who came" is private bookkeeping: it never becomes a public record of anyone's reliability.
    await db.query(`UPDATE play_session_members SET came=(player_id IN (SELECT jsonb_array_elements_text($2::jsonb))),updated_at=now() WHERE session_id=$1 AND status='in'`, [session.id, JSON.stringify([...came])]);
  }
  if (didPlay && session.status !== "played") {
    await db.query(`UPDATE play_sessions SET status='played',played_at=COALESCE(played_at,now()),revision=revision+1,updated_at=now() WHERE id=$1`, [session.id]);
  }
  return { id: session.id, events: [{ event: "play_played", props: { id: session.id, played: didPlay } }] };
}

async function avoid(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>, add: boolean): Promise<PlayResult> {
  const otherId = typeof input.playerId === "string" ? input.playerId : "";
  if (!otherId || otherId === actor.id) fail(msg("無效操作。"));
  if (add) {
    if (!(await playersById(db, [otherId])).size) fail(msg("搵唔到呢位球員。"), 404);
    await db.query(`INSERT INTO play_avoids(player_id,other_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [actor.id, otherId]);
  } else {
    await db.query(`DELETE FROM play_avoids WHERE player_id=$1 AND other_id=$2`, [actor.id, otherId]);
  }
  // Deliberately no analytics payload naming the other player.
  return { events: [{ event: add ? "play_avoid_added" : "play_avoid_removed" }] };
}

async function createVenue(db: PlayConnection, actor: PlayPlayer, input: Record<string, unknown>): Promise<PlayResult> {
  const name = str(input.name, 60);
  if (!name) fail(msg("請輸入場地名稱。"));
  const lat = Number(input.lat), lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(msg("請喺地圖上標示場地位置。"));
  const fallbackTz = typeof input.tz === "string" && isValidZone(input.tz) ? input.tz : "UTC";
  const { city, tz } = cityForPin(lat, lng, fallbackTz);
  const existing = await db.query<PlayVenue>(`SELECT id,name,name_en AS "nameEn",COALESCE(city,'${OTHER_CITY}') AS city,COALESCE(tz,'UTC') AS tz,lat,lng,status
    FROM venues WHERE active AND merged_into IS NULL AND status<>'rejected'`);
  const duplicates = likelyDuplicates({ name, lat, lng }, existing);
  if (duplicates.length && input.confirmNew !== true) return { duplicates, events: [] };
  const id = `venue-${randomUUID().slice(0, 8)}`;
  await db.query(`INSERT INTO venues(id,name,name_en,district,city,tz,lat,lng,status,created_by) VALUES($1,$2,$3,'',$4,$5,$6,$7,'unverified',$8)`,
    [id, name, str(input.nameEn, 60) || null, city, tz, lat, lng, actor.id]);
  return { id, events: [{ event: "play_venue_added", props: { id, city } }] };
}

/* ------------------------------------------------------------ admin */

export type VenueAdminAction = "approve" | "reject" | "edit" | "merge";

/** Moderation of member-added venues. Merging repoints sessions and intents so nothing is orphaned. */
export async function venueAdmin(database: PlayDatabase, action: VenueAdminAction, input: Record<string, unknown>): Promise<{ id: string }> {
  return database.transaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock($1,$2)`, [...LOCK]);
    const id = typeof input.id === "string" ? input.id : fail(msg("搵唔到呢間場地。"), 404);
    const found = await db.query<{ id: string }>(`SELECT id FROM venues WHERE id=$1 FOR UPDATE`, [id]);
    if (!found.length) fail(msg("搵唔到呢間場地。"), 404);
    if (action === "approve") await db.query(`UPDATE venues SET status='verified',active=true WHERE id=$1`, [id]);
    else if (action === "reject") await db.query(`UPDATE venues SET status='rejected',active=false WHERE id=$1`, [id]);
    else if (action === "edit") {
      const name = str(input.name, 60);
      const lat = input.lat == null ? null : Number(input.lat), lng = input.lng == null ? null : Number(input.lng);
      if (lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) fail(msg("請喺地圖上標示場地位置。"));
      if (lng != null && (!Number.isFinite(lng) || Math.abs(lng) > 180)) fail(msg("請喺地圖上標示場地位置。"));
      const pin = lat != null && lng != null ? cityForPin(lat, lng, "UTC") : null;
      await db.query(`UPDATE venues SET name=COALESCE(NULLIF($2,''),name),name_en=COALESCE($3,name_en),lat=COALESCE($4,lat),lng=COALESCE($5,lng),
        city=COALESCE($6,city),tz=COALESCE($7,tz) WHERE id=$1`, [id, name, str(input.nameEn, 60) || null, lat, lng, pin?.city ?? null, pin?.tz ?? null]);
    } else if (action === "merge") {
      const into = typeof input.into === "string" ? input.into : "";
      if (!into || into === id) fail(msg("請揀要合併嘅場地。"));
      if (!(await db.query(`SELECT 1 FROM venues WHERE id=$1 AND active AND merged_into IS NULL`, [into])).length) fail(msg("搵唔到呢間場地。"), 404);
      await db.query(`UPDATE play_sessions SET venue_id=$2 WHERE venue_id=$1`, [id, into]);
      const intents = await db.query<{ id: string; venueIds: unknown }>(`SELECT id,venue_ids::text AS "venueIds" FROM play_intents WHERE venue_ids @> jsonb_build_array($1::text)`, [id]);
      for (const intent of intents) {
        const ids = [...new Set(parseStringArray(intent.venueIds).map((v) => (v === id ? into : v)))];
        await db.query(`UPDATE play_intents SET venue_ids=$2::jsonb WHERE id=$1`, [intent.id, JSON.stringify(ids)]);
      }
      await db.query(`UPDATE venues SET merged_into=$2,status='rejected',active=false WHERE id=$1`, [id, into]);
    } else fail(msg("無效操作。"));
    return { id };
  });
}

export type { MemberStatus };
