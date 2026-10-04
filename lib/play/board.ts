import { COMMITMENT, avoided, compatible, fitScore, groupCompatible, whyChips, type AvoidSet, type FitSide, type WhyKey } from "./fit.ts";
import { accepted, confidenceOf, isLive, joinBlock, statusOf, type JoinBlock } from "./session.ts";
import { dayRange } from "./time.ts";
import type { Confidence, Interval, PlayIntent, PlayPlayer, PlaySession, PlayVenue } from "./types.ts";
import { intersect, intersectAll, minutesBetween, overlaps, requiredMinutes, DEFAULT_MIN_MINUTES } from "./window.ts";

/* Assembles one viewer's board from a snapshot of a city. Pure, so the server and the tests build the
   same board. Visibility rules live here:
     - wants are visible to the whole city; open to people who share a venue (or either has no venue limit)
     - a quiet intent is counted in pools and used for suggestions, but never listed by name
     - avoid pairs hide sessions and people in both directions, silently */

export type BoardInput = {
  viewerId: string;
  city: string;
  tz: string;
  date: string;
  now: number;
  players: Map<string, PlayPlayer>;
  venues: PlayVenue[];
  intents: PlayIntent[];
  sessions: PlaySession[];
  avoids: AvoidSet;
  /** Intents posted by the viewer's own ratings are looked up by player id. */
};

export type SessionCard = {
  session: PlaySession;
  confidence: Record<string, Confidence | null>;
  mine: "in" | "maybe" | "invited" | null;
  block: JoinBlock | null;
  score: number;
};

export type LookingCard = { intent: PlayIntent; player: PlayPlayer; score: number; why: WhyKey[]; overlap: Interval | null };

export type Pool = { key: string; window: Interval; count: number; named: PlayPlayer[]; hiddenCount: number; venueIds: string[] };

export type QueueItem =
  | { kind: "record"; session: PlaySession }
  | { kind: "invite"; session: PlaySession }
  | { kind: "upcoming"; session: PlaySession }
  | { kind: "join"; session: PlaySession }
  | { kind: "want" };

export type Board = {
  queue: QueueItem[];
  sessions: SessionCard[];
  looking: LookingCard[];
  pools: Pool[];
  mine: PlayIntent[];
};

const side = (player: PlayPlayer, conditions: FitSide["conditions"]): FitSide => ({ playerId: player.id, rating: player.rating, conditions });

/** A session or intent accepts a venue if it names no venue, covers the whole city, or lists it. */
export function intentAcceptsVenue(intent: Pick<PlayIntent, "venueScope" | "venueIds">, venueId: string | null) {
  if (intent.venueScope === "city" || !venueId) return true;
  return intent.venueIds.includes(venueId);
}

export function intentsShareVenue(a: PlayIntent, b: PlayIntent) {
  if (a.venueScope === "city" || b.venueScope === "city") return true;
  return a.venueIds.some((id) => b.venueIds.includes(id));
}

const isActive = (intent: PlayIntent, now: number) => intent.status === "active" && Date.parse(intent.endAt) > now;

/** Whether `viewer` may see `intent` by name at all (before fit). */
function visibleTo(intent: PlayIntent, viewerId: string, mineIntents: PlayIntent[]) {
  if (intent.playerId === viewerId || intent.quiet) return false;
  if (intent.kind === "wants") return true;
  return mineIntents.length === 0 ? true : mineIntents.some((m) => intentsShareVenue(m, intent));
}

/** The viewer's other live sessions they are "in", as windows that block a new seat. */
function conflictsFor(sessions: PlaySession[], viewerId: string, excludeId: string, now: number): Interval[] {
  return sessions
    .filter((s) => s.id !== excludeId && isLive(s.status) && Date.parse(s.endAt) > now && statusOf(s, viewerId) === "in")
    .map((s) => ({ startAt: s.startAt, endAt: s.endAt }));
}

export function buildBoard(input: BoardInput): Board {
  const { viewerId, city, tz, date, now, players, intents, sessions, avoids } = input;
  const viewer = players.get(viewerId);
  const day = dayRange(date, tz);
  const mine = intents.filter((i) => i.playerId === viewerId && isActive(i, now));
  const myConditions = mine[0]?.conditions ?? {};
  const me: FitSide | null = viewer ? side(viewer, myConditions) : null;
  const inCity = (x: { city: string }) => x.city === city;

  // --- sessions -------------------------------------------------------------------------------
  const sessionCards: SessionCard[] = [];
  for (const session of sessions.filter(inCity)) {
    const mineStatus = statusOf(session, viewerId);
    const involved = mineStatus === "in" || mineStatus === "maybe" || mineStatus === "invited";
    if (!involved && (!isLive(session.status) || Date.parse(session.endAt) <= now)) continue;
    if (!overlaps(session, day) && !involved) continue;
    const inPlayers = accepted(session.members).map((m) => players.get(m.playerId)).filter((p): p is PlayPlayer => !!p);
    // Silently hide a session that contains someone the viewer avoids (or who avoids the viewer).
    if (!involved && inPlayers.some((p) => avoided(avoids, viewerId, p.id))) continue;
    const fits = me ? groupCompatible([me, ...inPlayers.map((p) => side(p, session.terms))], avoids) : false;
    const block = involved ? null : joinBlock({ session, playerId: viewerId, conflicts: conflictsFor(sessions, viewerId, session.id, now), compatible: fits, now });
    const confidence: SessionCard["confidence"] = {};
    for (const m of session.members) confidence[m.playerId] = confidenceOf(session, m);
    const soon = Math.max(0, 30 - (Date.parse(session.startAt) - now) / 3_600_000);
    const members = accepted(session.members).length;
    const score = Math.round(soon + Math.min(members, session.targetSize) * 8 + (session.tableStatus === "booked" ? 10 : 0));
    sessionCards.push({ session, confidence, mine: mineStatus === "in" || mineStatus === "maybe" || mineStatus === "invited" ? mineStatus : null, block, score });
  }
  sessionCards.sort((a, b) => b.score - a.score || a.session.startAt.localeCompare(b.session.startAt) || a.session.id.localeCompare(b.session.id));

  // --- people looking ---------------------------------------------------------------------------
  const looking: LookingCard[] = [];
  if (me) {
    for (const intent of intents.filter((i) => inCity(i) && isActive(i, now) && overlaps(i, day))) {
      if (!visibleTo(intent, viewerId, mine)) continue;
      const other = players.get(intent.playerId);
      if (!other) continue;
      const them = side(other, intent.conditions);
      const verdict = compatible(me, them, avoids);
      if (!verdict.ok) continue;
      const best = mine.map((m) => intersect(m, intent)).filter((x): x is Interval => !!x && minutesBetween(x) >= requiredMinutes(...mine.map((m) => m.minMinutes), intent.minMinutes))
        .sort((a, b) => minutesBetween(b) - minutesBetween(a))[0] ?? null;
      const overlapMinutes = best ? minutesBetween(best) : 0;
      const sharedVenue = mine.length === 0 ? false : mine.some((m) => intentsShareVenue(m, intent));
      const commitment = intent.kind === "wants" ? COMMITMENT.wants : COMMITMENT[intent.strength];
      looking.push({
        intent, player: other, overlap: best,
        score: fitScore(me, them, { overlapMinutes, sharedVenue, commitment }, avoids),
        why: whyChips(me, them, { overlapMinutes, sharedVenue }),
      });
    }
    looking.sort((a, b) => b.score - a.score || a.intent.startAt.localeCompare(b.intent.startAt) || a.intent.id.localeCompare(b.intent.id));
  }

  // --- pools ----------------------------------------------------------------------------------------
  const pools = buildPools(intents.filter((i) => inCity(i) && isActive(i, now) && overlaps(i, day)), players, avoids, viewerId);

  // --- the one-pass queue -----------------------------------------------------------------------------
  const queue: QueueItem[] = [];
  const involved = sessions.filter((s) => s.city === city || statusOf(s, viewerId));
  for (const s of involved) {
    const m = s.members.find((x) => x.playerId === viewerId);
    if (m?.status === "in" && Date.parse(s.endAt) <= now && s.status !== "cancelled" && m.played === null) queue.push({ kind: "record", session: s });
  }
  for (const s of involved) {
    if (isLive(s.status) && Date.parse(s.endAt) > now && statusOf(s, viewerId) === "invited") queue.push({ kind: "invite", session: s });
  }
  for (const s of involved.slice().sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const st = statusOf(s, viewerId);
    if (isLive(s.status) && Date.parse(s.endAt) > now && (st === "in" || st === "maybe")) queue.push({ kind: "upcoming", session: s });
  }
  for (const c of sessionCards) if (!c.mine && c.block === null && queue.filter((q) => q.kind === "join").length < 3) queue.push({ kind: "join", session: c.session });
  if (!mine.length) queue.push({ kind: "want" });

  return { queue, sessions: sessionCards, looking, pools, mine };
}

/** Groups of three or more people whose windows overlap enough to play: "5 could play Saturday
    afternoon — start a table?". Quiet people count towards the total but are never named. */
export function buildPools(intents: PlayIntent[], players: Map<string, PlayPlayer>, avoids: AvoidSet, viewerId: string): Pool[] {
  const live = intents.slice().sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const pools: Pool[] = [];
  for (const seed of live) {
    const group: PlayIntent[] = [seed];
    for (const other of live) {
      if (other === seed || group.some((g) => g.playerId === other.playerId)) continue;
      const window = intersectAll([...group, other]);
      if (!window) continue;
      const need = requiredMinutes(DEFAULT_MIN_MINUTES, ...group.map((g) => g.minMinutes), other.minMinutes);
      if (minutesBetween(window) < need) continue;
      if (!group.every((g) => intentsShareVenue(g, other))) continue;
      const fits = [...group, other].map((i) => {
        const p = players.get(i.playerId);
        return p ? side(p, i.conditions) : null;
      });
      if (fits.some((f) => !f) || !groupCompatible(fits as FitSide[], avoids)) continue;
      group.push(other);
    }
    if (group.length < 3) continue;
    const window = intersectAll(group)!;
    const key = group.map((g) => g.playerId).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const named = group.filter((g) => !g.quiet && g.playerId !== viewerId).map((g) => players.get(g.playerId)).filter((p): p is PlayPlayer => !!p);
    const venueIds = [...new Set(group.flatMap((g) => (g.venueScope === "listed" ? g.venueIds : [])))];
    pools.push({ key, window, count: group.length, named, hiddenCount: group.length - named.length - (group.some((g) => g.playerId === viewerId) ? 1 : 0), venueIds });
  }
  return pools.sort((a, b) => b.count - a.count || a.window.startAt.localeCompare(b.window.startAt)).slice(0, 5);
}
