import postgres from "postgres";

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (!sqlClient) {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!url) {
      throw new Error(
        "No Postgres connection string found. Set POSTGRES_URL (Vercel's Supabase integration sets this automatically)."
      );
    }
    // Supabase's pooled connection runs pgbouncer in transaction mode, which
    // doesn't support named prepared statements — disable them.
    sqlClient = postgres(url, { ssl: "require", prepare: false });
  }
  return sqlClient;
}

let schemaReady: Promise<unknown> | null = null;
function ensureStateSchema() {
  schemaReady ??= (async () => {
    const sql = getSql();
    await sql`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
  })().catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export async function getState(): Promise<string | null> {
  await ensureStateSchema();
  const sql = getSql();
  const rows = await sql<{ data: string }[]>`SELECT data FROM app_state WHERE id = 1`;
  return rows[0]?.data ?? null;
}

export async function putState(data: string) {
  await ensureStateSchema();
  const sql = getSql();
  const now = new Date().toISOString();
  await sql`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ${data}, ${now})
    ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `;
}

export async function deleteState() {
  await ensureStateSchema();
  const sql = getSql();
  await sql`DELETE FROM app_state WHERE id = 1`;
}
