import { createMember, createSession, hasMembers } from "../../../../db/auth";

export async function POST(request: Request) {
  if (await hasMembers()) return Response.redirect(new URL("/login", request.url), 303);
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email.includes("@") || displayName.length < 2 || password.length < 6) {
    return Response.redirect(new URL("/register?error=invalid", request.url), 303);
  }
  await createMember(email, displayName, password, "admin");
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/account", request.url).toString(), "set-cookie": await createSession(email) },
  });
}
