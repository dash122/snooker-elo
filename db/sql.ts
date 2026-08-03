import postgres from "postgres";

let sqlClient: ReturnType<typeof postgres> | null = null;

// One pool for the whole application.
//
// Shared originally by auth.pg.ts and state.pg.ts so operations touching both
// members and state_players (e.g. signup) could run in a single transaction —
// but every other data module is now on it too, and that second reason matters
// more. Each module that called `postgres(url, …)` for itself opened its own
// pool of up to ten connections; with matchmaking, notifications, offers,
// recurrence and analytics added, that reached roughly ninety against
// Supabase's transaction pooler. Statements then queue behind the connection
// limit until `statement_timeout` cancels them, which surfaces as every page
// failing with "canceling statement due to statement timeout" rather than as
// anything that looks like a connection problem.
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
