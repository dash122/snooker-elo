import postgres from "postgres";
import { headers } from "next/headers";
import type { MemberSession, MemberRow } from "./auth-types";

const SESSION_COOKIE = "scaa_session";
const SESSION_DAYS = 30;

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (!sqlClient) {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!url) {
      throw new Error(
        "No Postgres connection string found. Set POSTGRES_URL (Vercel's Supabase integration sets this automatically)."
      );
    }
    // Supabase's pooled connection runs pgbouncer in transaction mode, which
    // doesn't support named prepared statements — disable them.
    sqlClient = postgres(url, { ssl: "require", prepare: false });
  }
  return sqlClient;
}

let schemaReady: Promise<unknown> | null = null;
function ensureAuthSchema() {
  schemaReady ??= (async () => {
    const sql = getSql();
    await sql`
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
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY NOT NULL,
        member_email TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sessions_member_email_idx ON sessions (member_email)`;
    await sql`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)`;
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
    SELECT m.email, m.username, m.state_player_id AS "statePlayerId", m.display_name AS "displayName", m.role
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

export async function hasMembers() {
  await ensureAuthSchema();
  const sql = getSql();
  const rows = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM members`;
  return Number(rows[0]?.count ?? 0) > 0;
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
    SELECT email, username, state_player_id AS "statePlayerId", display_name AS "displayName", role, active, joined_at AS "joinedAt"
    FROM members ORDER BY joined_at DESC
  `;
}
