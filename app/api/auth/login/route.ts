import { createSession, verifyCredentials } from "../../../../db/auth";
import { checkAttempt } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkAttempt(`login:${ip}`, 10, 5 * 60_000)) {
    return Response.redirect(new URL("/login?error=rate-limited", request.url), 303);
  }

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
