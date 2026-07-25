import { getState } from "./state";
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

export async function hasMembers() {
  return (await backend()).hasMembers();
}


export async function provisionPlayerAccounts() {
  const raw = await getState();
  if (!raw) return { created: 0, skipped: 0 };
  const state = JSON.parse(raw) as {
    players?: { id: string; name: string }[];
    matches?: { a: string; b: string; status?: string }[];
  };
  const matched = new Set(
    (state.matches ?? [])
      .filter(match => match.status !== "void")
      .flatMap(match => [match.a, match.b]),
  );
  const members = await listMembers();
  const linked = new Set(members.map(member => member.statePlayerId).filter(Boolean));
  const usernames = new Set(members.map(member => member.username));
  let created = 0;
  let skipped = 0;
  for (const player of state.players ?? []) {
    if (!matched.has(player.id) || linked.has(player.id)) continue;
    const username = player.name.toLowerCase().replace(/\s+/g, "");
    if (!username || usernames.has(username)) { skipped++; continue; }
    try {
      await createMember(username, `${username}@players.local`, player.name, username, "member", player.id);
      linked.add(player.id);
      usernames.add(username);
      created++;
    } catch {
      skipped++;
    }
  }
  return { created, skipped };
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
