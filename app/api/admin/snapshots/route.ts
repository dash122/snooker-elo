import { requireMember } from "../../../../db/auth";
import { restoreSnapshot } from "../../../../db/state";

export async function POST(request: Request) {
  const admin = await requireMember("admin");
  if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const form = await request.formData();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return Response.redirect(new URL("/admin?error=invalid", request.url), 303);
  try { await restoreSnapshot(id); }
  catch { return Response.redirect(new URL("/admin?error=invalid", request.url), 303); }
  return Response.redirect(new URL("/admin?restored=1", request.url), 303);
}
