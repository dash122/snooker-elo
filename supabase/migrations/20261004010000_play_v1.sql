-- 約戰 v1 ("Play") — session-based matchmaking. See docs/matchmaking-phase1-spec.md.
--
-- Additive only: nothing from the legacy matchmaking tables is read, moved or dropped here. The
-- legacy tables are removed by a later migration (20261004020000_drop_legacy_matchmaking.sql), which
-- must only be applied once the new code is live.
--
-- Shape:
--   play_intents          "I want a game" / "I'm around" — a player's stated window, not a promise.
--   play_avoids           private "don't show me / don't show me to" pairs. Never exposed.
--   play_sessions         a time window, a venue (or open), a 2-6 size range and a set of members.
--   play_session_members  only status 'in' counts towards the minimum and the maximum.
--   play_session_results  links a state_matches row to the session it came from.
-- venues is extended in place (pin, city, time zone, moderation status).

BEGIN;

-- --------------------------------------------------------------------------
-- 1. venues: a pin, a city and a moderation state
-- --------------------------------------------------------------------------
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS lng double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS tz text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'verified'
    CHECK (status IN ('unverified','verified','rejected')),
  ADD COLUMN IF NOT EXISTS created_by text REFERENCES public.state_players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_into text REFERENCES public.venues(id) ON DELETE SET NULL;

-- The only pre-existing venue is in Hong Kong. Its pin is set by an admin.
UPDATE public.venues SET city = 'hong-kong', tz = 'Asia/Hong_Kong' WHERE id = 'venue-scaa' AND city IS NULL;

CREATE INDEX IF NOT EXISTS venues_city_status_idx ON public.venues (city, status) WHERE active;

-- --------------------------------------------------------------------------
-- 2. play_intents
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.play_intents (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  -- 'wants' = actively asking for a game; 'open' = could play, ask me gently.
  kind text NOT NULL CHECK (kind IN ('open','wants')),
  strength text NOT NULL DEFAULT 'likely' CHECK (strength IN ('could','likely')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  min_minutes integer NOT NULL DEFAULT 60 CHECK (min_minutes BETWEEN 30 AND 240),
  venue_scope text NOT NULL DEFAULT 'city' CHECK (venue_scope IN ('listed','city')),
  venue_ids text[] NOT NULL DEFAULT '{}',
  city text NOT NULL,
  min_players integer NOT NULL DEFAULT 2,
  target_size integer NOT NULL DEFAULT 4,
  max_players integer NOT NULL DEFAULT 6,
  -- level / vibe / conduct requirements, each with a strictness. Shape owned by lib/play/fit.ts.
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text CHECK (note IS NULL OR char_length(note) <= 140),
  -- Quiet: visible to the app for suggestions, never offered to other players as someone to ask.
  quiet boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at AND end_at - start_at <= interval '24 hours'),
  CHECK (2 <= min_players AND min_players <= target_size AND target_size <= max_players AND max_players <= 6)
);
CREATE INDEX IF NOT EXISTS play_intents_board_idx ON public.play_intents (city, end_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS play_intents_player_idx ON public.play_intents (player_id, end_at DESC);

-- --------------------------------------------------------------------------
-- 3. play_avoids (private)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.play_avoids (
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  other_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, other_id),
  CHECK (player_id <> other_id)
);
CREATE INDEX IF NOT EXISTS play_avoids_other_idx ON public.play_avoids (other_id);

-- --------------------------------------------------------------------------
-- 4. play_sessions and members
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.play_sessions (
  id text PRIMARY KEY,
  created_by text REFERENCES public.state_players(id) ON DELETE SET NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  city text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  min_players integer NOT NULL DEFAULT 2,
  target_size integer NOT NULL DEFAULT 4,
  max_players integer NOT NULL DEFAULT 6,
  table_status text NOT NULL DEFAULT 'walkin' CHECK (table_status IN ('walkin','booked')),
  status text NOT NULL DEFAULT 'forming' CHECK (status IN ('forming','playable','full','played','cancelled')),
  -- Free text, e.g. "winner stays". Rotation is deliberately not modelled.
  note text CHECK (note IS NULL OR char_length(note) <= 140),
  -- Terms shown before anyone joins: vibe, format, conduct. Shape owned by lib/play/fit.ts.
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  played_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at AND end_at - start_at <= interval '24 hours'),
  CHECK (2 <= min_players AND min_players <= target_size AND target_size <= max_players AND max_players <= 6)
);
CREATE INDEX IF NOT EXISTS play_sessions_board_idx ON public.play_sessions (city, start_at)
  WHERE status IN ('forming','playable','full');
CREATE INDEX IF NOT EXISTS play_sessions_venue_idx ON public.play_sessions (venue_id, start_at);

CREATE TABLE IF NOT EXISTS public.play_session_members (
  session_id text NOT NULL REFERENCES public.play_sessions(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  -- 'in' is an explicit acceptance and the only status that counts towards capacity.
  status text NOT NULL CHECK (status IN ('invited','in','maybe','declined','left')),
  source text NOT NULL DEFAULT 'joined' CHECK (source IN ('creator','invited','joined','intent')),
  -- Filled after the session: "who came" and "did you play". Private; never shown as a record.
  came boolean,
  played boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_id)
);
CREATE INDEX IF NOT EXISTS play_session_members_player_idx ON public.play_session_members (player_id, status);

-- A result belongs to at most one session. The match itself lives in state_matches.
CREATE TABLE IF NOT EXISTS public.play_session_results (
  match_id text PRIMARY KEY REFERENCES public.state_matches(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.play_sessions(id) ON DELETE CASCADE,
  recorded_by text REFERENCES public.state_players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS play_session_results_session_idx ON public.play_session_results (session_id);

-- --------------------------------------------------------------------------
-- 5. Integrity guard (deferred, so it sees the final state of a transaction)
--    - never more accepted players than the session's maximum
--    - a player is 'in' at most one live session at a time
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_play_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE sid text := COALESCE(NEW.session_id, OLD.session_id);
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.play_sessions s
    WHERE s.id = sid AND s.status IN ('forming','playable','full')
      AND (SELECT count(*) FROM public.play_session_members m WHERE m.session_id = s.id AND m.status = 'in') > s.max_players
  ) THEN RAISE EXCEPTION 'Session is full' USING ERRCODE = '23514'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.play_sessions a
    JOIN public.play_session_members am ON am.session_id = a.id AND am.status = 'in'
    JOIN public.play_session_members bm ON bm.player_id = am.player_id AND bm.status = 'in' AND bm.session_id <> a.id
    JOIN public.play_sessions b ON b.id = bm.session_id
    WHERE a.id = sid AND a.status IN ('forming','playable','full') AND b.status IN ('forming','playable','full')
      AND a.end_at > now() AND b.end_at > now() AND a.start_at < b.end_at AND b.start_at < a.end_at
  ) THEN RAISE EXCEPTION 'Already in another session at that time' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS play_integrity ON public.play_session_members;
CREATE CONSTRAINT TRIGGER play_integrity AFTER INSERT OR UPDATE OR DELETE ON public.play_session_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_play_integrity();

-- --------------------------------------------------------------------------
-- 6. Same posture as every other operational table: server-side connection only.
-- --------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['play_intents','play_avoids','play_sessions','play_session_members','play_session_results'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "deny_data_api_clients" ON public.%I', t);
    EXECUTE format('CREATE POLICY "deny_data_api_clients" ON public.%I AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;

COMMIT;
