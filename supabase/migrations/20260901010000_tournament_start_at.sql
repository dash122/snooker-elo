ALTER TABLE public.state_tournaments
  ADD COLUMN IF NOT EXISTS start_at timestamptz;
