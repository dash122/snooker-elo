import { connectGoogleMember, createSession, getCurrentMember, resolveGoogleMember } from "../../../../../db/auth";
import { signInOrSignUpWithGoogle } from "../../../../../db/signup";
import { checkAttempt } from "../../../../../lib/rate-limit";

const STATE_COOKIE = "scaa_oauth_state";
const INTENT_COOKIE = "scaa_oauth_intent";
const clearStateCookie = `${STATE_COOKIE}=; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const clearIntentCookie = `${INTENT_COOKIE}=; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function parseCookie(cookieHeader: string | null, name: string) {
  const item = cookieHeader?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function fail(request: Request, error: string, intent = "login") {
  const destination = intent === "connect" ? `/account?google=${error}` : `/login?${intent === "signup" ? "mode=signup&" : ""}error=${error}`;
  return new Response(null, {
    status: 303,
    headers: [
      ["location", new URL(destination, request.url).toString()],
      ["set-cookie", clearStateCookie],
      ["set-cookie", clearIntentCookie],
    ],
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intent = parseCookie(request.headers.get("cookie"), INTENT_COOKIE) ?? "login";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkAttempt(`google-callback:${ip}`, 20, 5 * 60_000)) return fail(request, "rate-limited", intent);
  if (url.searchParams.get("error")) return fail(request, "cancelled", intent);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = parseCookie(request.headers.get("cookie"), STATE_COOKIE);
  if (!code || !state || !cookieState || state !== cookieState) return fail(request, "google-failed", intent);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "google-failed", intent);

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
  if (!tokenResponse.ok) return fail(request, "google-failed", intent);
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) return fail(request, "google-failed", intent);

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResponse.ok) return fail(request, "google-failed", intent);
  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!profile.sub || !profile.email) return fail(request, "google-failed", intent);
  if (!profile.email_verified) return fail(request, "google-unverified", intent);

  if (intent === "connect") {
    const member = await getCurrentMember();
    if (!member) return fail(request, "session-required", intent);
    const result = await connectGoogleMember(member.email, profile.sub);
    if (result === "google-in-use") return fail(request, "google-in-use", intent);
    return new Response(null, { status: 303, headers: [
      ["location", new URL(`/account?google=${result}`, request.url).toString()],
      ["set-cookie", clearStateCookie],
      ["set-cookie", clearIntentCookie],
    ] });
  }

  if (intent === "login") {
    const lookup = await resolveGoogleMember(profile.email, profile.sub);
    if (lookup.status === "not-found") return fail(request, "google-no-account", intent);
    if (lookup.status === "deactivated") return fail(request, "google-failed", intent);
    const sessionCookie = await createSession(lookup.email);
    return new Response(null, { status: 303, headers: [
      ["location", new URL("/", request.url).toString()],
      ["set-cookie", clearStateCookie],
      ["set-cookie", clearIntentCookie],
      ["set-cookie", sessionCookie],
    ] });
  }

  const outcome = await signInOrSignUpWithGoogle({ email: profile.email, displayName: profile.name ?? "", googleId: profile.sub });
  if (outcome.status === "deactivated") return fail(request, "google-failed");

  const sessionCookie = await createSession(outcome.email);
  const redirectTo = outcome.status === "created" ? "/onboarding" : "/";

  return new Response(null, {
    status: 303,
    headers: [
      ["location", new URL(redirectTo, request.url).toString()],
      ["set-cookie", clearStateCookie],
      ["set-cookie", clearIntentCookie],
      ["set-cookie", sessionCookie],
    ],
  });
}
