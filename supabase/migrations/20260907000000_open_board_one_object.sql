-- 開局板 — one object, one lifecycle.
--
-- The matchmaking tab previously ran two models side by side: an availability pool that only an
-- algorithm could read, and a formation session with pending applicants. Neither produced a game a
-- member could see before committing to it. This migration folds both into the object that was
-- already closest to the product we want -- `open_calls` -- and gives it the fields a 局 needs.
--
-- The shape follows three product decisions, in this order:
--
--   1. A 局 with one participant IS the pool. There is no second table for "people who are free",
--      because a soft 局 (time range, venue possibly undecided, one person) says exactly that.
--   2. There are no roles. Snooker is not football: four members at one table is a normal evening,
--      not an overflow, so `open_call_players` carries no 正選/後備 column and no capacity beyond
--      an optional cap the host may set. Two participants is the only threshold in the system.
--   3. Withdrawing leaves no trace. `我去不到` DELETEs the row rather than stamping a `left_at`,
--      because a card that displays "已退出 陳嘉朗" teaches everyone else not to press the button.
--      The absence of a tombstone column here is the product decision, not an oversight.

-- --- open_calls: the 局 ------------------------------------------------------------------------

ALTER TABLE public.open_calls
  -- Venue becomes a reference so the board can filter by district and show the table count. It stays
  -- nullable on purpose: members find people first and argue about the venue afterwards, so a 局 must
  -- be postable with no venue at all.
  ADD COLUMN IF NOT EXISTS venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  -- Where the poster is *leaning* when no venue is fixed yet. A district string, shown as
  -- "場地未定 · 意向：葵青區" so the reader can judge travel before joining.
  ADD COLUMN IF NOT EXISTS venue_intent text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tempo text NOT NULL DEFAULT 'sport',
  -- The host's *intent*, not a number. An exact handicap cannot be computed before an opponent
  -- exists; once two participants are in, both ratings are known and the card derives the suggested
  -- handicap at read time. Nothing about the number is stored here.
  ADD COLUMN IF NOT EXISTS handicap_pref text NOT NULL DEFAULT 'even',
  ADD COLUMN IF NOT EXISTS cost_split text NOT NULL DEFAULT 'aa',
  ADD COLUMN IF NOT EXISTS smoking text NOT NULL DEFAULT 'nonsmoking',
  -- NULL means uncapped, which is the default. A cap is an unusual request (a fixed doubles match),
  -- not the normal state of a club night.
  ADD COLUMN IF NOT EXISTS max_players integer,
  -- Notification bookkeeping. All three are "have we already sent this", so the sweep that sends
  -- them can run as often as it likes without ever sending twice.
  ADD COLUMN IF NOT EXISTS filled_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_prompted_at timestamptz;

ALTER TABLE public.open_calls
  DROP CONSTRAINT IF EXISTS open_calls_tempo_check,
  DROP CONSTRAINT IF EXISTS open_calls_handicap_pref_check,
  DROP CONSTRAINT IF EXISTS open_calls_cost_split_check,
  DROP CONSTRAINT IF EXISTS open_calls_smoking_check,
  DROP CONSTRAINT IF EXISTS open_calls_max_players_check;

ALTER TABLE public.open_calls
  ADD CONSTRAINT open_calls_tempo_check CHECK (tempo IN ('sport','casual')),
  ADD CONSTRAINT open_calls_handicap_pref_check CHECK (handicap_pref IN ('even','handicap')),
  ADD CONSTRAINT open_calls_cost_split_check CHECK (cost_split IN ('aa','host')),
  ADD CONSTRAINT open_calls_smoking_check CHECK (smoking IN ('nonsmoking','any')),
  ADD CONSTRAINT open_calls_max_players_check CHECK (max_players IS NULL OR max_players BETWEEN 2 AND 8);

-- A 局 now ends at its *end* time, not its start: members join a game already under way, and a table
-- booked to 21:30 is still a table at 20:00. `completed` is the terminal state that feeds the
-- 記錄賽果 prompt. The legacy values stay in the check so rows written by the old claim flow remain
-- valid until they age out.
ALTER TABLE public.open_calls DROP CONSTRAINT IF EXISTS open_calls_status_check;
ALTER TABLE public.open_calls
  ADD CONSTRAINT open_calls_status_check
  CHECK (status IN ('open','claimed','cancelled','expired','completed'));

-- --- open_call_players: who is coming ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.open_call_players (
  call_id text NOT NULL REFERENCES public.open_calls(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  -- Ordering only. Nothing in the product ranks participants, but the poster should read first in a
  -- list and a stable order stops the card reshuffling between loads.
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, player_id)
);

CREATE INDEX IF NOT EXISTS open_call_players_player_idx
  ON public.open_call_players (player_id, joined_at DESC);

-- --- backfill ----------------------------------------------------------------------------------
-- Every existing call's poster is a participant of it, and anyone who claimed one is the second.
-- Without this the board would render live calls as having nobody in them.

INSERT INTO public.open_call_players (call_id, player_id, joined_at)
SELECT id, player_id, created_at FROM public.open_calls
ON CONFLICT DO NOTHING;

INSERT INTO public.open_call_players (call_id, player_id, joined_at)
SELECT id, claimed_by_id, coalesce(claimed_at, created_at)
FROM public.open_calls WHERE claimed_by_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Calls that were claimed under the old model are ordinary two-participant 局 now; the distinct
-- `claimed` status no longer means anything the board reads.
UPDATE public.open_calls SET status='open' WHERE status='claimed' AND end_at>now();
UPDATE public.open_calls SET status='completed' WHERE status IN ('claimed','expired') AND end_at<=now();

-- Carry the free-text venue over to the reference where it names a venue we know, so existing calls
-- gain district and table data instead of keeping a string the filters cannot read.
UPDATE public.open_calls call
SET venue_id = venue.id
FROM public.venues AS venue
WHERE call.venue_id IS NULL AND call.venue <> '' AND lower(btrim(call.venue)) = lower(venue.name);

-- --- Data API boundary -------------------------------------------------------------------------
-- Same posture as every other operational table: server-side connection only, deny-by-default for
-- the Supabase Data API roles. See 20260826000000_harden_public_rls.sql.

REVOKE ALL ON public.open_call_players FROM PUBLIC, anon, authenticated;
ALTER TABLE public.open_call_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api_clients" ON public.open_call_players;
CREATE POLICY "deny_data_api_clients" ON public.open_call_players
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Live board reads are always "this day's calls, newest first"; the partial index keeps that off a
-- sequential scan once the table has a season of history in it.
CREATE INDEX IF NOT EXISTS open_calls_board_idx
  ON public.open_calls (start_at) WHERE status='open';
