import { requireMember } from "../../../../db/auth";
import { deleteFeeSession, getFeeSession, updateFeeSession } from "../../../../db/fee-sessions";
import { sanitizeEntries, sanitizeTitle } from "../../../../lib/fee-session";

function storageError(error: unknown) {
  console.error("fee session storage error:", error);
  const message = error instanceof Error ? error.message : "storage unavailable";
  return Response.json({ error: message }, { status: 503 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const { id } = await params;
    const session = await getFeeSession(id);
    if (!session) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(session, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return storageError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const { id } = await params;
    const existing = await getFeeSession(id);
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
    if (user.role !== "admin" && existing.createdBy !== user.email) {
      return Response.json({ error: "Only the creator or an admin may edit this session" }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const entries = sanitizeEntries(body?.entries);
    if (!entries) return Response.json({ error: "Invalid entries" }, { status: 400 });
    const session = await updateFeeSession(id, { title: sanitizeTitle(body?.title), entries });
    if (!session) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(session);
  } catch (error) {
    return storageError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const { id } = await params;
    const existing = await getFeeSession(id);
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
    if (user.role !== "admin" && existing.createdBy !== user.email) {
      return Response.json({ error: "Only the creator or an admin may delete this session" }, { status: 403 });
    }
    await deleteFeeSession(id);
    return Response.json({ ok: true });
  } catch (error) {
    return storageError(error);
  }
}
