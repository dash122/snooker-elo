// Resolved dynamically (with webpackIgnore) so bundlers that don't target
// Cloudflare Workers — e.g. Vercel's Next.js build — never try to statically
// resolve this Workers-only specifier.
async function cfEnv(): Promise<{ DB: any }> {
  const mod: any = await import(/* webpackIgnore: true */ "cloudflare:workers");
  return mod.env;
}

let schemaReady: Promise<unknown> | null = null;
function ensureStateSchema() {
  schemaReady ??= (async () => {
    const env = await cfEnv();
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();
  })().catch((error: unknown) => { schemaReady = null; throw error; });
  return schemaReady;
}

export async function getState(): Promise<string | null> {
  await ensureStateSchema();
  const env = await cfEnv();
  const row = await env.DB.prepare("SELECT data FROM app_state WHERE id = 1").first() as { data: string } | null;
  return row?.data ?? null;
}

export async function putState(data: string) {
  await ensureStateSchema();
  const env = await cfEnv();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).bind(data, now).run();
}

export async function deleteState() {
  await ensureStateSchema();
  const env = await cfEnv();
  await env.DB.prepare("DELETE FROM app_state WHERE id = 1").run();
}
