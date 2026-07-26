import { createSession, verifyCredentials } from "../../../../db/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const member = await verifyCredentials(username, password);
  if (!member) return Response.redirect(new URL("/login?error=invalid", request.url), 303);
  return new Response(null, {
    status: 303,
    // Land on the leaderboard: signing in is a step towards looking at the
    // club table or logging a match, not an errand about the account itself.
    headers: { location: new URL("/", request.url).toString(), "set-cookie": await createSession(member.email) },
  });
}
