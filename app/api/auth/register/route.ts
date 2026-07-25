import { signUpMember } from "../../../../db/signup";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const username = String(form.get("username") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (username.length < 2 || !email.includes("@") || displayName.length < 2 || password.length < 6) {
    return Response.redirect(new URL("/login?mode=signup&error=invalid", request.url), 303);
  }
  try {
    const result = await signUpMember({ username, email, displayName, password });
    return new Response(null, {
      status: 303,
      headers: { location: new URL("/", request.url).toString(), "set-cookie": result.cookie },
    });
  } catch (error) {
    console.error("registration error:", error);
    return Response.redirect(new URL("/login?mode=signup&error=exists", request.url), 303);
  }
}