import { createSession, verifyCredentials } from "../../../../db/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const member = await verifyCredentials(email, password);
  if (!member) return Response.redirect(new URL("/login?error=invalid", request.url), 303);
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/account", request.url).toString(), "set-cookie": await createSession(member.email) },
  });
}
