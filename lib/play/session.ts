import type { Confidence, GroupRange, Interval, MemberStatus, PlaySession, SessionMember, SessionStatus, TableStatus } from "./types.ts";
import { GROUP_PRESETS } from "./types.ts";

const LIVE: SessionStatus[] = ["forming", "playable", "full"];
export const isLive = (status: SessionStatus) => LIVE.includes(status);

export const accepted = (members: SessionMember[]) => members.filter((m) => m.status === "in");
export const acceptedIds = (session: Pick<PlaySession, "members">) => accepted(session.members).map((m) => m.playerId);
export const statusOf = (session: Pick<PlaySession, "members">, playerId: string): MemberStatus | null =>
  session.members.find((m) => m.playerId === playerId)?.status ?? null;

/** Only an explicit "in" counts. "Maybe" and "invited" never raise the count, so a session is
    playable only when enough people have actually said yes. It stays playable as people leave until
    it drops below the minimum, and then reopens for recruitment. */
export function deriveStatus(session: Pick<PlaySession, "status" | "members" | "minPlayers" | "maxPlayers">): SessionStatus {
  if (session.status === "cancelled" || session.status === "played") return session.status;
  const count = accepted(session.members).length;
  if (count >= session.maxPlayers) return "full";
  if (count >= session.minPlayers) return "playable";
  return "forming";
}

export type JoinBlock = "closed" | "full" | "already-in" | "conflict" | "incompatible" | "ended";

/** Why a player cannot take a seat, or null when they can. `conflicts` are the windows of other
    sessions the player is already "in"; `compatible` is the mutual-acceptability result. */
export function joinBlock(input: {
  session: PlaySession; playerId: string; conflicts: Interval[]; compatible: boolean; now?: number;
}): JoinBlock | null {
  const { session, playerId, conflicts, compatible } = input;
  const now = input.now ?? Date.now();
  if (!isLive(session.status)) return "closed";
  if (Date.parse(session.endAt) <= now) return "ended";
  if (statusOf(session, playerId) === "in") return "already-in";
  if (accepted(session.members).length >= session.maxPlayers) return "full";
  const start = Date.parse(session.startAt);
  const end = Date.parse(session.endAt);
  if (conflicts.some((c) => Date.parse(c.startAt) < end && start < Date.parse(c.endAt))) return "conflict";
  if (!compatible) return "incompatible";
  return null;
}

/** The label others see for a member. A booked table turns the creator into an anchor ("locked");
    everyone else is "in" once they have accepted, or "maybe" while they have not committed. */
export function confidenceOf(session: Pick<PlaySession, "createdBy" | "tableStatus">, member: Pick<SessionMember, "playerId" | "status">): Confidence | null {
  if (member.status === "in") return member.playerId === session.createdBy && session.tableStatus === "booked" ? "locked" : "in";
  if (member.status === "maybe") return "maybe";
  return null;
}

/** Chance that at least `need` of `invited` independent people turn up, each with probability `p`.
    Illustrative only: it explains why widening a 1v1 to a group makes a game likelier. */
export function gameOdds(invited: number, need = 2, p = 0.5) {
  if (invited < need) return 0;
  const choose = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i; return r; };
  let below = 0;
  for (let k = 0; k < need; k += 1) below += choose(invited, k) * p ** k * (1 - p) ** (invited - k);
  return 1 - below;
}

export type WidenSuggestion = { to: GroupRange; oddsBefore: number; oddsAfter: number };

/** For a 1v1 whose partner is uncertain, the app recommends opening it to a group and says why.
    A player who really wants a 1v1 can decline; the odds shown are honest either way. */
export function widenSuggestion(range: GroupRange, uncertainPeople: number, p = 0.5): WidenSuggestion | null {
  if (range.maxPlayers > 2 || uncertainPeople < 1) return null;
  return {
    to: GROUP_PRESETS.open,
    oddsBefore: gameOdds(2, 2, p),
    oddsAfter: gameOdds(GROUP_PRESETS.open.targetSize, 2, p),
  };
}

/** Does a result count toward the success metric? "Played" is enough; a score is optional. */
export const countsAsPlayed = (session: Pick<PlaySession, "members">) => session.members.some((m) => m.played === true);

export type Seat = { open: number; needed: number; label: "locked" | "playable" | "forming" | "full" };
export function seats(session: Pick<PlaySession, "members" | "minPlayers" | "maxPlayers" | "tableStatus">): Seat {
  const count = accepted(session.members).length;
  return {
    open: Math.max(0, session.maxPlayers - count),
    needed: Math.max(0, session.minPlayers - count),
    label: count >= session.maxPlayers ? "full" : count >= session.minPlayers ? "playable" : session.tableStatus === "booked" ? "locked" : "forming",
  };
}

export type { TableStatus };
