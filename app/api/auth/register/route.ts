import { signUpMember } from "../../../../db/signup";
import { checkAttempt } from "../../../../lib/rate-limit";
import { checkUsername, checkEmail, checkDisplayName, checkPassword } from "../../account/validate";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkAttempt(`register:${ip}`, 5, 15 * 60_000)) {
    return Response.redirect(new URL("/login?mode=signup&error=rate-limited", request.url), 303);
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const username = String(form.get("username") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (checkUsername(username) || checkEmail(email) || checkDisplayName(displayName) || checkPassword(password)) {
    return Response.redirect(new URL("/login?mode=signup&error=invalid", request.url), 303);
  }
  try {
    const result = await signUpMember({ username, email, displayName, password });
    return new Response(null, {
      status: 303,
      headers: { location: new URL("/onboarding", request.url).toString(), "set-cookie": result.cookie },
    });
  } catch (error) {
    console.error("registration error:", error);
    const code = (error as { code?: string } | null)?.code;
    const reason = code === "23505" ? "exists" : "error";
    return Response.redirect(new URL(`/login?mode=signup&error=${reason}`, request.url), 303);
  }
}
