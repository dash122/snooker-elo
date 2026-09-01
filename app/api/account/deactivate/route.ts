import { deactivateMember, getCurrentMember, listMembers } from "../../../../db/auth";
import { secureCookieAttribute } from "../../../../lib/auth-cookie";

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { currentPassword?: string; confirm?: string } | null;
  const currentPassword = String(body?.currentPassword ?? "");
  // The member types their username to confirm, so a stray click can't do this.
  if (String(body?.confirm ?? "").trim().toLowerCase() !== member.username) {
    return Response.json({ error: "confirm-mismatch", field: "confirm" }, { status: 400 });
  }
  // Typing the username is the only confirmation a Google-created account can
  // give — it has no password of its own.
  if (member.hasPassword !== false && !currentPassword) return Response.json({ error: "password-required", field: "currentPassword" }, { status: 400 });
  // Never let the last active admin lock everyone out of the admin panel.
  if (member.role === "admin") {
    const admins = (await listMembers()).filter(row => row.role === "admin" && row.active);
    if (admins.length <= 1) return Response.json({ error: "last-admin" }, { status: 409 });
  }

  const ok = await deactivateMember(member.email, currentPassword);
  if (!ok) return Response.json({ error: "password-wrong", field: "currentPassword" }, { status: 400 });
  // deactivateMember already dropped every session row; clear the stale cookie.
  return Response.json({ ok: true }, {
    headers: { "set-cookie": `scaa_session=; Path=/; HttpOnly${secureCookieAttribute()}; SameSite=Lax; Max-Age=0` },
  });
}
