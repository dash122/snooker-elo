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
    const configuredUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!configuredUrl) {
      throw new Error(
        "No Postgres connection string found. Set POSTGRES_URL (Vercel's Supabase integration sets this automatically)."
      );
    }
    /* Supavisor's transaction pooler (6543) is ideal for short-lived serverless functions, but a
       persistent local Vite process can leave responses stuck in ClientRead when several requests
       share its long-lived Postgres.js pool. Supabase recommends session mode (5432) for persistent
       IPv4 backends. Keep production on its configured mode and switch only local development. */
    let url = configuredUrl;
    try {
      const parsed = new URL(configuredUrl);
      if (process.env.NODE_ENV === "development" && parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
        parsed.port = "5432";
        url = parsed.toString();
      }
    } catch {
      // The validation/logging block below reports an unparseable string without exposing it.
    }
    // Which database this process is talking to is worth knowing at startup,
    // but the connection string carries the password in userinfo — logging it
    // whole leaks the credential into hosting and CI logs. Host and database
    // name answer "am I pointed at prod?" without exposing anything.
    try {
      const { host, pathname } = new URL(url);
      console.log(`Postgres: ${host}${pathname}`);
    } catch {
      console.log("Postgres: connection string set (unparseable, not logged)");
    }
    const isLocal = url.includes("127.0.0.1") || url.includes("localhost");
    /* Serverless functions are created in bursts when the 約戰 tab opens. Postgres.js defaults to
       ten connections and opens another one for every concurrent query, so each tiny API function
       could stampede Supabase's transaction pooler with its own ten-connection pool. A small,
       bounded pool pays only a few remote TLS handshakes and queues excess reads locally. */
    sqlClient = postgres(url, {
      ssl: isLocal ? false : "require",
      prepare: false,
      /* Four leaves room for the app's transaction helpers and parallel read groups without the
         pool-starvation seen at one or two, while still cutting the library default by 60%. */
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sqlClient;
}
