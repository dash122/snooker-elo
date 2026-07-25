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
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  const rows = await sql<{ data: unknown }[]>`SELECT data FROM app_state WHERE id = 1`;
  const value = rows[0]?.data;
  return value == null ? null : typeof value === "string" ? value : JSON.stringify(value);
}

export async function putState(data: string) {
  await ensureStateSchema();
  const sql = getSql();
  const parsed = JSON.parse(data) as any;
  const now = new Date().toISOString();
  await sql.begin(async transaction => {
    await transaction`INSERT INTO app_state (id, data, updated_at) VALUES (1, ${parsed}, ${now}) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;
    await transaction`INSERT INTO app_state_snapshots (state) VALUES (${parsed})`;
    await transaction`DELETE FROM state_players`;
    for (const player of parsed.players ?? []) await transaction`INSERT INTO state_players (id, name, rating, active, payload, updated_at) VALUES (${player.id}, ${player.name}, ${player.rating}, ${player.active ?? true}, ${player}, ${now})`;
    await transaction`DELETE FROM state_matches`;
    for (const match of parsed.matches ?? []) await transaction`INSERT INTO state_matches (id, player_a, player_b, played_on, status, payload, updated_at) VALUES (${match.id}, ${match.a}, ${match.b}, ${match.playedOn ?? null}, ${match.status}, ${match}, ${now})`;
  });
}

export async function deleteState() {
  await ensureStateSchema();
  const sql = getSql();
  await sql`DELETE FROM app_state WHERE id = 1`;
}
