-- Schema bootstrapping used to run inside normal application requests. On a
-- serverless cold start, ALTER TABLE then queued an ACCESS EXCLUSIVE lock on
-- hot tables and blocked every later reader. Keep all schema ownership here.
--
-- The catalog guards matter: unlike ALTER ... IF NOT EXISTS, a false guard
-- never asks PostgreSQL for a heavyweight relation lock on an existing table.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.members') IS NULL THEN
    CREATE TABLE public.members (
      email text PRIMARY KEY NOT NULL,
      username text NOT NULL UNIQUE,
      state_player_id text UNIQUE,
      display_name text NOT NULL,
      role text NOT NULL DEFAULT 'member',
      password_hash text NOT NULL,
      password_salt text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      joined_at text NOT NULL,
      last_seen_at text NOT NULL,
      avatar text,
      deactivated_at text,
      initials text,
      icon_colour text
    );
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members'::regclass AND attname = 'avatar' AND NOT attisdropped) THEN
      ALTER TABLE public.members ADD COLUMN avatar text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members'::regclass AND attname = 'deactivated_at' AND NOT attisdropped) THEN
      ALTER TABLE public.members ADD COLUMN deactivated_at text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members'::regclass AND attname = 'initials' AND NOT attisdropped) THEN
      ALTER TABLE public.members ADD COLUMN initials text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members'::regclass AND attname = 'icon_colour' AND NOT attisdropped) THEN
      ALTER TABLE public.members ADD COLUMN icon_colour text;
    END IF;
  END IF;

  IF to_regclass('public.sessions') IS NULL THEN
    CREATE TABLE public.sessions (
      token_hash text PRIMARY KEY NOT NULL,
      member_email text NOT NULL,
      expires_at text NOT NULL,
      created_at text NOT NULL
    );
  END IF;

  IF to_regclass('public.match_intents') IS NULL THEN
    CREATE TABLE public.match_intents (
      id text PRIMARY KEY,
      player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('tonight','window','standby')),
      start_at timestamptz,
      end_at timestamptz,
      note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'live' CHECK (status IN ('live','withdrawn','expired')),
      preference text NOT NULL DEFAULT 'any',
      CHECK (kind <> 'standby' OR (start_at IS NULL AND end_at IS NULL))
    );
  END IF;

  IF to_regclass('public.club_presence') IS NULL THEN
    CREATE TABLE public.club_presence (
      player_id text PRIMARY KEY REFERENCES public.state_players(id) ON DELETE CASCADE,
      arrived_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  END IF;

  IF to_regclass('public.slot_hands') IS NULL THEN
    CREATE TABLE public.slot_hands (
      id text PRIMARY KEY,
      slot_id text NOT NULL REFERENCES public.availability_slots(id) ON DELETE CASCADE,
      player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
      raised_at timestamptz NOT NULL DEFAULT now(),
      retracted_at timestamptz,
      accepted_at timestamptz
    );
  END IF;

  IF to_regclass('public.slot_watchers') IS NULL THEN
    CREATE TABLE public.slot_watchers (
      id text PRIMARY KEY,
      watcher_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
      target_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (watcher_id <> target_id)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sessions_member_email_idx ON public.sessions (member_email);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON public.sessions (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS match_intents_live_player_idx ON public.match_intents (player_id) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS club_presence_live_idx ON public.club_presence (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS slot_hands_active_idx ON public.slot_hands (slot_id, player_id) WHERE retracted_at IS NULL;
CREATE INDEX IF NOT EXISTS slot_hands_player_idx ON public.slot_hands (player_id) WHERE retracted_at IS NULL;
CREATE INDEX IF NOT EXISTS slot_hands_slot_idx ON public.slot_hands (slot_id) WHERE retracted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS slot_watchers_pair_idx ON public.slot_watchers (watcher_id, target_id);
CREATE INDEX IF NOT EXISTS slot_watchers_target_idx ON public.slot_watchers (target_id);
