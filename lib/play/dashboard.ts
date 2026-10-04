import { buildBoard, type BoardInput, type Pool, type QueueItem } from "./board.ts";
import { CITIES, cityById } from "./geo.ts";
import { seats } from "./session.ts";
import { addDays, dayRange } from "./time.ts";
import type { Confidence, Interval, IntentKind, PlayConditions, PlayIntent, PlayPlayer, PlaySession, PlayVenue, SessionStatus, Strength, TableStatus, VenueScope } from "./types.ts";
import { overlaps } from "./window.ts";
import type { JoinBlock } from "./session.ts";
import type { WhyKey } from "./fit.ts";

/* What the client is allowed to see. Everything private is dropped here, in one place, so a test can
   prove it: other people's requirements, quiet intents' names, pending invitees (except to the
   creator), and anyone's declined/left status never leave the server. */

export type PublicPlayer = PlayPlayer;

export type SessionDto = Interval & {
  id: string; createdBy: string | null; venueId: string | null; city: string;
  minPlayers: number; targetSize: number; maxPlayers: number;
  tableStatus: TableStatus; status: SessionStatus; note: string | null; terms: PlayConditions;
  members: { player: PublicPlayer; confidence: Confidence }[];
  /** Pending invitees, only for the person who created the session. */
  invitees: PublicPlayer[];
  seatsOpen: number; seatsNeeded: number;
  mine: "in" | "maybe" | "invited" | null;
  block: JoinBlock | null;
  played: boolean | null;
};

export type LookingDto = Interval & {
  id: string; player: PublicPlayer; kind: IntentKind; strength: Strength; minMinutes: number;
  venueScope: VenueScope; venueIds: string[]; note: string | null;
  overlap: Interval | null; score: number; why: WhyKey[];
};

export type PoolDto = { key: string; window: Interval; count: number; named: PublicPlayer[]; hiddenCount: number; venueIds: string[] };

export type QueueDto =
  | { kind: "record" | "invite" | "upcoming" | "join"; session: SessionDto }
  | { kind: "want" };

export type DayCount = { date: string; wants: number; open: number; sessions: number };

export type Dashboard = {
  ready: true;
  signedIn: boolean;
  viewerId: string | null;
  viewerRating: number | null;
  city: string;
  cityLabel: string;
  tz: string;
  date: string;
  cities: { id: string; label: string }[];
  venues: PlayVenue[];
  dates: DayCount[];
  queue: QueueDto[];
  sessions: SessionDto[];
  looking: LookingDto[];
  pools: PoolDto[];
  mine: PlayIntent[];
};

const pub = (p: PlayPlayer): PublicPlayer => ({ id: p.id, name: p.name, rating: p.rating });

function sessionDto(session: PlaySession, input: BoardInput, mine: SessionDto["mine"], block: JoinBlock | null): SessionDto {
  const viewer = input.viewerId;
  const members = session.members
    .filter((m) => m.status === "in" || m.status === "maybe")
    .map((m) => ({ player: input.players.get(m.playerId), status: m.status }))
    .filter((m): m is { player: PlayPlayer; status: "in" | "maybe" } => !!m.player)
    .map((m) => ({
      player: pub(m.player),
      confidence: (m.status === "maybe" ? "maybe" : m.player.id === session.createdBy && session.tableStatus === "booked" ? "locked" : "in") as Confidence,
    }));
  const invitees = session.createdBy === viewer
    ? session.members.filter((m) => m.status === "invited").map((m) => input.players.get(m.playerId)).filter((p): p is PlayPlayer => !!p).map(pub)
    : [];
  const seat = seats(session);
  const own = session.members.find((m) => m.playerId === viewer);
  return {
    id: session.id, createdBy: session.createdBy, venueId: session.venueId, city: session.city,
    startAt: session.startAt, endAt: session.endAt,
    minPlayers: session.minPlayers, targetSize: session.targetSize, maxPlayers: session.maxPlayers,
    tableStatus: session.tableStatus, status: session.status, note: session.note, terms: session.terms,
    members, invitees, seatsOpen: seat.open, seatsNeeded: seat.needed, mine, block, played: own?.played ?? null,
  };
}

const distinct = <T,>(items: T[], key: (t: T) => string) => new Set(items.map(key)).size;

/** Counts per day for the next week, safe for guests: numbers only, never names. */
export function dayCounts(input: BoardInput, days = 7): DayCount[] {
  const live = input.intents.filter((i) => i.city === input.city && i.status === "active" && Date.parse(i.endAt) > input.now);
  const sessions = input.sessions.filter((s) => s.city === input.city && (s.status === "forming" || s.status === "playable" || s.status === "full") && Date.parse(s.endAt) > input.now);
  const out: DayCount[] = [];
  for (let n = 0; n < days; n += 1) {
    const date = addDays(input.date, n);
    const range = dayRange(date, input.tz);
    out.push({
      date,
      wants: distinct(live.filter((i) => i.kind === "wants" && overlaps(i, range)), (i) => i.playerId),
      open: distinct(live.filter((i) => i.kind === "open" && overlaps(i, range)), (i) => i.playerId),
      sessions: sessions.filter((s) => overlaps(s, range)).length,
    });
  }
  return out;
}

export function toDashboard(input: BoardInput, signedIn: boolean): Dashboard {
  const city = cityById(input.city);
  const base = {
    ready: true as const, signedIn, viewerId: signedIn ? input.viewerId : null,
    viewerRating: signedIn ? input.players.get(input.viewerId)?.rating ?? null : null,
    city: input.city, cityLabel: city?.label ?? input.city, tz: input.tz, date: input.date,
    cities: CITIES.map((c) => ({ id: c.id, label: c.label })),
    venues: input.venues.filter((v) => v.city === input.city && v.status !== "rejected"),
    dates: dayCounts(input),
  };
  if (!signedIn) return { ...base, queue: [], sessions: [], looking: [], pools: [], mine: [] };

  const board = buildBoard(input);
  const toQueue = (q: QueueItem): QueueDto => q.kind === "want"
    ? { kind: "want" }
    : { kind: q.kind, session: sessionDto(q.session, input, ownStatus(q.session, input.viewerId), null) };
  const pools = board.pools.map((p: Pool): PoolDto => ({ key: p.key, window: p.window, count: p.count, named: p.named.map(pub), hiddenCount: p.hiddenCount, venueIds: p.venueIds }));
  return {
    ...base,
    queue: board.queue.map(toQueue),
    sessions: board.sessions.map((c) => sessionDto(c.session, input, c.mine, c.block)),
    looking: board.looking.map((l): LookingDto => ({
      id: l.intent.id, player: pub(l.player), kind: l.intent.kind, strength: l.intent.strength,
      startAt: l.intent.startAt, endAt: l.intent.endAt, minMinutes: l.intent.minMinutes,
      venueScope: l.intent.venueScope, venueIds: l.intent.venueIds, note: l.intent.note,
      overlap: l.overlap, score: l.score, why: l.why,
    })),
    pools,
    mine: board.mine,
  };
}

function ownStatus(session: PlaySession, viewerId: string): SessionDto["mine"] {
  const s = session.members.find((m) => m.playerId === viewerId)?.status;
  return s === "in" || s === "maybe" || s === "invited" ? s : null;
}

