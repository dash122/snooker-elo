import { requireMember } from "../../../db/auth";

const backend = process.env.STATE_BACKEND_URL ?? "https://scaa-snooker-elo.dchan98hk.chatgpt.site/api/state";

async function forward(request: Request, method: "GET" | "PUT" | "DELETE") {
  try {
    const response = await fetch(backend, {
      method,
      headers: method === "PUT" ? { "content-type": "application/json" } : undefined,
      body: method === "PUT" ? await request.text() : undefined,
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "storage unavailable" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return forward(request, "GET");
}

export async function PUT(request: Request) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return forward(request, "PUT");
}

export async function DELETE(request: Request) {
  const user = await requireMember("admin");
  if (!user) return Response.json({ error: "Admin access required" }, { status: 403 });
  return forward(request, "DELETE");
}
