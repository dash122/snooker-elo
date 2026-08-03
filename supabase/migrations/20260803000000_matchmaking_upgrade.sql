-- Matchmaking upgrade: notifications, mutual offers, recurring availability,
-- counter-proposals, venue, and the club's own analytics sink.
--
-- Every statement is idempotent. The application also creates these objects
-- lazily on first use (see db/*.pg.ts), so this file exists for deployments
-- that prefer explicit migrations — running both in either order is safe.

-- --- Push subscriptions and notification preferences ------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  failure_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_player_idx ON push_subscriptions (player_id);

CREATE TABLE IF NOT EXISTS notification_prefs (
  player_id text PRIMARY KEY REFERENCES state_players(id) ON DELETE CASCADE,
  invites boolean NOT NULL DEFAULT true,
  open_calls boolean NOT NULL DEFAULT true,
  offers boolean NOT NULL DEFAULT true,
  results boolean NOT NULL DEFAULT true,
  email_fallback boolean NOT NULL DEFAULT true,
  quiet_from smallint,
  quiet_to smallint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- --- Invites: venue and counter-proposals ----------------------------------
ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT '';
ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS counter_start_at timestamptz;
ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS counter_end_at timestamptz;
ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS counter_by_id text REFERENCES state_players(id) ON DELETE SET NULL;

ALTER TABLE open_calls ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT '';

-- --- Mutual match offers ----------------------------------------------------
-- The pair is stored in a fixed order (a < b) so "is there already an offer
-- between these two" is one unique index rather than a two-way search.
CREATE TABLE IF NOT EXISTS match_offers (
  id text PRIMARY KEY,
  a_player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
  b_player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  venue text NOT NULL DEFAULT '',
  a_response text NOT NULL DEFAULT 'pending',
  b_response text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'live',
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK (end_at > start_at),
  CHECK (a_player_id < b_player_id),
  CHECK (a_response IN ('pending','yes','no')),
  CHECK (b_response IN ('pending','yes','no')),
  CHECK (status IN ('live','matched','dead','expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS match_offers_live_pair_idx ON match_offers (a_player_id,b_player_id) WHERE status='live';
CREATE INDEX IF NOT EXISTS match_offers_a_idx ON match_offers (a_player_id,status);
CREATE INDEX IF NOT EXISTS match_offers_b_idx ON match_offers (b_player_id,status);

-- --- Recurring availability -------------------------------------------------
-- Rules are materialised into ordinary availability_slots rows, so every reader
-- keeps working on plain slots and knows nothing about recurrence.
CREATE TABLE IF NOT EXISTS availability_recurrence (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time text NOT NULL,
  end_time text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS availability_recurrence_unique_idx
  ON availability_recurrence (player_id,weekday,start_time,end_time) WHERE active;
CREATE INDEX IF NOT EXISTS availability_recurrence_player_idx ON availability_recurrence (player_id) WHERE active;

-- --- Analytics --------------------------------------------------------------
-- No foreign key on purpose: signed-out events carry a null player, and an
-- event's historical truth should not vanish because a player row was removed.
CREATE TABLE IF NOT EXISTS analytics_events (
  id bigserial PRIMARY KEY,
  player_id text,
  event text NOT NULL,
  props jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_event_idx ON analytics_events (event,occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_player_idx ON analytics_events (player_id,occurred_at DESC);
