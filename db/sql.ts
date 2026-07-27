import postgres from "postgres";

let sqlClient: ReturnType<typeof postgres> | null = null;

// Shared by auth.pg.ts and state.pg.ts so operations that touch both members
// and state_players (e.g. signup) can run inside a single transaction.
export function getSql() {
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
