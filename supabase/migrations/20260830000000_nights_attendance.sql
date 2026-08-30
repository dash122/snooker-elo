-- 場次 · a night is derived, not opened.
--
-- Nothing in this schema modelled 「星期二夜晚」 — every matchmaking table models a *pair*, right
-- down to availability_slots.filled_by being singular. These two tables add the object members
-- actually decide about, so the app can answer 「今晚上去有無人」.
--
-- Rows are materialised lazily, on the first signal for a date, rather than pre-generated: the
-- forecast answers an empty evening perfectly well from no rows at all, and once venues arrive the
-- cost of pre-generating would multiply by every club in Hong Kong. A venue_id column later turns
-- `nights` into (venue x date) without a rewrite.
--
-- IF NOT EXISTS throughout, to match the other migrations here and stay re-runnable.

CREATE TABLE IF NOT EXISTS public.nights (
  id text PRIMARY KEY NOT NULL,
  night_date date NOT NULL UNIQUE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nights_band_order CHECK (end_at > start_at)
);

-- What one member says about one night. Replaced in place rather than appended: a change of mind is
-- not a second opinion, and set_at moving forward is what makes the signal weigh more again.
--
-- upgrade_at is 夠人就去 — promote to 'high' once that many people (this member included) are
-- confirmed. It is the member's own threshold rather than a club constant, because what counts as
-- 「夠人」 is a personal judgement; two is the floor because below two there is no game to be had.
--
-- promoted_at records that the club made that commitment on the member's behalf, so the app can say
-- so plainly and so a promotion is never silently re-run.
CREATE TABLE IF NOT EXISTS public.night_attendance (
  night_id text NOT NULL REFERENCES public.nights(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  confidence text NOT NULL,
  upgrade_at smallint,
  promoted_at timestamptz,
  set_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (night_id, player_id),
  CONSTRAINT night_attendance_confidence_check CHECK (confidence IN ('high','mid','low','out')),
  CONSTRAINT night_attendance_upgrade_range_check CHECK (upgrade_at IS NULL OR (upgrade_at BETWEEN 2 AND 12)),
  -- A member who declined cannot also be waiting on a threshold: the two states contradict, and
  -- allowing both would let other people's taps quietly reverse a decline.
  CONSTRAINT night_attendance_decline_has_no_threshold_check CHECK (confidence <> 'out' OR upgrade_at IS NULL)
);

-- The board read: every live signal for one night.
CREATE INDEX IF NOT EXISTS night_attendance_night_idx
  ON public.night_attendance (night_id) WHERE confidence <> 'out';
-- One member's own rows across the week, for the viewer's row on each night.
CREATE INDEX IF NOT EXISTS night_attendance_player_idx
  ON public.night_attendance (player_id, night_id);
-- The promotion engine's hot read: everyone still waiting on a threshold for one night.
CREATE INDEX IF NOT EXISTS night_attendance_pending_idx
  ON public.night_attendance (night_id, upgrade_at)
  WHERE upgrade_at IS NOT NULL AND confidence NOT IN ('high','out');

-- The app talks to Postgres server-side and does not expose these tables through the Supabase Data
-- API. 20260826000000_harden_public_rls.sql applied this to every table existing at the time, but it
-- was a one-off loop, not an event trigger — a new table gets no RLS unless its own migration says
-- so. Without these three statements, `nights` and `night_attendance` would be the only tables in
-- the schema outside that boundary.
ALTER TABLE public.nights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_data_api_clients" ON public.nights;
CREATE POLICY "deny_data_api_clients" ON public.nights
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_data_api_clients" ON public.night_attendance;
CREATE POLICY "deny_data_api_clients" ON public.night_attendance
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON public.nights FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.night_attendance FROM PUBLIC, anon, authenticated;
