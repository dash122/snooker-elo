import { getCurrentMember, updateProfile, verifyCredentials } from "../../../../db/auth";
import { getState, putState } from "../../../../db/state";
import { checkColour } from "../../../avatar-colours";
import { checkAvatar, checkDisplayName, checkEmail, checkInitials, checkUsername, deriveInitials } from "../validate";

type Body = { username?: string; email?: string; displayName?: string; avatar?: string | null; initials?: string | null; iconColour?: string | null; currentPassword?: string };

/**
 * Push the badge a member just chose onto their linked player, so the
 * leaderboard, player cards, break rankings and head-to-head all render it.
 * Those views read the public state payload and nothing else, so the state row
 * — not the member row — is what makes the change visible everywhere.
 */
async function syncPlayerBadge(playerId: string, badge: { short?: string; colour?: string | null; avatar?: string | null }) {
  const raw = await getState();
  if (!raw) return;
  const state = JSON.parse(raw) as { players?: Record<string, unknown>[] };
  const player = state.players?.find(item => item.id === playerId);
  if (!player) return;
  if (badge.short !== undefined) player.short = badge.short;
  if (badge.colour !== undefined) player.colour = badge.colour;
  if (badge.avatar !== undefined) player.avatar = badge.avatar;
  await putState(JSON.stringify(state));
}

function fail(error: string, field?: string, status = 400) {
  return Response.json({ error, field }, { status });
}

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return fail("unauthorized", undefined, 401);

  const body = await request.json().catch(() => null) as Body | null;
  if (!body) return fail("bad-request");
  const username = String(body.username ?? "").trim();
  const email = String(body.email ?? "").trim();
  const displayName = String(body.displayName ?? "").trim();
  // undefined = leave the stored value alone, null = remove it.
  const avatar = body.avatar === undefined ? undefined : (body.avatar || null);
  const initials = body.initials === undefined ? undefined : (String(body.initials).trim().toUpperCase() || null);
  const iconColour = body.iconColour === undefined ? undefined : (body.iconColour || null);

  const problem =
    (checkUsername(username) && { error: checkUsername(username)!, field: "username" }) ||
    (checkEmail(email) && { error: checkEmail(email)!, field: "email" }) ||
    (checkDisplayName(displayName) && { error: checkDisplayName(displayName)!, field: "displayName" }) ||
    (avatar !== undefined && checkAvatar(avatar) && { error: checkAvatar(avatar)!, field: "avatar" }) ||
    (initials !== undefined && checkInitials(initials) && { error: checkInitials(initials)!, field: "initials" }) ||
    (iconColour !== undefined && checkColour(iconColour) && { error: checkColour(iconColour)!, field: "iconColour" });
  if (problem) return fail(problem.error, problem.field);

  // Changing the identifiers used to sign in requires proving ownership;
  // display name and avatar edits don't.
  const identityChanged = username.toLowerCase() !== member.username || email.toLowerCase() !== member.email;
  if (identityChanged) {
    const currentPassword = String(body.currentPassword ?? "");
    if (!currentPassword) return fail("password-required", "currentPassword");
    if (!await verifyCredentials(member.username, currentPassword)) return fail("password-wrong", "currentPassword");
  }

  const result = await updateProfile(member.email, { username, newEmail: email, displayName, avatar, initials, iconColour });
  if (result === "username-taken") return fail("username-taken", "username", 409);
  if (result === "email-taken") return fail("email-taken", "email", 409);

  if (member.statePlayerId) {
    // A cleared initials box means "go back to the derived initials" rather
    // than an empty badge, so the leaderboard never shows a blank chip.
    await syncPlayerBadge(member.statePlayerId, {
      ...(initials !== undefined ? { short: initials || deriveInitials(displayName) } : {}),
      ...(iconColour !== undefined ? { colour: iconColour } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    });
  }
  return Response.json({ ok: true });
}
