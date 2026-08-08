import { requireMember } from "../../../db/auth";
import { createFeeSession, listFeeSessions } from "../../../db/fee-sessions";
import { sanitizeEntries, sanitizeTitle } from "../../../lib/fee-session";

function storageError(error: unknown) {
  console.error("fee session storage error:", error);
  const message = error instanceof Error ? error.message : "storage unavailable";
  return Response.json({ error: message }, { status: 503 });
}

export async function GET() {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    return Response.json(await listFeeSessions(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return storageError(error);
  }
}

export async function POST(request: Request) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const entries = sanitizeEntries(body?.entries);
    if (!entries) return Response.json({ error: "Invalid entries" }, { status: 400 });
    const session = await createFeeSession({
      title: sanitizeTitle(body?.title),
      entries,
      createdBy: user.email,
      createdByName: user.displayName,
    });
    return Response.json(session);
  } catch (error) {
    return storageError(error);
  }
}
