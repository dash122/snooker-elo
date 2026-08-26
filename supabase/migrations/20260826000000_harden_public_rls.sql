-- The application uses a server-side Postgres connection and does not expose
-- these operational tables through supabase-js/PostgREST. Keep the Data API
-- roles fully deny-by-default while preserving server-side access.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Prevent future objects created by the postgres owner from being exposed by
-- default. Access can be granted explicitly if a table is intentionally added
-- to the Data API later.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Enable RLS on every current public table, including tables that may exist in
-- a drifted database but are no longer present in the checked-in migrations.
-- The explicit deny policy keeps the intent visible to Supabase advisors;
-- revoked table privileges remain the primary Data API boundary.
DO $$
DECLARE
  table_ref record;
BEGIN
  FOR table_ref IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_ref.schema_name,
      table_ref.table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS "deny_data_api_clients" ON %I.%I',
      table_ref.schema_name,
      table_ref.table_name
    );
    EXECUTE format(
      'CREATE POLICY "deny_data_api_clients" ON %I.%I '
      'FOR ALL TO anon, authenticated '
      'USING (false) WITH CHECK (false)',
      table_ref.schema_name,
      table_ref.table_name
    );
  END LOOP;
END
$$;

-- This legacy event-trigger helper is not part of the application API.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
