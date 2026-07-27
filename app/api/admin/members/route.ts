import { adminUpdateMember, createMember, deleteMember, listMembers, requireMember } from "../../../../db/auth";
import { getState, putState } from "../../../../db/state";
import { DEFAULT_AVATAR } from "../../../avatar-colours";

type State = { players?: any[]; matches?: any[]; settings?: { start?: number }; audits?: any[]; [key: string]: unknown };

function playerFor(displayName: string, start: number) {
  return { id: crypto.randomUUID(), name: displayName, short: Array.from(displayName).slice(0, 3).join("").toUpperCase(), colour: DEFAULT_AVATAR, handicap: null, rating: start, initialRating: start, active: true, wins: 0, losses: 0, draws: 0, framesWon: 0, framesLost: 0, lastChange: 0, form: [] };
}

async function loadState(): Promise<State> {
  const raw = await getState();
  return raw ? JSON.parse(raw) : { players: [], matches: [], settings: { start: 1500 }, audits: [] };
}

// Keeps the leaderboard name in step when an admin edits a linked member's
// display name — otherwise the account and the leaderboard show two names
// for the same person until someone happens to re-save the player profile.
async function syncPlayerName(playerId: string, name: string) {
  const state = await loadState();
  const player = (state.players ?? []).find(item => item.id === playerId);
  if (!player || player.name === name) return;
  player.name = name;
  await putState(JSON.stringify(state));
}

async function backfillPlayerLinks() {
  const [members, state] = await Promise.all([listMembers(), loadState()]);
  const linked = new Set((state.players ?? []).map(player => player.id));
  const missing = members.filter(member => member.active && (!member.statePlayerId || !linked.has(member.statePlayerId)));
  if (!missing.length) return 0;
  const start = Number(state.settings?.start ?? 1500), createdAt = new Date().toISOString();
  const players = missing.map(member => playerFor(member.displayName, start));
  await putState(JSON.stringify({ ...state, players: [...(state.players ?? []), ...players], matches: state.matches ?? [], audits: [{ id: crypto.randomUUID(), text: `Linked ${players.length} existing member account(s) to player profiles`, at: createdAt }, ...(state.audits ?? [])] }));
  for (let index = 0; index < missing.length; index++) {
    const member = missing[index], player = players[index];
    await adminUpdateMember(member.email, { username: member.username, newEmail: member.email, displayName: member.displayName, statePlayerId: player.id });
  }
  return players.length;
}

export async function POST(request: Request) {
  const admin = await requireMember("admin");
  if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const form = await request.formData();
  if (form.get("action") === "delete") {
    const originalEmail = String(form.get("originalEmail") ?? "").trim().toLowerCase();
    if (!originalEmail) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    if (originalEmail === admin.email.toLowerCase()) return Response.redirect(new URL("/admin?error=self-delete", request.url), 303);
    const members = await listMembers();
    const target = members.find(m => m.email.toLowerCase() === originalEmail);
    if (!target) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    if (target.role === "admin" && members.filter(m => m.role === "admin" && m.active).length <= 1) {
      return Response.redirect(new URL("/admin?error=last-admin", request.url), 303);
    }
    try { await deleteMember(originalEmail); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      return Response.redirect(new URL(`/admin?error=${message === "has-matches" ? "has-matches" : "invalid"}`, request.url), 303);
    }
    return Response.redirect(new URL(`/admin?deleted=1&who=${encodeURIComponent(target.displayName)}`, request.url), 303);
  }
  if (form.get("action") === "backfill") {
    try { await backfillPlayerLinks(); } catch { return Response.redirect(new URL("/admin?error=invalid", request.url), 303); }
    return Response.redirect(new URL("/admin?linked=1", request.url), 303);
  }
  const email = String(form.get("email") ?? "").trim();
  if (form.get("action") === "link") {
    const originalEmail = String(form.get("originalEmail") ?? "").trim();
    const statePlayerId = String(form.get("statePlayerId") ?? "").trim();
    if (!originalEmail || !statePlayerId) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    const [members, state] = await Promise.all([listMembers(), loadState()]);
    const member = members.find(m => m.email === originalEmail);
    const linkedPlayer = (state.players ?? []).find(player => player.id === statePlayerId);
    if (!member || !linkedPlayer) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    // Same reasoning as the create flow: the player already has an
    // established leaderboard name, so linking adopts it onto the account.
    try { await adminUpdateMember(originalEmail, { username: member.username, newEmail: member.email, displayName: linkedPlayer.name, statePlayerId }); } catch { return Response.redirect(new URL("/admin?error=exists", request.url), 303); }
    return Response.redirect(new URL(`/admin?linked=1&who=${encodeURIComponent(linkedPlayer.name)}`, request.url), 303);
  }
  if (form.get("action") === "update") {
    const password = String(form.get("password") ?? "");
    const statePlayerId = String(form.get("statePlayerId") ?? "");
    const displayName = String(form.get("displayName") ?? "").trim();
    const username = String(form.get("username") ?? "").trim();
    if (!username || !email.includes("@") || displayName.length < 2 || (password && password.length < 6)) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    try { await adminUpdateMember(String(form.get("originalEmail") ?? email), { username, newEmail: email, displayName, password: password || undefined, statePlayerId: statePlayerId || null }); } catch { return Response.redirect(new URL("/admin?error=exists", request.url), 303); }
    if (statePlayerId) await syncPlayerName(statePlayerId, displayName);
    return Response.redirect(new URL(`/admin?updated=1&who=${encodeURIComponent(displayName)}`, request.url), 303);
  }
  const username = String(form.get("username") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const role = form.get("role") === "admin" ? "admin" : "member";
  const existingPlayerId = String(form.get("statePlayerId") ?? "").trim();
  if (!username || !email.includes("@") || displayName.length < 2 || password.length < 6) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
  try {
    const state = await loadState();
    if (existingPlayerId) {
      const existingPlayer = (state.players ?? []).find(player => player.id === existingPlayerId);
      if (!existingPlayer) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
      // The player is already established on the leaderboard, so its name is
      // canonical — the new account takes it rather than whatever was typed
      // into the form, so the two never disagree from the start.
      await createMember(username, email, existingPlayer.name, password, role, existingPlayerId);
    } else {
      const player = playerFor(displayName, Number(state.settings?.start ?? 1500));
      await putState(JSON.stringify({ ...state, players: [...(state.players ?? []), player], matches: state.matches ?? [], audits: [{ id: crypto.randomUUID(), text: `Created member account and player profile: ${player.name}`, at: new Date().toISOString() }, ...(state.audits ?? [])] }));
      await createMember(username, email, displayName, password, role, player.id);
    }
  } catch {
    return Response.redirect(new URL("/admin?error=exists", request.url), 303);
  }
  return Response.redirect(new URL(`/admin?created=1&who=${encodeURIComponent(displayName)}`, request.url), 303);
}