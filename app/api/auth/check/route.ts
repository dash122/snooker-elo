import { checkSignupAvailability } from "../../../../db/auth";
import { checkAttempt } from "../../../../lib/rate-limit";
import { checkUsername, checkEmail } from "../../account/validate";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkAttempt(`check:${ip}`)) return Response.json({ error: "rate-limited" }, { status: 429 });

  const url = new URL(request.url);
  const username = (url.searchParams.get("username") ?? "").trim();
  const email = (url.searchParams.get("email") ?? "").trim();

  const usernameValid = username ? !checkUsername(username) : false;
  const emailValid = email ? !checkEmail(email) : false;
  if (!usernameValid && !emailValid) return Response.json({ usernameTaken: false, emailTaken: false });

  const result = await checkSignupAvailability(usernameValid ? username : null, emailValid ? email : null);
  return Response.json({
    usernameTaken: usernameValid && result.usernameTaken,
    emailTaken: emailValid && result.emailTaken,
  });
}
