import { headers } from "next/headers";
import type { MemberSession, MemberRow } from "./auth-types";

const SESSION_COOKIE = "scaa_session";
const SESSION_DAYS = 30;
let schemaReady: Promise<unknown> | null = null;

// Resolved dynamically (with webpackIgnore) so bundlers that don't target
// Cloudflare Workers — e.g. Vercel's Next.js build — never try to statically
// resolve this Workers-only specifier.
async function cfEnv(): Promise<{ DB: any }> {
  const mod: any = await import(/* webpackIgnore: true */ "cloudflare:workers");
  return mod.env;
}

function ensureAuthSchema() {
  schemaReady ??= (async () => {
    const env = await cfEnv();
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS members (
          email TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL UNIQUE,
          state_player_id TEXT UNIQUE,
          display_name TEXT NOT NULL,
          role TEXT DEFAULT 'member' NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          active INTEGER DEFAULT 1 NOT NULL,
          joined_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY NOT NULL,
          member_email TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS sessions_member_email_idx
        ON sessions (member_email)
      `),
      env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
        ON sessions (expires_at)
      `),
    ]);
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
    // Cloudflare Workers Web Crypto supports PBKDF2 iteration counts up to 100,000.
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
  const env = await cfEnv();
  return await env.DB.prepare(`
    SELECT m.email, m.username, m.display_name AS displayName, m.role
    FROM sessions s JOIN members m ON m.email = s.member_email
    WHERE s.token_hash = ? AND s.expires_at > ? AND m.active = 1
  `).bind(tokenHash, now).first() as MemberSession | null;
}

export async function requireMember(role?: "admin") {
  const member = await getCurrentMember();
  if (!member || (role && member.role !== role)) return null;
  return member;
}

export async function verifyCredentials(username: string, password: string) {
  await ensureAuthSchema();
  const env = await cfEnv();
  const row = await env.DB.prepare(`
    SELECT email, display_name AS displayName, role, password_hash AS passwordHash, password_salt AS passwordSalt
    FROM members WHERE username = ? AND active = 1
  `).bind(username.trim().toLowerCase()).first() as (MemberSession & { passwordHash: string; passwordSalt: string }) | null;
  if (!row || await passwordDigest(password, row.passwordSalt) !== row.passwordHash) return null;
  return row;
}

export async function createMember(username: string, email: string, displayName: string, password: string, role: "admin" | "member", statePlayerId?: string) {
  await ensureAuthSchema();
  const env = await cfEnv();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim().toLowerCase();
  const salt = randomHex(16);
  const hash = await passwordDigest(password, salt);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO members (email, username, state_player_id, display_name, role, password_hash, password_salt, active, joined_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).bind(normalizedEmail, normalizedUsername, statePlayerId ?? null, displayName.trim(), role, hash, salt, now, now).run();
}

export async function adminUpdateMember(email: string, input: { username: string; newEmail: string; displayName: string; password?: string; statePlayerId?: string | null }) {
  await ensureAuthSchema();
  const env = await cfEnv();
  const oldEmail = email.trim().toLowerCase();
  const newEmail = input.newEmail.trim().toLowerCase();
  if (input.password) {
    const salt = randomHex(16);
    const hash = await passwordDigest(input.password, salt);
    await env.DB.prepare("UPDATE members SET username = ?, email = ?, display_name = ?, state_player_id = ?, password_hash = ?, password_salt = ? WHERE email = ?")
      .bind(input.username.trim().toLowerCase(), newEmail, input.displayName.trim(), input.statePlayerId || null, hash, salt, oldEmail).run();
  } else {
    await env.DB.prepare("UPDATE members SET username = ?, email = ?, display_name = ?, state_player_id = ? WHERE email = ?")
      .bind(input.username.trim().toLowerCase(), newEmail, input.displayName.trim(), input.statePlayerId || null, oldEmail).run();
  }
  if (oldEmail !== newEmail) await env.DB.prepare("UPDATE sessions SET member_email = ? WHERE member_email = ?").bind(newEmail, oldEmail).run();
  return true;
}
export async function hasMembers() {
  await ensureAuthSchema();
  const env = await cfEnv();
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first() as { count: number } | null;
  return Number(row?.count ?? 0) > 0;
}

export async function updateMember(email: string, input: { username?: string; newEmail?: string; password?: string; currentPassword?: string }) {
  await ensureAuthSchema();
  const env = await cfEnv();
  const row = await env.DB.prepare("SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM members WHERE email = ?")
    .bind(email.toLowerCase()).first() as { passwordHash: string; passwordSalt: string } | null;
  if (!row || !input.currentPassword || await passwordDigest(input.currentPassword, row.passwordSalt) !== row.passwordHash) return false;
  const username = input.username?.trim().toLowerCase();
  const newEmail = input.newEmail?.trim().toLowerCase();
  if (input.password) {
    const salt = randomHex(16);
    const hash = await passwordDigest(input.password, salt);
    await env.DB.prepare("UPDATE members SET username = COALESCE(?, username), email = COALESCE(?, email), password_hash = ?, password_salt = ? WHERE email = ?")
      .bind(username || null, newEmail || null, hash, salt, email.toLowerCase()).run();
  } else {
    await env.DB.prepare("UPDATE members SET username = COALESCE(?, username), email = COALESCE(?, email) WHERE email = ?")
      .bind(username || null, newEmail || null, email.toLowerCase()).run();
  }
  return true;
}
export async function createSession(email: string) {
  await ensureAuthSchema();
  const env = await cfEnv();
  const token = randomHex();
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 864e5);
  await env.DB.prepare(`
    INSERT INTO sessions (token_hash, member_email, expires_at, created_at) VALUES (?, ?, ?, ?)
  `).bind(tokenHash, email.toLowerCase(), expiresAt.toISOString(), createdAt.toISOString()).run();
  await env.DB.prepare("UPDATE members SET last_seen_at = ? WHERE email = ?")
    .bind(createdAt.toISOString(), email.toLowerCase()).run();
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export async function deleteCurrentSession() {
  await ensureAuthSchema();
  const env = await cfEnv();
  const token = parseCookie((await headers()).get("cookie"), SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function listMembers(): Promise<MemberRow[]> {
  await ensureAuthSchema();
  const env = await cfEnv();
  const result = await env.DB.prepare(`
    SELECT email, username, state_player_id AS statePlayerId, display_name AS displayName, role, active, joined_at AS joinedAt
    FROM members ORDER BY joined_at DESC
  `).all() as { results: (Omit<MemberRow, "active"> & { active: number })[] };
  return result.results.map(row => ({ ...row, active: Boolean(row.active) }));
}
