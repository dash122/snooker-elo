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
    // The local vinext process is long-lived, so use Supavisor session mode when
    // the integration has provided it. Production serverless requests should
    // keep using the transaction pooler via POSTGRES_URL.
    const configuredUrl = process.env.NODE_ENV !== "production"
      ? process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
      : process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!configuredUrl) {
      throw new Error(
        "No Postgres connection string found. Set POSTGRES_URL (Vercel's Supabase integration sets this automatically)."
      );
    }
    /* Keep SSL enabled for every remote Supabase connection. */
    let url = configuredUrl;
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
      /* Six leaves more headroom for concurrent board loads (each opens at least two parallel
         queries via Promise.all) without coming near the pool-starvation seen at one or two, or
         the ~90-connection stampede a separate pool per module used to cause. Still small enough
         that Supabase's transaction pooler never notices. */
      max: 6,
      idle_timeout: 20,
      connect_timeout: 10,
      /* A serverless invocation can die mid-request (a Vercel function frozen or killed) without
         closing its socket, leaving the Postgres backend blocked forever writing a result to a
         client that will never read it again — `idle_timeout` above only reaps connections that
         are cleanly idle, not ones stuck mid-query. With only a handful of connections in the pool,
         a couple of these silently exhaust it and every other request queues until it times out.
         `statement_timeout` makes Postgres itself cancel any statement that runs this long, instead
         of relying on someone finding and killing the backend by hand. Set below the client's own
         fetch timeout (12s in OpenBoard.tsx's `load()`) on purpose: found live that a 15s value let
         the *client* give up and show "未能載入約戰" before Postgres's own safety net had even
         fired, so the connection stayed wedged for the queued request behind it too. At 8s, the
         connection is back in the pool before any client relying on the same 12s budget times out.
         `idle_in_transaction_session_timeout` covers the other shape seen live in the Postgres logs
         ("unexpected EOF ... with an open transaction") -- a connection sitting inside a still-open
         transaction with no statement running, which `statement_timeout` does not bound at all. */
      connection: { statement_timeout: 8000, idle_in_transaction_session_timeout: 10000 },
      /* Belt and braces beyond both timeouts above: neither bounds a connection stuck between
         statements waiting on something else this process is doing (an un-timed-out outbound fetch
         was exactly the bug found live — see lib/mailer.ts). No pooled connection has any business
         living longer than this regardless of cause, so postgres.js closes and transparently
         replaces one once it turns this old, which puts a hard ceiling on how long any future bug
         of this shape can wedge the pool before it self-heals, instead of needing someone to find
         and kill the backend by hand. */
      max_lifetime: 600,
    });
  }
  return sqlClient;
}
