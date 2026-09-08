-- PR 1: additive marketplace foundations. OpenBoard and legacy formations keep their behavior.
BEGIN;

ALTER TABLE public.availability_slots
  ADD COLUMN min_players smallint NOT NULL DEFAULT 2,
  ADD COLUMN max_players smallint NOT NULL DEFAULT 2,
  ADD COLUMN venue_scope text;

UPDATE public.availability_slots
SET venue_scope = CASE WHEN venue_id IS NULL THEN 'any_hk' ELSE 'exact' END;

-- Legacy writers omit scope. A BEFORE INSERT trigger supplies the context-dependent default;
-- explicit exact/district with no venue still fails the check. No security-definer privileges.
CREATE FUNCTION public.default_matchmaking_venue_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.venue_scope IS NULL THEN
    NEW.venue_scope := CASE WHEN NEW.venue_id IS NULL THEN 'any_hk' ELSE 'exact' END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.default_matchmaking_venue_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER availability_slots_default_venue_scope
  BEFORE INSERT ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.default_matchmaking_venue_scope();

ALTER TABLE public.availability_slots
  ALTER COLUMN venue_scope SET NOT NULL,
  DROP CONSTRAINT availability_slots_target_size_check,
  ADD CONSTRAINT availability_slots_target_size_check CHECK (target_size BETWEEN 2 AND 6),
  ADD CONSTRAINT availability_slots_group_range_check
    CHECK (2 <= min_players AND min_players <= target_size AND target_size <= max_players AND max_players <= 6),
  ADD CONSTRAINT availability_slots_venue_scope_check CHECK (venue_scope IN ('exact','district','any_hk')),
  ADD CONSTRAINT availability_slots_venue_scope_venue_check CHECK (venue_scope = 'any_hk' OR venue_id IS NOT NULL);

ALTER TABLE public.matchmaking_sessions
  ALTER COLUMN host_player_id DROP NOT NULL,
  ALTER COLUMN anchor_slot_id DROP NOT NULL,
  ADD COLUMN created_by_player_id text REFERENCES public.state_players(id) ON DELETE SET NULL,
  ADD COLUMN min_players smallint NOT NULL DEFAULT 2,
  ADD COLUMN max_players smallint NOT NULL DEFAULT 2,
  -- Keep this default until legacy writers retire. Marketplace/direct writes must set source.
  ADD COLUMN source text NOT NULL DEFAULT 'legacy';

UPDATE public.matchmaking_sessions SET created_by_player_id = host_player_id;

ALTER TABLE public.matchmaking_sessions
  DROP CONSTRAINT matchmaking_sessions_target_size_check,
  ADD CONSTRAINT matchmaking_sessions_target_size_check CHECK (target_size BETWEEN 2 AND 6),
  ADD CONSTRAINT matchmaking_sessions_group_range_check
    CHECK (2 <= min_players AND min_players <= target_size AND target_size <= max_players AND max_players <= 6),
  ADD CONSTRAINT matchmaking_sessions_source_check CHECK (source IN ('marketplace','direct','legacy')),
  ADD CONSTRAINT matchmaking_sessions_hostless_check CHECK (source = 'legacy' OR host_player_id IS NULL);

-- Legacy request code already serializes requests on the anchor/session and checks pending count.
DROP INDEX IF EXISTS public.matchmaking_session_one_pending_member_idx;

-- Preserve the one-live-session-per-anchor rule only for legacy rows. New formations may share
-- traceability to one availability without granting its owner any authority over the formation.
DROP INDEX public.matchmaking_sessions_active_anchor_idx;
CREATE UNIQUE INDEX matchmaking_sessions_active_anchor_idx
  ON public.matchmaking_sessions (anchor_slot_id)
  WHERE source = 'legacy' AND status IN ('forming','playable','full');

CREATE TABLE public.matchmaking_pair_preferences (
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  other_player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  preference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, other_player_id),
  CONSTRAINT matchmaking_pair_preferences_not_self_check CHECK (player_id <> other_player_id),
  CONSTRAINT matchmaking_pair_preferences_preference_check CHECK (preference = 'avoid')
);
CREATE INDEX matchmaking_pair_preferences_other_player_idx ON public.matchmaking_pair_preferences (other_player_id);
ALTER TABLE public.matchmaking_pair_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_data_api_clients ON public.matchmaking_pair_preferences
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.matchmaking_pair_preferences FROM PUBLIC, anon, authenticated;

COMMIT;
