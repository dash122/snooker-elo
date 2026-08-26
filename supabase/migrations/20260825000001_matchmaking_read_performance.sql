-- The matchmaking read paths repeatedly filter live rows by their lifecycle time.
-- Keep these partial indexes small and aligned with the predicates used by the app.

-- Older baseline deployments created this index with filled_by IS NULL, but the board now
-- deliberately includes filled rows so members can see that a game already has someone in it.
DROP INDEX IF EXISTS public.availability_slots_board_idx;
CREATE INDEX availability_slots_board_idx ON public.availability_slots (start_at)
  WHERE posted = true AND cancelled_at IS NULL AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS availability_slots_end_active_idx ON public.availability_slots (end_at)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS match_invites_pending_time_idx
  ON public.match_invites ((COALESCE(counter_start_at, start_at)))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS match_offers_live_start_idx ON public.match_offers (start_at)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS match_intents_live_expiry_idx ON public.match_intents (expires_at)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS open_calls_live_end_idx ON public.open_calls (end_at)
  WHERE status IN ('open', 'claimed');
