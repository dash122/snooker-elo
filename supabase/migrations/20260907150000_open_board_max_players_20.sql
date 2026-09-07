-- The composer's capacity stepper now goes up to 20 joiners (21 including the host), matching
-- iOS's own stepper convention for a small bounded count. The original constraint capped
-- max_players at 8, which would have silently clamped a legal composer value to NULL server-side.
ALTER TABLE public.open_calls
  DROP CONSTRAINT IF EXISTS open_calls_max_players_check;

ALTER TABLE public.open_calls
  ADD CONSTRAINT open_calls_max_players_check CHECK (max_players IS NULL OR max_players BETWEEN 2 AND 21);
