-- Matchmaking MVP: one member, one suitable opponent, one confirmed game.
--
-- The formation prototype allowed groups of 2–8 and multiple pending applicants. Option A keeps the
-- storage shape backwards-compatible, but narrows the product contract to a two-player game. A
-- partial unique index prevents races from turning one availability post into an applicant queue.

UPDATE public.availability_slots SET target_size=2 WHERE target_size<>2;
UPDATE public.matchmaking_sessions SET target_size=2 WHERE target_size<>2;

-- Convert prototype status values to the two-player meaning before the application starts reading
-- them with the MVP copy. A session with two accepted members is already confirmed; anything else is
-- still waiting for the host's answer.
UPDATE public.matchmaking_sessions session
SET status=CASE WHEN accepted.accepted_count>=2 THEN 'full' ELSE 'forming' END,updated_at=now()
FROM (
  SELECT session_id,count(*) FILTER (WHERE status='accepted') AS accepted_count
  FROM public.matchmaking_session_members GROUP BY session_id
) accepted
WHERE session.id=accepted.session_id AND session.status IN ('forming','playable','full');

ALTER TABLE public.availability_slots
  DROP CONSTRAINT IF EXISTS availability_slots_target_size_check;
ALTER TABLE public.availability_slots
  ADD CONSTRAINT availability_slots_target_size_check CHECK (target_size=2);

ALTER TABLE public.matchmaking_sessions
  DROP CONSTRAINT IF EXISTS matchmaking_sessions_target_size_check;
ALTER TABLE public.matchmaking_sessions
  ADD CONSTRAINT matchmaking_sessions_target_size_check CHECK (target_size=2);

-- Keep the earliest applicant if the prototype has already accumulated more than one pending
-- request for a live session. The others can try another opportunity after the migration.
WITH ranked AS (
  SELECT session_id,player_id,
         row_number() OVER (PARTITION BY session_id ORDER BY requested_at,player_id) AS position,
         count(*) FILTER (WHERE status='accepted') OVER (PARTITION BY session_id) AS accepted_count
  FROM public.matchmaking_session_members
  WHERE role='member' AND status IN ('pending','accepted')
)
UPDATE public.matchmaking_session_members member
SET status='withdrawn',updated_at=now()
FROM ranked
WHERE member.session_id=ranked.session_id
  AND member.player_id=ranked.player_id
  AND member.status='pending'
  AND (ranked.position>1 OR ranked.accepted_count>=2);

CREATE UNIQUE INDEX IF NOT EXISTS matchmaking_session_one_pending_member_idx
  ON public.matchmaking_session_members (session_id)
  WHERE role='member' AND status='pending';
