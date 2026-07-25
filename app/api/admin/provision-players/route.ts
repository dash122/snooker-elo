import { provisionPlayerAccounts, requireMember } from "../../../../db/auth";

export async function POST(request: Request) {
  if (!await requireMember("admin")) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const result = await provisionPlayerAccounts();
  return Response.redirect(new URL(`/admin?provisioned=${result.created}`, request.url), 303);
}
