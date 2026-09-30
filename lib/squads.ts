/* 球隊 (squads) — the rules that don't need a database, kept here so they can be tested directly.
   Persistence lives in db/squads.pg.ts; see supabase/migrations/20260930000000_squads.sql. */

export type SquadRole = "host" | "member";
export type SquadVisibility = "public" | "private";

export const SQUAD_NAME_MAX = 40;
/* Big enough for any real playing group; small enough that a squad table stays a focused rivalry
   view rather than a second club leaderboard, and that filtering by member id stays trivial. */
export const MAX_SQUAD_MEMBERS = 50;
export const MAX_SQUADS_PER_PLAYER = 20;
/* The public directory hides one-person squads, so a name alone can't be used to post into it. */
export const PUBLIC_LISTING_MIN_MEMBERS = 2;

/** An error whose message is a translatable key and whose status the route returns as-is. */
export class SquadError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** Trimmed, inner whitespace collapsed; null when empty or too long. */
export function normaliseSquadName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.replace(/\s+/g, " ").trim();
  if (!name || [...name].length > SQUAD_NAME_MAX) return null;
  return name;
}

export function isVisibility(value: unknown): value is SquadVisibility {
  return value === "public" || value === "private";
}

export function isRole(value: unknown): value is SquadRole {
  return value === "host" || value === "member";
}

/* No 0/O/1/I/L: the code is read aloud and retyped from WhatsApp screenshots as often as tapped. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const INVITE_CODE_LENGTH = 10;

export function newInviteCode(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(INVITE_CODE_LENGTH));
  let code = "";
  // 31 symbols, so modulo bias is < 1/8 per character — immaterial for a ~49-bit unguessable code.
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function normaliseInviteCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return code.length === INVITE_CODE_LENGTH && [...code].every(char => CODE_ALPHABET.includes(char)) ? code : null;
}

type Membership = { playerId: string; role: SquadRole };

/** Hosts left if `playerId` stopped being one — removed, demoted or leaving come to the same count. */
export function hostsWithout(members: Membership[], playerId: string): number {
  return members.filter(member => member.role === "host" && member.playerId !== playerId).length;
}

/** What leaving means for the leaver: a plain exit, the squad dissolving with its last member, or
    refusal because they are the only host and others would be left without one. */
export function leaveOutcome(members: Membership[], playerId: string): "leave" | "dissolve" | "last-host" {
  const self = members.find(member => member.playerId === playerId);
  if (!self) return "leave";
  if (members.length === 1) return "dissolve";
  if (self.role === "host" && hostsWithout(members, playerId) === 0) return "last-host";
  return "leave";
}
