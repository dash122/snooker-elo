--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id bigint NOT NULL,
    player_id text,
    event text NOT NULL,
    props jsonb,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_events_id_seq OWNED BY public.analytics_events.id;


--
-- Name: app_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_state (
    id integer NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: app_state_snapshot_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_state_snapshot_entities (
    content_hash text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    payload jsonb NOT NULL
);


--
-- Name: app_state_snapshot_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_state_snapshot_items (
    snapshot_id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    content_hash text NOT NULL,
    "position" integer NOT NULL
);


--
-- Name: app_state_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_state_snapshots (
    id bigint NOT NULL,
    state jsonb,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_state_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_state_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_state_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_state_snapshots_id_seq OWNED BY public.app_state_snapshots.id;


--
-- Name: availability_recurrence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability_recurrence (
    id text NOT NULL,
    player_id text NOT NULL,
    weekday smallint NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT availability_recurrence_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: availability_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability_slots (
    id text NOT NULL,
    player_id text NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    venue text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    posted boolean DEFAULT false NOT NULL,
    fill_rule text DEFAULT 'first'::text NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    filled_by text,
    filled_at timestamp with time zone,
    result text DEFAULT 'pending'::text NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT availability_slots_check CHECK ((end_at > start_at)),
    CONSTRAINT availability_slots_fill_rule_check CHECK ((fill_rule = ANY (ARRAY['first'::text, 'review'::text]))),
    CONSTRAINT availability_slots_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'played'::text, 'missed'::text])))
);


--
-- Name: club_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_presence (
    player_id text NOT NULL,
    arrived_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: match_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_intents (
    id text NOT NULL,
    player_id text NOT NULL,
    kind text NOT NULL,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'live'::text NOT NULL,
    preference text DEFAULT 'any'::text NOT NULL,
    CONSTRAINT match_intents_check CHECK (((kind <> 'standby'::text) OR ((start_at IS NULL) AND (end_at IS NULL)))),
    CONSTRAINT match_intents_kind_check CHECK ((kind = ANY (ARRAY['tonight'::text, 'window'::text, 'standby'::text]))),
    CONSTRAINT match_intents_status_check CHECK ((status = ANY (ARRAY['live'::text, 'withdrawn'::text, 'expired'::text])))
);


--
-- Name: match_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_invites (
    id text NOT NULL,
    from_player_id text NOT NULL,
    to_player_id text NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    closed_at timestamp with time zone,
    venue text DEFAULT ''::text NOT NULL,
    counter_start_at timestamp with time zone,
    counter_end_at timestamp with time zone,
    counter_by_id text,
    CONSTRAINT match_invites_check CHECK ((end_at > start_at)),
    CONSTRAINT match_invites_check1 CHECK ((from_player_id <> to_player_id)),
    CONSTRAINT match_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text, 'expired'::text, 'played'::text, 'missed'::text])))
);


--
-- Name: match_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_offers (
    id text NOT NULL,
    a_player_id text NOT NULL,
    b_player_id text NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    venue text DEFAULT ''::text NOT NULL,
    a_response text DEFAULT 'pending'::text NOT NULL,
    b_response text DEFAULT 'pending'::text NOT NULL,
    status text DEFAULT 'live'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT match_offers_a_response_check CHECK ((a_response = ANY (ARRAY['pending'::text, 'yes'::text, 'no'::text]))),
    CONSTRAINT match_offers_b_response_check CHECK ((b_response = ANY (ARRAY['pending'::text, 'yes'::text, 'no'::text]))),
    CONSTRAINT match_offers_check CHECK ((end_at > start_at)),
    CONSTRAINT match_offers_check1 CHECK ((a_player_id < b_player_id)),
    CONSTRAINT match_offers_status_check CHECK ((status = ANY (ARRAY['live'::text, 'matched'::text, 'dead'::text, 'expired'::text])))
);


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    email text NOT NULL,
    display_name text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    password_hash text,
    password_salt text,
    active boolean DEFAULT true NOT NULL,
    joined_at text NOT NULL,
    last_seen_at text NOT NULL,
    username text NOT NULL,
    state_player_id text,
    avatar text,
    deactivated_at text,
    initials text,
    icon_colour text,
    provider text DEFAULT 'local'::text NOT NULL
);


--
-- Name: notification_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_prefs (
    player_id text NOT NULL,
    invites boolean DEFAULT true NOT NULL,
    open_calls boolean DEFAULT true NOT NULL,
    offers boolean DEFAULT true NOT NULL,
    results boolean DEFAULT true NOT NULL,
    email_fallback boolean DEFAULT true NOT NULL,
    quiet_from smallint,
    quiet_to smallint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: open_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_calls (
    id text NOT NULL,
    player_id text NOT NULL,
    claimed_by_id text,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    venue text DEFAULT ''::text NOT NULL,
    CONSTRAINT open_calls_check CHECK ((end_at > start_at)),
    CONSTRAINT open_calls_check1 CHECK ((player_id <> claimed_by_id)),
    CONSTRAINT open_calls_status_check CHECK ((status = ANY (ARRAY['open'::text, 'claimed'::text, 'cancelled'::text, 'expired'::text])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    endpoint text NOT NULL,
    player_id text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token_hash text NOT NULL,
    member_email text NOT NULL,
    expires_at text NOT NULL,
    created_at text NOT NULL
);


--
-- Name: slot_hands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_hands (
    id text NOT NULL,
    slot_id text NOT NULL,
    player_id text NOT NULL,
    raised_at timestamp with time zone DEFAULT now() NOT NULL,
    retracted_at timestamp with time zone,
    accepted_at timestamp with time zone
);


--
-- Name: slot_watchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_watchers (
    id text NOT NULL,
    watcher_id text NOT NULL,
    target_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slot_watchers_check CHECK ((watcher_id <> target_id))
);


--
-- Name: state_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_audits (
    id text NOT NULL,
    text text NOT NULL,
    occurred_at timestamp with time zone NOT NULL
);


--
-- Name: state_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_matches (
    id text NOT NULL,
    player_a text NOT NULL,
    player_b text NOT NULL,
    played_on date,
    status text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    score_a integer NOT NULL,
    score_b integer NOT NULL,
    entry_mode text,
    frame_evidence numeric,
    performance_score numeric,
    evidence_weight numeric,
    handicap_adjustment numeric,
    over_handicap_elo numeric,
    over_handicap_multiplier numeric,
    high_breaks jsonb DEFAULT '[]'::jsonb NOT NULL,
    actual numeric NOT NULL,
    giver text,
    official numeric,
    extra numeric NOT NULL,
    expected_a numeric NOT NULL,
    before_a numeric NOT NULL,
    before_b numeric NOT NULL,
    after_a numeric NOT NULL,
    after_b numeric NOT NULL,
    delta_a numeric NOT NULL,
    margin_multiplier numeric,
    created_at timestamp with time zone NOT NULL,
    player_a2 text,
    player_b2 text,
    mode text,
    before_a2 numeric,
    before_b2 numeric,
    after_a2 numeric,
    after_b2 numeric,
    team_a_name text,
    team_b_name text,
    tournament_id text,
    tournament_round integer,
    tournament_match_index integer
);


--
-- Name: state_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_players (
    id text NOT NULL,
    name text NOT NULL,
    rating numeric NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    short text NOT NULL,
    handicap numeric,
    colour text,
    initial_rating numeric NOT NULL,
    wins integer DEFAULT 0 NOT NULL,
    losses integer DEFAULT 0 NOT NULL,
    draws integer DEFAULT 0 NOT NULL,
    frames_won integer DEFAULT 0 NOT NULL,
    frames_lost integer DEFAULT 0 NOT NULL,
    last_change numeric DEFAULT 0 NOT NULL,
    form jsonb DEFAULT '[]'::jsonb NOT NULL,
    avatar text
);


--
-- Name: state_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_settings (
    id boolean DEFAULT true NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT state_settings_id_check CHECK (id)
);


--
-- Name: state_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_subscriptions (
    endpoint text NOT NULL,
    subscription jsonb NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: state_tournaments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_tournaments (
    id text NOT NULL,
    name text NOT NULL,
    handicap_mode text NOT NULL,
    signup_deadline timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by text,
    signups jsonb DEFAULT '[]'::jsonb NOT NULL,
    draw jsonb,
    drawn_at timestamp with time zone,
    walkovers jsonb
);


--
-- Name: analytics_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events ALTER COLUMN id SET DEFAULT nextval('public.analytics_events_id_seq'::regclass);


--
-- Name: app_state_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_snapshots ALTER COLUMN id SET DEFAULT nextval('public.app_state_snapshots_id_seq'::regclass);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: app_state app_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state
    ADD CONSTRAINT app_state_pkey PRIMARY KEY (id);


--
-- Name: app_state_snapshot_entities app_state_snapshot_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_snapshot_entities
    ADD CONSTRAINT app_state_snapshot_entities_pkey PRIMARY KEY (content_hash);


--
-- Name: app_state_snapshot_items app_state_snapshot_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_snapshot_items
    ADD CONSTRAINT app_state_snapshot_items_pkey PRIMARY KEY (snapshot_id, entity_type, entity_id);


--
-- Name: app_state_snapshots app_state_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_snapshots
    ADD CONSTRAINT app_state_snapshots_pkey PRIMARY KEY (id);


--
-- Name: availability_recurrence availability_recurrence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_recurrence
    ADD CONSTRAINT availability_recurrence_pkey PRIMARY KEY (id);


--
-- Name: availability_slots availability_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_slots
    ADD CONSTRAINT availability_slots_pkey PRIMARY KEY (id);


--
-- Name: club_presence club_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_presence
    ADD CONSTRAINT club_presence_pkey PRIMARY KEY (player_id);


--
-- Name: match_intents match_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_intents
    ADD CONSTRAINT match_intents_pkey PRIMARY KEY (id);


--
-- Name: match_invites match_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_invites
    ADD CONSTRAINT match_invites_pkey PRIMARY KEY (id);


--
-- Name: match_offers match_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_offers
    ADD CONSTRAINT match_offers_pkey PRIMARY KEY (id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (email);


--
-- Name: notification_prefs notification_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_prefs
    ADD CONSTRAINT notification_prefs_pkey PRIMARY KEY (player_id);


--
-- Name: open_calls open_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_calls
    ADD CONSTRAINT open_calls_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (endpoint);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: slot_hands slot_hands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_hands
    ADD CONSTRAINT slot_hands_pkey PRIMARY KEY (id);


--
-- Name: slot_watchers slot_watchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_watchers
    ADD CONSTRAINT slot_watchers_pkey PRIMARY KEY (id);


--
-- Name: state_audits state_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_audits
    ADD CONSTRAINT state_audits_pkey PRIMARY KEY (id);


--
-- Name: state_matches state_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_matches
    ADD CONSTRAINT state_matches_pkey PRIMARY KEY (id);


--
-- Name: state_players state_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_players
    ADD CONSTRAINT state_players_pkey PRIMARY KEY (id);


--
-- Name: state_settings state_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_settings
    ADD CONSTRAINT state_settings_pkey PRIMARY KEY (id);


--
-- Name: state_subscriptions state_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_subscriptions
    ADD CONSTRAINT state_subscriptions_pkey PRIMARY KEY (endpoint);


--
-- Name: state_tournaments state_tournaments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_tournaments
    ADD CONSTRAINT state_tournaments_pkey PRIMARY KEY (id);


--
-- Name: analytics_events_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_event_idx ON public.analytics_events USING btree (event, occurred_at DESC);


--
-- Name: analytics_events_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_player_idx ON public.analytics_events USING btree (player_id, occurred_at DESC);


--
-- Name: app_state_snapshot_items_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_state_snapshot_items_lookup_idx ON public.app_state_snapshot_items USING btree (snapshot_id, entity_type, "position");


--
-- Name: availability_recurrence_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_recurrence_player_idx ON public.availability_recurrence USING btree (player_id) WHERE active;


--
-- Name: availability_recurrence_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX availability_recurrence_unique_idx ON public.availability_recurrence USING btree (player_id, weekday, start_time, end_time) WHERE active;


--
-- Name: availability_slots_active_range_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_slots_active_range_idx ON public.availability_slots USING btree (start_at, end_at) WHERE (cancelled_at IS NULL);


--
-- Name: availability_slots_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_slots_board_idx ON public.availability_slots USING btree (start_at) WHERE ((posted = true) AND (cancelled_at IS NULL) AND (filled_by IS NULL));


--
-- Name: availability_slots_player_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_slots_player_active_idx ON public.availability_slots USING btree (player_id, start_at) WHERE (cancelled_at IS NULL);


--
-- Name: club_presence_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX club_presence_live_idx ON public.club_presence USING btree (expires_at);


--
-- Name: match_intents_live_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX match_intents_live_player_idx ON public.match_intents USING btree (player_id) WHERE (status = 'live'::text);


--
-- Name: match_invites_from_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_invites_from_player_idx ON public.match_invites USING btree (from_player_id, status);


--
-- Name: match_invites_pending_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX match_invites_pending_pair_idx ON public.match_invites USING btree (from_player_id, to_player_id) WHERE (status = 'pending'::text);


--
-- Name: match_invites_to_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_invites_to_player_idx ON public.match_invites USING btree (to_player_id, status);


--
-- Name: match_offers_a_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_offers_a_idx ON public.match_offers USING btree (a_player_id, status);


--
-- Name: match_offers_b_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_offers_b_idx ON public.match_offers USING btree (b_player_id, status);


--
-- Name: match_offers_live_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX match_offers_live_pair_idx ON public.match_offers USING btree (a_player_id, b_player_id) WHERE (status = 'live'::text);


--
-- Name: members_state_player_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_state_player_id_idx ON public.members USING btree (state_player_id);


--
-- Name: members_username_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_username_idx ON public.members USING btree (username);


--
-- Name: open_calls_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_calls_live_idx ON public.open_calls USING btree (start_at) WHERE (status = 'open'::text);


--
-- Name: open_calls_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_calls_player_idx ON public.open_calls USING btree (player_id, status);


--
-- Name: push_subscriptions_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_player_idx ON public.push_subscriptions USING btree (player_id);


--
-- Name: sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at);


--
-- Name: sessions_member_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_member_email_idx ON public.sessions USING btree (member_email);


--
-- Name: slot_hands_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slot_hands_active_idx ON public.slot_hands USING btree (slot_id, player_id) WHERE (retracted_at IS NULL);


--
-- Name: slot_hands_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_hands_player_idx ON public.slot_hands USING btree (player_id) WHERE (retracted_at IS NULL);


--
-- Name: slot_hands_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_hands_slot_idx ON public.slot_hands USING btree (slot_id) WHERE (retracted_at IS NULL);


--
-- Name: slot_watchers_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slot_watchers_pair_idx ON public.slot_watchers USING btree (watcher_id, target_id);


--
-- Name: slot_watchers_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_watchers_target_idx ON public.slot_watchers USING btree (target_id);


--
-- Name: state_audits_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX state_audits_occurred_at_idx ON public.state_audits USING btree (occurred_at DESC);


--
-- Name: state_matches_played_on_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX state_matches_played_on_idx ON public.state_matches USING btree (played_on);


--
-- Name: state_matches_players_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX state_matches_players_idx ON public.state_matches USING btree (player_a, player_b);


--
-- Name: app_state_snapshot_items app_state_snapshot_items_content_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_snapshot_items
    ADD CONSTRAINT app_state_snapshot_items_content_hash_fkey FOREIGN KEY (content_hash) REFERENCES public.app_state_snapshot_entities(content_hash);


--
-- Name: app_state_snapshot_items app_state_snapshot_items_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_snapshot_items
    ADD CONSTRAINT app_state_snapshot_items_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.app_state_snapshots(id) ON DELETE CASCADE;


--
-- Name: availability_recurrence availability_recurrence_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_recurrence
    ADD CONSTRAINT availability_recurrence_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: availability_slots availability_slots_filled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_slots
    ADD CONSTRAINT availability_slots_filled_by_fkey FOREIGN KEY (filled_by) REFERENCES public.state_players(id);


--
-- Name: availability_slots availability_slots_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_slots
    ADD CONSTRAINT availability_slots_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE RESTRICT;


--
-- Name: club_presence club_presence_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_presence
    ADD CONSTRAINT club_presence_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: match_intents match_intents_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_intents
    ADD CONSTRAINT match_intents_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: match_invites match_invites_counter_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_invites
    ADD CONSTRAINT match_invites_counter_by_id_fkey FOREIGN KEY (counter_by_id) REFERENCES public.state_players(id) ON DELETE SET NULL;


--
-- Name: match_invites match_invites_from_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_invites
    ADD CONSTRAINT match_invites_from_player_id_fkey FOREIGN KEY (from_player_id) REFERENCES public.state_players(id) ON DELETE RESTRICT;


--
-- Name: match_invites match_invites_to_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_invites
    ADD CONSTRAINT match_invites_to_player_id_fkey FOREIGN KEY (to_player_id) REFERENCES public.state_players(id) ON DELETE RESTRICT;


--
-- Name: match_offers match_offers_a_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_offers
    ADD CONSTRAINT match_offers_a_player_id_fkey FOREIGN KEY (a_player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: match_offers match_offers_b_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_offers
    ADD CONSTRAINT match_offers_b_player_id_fkey FOREIGN KEY (b_player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: members members_state_player_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_state_player_fk FOREIGN KEY (state_player_id) REFERENCES public.state_players(id) ON DELETE SET NULL;


--
-- Name: notification_prefs notification_prefs_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_prefs
    ADD CONSTRAINT notification_prefs_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: open_calls open_calls_claimed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_calls
    ADD CONSTRAINT open_calls_claimed_by_id_fkey FOREIGN KEY (claimed_by_id) REFERENCES public.state_players(id) ON DELETE RESTRICT;


--
-- Name: open_calls open_calls_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_calls
    ADD CONSTRAINT open_calls_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE RESTRICT;


--
-- Name: push_subscriptions push_subscriptions_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: slot_hands slot_hands_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_hands
    ADD CONSTRAINT slot_hands_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: slot_hands slot_hands_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_hands
    ADD CONSTRAINT slot_hands_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.availability_slots(id) ON DELETE CASCADE;


--
-- Name: slot_watchers slot_watchers_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_watchers
    ADD CONSTRAINT slot_watchers_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: slot_watchers slot_watchers_watcher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_watchers
    ADD CONSTRAINT slot_watchers_watcher_id_fkey FOREIGN KEY (watcher_id) REFERENCES public.state_players(id) ON DELETE CASCADE;


--
-- Name: state_matches state_matches_player_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_matches
    ADD CONSTRAINT state_matches_player_a_fkey FOREIGN KEY (player_a) REFERENCES public.state_players(id) ON DELETE RESTRICT;


--
-- Name: state_matches state_matches_player_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_matches
    ADD CONSTRAINT state_matches_player_b_fkey FOREIGN KEY (player_b) REFERENCES public.state_players(id) ON DELETE RESTRICT;


--
-- Name: state_matches state_matches_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_matches
    ADD CONSTRAINT state_matches_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.state_tournaments(id) ON DELETE SET NULL;


--
-- Name: state_tournaments state_tournaments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_tournaments
    ADD CONSTRAINT state_tournaments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.state_players(id) ON DELETE SET NULL;


--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: app_state_snapshot_entities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_state_snapshot_entities ENABLE ROW LEVEL SECURITY;

--
-- Name: app_state_snapshot_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_state_snapshot_items ENABLE ROW LEVEL SECURITY;

--
-- Name: availability_recurrence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.availability_recurrence ENABLE ROW LEVEL SECURITY;

--
-- Name: club_presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_presence ENABLE ROW LEVEL SECURITY;

--
-- Name: match_intents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: match_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: open_calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_hands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.slot_hands ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_watchers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.slot_watchers ENABLE ROW LEVEL SECURITY;

--
-- Name: state_tournaments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.state_tournaments ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--
