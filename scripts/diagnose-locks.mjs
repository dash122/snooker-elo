import postgres from "postgres";

const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) throw new Error("Set POSTGRES_URL, DATABASE_URL, or SUPABASE_DB_URL");

const target = new URL(url);
console.log(`target_host=${target.hostname} port=${target.port || "5432"}`);

const sql = postgres(url, { ssl: "require", prepare: false, max: 1, connect_timeout: 8, idle_timeout: 2 });
try {
  const relation = await sql`SELECT oid, oid::regclass::text AS relation FROM pg_class WHERE oid = 17546`;
  const activity = await sql`
    SELECT a.pid, a.usename, a.application_name, a.state,
      now() - a.query_start AS query_age,
      now() - a.xact_start AS transaction_age,
      a.wait_event_type, a.wait_event, left(a.query, 500) AS query,
      pg_blocking_pids(a.pid) AS blocking_pids
    FROM pg_stat_activity a
    WHERE a.datname = current_database()
      AND (
        cardinality(pg_blocking_pids(a.pid)) > 0
        OR a.pid IN (SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity)
      )
    ORDER BY a.query_start NULLS LAST
  `;
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('state_players', 'state_matches', 'state_tournaments', 'state_settings', 'state_audits')
    ORDER BY table_name
  `;
  const counts = await sql`
    SELECT
      (SELECT count(*)::int FROM state_players) AS players,
      (SELECT count(*)::int FROM state_matches) AS matches,
      (SELECT count(*)::int FROM state_settings) AS settings
  `;
  console.log(JSON.stringify({ relation, lock_activity: activity, tables, counts: counts[0] }, null, 2));
} finally {
  await sql.end({ timeout: 2 });
}
