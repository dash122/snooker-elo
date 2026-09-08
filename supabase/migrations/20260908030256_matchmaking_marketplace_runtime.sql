BEGIN;
ALTER TABLE public.availability_slots ADD COLUMN source text NOT NULL DEFAULT 'legacy'
  CHECK (source IN ('legacy','marketplace'));
ALTER TABLE public.matchmaking_session_members ADD COLUMN eligibility jsonb;
ALTER TABLE public.matchmaking_sessions
  ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD COLUMN reopened boolean NOT NULL DEFAULT false;

-- One short transaction lock coordinates new writes with old clients during coexistence.
-- No network/notification delivery takes place while this lock is held.
CREATE FUNCTION public.lock_matchmaking_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(726341,2);
  RETURN NULL;
END;
$$;
CREATE TRIGGER marketplace_lock BEFORE INSERT OR UPDATE OR DELETE ON public.matchmaking_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_matchmaking_write();
CREATE TRIGGER marketplace_lock BEFORE INSERT OR UPDATE OR DELETE ON public.matchmaking_session_members
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_matchmaking_write();
CREATE TRIGGER marketplace_lock BEFORE INSERT OR UPDATE OR DELETE ON public.availability_slots
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_matchmaking_write();
CREATE TRIGGER marketplace_lock BEFORE INSERT OR UPDATE OR DELETE ON public.open_calls
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_matchmaking_write();
CREATE TRIGGER marketplace_lock BEFORE INSERT OR UPDATE OR DELETE ON public.open_call_players
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_matchmaking_write();

CREATE FUNCTION public.protect_marketplace_availability() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.source='marketplace' AND pg_catalog.current_setting('app.marketplace_write',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '請在新版約戰內修改這個空檔。' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_marketplace_availability BEFORE UPDATE OR DELETE ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.protect_marketplace_availability();

-- Deferred validation sees the final consent/status state, also for legacy API writes.
CREATE FUNCTION public.check_marketplace_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.matchmaking_sessions s
    WHERE s.source<>'legacy' AND s.status IN ('forming','playable','full') AND s.end_at>now()
    AND ((SELECT count(*) FROM public.matchmaking_session_members m WHERE m.session_id=s.id AND m.status='accepted')>s.max_players
      OR EXISTS (SELECT 1 FROM public.matchmaking_session_members m WHERE m.session_id=s.id AND m.role<>'member'))
  ) THEN RAISE EXCEPTION 'Invalid marketplace capacity or role' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.matchmaking_sessions a
    JOIN public.matchmaking_session_members am ON am.session_id=a.id AND am.status='accepted'
    JOIN public.matchmaking_session_members bm ON bm.player_id=am.player_id AND bm.status='accepted' AND bm.session_id<>a.id
    JOIN public.matchmaking_sessions b ON b.id=bm.session_id
    WHERE a.source<>'legacy' AND a.status IN ('playable','full') AND b.status IN ('playable','full')
      AND a.end_at>now() AND b.end_at>now() AND a.start_at<b.end_at AND b.start_at<a.end_at
  ) OR EXISTS (
    SELECT 1 FROM public.matchmaking_sessions s
    JOIN public.matchmaking_session_members m ON m.session_id=s.id AND m.status='accepted'
    JOIN public.open_call_players p ON p.player_id=m.player_id
    JOIN public.open_calls c ON c.id=p.call_id
    WHERE s.source<>'legacy' AND s.status IN ('playable','full') AND s.end_at>now()
      AND c.status IN ('open','claimed') AND c.end_at>now() AND c.start_at<s.end_at AND s.start_at<c.end_at
      AND (SELECT count(*) FROM public.open_call_players cp WHERE cp.call_id=c.id)>=2
  ) THEN RAISE EXCEPTION '這段時間已有確認安排。' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER marketplace_integrity AFTER INSERT OR UPDATE OR DELETE ON public.matchmaking_sessions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_marketplace_integrity();
CREATE CONSTRAINT TRIGGER marketplace_integrity AFTER INSERT OR UPDATE OR DELETE ON public.matchmaking_session_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_marketplace_integrity();
CREATE CONSTRAINT TRIGGER marketplace_integrity AFTER INSERT OR UPDATE OR DELETE ON public.open_calls
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_marketplace_integrity();
CREATE CONSTRAINT TRIGGER marketplace_integrity AFTER INSERT OR UPDATE OR DELETE ON public.open_call_players
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_marketplace_integrity();

CREATE TABLE public.matchmaking_delivery (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES public.matchmaking_sessions(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invite','playable','reopened','recruit','reminder','result')),
  revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,player_id,kind,revision)
);
CREATE INDEX matchmaking_delivery_pending_idx ON public.matchmaking_delivery(next_attempt_at) WHERE sent_at IS NULL;
CREATE TABLE public.matchmaking_results (
  match_id text PRIMARY KEY REFERENCES public.state_matches(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.matchmaking_sessions(id) ON DELETE RESTRICT,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matchmaking_results_session_idx ON public.matchmaking_results(session_id);
ALTER TABLE public.matchmaking_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_data_api_clients ON public.matchmaking_delivery FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
CREATE POLICY deny_data_api_clients ON public.matchmaking_results FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
REVOKE ALL ON public.matchmaking_delivery,public.matchmaking_results FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_matchmaking_write(),public.protect_marketplace_availability(),public.check_marketplace_integrity() FROM PUBLIC,anon,authenticated;
COMMIT;
