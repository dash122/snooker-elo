import { getCurrentMember, updateMember } from "../../../../db/auth";
import { checkPassword } from "../validate";

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { currentPassword?: string; password?: string } | null;
  const currentPassword = String(body?.currentPassword ?? "");
  const password = String(body?.password ?? "");
  // A Google-created account is setting its first password, so there is no
  // current one to ask for; updateMember accepts the session as proof.
  const settingFirstPassword = member.hasPassword === false;
  if (checkPassword(password)) return Response.json({ error: "password-short", field: "password" }, { status: 400 });
  if (!settingFirstPassword && !currentPassword) return Response.json({ error: "password-required", field: "currentPassword" }, { status: 400 });
  if (!settingFirstPassword && password === currentPassword) return Response.json({ error: "password-same", field: "password" }, { status: 400 });

  const ok = await updateMember(member.email, { password, currentPassword });
  if (!ok) return Response.json({ error: "password-wrong", field: "currentPassword" }, { status: 400 });
  return Response.json({ ok: true });
}
