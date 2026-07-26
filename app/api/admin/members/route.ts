import { adminUpdateMember, createMember, listMembers, requireMember } from "../../../../db/auth";
import { getState, putState } from "../../../../db/state";

type State = { players?: any[]; matches?: any[]; settings?: { start?: number }; audits?: any[]; [key: string]: unknown };

function playerFor(displayName: string, start: number) {
  return { id: crypto.randomUUID(), name: displayName, short: Array.from(displayName).slice(0, 3).join("").toUpperCase(), colour: "#52796f", handicap: null, rating: start, initialRating: start, active: true, wins: 0, losses: 0, draws: 0, framesWon: 0, framesLost: 0, lastChange: 0, form: [] };
}

async function loadState(): Promise<State> {
  const raw = await getState();
  return raw ? JSON.parse(raw) : { players: [], matches: [], settings: { start: 1500 }, audits: [] };
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
  if (!await requireMember("admin")) return Response.json({ error: "Admin access required" }, { status: 403 });
  const form = await request.formData();
  if (form.get("action") === "backfill") {
    try { await backfillPlayerLinks(); } catch { return Response.redirect(new URL("/admin?error=invalid", request.url), 303); }
    return Response.redirect(new URL("/admin?linked=1", request.url), 303);
  }
  const email = String(form.get("email") ?? "").trim();
  if (form.get("action") === "link") {
    const originalEmail = String(form.get("originalEmail") ?? "").trim();
    const statePlayerId = String(form.get("statePlayerId") ?? "").trim();
    if (!originalEmail || !statePlayerId) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    const members = await listMembers();
    const member = members.find(m => m.email === originalEmail);
    if (!member) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    try { await adminUpdateMember(originalEmail, { username: member.username, newEmail: member.email, displayName: member.displayName, statePlayerId }); } catch { return Response.redirect(new URL("/admin?error=exists", request.url), 303); }
    return Response.redirect(new URL(`/admin?linked=1&who=${encodeURIComponent(member.displayName)}`, request.url), 303);
  }
  if (form.get("action") === "update") {
    const password = String(form.get("password") ?? "");
    const statePlayerId = String(form.get("statePlayerId") ?? "");
    const displayName = String(form.get("displayName") ?? "").trim();
    const username = String(form.get("username") ?? "").trim();
    if (!username || !email.includes("@") || displayName.length < 2 || (password && password.length < 6)) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
    try { await adminUpdateMember(String(form.get("originalEmail") ?? email), { username, newEmail: email, displayName, password: password || undefined, statePlayerId: statePlayerId || null }); } catch { return Response.redirect(new URL("/admin?error=exists", request.url), 303); }
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
      if (!(state.players ?? []).some(player => player.id === existingPlayerId)) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
      await createMember(username, email, displayName, password, role, existingPlayerId);
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