/* Shared contracts for the session-based matchmaking ("Play"). See docs/matchmaking-phase1-spec.md.
   Everything in lib/play is pure: it takes plain data and returns plain data, so the same rules run
   in the repository, the board and the tests. */

export type Interval = { startAt: string; endAt: string };
export type GroupRange = { minPlayers: number; targetSize: number; maxPlayers: number };

/** Rung 2 ("open": could play, ask me gently) and rung 3 ("wants": actively asking for a game). */
export type IntentKind = "open" | "wants";
export type Strength = "could" | "likely";
export type VenueScope = "listed" | "city";

/** Must filters; Prefer only ranks; Any ignores the dimension. Most defaults are Prefer. */
export type Strictness = "must" | "prefer" | "any";
export type LevelWant = "weaker" | "similar" | "stronger" | "any";
export type Vibe = "competitive" | "relaxed" | "practice";

export type Stance<T extends string> = { want: T; strictness: Strictness };
export type PlayConditions = {
  level?: Stance<LevelWant> & { handicapOk?: boolean; maxGap?: number };
  vibe?: Stance<Vibe>;
  /** "no" means non-smoking only. */
  smoking?: Stance<"no" | "any">;
  /** "split" means fee shared (AA). */
  fee?: Stance<"split" | "any">;
  /** Happy to play weaker players: a stronger player's level filter yields to this. */
  teaching?: boolean;
};

export const GROUP_PRESETS = {
  singles: { minPlayers: 2, targetSize: 2, maxPlayers: 2 },
  small: { minPlayers: 2, targetSize: 3, maxPlayers: 3 },
  rotation: { minPlayers: 4, targetSize: 5, maxPlayers: 6 },
  /** The default: a game happens with two, and the table can absorb up to six. */
  open: { minPlayers: 2, targetSize: 4, maxPlayers: 6 },
} as const satisfies Record<string, GroupRange>;

export function validateGroupRange(range: GroupRange): GroupRange {
  const { minPlayers, targetSize, maxPlayers } = range;
  if (![minPlayers, targetSize, maxPlayers].every(Number.isInteger)
    || minPlayers < 2 || minPlayers > targetSize || targetSize > maxPlayers || maxPlayers > 6) {
    throw new RangeError("Group size must satisfy 2 ≤ min ≤ target ≤ max ≤ 6");
  }
  return { minPlayers, targetSize, maxPlayers };
}

export type PlayPlayer = { id: string; name: string; rating: number };
export type PlayVenue = {
  id: string; name: string; nameEn?: string | null; city: string; tz: string;
  lat: number | null; lng: number | null; status: "unverified" | "verified" | "rejected";
};

export type PlayIntent = Interval & GroupRange & {
  id: string; playerId: string; kind: IntentKind; strength: Strength;
  minMinutes: number; venueScope: VenueScope; venueIds: string[]; city: string;
  conditions: PlayConditions; note: string | null; quiet: boolean;
  status: "active" | "cancelled";
};

export type MemberStatus = "invited" | "in" | "maybe" | "declined" | "left";
export type SessionStatus = "forming" | "playable" | "full" | "played" | "cancelled";
export type TableStatus = "walkin" | "booked";
export type MemberSource = "creator" | "invited" | "joined" | "intent";

export type SessionMember = {
  playerId: string; status: MemberStatus; source: MemberSource;
  came: boolean | null; played: boolean | null;
};

export type PlaySession = Interval & GroupRange & {
  id: string; createdBy: string | null; venueId: string | null; city: string;
  tableStatus: TableStatus; status: SessionStatus; note: string | null;
  terms: PlayConditions; revision: number; members: SessionMember[];
};

/** What a member sees as the certainty of someone else: a label, never a percentage or a record. */
export type Confidence = "locked" | "in" | "likely" | "maybe";
