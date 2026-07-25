import { createMember, requireMember } from "../../../../db/auth";

export async function POST(request: Request) {
  if (!await requireMember("admin")) return Response.json({ error: "Admin access required" }, { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const username = String(form.get("username") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const role = form.get("role") === "admin" ? "admin" : "member";
  if (!username || !email.includes("@") || displayName.length < 2 || password.length < 6) {
    return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
  }
  try {
    await createMember(username, email, displayName, password, role);
  } catch {
    return Response.redirect(new URL("/admin?error=exists", request.url), 303);
  }
  return Response.redirect(new URL("/admin?created=1", request.url), 303);
}
