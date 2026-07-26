-- Player photos live on the state row, not just the member row, so the
-- leaderboard, player cards and head-to-head can render them from the public
-- state payload without a second authenticated lookup.
ALTER TABLE state_players ADD COLUMN IF NOT EXISTS avatar text;

UPDATE state_players p
SET avatar = m.avatar
FROM members m
WHERE m.state_player_id = p.id
  AND m.avatar IS NOT NULL;
