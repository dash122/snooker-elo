import { createSession, needsOnboarding, verifyCredentials } from "../../../../db/auth";
import { isBlocked, recordFailure } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `login:${ip}`;
  if (isBlocked(key, 10, 5 * 60_000)) {
    return Response.redirect(new URL("/login?error=rate-limited", request.url), 303);
  }

  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const member = await verifyCredentials(username, password);
  // Only wrong-password attempts count against the shared IP budget — a
  // correct login shouldn't cost the next member behind the same IP their
  // chance to sign in.
  if (!member) {
    recordFailure(key, 5 * 60_000);
    return Response.redirect(new URL("/login?error=invalid", request.url), 303);
  }
  const cookie = await createSession(member.email);
  const promptOnboarding = await needsOnboarding(member.email);
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(promptOnboarding ? "/onboarding?reminder=1" : "/", request.url).toString(),
      "set-cookie": cookie,
    },
  });
}
