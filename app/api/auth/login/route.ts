import { createSession, verifyCredentials } from "../../../../db/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const member = await verifyCredentials(username, password);
  if (!member) return Response.redirect(new URL("/login?error=invalid", request.url), 303);
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/account", request.url).toString(), "set-cookie": await createSession(member.email) },
  });
}
