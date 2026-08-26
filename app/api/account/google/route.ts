import { disconnectGoogleMember, getCurrentMember } from "../../../../db/auth";
import { checkAttempt } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (!checkAttempt(`google-disconnect:${member.email}`, 8, 5 * 60_000)) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as { currentPassword?: string } | null;
  const currentPassword = String(body?.currentPassword ?? "");
  if (member.hasPassword !== false && !currentPassword) return Response.json({ error: "password-required", field: "currentPassword" }, { status: 400 });

  const result = await disconnectGoogleMember(member.email, currentPassword);
  if (result === "password-wrong") return Response.json({ error: result, field: "currentPassword" }, { status: 400 });
  // Unlinking without a password would leave no way back in.
  if (result === "no-password") return Response.json({ error: result }, { status: 409 });
  if (result === "not-linked") return Response.json({ error: result }, { status: 409 });
  return Response.json({ ok: true });
}
