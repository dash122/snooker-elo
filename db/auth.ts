export type { MemberSession, MemberRow } from "./auth-types";

// Vercel deployments (with the Supabase Postgres integration) set POSTGRES_URL;
// Cloudflare Workers deployments don't, so they keep using D1. Each backend is
// a dynamic import so bundlers only need to resolve the one actually in use.
function backend() {
  return process.env.POSTGRES_URL ? import("./auth.pg") : import("./auth.d1");
}

export async function getCurrentMember() {
  return (await backend()).getCurrentMember();
}

export async function requireMember(role?: "admin") {
  return (await backend()).requireMember(role);
}

export async function verifyCredentials(username: string, password: string) {
  return (await backend()).verifyCredentials(username, password);
}

export async function createMember(username: string, email: string, displayName: string, password: string, role: "admin" | "member", statePlayerId?: string) {
  return (await backend()).createMember(username, email, displayName, password, role, statePlayerId);
}

export async function updateMember(email: string, input: { username?: string; newEmail?: string; password?: string; currentPassword?: string }) {
  return (await backend()).updateMember(email, input);
}

export async function hasMembers() {
  return (await backend()).hasMembers();
}
export async function createSession(email: string) {
  return (await backend()).createSession(email);
}

export async function deleteCurrentSession() {
  return (await backend()).deleteCurrentSession();
}

export async function listMembers() {
  return (await backend()).listMembers();
}
