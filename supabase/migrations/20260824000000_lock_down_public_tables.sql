-- The application uses a server-side Postgres connection, not the Supabase
-- Data API. Do not expose its operational tables to publishable-key clients.
-- RLS was already enabled for a subset of these tables in the baseline dump;
-- this migration completes coverage for every table in the exposed schema and
-- removes the default client grants that otherwise precede RLS evaluation.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_state_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_subscriptions ENABLE ROW LEVEL SECURITY;

-- New public tables must not inherit Data API privileges before their own RLS
-- policy and grants have been deliberately designed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- This helper has no event trigger in this schema. It never needs to be a
-- callable public API endpoint.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
