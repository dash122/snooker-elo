-- Invite lifecycle: expiry and post-slot outcomes.
--
-- A pending invite had no terminal state other than a human answering it, and the partial unique
-- index below is on (from_player_id,to_player_id) WHERE status='pending' — so one unanswered invite
-- permanently blocked its sender from ever inviting that opponent again. 'expired' releases the
-- pair; 'played'/'missed' record whether a confirmed game actually happened.
ALTER TABLE match_invites DROP CONSTRAINT IF EXISTS match_invites_status_check;
ALTER TABLE match_invites ADD CONSTRAINT match_invites_status_check
  CHECK (status IN ('pending','accepted','declined','cancelled','expired','played','missed'));
ALTER TABLE match_invites ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Retire invites already stranded by the old behaviour, so existing members are unblocked on deploy
-- rather than on their next write.
UPDATE match_invites SET status='expired', closed_at=now()
  WHERE status='pending' AND start_at<=now();

-- Open calls: a table offered to the whole club instead of a directed 1:1 invite. Reaches the member
-- who never published availability, which is precisely who directed invites cannot reach.
CREATE TABLE IF NOT EXISTS open_calls (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES state_players(id) ON DELETE RESTRICT,
  claimed_by_id text REFERENCES state_players(id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  CHECK (end_at > start_at),
  CHECK (player_id <> claimed_by_id),
  CHECK (status IN ('open','claimed','cancelled','expired'))
);
CREATE INDEX IF NOT EXISTS open_calls_live_idx ON open_calls (start_at) WHERE status='open';
CREATE INDEX IF NOT EXISTS open_calls_player_idx ON open_calls (player_id,status);
