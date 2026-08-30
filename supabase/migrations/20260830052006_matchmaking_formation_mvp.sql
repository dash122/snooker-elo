-- Matchmaking formation MVP.
--
-- Availability remains the lightweight supply signal. A session is only created when another
-- member asks to join an overlapping window, and the availability owner approves each member.
-- This keeps one-to-one and groups on the same path without treating every free-time post as a
-- confirmed fixture.

-- Venue is deliberately optional: members often agree the time first and decide SCAA/another club
-- in chat afterwards. The previous migration made it mandatory, which also broke the existing
-- availability publishing path that never supplied venue_id.
ALTER TABLE public.availability_slots
  ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.availability_slots
  ADD COLUMN IF NOT EXISTS target_size smallint NOT NULL DEFAULT 2;

ALTER TABLE public.availability_slots
  DROP CONSTRAINT IF EXISTS availability_slots_target_size_check;
ALTER TABLE public.availability_slots
  ADD CONSTRAINT availability_slots_target_size_check CHECK (target_size BETWEEN 2 AND 8);

CREATE TABLE IF NOT EXISTS public.matchmaking_sessions (
  id text PRIMARY KEY NOT NULL,
  host_player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE RESTRICT,
  anchor_slot_id text NOT NULL REFERENCES public.availability_slots(id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  target_size smallint NOT NULL,
  status text NOT NULL DEFAULT 'forming',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT matchmaking_sessions_time_order_check CHECK (end_at > start_at),
  CONSTRAINT matchmaking_sessions_minimum_window_check CHECK (end_at >= start_at + interval '1 hour'),
  CONSTRAINT matchmaking_sessions_target_size_check CHECK (target_size BETWEEN 2 AND 8),
  CONSTRAINT matchmaking_sessions_status_check CHECK (status IN ('forming','playable','full','cancelled','completed'))
);

-- One live formation thread per availability post. Concurrent join requests reuse this row.
CREATE UNIQUE INDEX IF NOT EXISTS matchmaking_sessions_active_anchor_idx
  ON public.matchmaking_sessions (anchor_slot_id)
  WHERE status IN ('forming','playable','full');
CREATE INDEX IF NOT EXISTS matchmaking_sessions_host_status_idx
  ON public.matchmaking_sessions (host_player_id, status, start_at);
CREATE INDEX IF NOT EXISTS matchmaking_sessions_window_idx
  ON public.matchmaking_sessions (start_at, end_at)
  WHERE status IN ('forming','playable','full');
CREATE INDEX IF NOT EXISTS matchmaking_sessions_venue_idx
  ON public.matchmaking_sessions (venue_id, start_at)
  WHERE venue_id IS NOT NULL AND status IN ('forming','playable','full');

CREATE TABLE IF NOT EXISTS public.matchmaking_session_members (
  session_id text NOT NULL REFERENCES public.matchmaking_sessions(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE RESTRICT,
  availability_slot_id text REFERENCES public.availability_slots(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_id),
  CONSTRAINT matchmaking_session_members_role_check CHECK (role IN ('host','member')),
  CONSTRAINT matchmaking_session_members_status_check CHECK (status IN ('pending','accepted','declined','withdrawn')),
  CONSTRAINT matchmaking_session_members_host_status_check CHECK (role <> 'host' OR status = 'accepted')
);

CREATE INDEX IF NOT EXISTS matchmaking_session_members_player_idx
  ON public.matchmaking_session_members (player_id, status, session_id);
CREATE INDEX IF NOT EXISTS matchmaking_session_members_pending_idx
  ON public.matchmaking_session_members (session_id, requested_at)
  WHERE status = 'pending';

-- This app authenticates in its own server routes and connects to Postgres directly. Keep the new
-- tables unavailable through Supabase's public Data API, matching the repository's existing
-- hardened-table boundary.
ALTER TABLE public.matchmaking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_session_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_data_api_clients" ON public.matchmaking_sessions;
CREATE POLICY "deny_data_api_clients" ON public.matchmaking_sessions
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_data_api_clients" ON public.matchmaking_session_members;
CREATE POLICY "deny_data_api_clients" ON public.matchmaking_session_members
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON public.matchmaking_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.matchmaking_session_members FROM PUBLIC, anon, authenticated;
