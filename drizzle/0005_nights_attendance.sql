-- 場次 · a night is derived, not opened.
--
-- The row is materialised lazily, on the first signal for that date, rather than pre-generated for
-- every evening: the club does not need thousands of empty rows to answer 「今晚有無人」, and a
-- venue column later turns this into (venue × date) without a rewrite.
CREATE TABLE IF NOT EXISTS nights (
  id text PRIMARY KEY NOT NULL,
  night_date date NOT NULL UNIQUE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

-- What a member says about a night. One row per member per night, replaced in place — a change of
-- mind is not a second opinion, and `set_at` moving forward is what makes the signal weigh more.
--
-- `upgrade_at` is 夠人就去: promote to 'high' once that many people (this member included) are
-- confirmed. It is the member's own threshold rather than a club constant, because what counts as
-- 「夠人」 is a personal judgement. `promoted_at` records that the club made the commitment on their
-- behalf, so it can be shown as such and so a promotion is never silently re-run.
CREATE TABLE IF NOT EXISTS night_attendance (
  night_id text NOT NULL REFERENCES nights(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
  confidence text NOT NULL,
  upgrade_at smallint,
  promoted_at timestamptz,
  set_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (night_id, player_id),
  CHECK (confidence IN ('high','mid','low','out')),
  CHECK (upgrade_at IS NULL OR (upgrade_at >= 2 AND upgrade_at <= 12)),
  -- A member who declined cannot also be waiting on a threshold; the two states contradict, and
  -- allowing both would let a decline be quietly reversed by other people's taps.
  CHECK (confidence <> 'out' OR upgrade_at IS NULL)
);

CREATE INDEX IF NOT EXISTS night_attendance_night_idx ON night_attendance (night_id) WHERE confidence <> 'out';
CREATE INDEX IF NOT EXISTS night_attendance_player_idx ON night_attendance (player_id, night_id);
-- The promotion engine's hot read: everyone still waiting on a threshold for one night.
CREATE INDEX IF NOT EXISTS night_attendance_pending_idx ON night_attendance (night_id, upgrade_at)
  WHERE upgrade_at IS NOT NULL AND confidence <> 'high' AND confidence <> 'out';
