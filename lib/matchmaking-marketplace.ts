import type {Interval} from "./availability.ts";
import type {FormationStatus} from "./matchmaking-formation.ts";

/** Marketplace contracts are separate from legacy SlotConditions / host-owned sessions. */
export type MatchConditions = {
  handicap?: boolean;
  noSmoking?: boolean;
  levelPreference?: "similar" | "any";
  levelStrict?: boolean;
  feePreference?: "aa" | "any";
  tempo?: "sport" | "casual" | "any";
};
export type VenueScope = "exact" | "district" | "any_hk";
export type AvailabilityCommitment = "going" | "interested";
export type FormationSource = "marketplace" | "direct" | "legacy";
export type FormationMemberStatus = "pending" | "accepted" | "declined" | "withdrawn";
export type GroupRange = {minPlayers: number; targetSize: number; maxPlayers: number};

export const GROUP_PRESETS = {
  singles: {minPlayers: 2, targetSize: 2, maxPlayers: 2},
  small: {minPlayers: 2, targetSize: 3, maxPlayers: 3},
  rotation: {minPlayers: 4, targetSize: 5, maxPlayers: 6},
  flexible: {minPlayers: 2, targetSize: 4, maxPlayers: 6},
} as const satisfies Record<string, GroupRange>;

export type MatchableAvailability = Interval & GroupRange & {
  id: string;
  playerId: string;
  venueId: string | null;
  venueScope: VenueScope;
  commitment: AvailabilityCommitment;
  conditions: MatchConditions;
};

export type FormationMember = {
  playerId: string;
  availabilitySlotId: string | null;
  status: FormationMemberStatus;
};

export type MarketplaceSession = Interval & GroupRange & {
  id: string;
  createdByPlayerId: string | null;
  source: Exclude<FormationSource, "legacy">;
  venueId: string | null;
  status: FormationStatus;
  members: FormationMember[];
};

/** Server-only input: never include this relationship in a public dashboard DTO. */
export type MatchmakingPairPreference = {
  playerId: string;
  otherPlayerId: string;
  preference: "avoid";
};

export function validateGroupRange(range: GroupRange): GroupRange {
  const {minPlayers, targetSize, maxPlayers} = range;
  if (![minPlayers, targetSize, maxPlayers].every(Number.isInteger)
    || minPlayers < 2 || minPlayers > targetSize || targetSize > maxPlayers || maxPlayers > 6) {
    throw new Error("人數必須符合 2 ≤ 最少 ≤ 理想 ≤ 最多 ≤ 6。");
  }
  return {minPlayers, targetSize, maxPlayers};
}

/** Missing scope follows the old meaning: a selected venue is exact, no venue is flexible. */
export function parseVenueScope(value: unknown, venueId: string | null): VenueScope {
  const scope = value === undefined ? (venueId ? "exact" : "any_hk") : value;
  if (scope !== "exact" && scope !== "district" && scope !== "any_hk") {
    throw new Error("請選擇有效的場地彈性。");
  }
  if (scope !== "any_hk" && !venueId) throw new Error("指定場地或地區需要先選擇波房。");
  return scope;
}

/** Strict parsing for new writes. Historical OpenBoard costSplit/levelOnly are not reinterpreted. */
export function parseMatchConditions(value: unknown): MatchConditions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("約戰條件格式不正確。");
  const raw = value as Record<string, unknown>;
  const result: MatchConditions = {};
  for (const key of ["handicap", "noSmoking", "levelStrict"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") throw new Error(`Invalid ${key}`);
    result[key] = raw[key];
  }
  if (raw.levelPreference !== undefined) {
    if (raw.levelPreference !== "similar" && raw.levelPreference !== "any") throw new Error("Invalid levelPreference");
    result.levelPreference = raw.levelPreference;
  }
  if (raw.feePreference !== undefined) {
    if (raw.feePreference !== "aa" && raw.feePreference !== "any") throw new Error("Invalid feePreference");
    result.feePreference = raw.feePreference;
  }
  if (raw.tempo !== undefined) {
    if (raw.tempo !== "sport" && raw.tempo !== "casual" && raw.tempo !== "any") throw new Error("Invalid tempo");
    result.tempo = raw.tempo;
  }
  if (result.levelStrict && result.levelPreference === "any") throw new Error("不限水平不能同時設為嚴格水平限制。");
  return result;
}

/** Call after consent changes on live sessions only; never reopen completed/cancelled sessions. */
export function marketplaceFormationStatus(accepted: number, range: GroupRange): FormationStatus {
  validateGroupRange(range);
  if (!Number.isInteger(accepted) || accepted < 0 || accepted > range.maxPlayers) {
    throw new Error("Invalid accepted member count");
  }
  if (accepted === 0) return "cancelled";
  if (accepted < range.minPlayers) return "forming";
  return accepted < range.maxPlayers ? "playable" : "full";
}
