import { checkAttempt } from "../../../../lib/rate-limit";

const SCOPE = "openid email profile";
const STATE_COOKIE = "scaa_oauth_state";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkAttempt(`google-start:${ip}`, 20, 5 * 60_000)) {
    return Response.redirect(new URL("/login?error=rate-limited", request.url), 303);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.redirect(new URL("/login?error=google-failed", request.url), 303);
  }

  const state = crypto.randomUUID();
  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  return new Response(null, {
    status: 303,
    headers: [
      ["location", authUrl.toString()],
      ["set-cookie", `${STATE_COOKIE}=${state}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`],
    ],
  });
}