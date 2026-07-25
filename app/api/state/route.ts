import { requireMember } from "../../../db/auth";

const defaultState = {
  players: [],
  matches: [],
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature: 1.25, handicapSoftCap: 800, winnerBonus: .5, overHandicapBoost: .75, overHandicapScale: 200, modelVersion: 3 },
  audits: [],
};

// Resolved dynamically (with webpackIgnore) so bundlers that don't target
// Cloudflare Workers — e.g. Vercel's Next.js build — never try to statically
// resolve this Workers-only specifier.
async function cfEnv(): Promise<{ DB: any }> {
  const mod: any = await import(/* webpackIgnore: true */ "cloudflare:workers");
  return mod.env;
}

let stateSchemaReady: Promise<unknown> | null = null;
function ensureStateSchema() {
  stateSchemaReady ??= (async () => {
    const env = await cfEnv();
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();
  })().catch((error: unknown) => { stateSchemaReady = null; throw error; });
  return stateSchemaReady;
}

export async function GET() {
  try {
    await ensureStateSchema();
    const env = await cfEnv();
    const row = await env.DB.prepare("SELECT data FROM app_state WHERE id = 1").first() as { data: string } | null;
    return Response.json(row ? JSON.parse(row.data) : defaultState, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "storage unavailable" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    await ensureStateSchema();
    const env = await cfEnv();
    const data = await request.text();
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).bind(data, now).run();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "storage unavailable" }, { status: 503 });
  }
}

export async function DELETE() {
  const user = await requireMember("admin");
  if (!user) return Response.json({ error: "Admin access required" }, { status: 403 });
  try {
    await ensureStateSchema();
    const env = await cfEnv();
    await env.DB.prepare("DELETE FROM app_state WHERE id = 1").run();
    return Response.json(defaultState);
  } catch {
    return Response.json({ error: "storage unavailable" }, { status: 503 });
  }
}
