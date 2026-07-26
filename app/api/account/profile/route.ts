import { getCurrentMember, updateProfile, verifyCredentials } from "../../../../db/auth";
import { checkAvatar, checkDisplayName, checkEmail, checkInitials, checkUsername } from "../validate";

type Body = { username?: string; email?: string; displayName?: string; avatar?: string | null; initials?: string | null; currentPassword?: string };

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

  const problem =
    (checkUsername(username) && { error: checkUsername(username)!, field: "username" }) ||
    (checkEmail(email) && { error: checkEmail(email)!, field: "email" }) ||
    (checkDisplayName(displayName) && { error: checkDisplayName(displayName)!, field: "displayName" }) ||
    (avatar !== undefined && checkAvatar(avatar) && { error: checkAvatar(avatar)!, field: "avatar" }) ||
    (initials !== undefined && checkInitials(initials) && { error: checkInitials(initials)!, field: "initials" });
  if (problem) return fail(problem.error, problem.field);

  // Changing the identifiers used to sign in requires proving ownership;
  // display name and avatar edits don't.
  const identityChanged = username.toLowerCase() !== member.username || email.toLowerCase() !== member.email;
  if (identityChanged) {
    const currentPassword = String(body.currentPassword ?? "");
    if (!currentPassword) return fail("password-required", "currentPassword");
    if (!await verifyCredentials(member.username, currentPassword)) return fail("password-wrong", "currentPassword");
  }

  const result = await updateProfile(member.email, { username, newEmail: email, displayName, avatar, initials });
  if (result === "username-taken") return fail("username-taken", "username", 409);
  if (result === "email-taken") return fail("email-taken", "email", 409);
  return Response.json({ ok: true });
}
