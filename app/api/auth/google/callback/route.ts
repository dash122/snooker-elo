import { createSession } from "../../../../../db/auth";
import { signInOrSignUpWithGoogle } from "../../../../../db/signup";
import { checkAttempt } from "../../../../../lib/rate-limit";

const STATE_COOKIE = "scaa_oauth_state";
const clearStateCookie = `${STATE_COOKIE}=; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function parseCookie(cookieHeader: string | null, name: string) {
  const item = cookieHeader?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function fail(request: Request, error: string) {
  return new Response(null, {
    status: 303,
    headers: [
      ["location", new URL(`/login?error=${error}`, request.url).toString()],
      ["set-cookie", clearStateCookie],
    ],
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkAttempt(`google-callback:${ip}`, 20, 5 * 60_000)) return fail(request, "rate-limited");
  if (url.searchParams.get("error")) return fail(request, "google-failed");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = parseCookie(request.headers.get("cookie"), STATE_COOKIE);
  if (!code || !state || !cookieState || state !== cookieState) return fail(request, "google-failed");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "google-failed");

  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return fail(request, "google-failed");
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) return fail(request, "google-failed");

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResponse.ok) return fail(request, "google-failed");
  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!profile.sub || !profile.email) return fail(request, "google-failed");
  if (!profile.email_verified) return fail(request, "google-unverified");

  const outcome = await signInOrSignUpWithGoogle({ email: profile.email, displayName: profile.name ?? "", googleId: profile.sub });
  if (outcome.status === "deactivated") return fail(request, "google-failed");

  const sessionCookie = await createSession(outcome.email);
  const redirectTo = outcome.status === "created" ? "/login?welcome=1" : "/";

  return new Response(null, {
    status: 303,
    headers: [
      ["location", new URL(redirectTo, request.url).toString()],
      ["set-cookie", clearStateCookie],
      ["set-cookie", sessionCookie],
    ],
  });
}