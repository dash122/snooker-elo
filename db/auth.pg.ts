import { headers } from "next/headers";
import type { MemberSession, MemberRow } from "./auth-types";
import { getSql } from "./sql";
import { ensureStateSchema } from "./state.pg";
import { getState, putState } from "./state";
import { replay, type ReplayMatch, type ReplayPlayer, type ReplaySettings } from "../lib/elo-replay";

const SESSION_COOKIE = "scaa_session";
const SESSION_DAYS = 30;

export type GoogleMemberLookup =
  | { status: "linked" | "not-found"; email: string }
  | { status: "deactivated" };

// Looks up the member a Google sign-in's email belongs to, auto-linking if
// found (only ever fills a missing google_id, never overwrites one). Never
// creates a member — signInOrSignUpWithGoogle in db/signup.ts does that.
export async function resolveGoogleMember(email: string, googleId: string): Promise<GoogleMemberLookup> {
  await ensureAuthSchema();
  const sql = getSql();
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await sql<{ active: boolean }[]>`SELECT active FROM members WHERE email = ${normalizedEmail}`;
  if (!existing[0]) return { status: "not-found", email: normalizedEmail };
  if (!existing[0].active) return { status: "deactivated" };
  await sql`UPDATE members SET google_id = COALESCE(google_id, ${googleId}) WHERE email = ${normalizedEmail}`;
  return { status: "linked", email: normalizedEmail };
}

let schemaReady: Promise<unknown> | null = null;
let preliminaryRatingSchemaReady: Promise<unknown> | null = null;
function ensurePreliminaryRatingSchema() {
  // Column is migration-owned now (see
  // supabase/migrations/20260821000000_auth_schema_runtime_ddl_cleanup.sql).
  // Running this ALTER on every serverless cold start meant every instance
  // queued on the advisory lock below and, under concurrent cold starts,
  // could sit there until the pooler's statement_timeout cancelled it.
  return Promise.resolve();

  preliminaryRatingSchemaReady ??= (async () => {
    const sql = getSql();
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(72591004)`;
      await tx`ALTER TABLE state_players ADD COLUMN IF NOT EXISTS preliminary_rating numeric`;
    });
  })().catch(error => { preliminaryRatingSchemaReady = null; throw error; });
  return preliminaryRatingSchemaReady;
}
function ensureAuthSchema() {
  // Tables and columns are migration-owned now (see
  // supabase/migrations/20260821000000_auth_schema_runtime_ddl_cleanup.sql).
  // Running this bootstrap on every serverless cold start took the advisory
  // lock below and, under a stampede of concurrent cold starts, queued
  // requests behind it until the pooler's statement_timeout cancelled them
  // — surfacing as "canceling statement due to statement timeout" on every
  // route that touches auth.
  return Promise.resolve();

  schemaReady ??= (async () => {
    const sql = getSql();
    // Serialize concurrent cold starts on a session advisory lock instead of
    // racing for the table locks DDL takes: with a short lock_timeout, the
    // loser of that race got killed outright (55P03) and surfaced as a 500 to
    // whatever request triggered it. Waiting on the advisory lock instead
    // means every instance just blocks until the first one finishes, then
    // finds the tables/columns already exist and returns immediately.
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(72591001)`;
      await tx`
        CREATE TABLE IF NOT EXISTS members (
          email TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL UNIQUE,
          state_player_id TEXT UNIQUE,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT true,
          joined_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        )
      `;
      await tx`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY NOT NULL,
          member_email TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `;
      // Added after the first release — existing deployments get them here.
      await tx`ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar TEXT`;
      await tx`ALTER TABLE members ADD COLUMN IF NOT EXISTS deactivated_at TEXT`;
      await tx`ALTER TABLE members ADD COLUMN IF NOT EXISTS initials TEXT`;
      await tx`ALTER TABLE members ADD COLUMN IF NOT EXISTS icon_colour TEXT`;
      await tx`CREATE INDEX IF NOT EXISTS sessions_member_email_idx ON sessions (member_email)`;
      await tx`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)`;
      await tx`ALTER TABLE members ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`;
    });
  })().catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  return new Uint8Array(hex.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) ?? []);
}

function randomHex(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function passwordDigest(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: 100_000 },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function parseCookie(cookie: string | null, name: string) {
  const item = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export async function getCurrentMember(): Promise<MemberSession | null> {
  await ensureAuthSchema();
  const token = parseCookie((await headers()).get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const sql = getSql();
  const rows = await sql<MemberSession[]>`
    SELECT m.email, m.username, m.state_player_id AS "statePlayerId", m.display_name AS "displayName", m.avatar, m.initials, m.icon_colour AS "iconColour", m.role
    FROM sessions s JOIN members m ON m.email = s.member_email
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > ${now} AND m.active = true
  `;
  return rows[0] ?? null;
}

export async function requireMember(role?: "admin") {
  const member = await getCurrentMember();
  if (!member || (role && member.role !== role)) return null;
  return member;
}

export async function verifyCredentials(username: string, password: string) {
  await ensureAuthSchema();
  const sql = getSql();
  const rows = await sql<(MemberSession & { passwordHash: string; passwordSalt: string })[]>`
    SELECT email, display_name AS "displayName", role, password_hash AS "passwordHash", password_salt AS "passwordSalt"
    FROM members WHERE username = ${username.trim().toLowerCase()} AND active = true
  `;
  const row = rows[0];
  if (!row || await passwordDigest(password, row.passwordSalt) !== row.passwordHash) return null;
  return row;
}

export async function createMember(username: string, email: string, displayName: string, password: string, role: "admin" | "member", statePlayerId?: string) {
  await ensureAuthSchema();
  const sql = getSql();
  const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
  const salt = randomHex(16);
  const hash = await passwordDigest(password, salt);
  const now = new Date().toISOString();
  await sql`
    INSERT INTO members (email, username, state_player_id, display_name, role, password_hash, password_salt, active, joined_at, last_seen_at)
    VALUES (${normalizedEmail}, ${normalizedUsername}, ${statePlayerId ?? null}, ${displayName.trim()}, ${role}, ${hash}, ${salt}, true, ${now}, ${now})
  `;
}

export async function checkSignupAvailability(username: string | null, email: string | null) {
  await ensureAuthSchema();
  const sql = getSql();
  const normalizedUsername = username?.trim().toLowerCase() || null;
  const normalizedEmail = email?.trim().toLowerCase() || null;
  const rows = await sql<{ username: string; email: string }[]>`
    SELECT username, email FROM members
    WHERE (${normalizedUsername}::text IS NOT NULL AND username = ${normalizedUsername})
       OR (${normalizedEmail}::text IS NOT NULL AND email = ${normalizedEmail})
  `;
  return {
    usernameTaken: normalizedUsername !== null && rows.some(row => row.username === normalizedUsername),
    emailTaken: normalizedEmail !== null && rows.some(row => row.email === normalizedEmail),
  };
}

export type NewSignupPlayer = {
  id: string; name: string; short: string; colour: string; rating: number; initialRating: number; preliminaryRating?: number | null;
};

// Player row and member row must exist together or not at all — a single
// transaction across both tables replaces the old "write player, then write
// member, best-effort delete player on failure" approach, which could leave
// an orphaned player if the process crashed between the two writes.
export async function createMemberWithPlayer(input: {
  username: string; email: string; displayName: string; password: string;
  role: "admin" | "member"; player: NewSignupPlayer; auditText: string; googleId?: string;
}) {
  await Promise.all([ensureAuthSchema(), ensureStateSchema()]);
  const sql = getSql();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedUsername = input.username.trim().toLowerCase();
  const salt = randomHex(16);
  const hash = await passwordDigest(input.password, salt);
  const now = new Date().toISOString();
  const p = input.player;
  await sql.begin(async tx => {
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    await tx`
      INSERT INTO state_players (id, name, short, handicap, rating, colour, initial_rating, active, wins, losses, draws, frames_won, frames_lost, last_change, form, updated_at)
      VALUES (${p.id}, ${p.name}, ${p.short}, NULL, ${p.rating}, ${p.colour}, ${p.initialRating}, true, 0, 0, 0, 0, 0, 0, ${tx.json([])}, now())
    `;
    await tx`
      INSERT INTO state_audits (id, text, occurred_at) VALUES (${crypto.randomUUID()}, ${input.auditText}, ${now})
    `;
    await tx`
      INSERT INTO members (email, username, state_player_id, display_name, role, password_hash, password_salt, active, joined_at, last_seen_at, google_id)
      VALUES (${normalizedEmail}, ${normalizedUsername}, ${p.id}, ${input.displayName.trim()}, ${input.role}, ${hash}, ${salt}, true, ${now}, ${now}, ${input.googleId ?? null})
    `;
  });
}

export async function adminUpdateMember(email: string, input: { username: string; newEmail: string; displayName: string; password?: string; statePlayerId?: string | null }) {
  await ensureAuthSchema();
  const sql = getSql();
  const oldEmail = email.trim().toLowerCase();
  const newEmail = input.newEmail.trim().toLowerCase();
  if (input.password) {
    const salt = randomHex(16);
    const hash = await passwordDigest(input.password, salt);
    await sql`UPDATE members SET username = ${input.username.trim().toLowerCase()}, email = ${newEmail}, display_name = ${input.displayName.trim()}, state_player_id = ${input.statePlayerId || null}, password_hash = ${hash}, password_salt = ${salt} WHERE email = ${oldEmail}`;
  } else {
    await sql`UPDATE members SET username = ${input.username.trim().toLowerCase()}, email = ${newEmail}, display_name = ${input.displayName.trim()}, state_player_id = ${input.statePlayerId || null} WHERE email = ${oldEmail}`;
  }
  if (oldEmail !== newEmail) await sql`UPDATE sessions SET member_email = ${newEmail} WHERE member_email = ${oldEmail}`;
  return true;
}

export async function hasMembers() {
  await ensureAuthSchema();
  const sql = getSql();
  const rows = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM members`;
  return Number(rows[0]?.count ?? 0) > 0;
}

export async function needsOnboarding(email: string) {
  await Promise.all([ensureAuthSchema(), ensurePreliminaryRatingSchema()]);
  const sql = getSql();
  const rows = await sql<{ needs: boolean }[]>`
    SELECT (p.preliminary_rating IS NULL) AS needs
    FROM members m
    LEFT JOIN state_players p ON p.id = m.state_player_id
    WHERE m.email = ${email.trim().toLowerCase()} AND m.active = true
  `;
  return rows[0]?.needs ?? false;
}

export async function savePreliminaryRating(email: string, preliminaryRating: number, finalRating: number, at: string) {
  await Promise.all([ensureAuthSchema(), ensureStateSchema(), ensurePreliminaryRatingSchema()]);
  const sql = getSql();
  const rows = await sql<{ statePlayerId: string | null; displayName: string; rating: number | null; initialRating: number | null; hasHistory: boolean }[]>`
    SELECT m.state_player_id AS "statePlayerId",
           m.display_name AS "displayName",
           p.rating::float8 AS rating,
           p.initial_rating::float8 AS "initialRating",
           EXISTS (
             SELECT 1 FROM state_matches sm
             WHERE sm.player_a = p.id OR sm.player_b = p.id OR sm.player_a2 = p.id OR sm.player_b2 = p.id
           ) AS "hasHistory"
    FROM members m
    LEFT JOIN state_players p ON p.id = m.state_player_id
    WHERE m.email = ${email.trim().toLowerCase()} AND m.active = true
  `;
  const member = rows[0];
  if (!member?.statePlayerId) return false;

  const rawState = await getState();
  if (!rawState) return false;
  const state = JSON.parse(rawState) as {
    players: Array<Record<string, unknown> & { id: string; initialRating: number; rating: number }>;
    matches: Record<string, unknown>[];
    settings: Record<string, unknown>;
    tournaments: unknown[];
    audits: { id: string; text: string; at: string }[];
  };
  const players = state.players.map(player => player.id === member.statePlayerId
    ? { ...player, initialRating: finalRating, preliminaryRating }
    : player);
  const rebuilt = replay(
    players as unknown as ReplayPlayer[],
    state.matches as unknown as ReplayMatch[],
    state.settings as ReplaySettings,
  );
  const rebuiltPlayer = rebuilt.players.find(player => player.id === member.statePlayerId);
  if (!rebuiltPlayer) return false;
  await putState(JSON.stringify({
    ...state,
    ...rebuilt,
    audits: [{ id: crypto.randomUUID(), text: `完成新會員評級：${member.displayName}（${rebuiltPlayer.rating} ELO）`, at }, ...state.audits],
  }));
  return true;
}
export async function updateMember(email: string, input: { username?: string; newEmail?: string; password?: string; currentPassword?: string }) {
  await ensureAuthSchema();
  const sql = getSql();
  const rows = await sql<{ passwordHash: string; passwordSalt: string }[]>`SELECT password_hash AS "passwordHash", password_salt AS "passwordSalt" FROM members WHERE email = ${email.toLowerCase()}`;
  const row = rows[0];
  if (!row || !input.currentPassword || await passwordDigest(input.currentPassword, row.passwordSalt) !== row.passwordHash) return false;
  const username = input.username?.trim().toLowerCase() || null;
  const newEmail = input.newEmail?.trim().toLowerCase() || null;
  if (input.password) {
    const salt = randomHex(16);
    const hash = await passwordDigest(input.password, salt);
    await sql`UPDATE members SET username = COALESCE(${username}, username), email = COALESCE(${newEmail}, email), password_hash = ${hash}, password_salt = ${salt} WHERE email = ${email.toLowerCase()}`;
  } else {
    await sql`UPDATE members SET username = COALESCE(${username}, username), email = COALESCE(${newEmail}, email) WHERE email = ${email.toLowerCase()}`;
  }
  return true;
}
export type ProfileResult = "ok" | "username-taken" | "email-taken";

export async function updateProfile(email: string, input: { username: string; newEmail: string; displayName: string; avatar?: string | null; initials?: string | null; iconColour?: string | null }): Promise<ProfileResult> {
  await ensureAuthSchema();
  const sql = getSql();
  const oldEmail = email.toLowerCase();
  const newEmail = input.newEmail.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const taken = await sql<{ email: string; username: string }[]>`
    SELECT email, username FROM members WHERE (username = ${username} OR email = ${newEmail}) AND email <> ${oldEmail}
  `;
  if (taken.some(row => row.username === username)) return "username-taken";
  if (taken.length) return "email-taken";
  // avatar/initials/iconColour undefined means "leave as stored"; null clears it.
  // Built as a field map rather than a branch per combination — three optional
  // columns would otherwise need eight near-identical UPDATE statements.
  const fields: Record<string, string | null> = { username, email: newEmail, display_name: input.displayName.trim() };
  if (input.avatar !== undefined) fields.avatar = input.avatar;
  if (input.initials !== undefined) fields.initials = input.initials;
  if (input.iconColour !== undefined) fields.icon_colour = input.iconColour;
  await sql`UPDATE members SET ${sql(fields)} WHERE email = ${oldEmail}`;
  if (oldEmail !== newEmail) await sql`UPDATE sessions SET member_email = ${newEmail} WHERE member_email = ${oldEmail}`;
  // The matching write into the linked state player happens in the account
  // profile route, so it runs the same way on both storage backends.
  return "ok";
}

export async function syncMemberPlayerProfiles(players: { id: string; name: string; short: string; colour?: string | null }[]) {
  await ensureAuthSchema();
  const sql = getSql();
  await sql.begin(async tx => {
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    for (const player of players) await tx`UPDATE members SET display_name = ${player.name}, initials = ${player.short}, icon_colour = ${player.colour ?? null} WHERE state_player_id = ${player.id}`;
  });
}

// Deactivation is reversible by an admin (active = true) but immediately ends
// every session the member has open.
export async function deactivateMember(email: string, currentPassword: string) {
  await ensureAuthSchema();
  const sql = getSql();
  const normalized = email.toLowerCase();
  const rows = await sql<{ passwordHash: string; passwordSalt: string }[]>`SELECT password_hash AS "passwordHash", password_salt AS "passwordSalt" FROM members WHERE email = ${normalized}`;
  const row = rows[0];
  if (!row || await passwordDigest(currentPassword, row.passwordSalt) !== row.passwordHash) return false;
  await sql`UPDATE members SET active = false, deactivated_at = ${new Date().toISOString()} WHERE email = ${normalized}`;
  await sql`DELETE FROM sessions WHERE member_email = ${normalized}`;
  return true;
}

export async function deleteMember(email: string) {
  await Promise.all([ensureAuthSchema(), ensureStateSchema()]);
  const sql = getSql();
  const normalized = email.trim().toLowerCase();
  await sql.begin(async tx => {
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    const rows = await tx<{ statePlayerId: string | null }[]>`SELECT state_player_id AS "statePlayerId" FROM members WHERE email = ${normalized}`;
    if (!rows[0]) throw new Error("not-found");
    await tx`DELETE FROM sessions WHERE member_email = ${normalized}`;
    await tx`DELETE FROM members WHERE email = ${normalized}`;
    const playerId = rows[0].statePlayerId;
    if (playerId) {
      try {
        await tx`DELETE FROM state_players WHERE id = ${playerId}`;
      } catch (error) {
        if ((error as { code?: string }).code === "23503") throw new Error("has-matches");
        throw error;
      }
    }
  });
}

export async function createSession(email: string) {
  await ensureAuthSchema();
  const sql = getSql();
  const token = randomHex();
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 864e5);
  await sql`
    INSERT INTO sessions (token_hash, member_email, expires_at, created_at)
    VALUES (${tokenHash}, ${email.toLowerCase()}, ${expiresAt.toISOString()}, ${createdAt.toISOString()})
  `;
  await sql`UPDATE members SET last_seen_at = ${createdAt.toISOString()} WHERE email = ${email.toLowerCase()}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export async function deleteCurrentSession() {
  await ensureAuthSchema();
  const sql = getSql();
  const token = parseCookie((await headers()).get("cookie"), SESSION_COOKIE);
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${await sha256(token)}`;
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function listMembers(): Promise<MemberRow[]> {
  await ensureAuthSchema();
  const sql = getSql();
  return await sql<MemberRow[]>`
    SELECT email, username, state_player_id AS "statePlayerId", display_name AS "displayName", avatar, initials, icon_colour AS "iconColour", role, active, joined_at AS "joinedAt"
    FROM members ORDER BY joined_at DESC
  `;
}
