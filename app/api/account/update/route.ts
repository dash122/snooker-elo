import { createSession, getCurrentMember, updateMember } from "../../../../db/auth";

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.redirect(new URL("/login", request.url), 303);
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const newEmail = String(form.get("email") ?? "").trim();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const password = String(form.get("password") ?? "");
  if (!username || !newEmail.includes("@") || currentPassword.length < 6 || (password && password.length < 6)) {
    return Response.redirect(new URL("/account?error=invalid", request.url), 303);
  }
  const ok = await updateMember(member.email, { username, newEmail, password: password || undefined, currentPassword });
  if (!ok) return Response.redirect(new URL("/account?error=invalid", request.url), 303);
  return new Response(null, { status: 303, headers: { location: new URL("/account?updated=1", request.url).toString(), "set-cookie": await createSession(newEmail) } });
}
