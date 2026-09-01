ALTER TABLE public.state_tournaments
  ADD COLUMN IF NOT EXISTS co_hosts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.state_tournaments
  ADD COLUMN IF NOT EXISTS roster_order jsonb;
