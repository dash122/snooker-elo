ALTER TABLE public.state_tournaments
  ADD COLUMN IF NOT EXISTS arrival_times jsonb NOT NULL DEFAULT '{}'::jsonb;
