import { env } from "cloudflare:workers";
import { headers } from "next/headers";

export type MemberSession = {
  email: string;
  displayName: string;
  role: "admin" | "member";
};

const SESSION_COOKIE = "scaa_session";
const SESSION_DAYS = 30;

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
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: 210_000 },
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
  const token = parseCookie((await headers()).get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  return await env.DB.prepare(`
    SELECT m.email, m.display_name AS displayName, m.role
    FROM sessions s JOIN members m ON m.email = s.member_email
    WHERE s.token_hash = ? AND s.expires_at > ? AND m.active = 1
  `).bind(tokenHash, now).first() as MemberSession | null;
}

export async function requireMember(role?: "admin") {
  const member = await getCurrentMember();
  if (!member || (role && member.role !== role)) return null;
  return member;
}

export async function verifyCredentials(email: string, password: string) {
  const row = await env.DB.prepare(`
    SELECT email, display_name AS displayName, role, password_hash AS passwordHash, password_salt AS passwordSalt
    FROM members WHERE email = ? AND active = 1
  `).bind(email.toLowerCase()).first() as (MemberSession & { passwordHash: string; passwordSalt: string }) | null;
  if (!row || await passwordDigest(password, row.passwordSalt) !== row.passwordHash) return null;
  return row;
}

export async function createMember(email: string, displayName: string, password: string, role: "admin" | "member") {
  const normalizedEmail = email.trim().toLowerCase();
  const salt = randomHex(16);
  const hash = await passwordDigest(password, salt);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO members (email, display_name, role, password_hash, password_salt, active, joined_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).bind(normalizedEmail, displayName.trim(), role, hash, salt, now, now).run();
}

export async function hasMembers() {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first() as { count: number } | null;
  return Number(row?.count ?? 0) > 0;
}

export async function createSession(email: string) {
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
  const token = parseCookie((await headers()).get("cookie"), SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
