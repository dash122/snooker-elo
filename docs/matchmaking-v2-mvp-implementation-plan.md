# Snooker ELO Matchmaking 2.0 — MVP Implementation Plan

> Codex execution brief  
> Repository: `dash122/snooker-elo`  
> Goal: replace the current host-owned `局` mental model with a public, asynchronous, hostless matchmaking marketplace that can scale from SCAA to Hong Kong-wide usage.

---

## 0. Executive summary

### Product decision

The MVP should **not** choose between `局` and `availability` as the primary product unit.

Use this hierarchy:

```text
MATCHABLE AVAILABILITY
"I am free / I actively want to play"
        ↓
PUBLIC DISCOVERY
"Who is free?"
        ↓
MATCHING ENGINE
"Which formations are viable for me?"
        ↓
FORMATION
"A possible 1v1 / small group / rotation group"
        ↓
ASYNC INTEREST / JOIN
"Each player independently opts in"
        ↓
HOSTLESS SESSION
"Enough players have opted in; the game is formed"
        ↓
PLAYED MATCH
"ELO result"
```

The MVP must satisfy five principles:

1. **Availability is public and discoverable** to signed-in members; it must not only exist as hidden matching-engine input.
2. **A formation is not owned by a host.** The first player to join does not gain cancellation authority over everyone else.
3. **Users do not need to be online simultaneously.** Joining/accepting is asynchronous and notification-driven.
4. **Ten compatible players do not automatically become one 10-player group.** The engine proposes multiple formation shapes: 1v1, small group, rotation.
5. **Preferences are split into hard constraints and soft ranking signals.** Do not destroy marketplace liquidity by making every preference a filter.

### North-star outcome

Maximise:

> **Published matchable availability → played snooker**

Do not optimise for number of slots posted, number of `局` created, or number of users shown in a pool.

---

# 1. Current-state findings to preserve / reverse

The current codebase already contains useful building blocks:

- `availability_slots` is the correct canonical source for player time windows.
- `commitment` already exists with `going | interested`.
- `match_intents` already separates "I want a game" from passive availability.
- `db/matchmaking-formation.pg.ts` already computes overlap, ELO difference, venue compatibility and ranked opportunities.
- `matchmaking_sessions` + `matchmaking_session_members` already model asynchronous request / response.
- `lib/notify.ts` already supports invite / offer / result channels.
- `lib/availability-analytics.ts` already has a first-party analytics funnel.
- `WeekBand` already supports rapid publication and overlap scanning.
- `venues` already has a district field and is not SCAA-only.

However, the current live UI has regressed to a host-owned `OpenBoard` model:

- `HomeClient.tsx` renders `OpenBoard` for the 約戰 tab.
- `open_calls.player_id` remains the effective owner / host.
- cancelling by the host cancels the whole call.
- the September 7 migration explicitly collapsed availability and formation into one host-owned `局`.
- the August 31 migration constrained formation to `target_size = 2`, despite the previous formation schema supporting groups.

**MVP direction:** revive and evolve the formation architecture rather than add more behaviour to `OpenBoard`.

Do **not** delete OpenBoard initially. Build Matchmaking 2.0 alongside it, then cut over after the new flow passes tests.

---

# 2. MVP product scope

## 2.1 Must-have

### A. Two availability strengths

Reuse the existing `availability_slots.commitment` column:

| DB value | Product label | Meaning | Matching priority |
|---|---|---|---|
| `interested` | 可以約我 | Public availability; others may find/invite me | Medium |
| `going` | 找緊波 | I actively want a game | High |

Do not introduce a second parallel availability object.

The user should be able to turn `可以約我` into `找緊波` with one tap.

### B. Public availability discovery

Signed-in members can browse:

- date
- time window
- player
- ELO
- preferred venue / district
- active-vs-open intent
- group-shape preference
- relevant compatibility hints

Guest users may see aggregate counts only. Do not expose named player schedules to anonymous web users in the MVP.

### C. Group-shape preference

When publishing availability, ask:

> 今晚想點打？

Presets:

| UI preset | min | ideal | max |
|---|---:|---:|---:|
| 認真對打 | 2 | 2 | 2 |
| 細局 | 2 | 3 | 3 |
| 多人輪流 | 4 | 5 | 6 |
| 有波打就得 | 2 | 4 | 6 |

The backend should store numbers, not only the label.

The label is a UI affordance; compatibility must be calculated from the numeric acceptable range.

### D. Formation candidates

The engine must be able to show several possible ways of using the same pool.

Example: ten people at SCAA tonight may produce:

- 1v1 candidate
- 3-player small-group candidate
- 4–6 player rotation candidate

Potential players may appear in multiple **unconfirmed** candidate formations. Do not hard-allocate users before consent.

### E. Hostless formation lifecycle

A formation / session must not be controlled by its first participant.

The first person joining simply becomes an accepted member.

If that person later leaves:

- other accepted members remain
- session is not cancelled
- status is recalculated
- if accepted count drops below minimum, session returns to `forming`
- matching engine resumes recruitment
- if accepted count becomes zero, cancel the empty formation

### F. Asynchronous consent

No simultaneous online presence is required.

For public formations:

- user taps `加入 / 有興趣`
- they become an accepted member
- other compatible players can discover the same formation later
- eligible active players may receive a notification

For direct People-first invitations:

- inviter becomes accepted
- target receives a pending invitation
- target can accept / decline later
- accepted target joins the same hostless formation

### G. Private "do not recommend"

Add a private player-to-player exclusion.

UI:

> 不再推薦此球員

Rules:

- private
- other player never sees who excluded them
- one-way exclusion is treated as a hard incompatibility for both sides
- exclusion affects matchmaking only; it does not alter historical matches or visibility of leaderboard/profile

---

# 3. Non-goals for this MVP

Do **not** implement these yet:

- exhaustive optimal graph partitioning
- live table inventory / table booking
- automatic venue booking
- travel-time APIs / maps / GPS distance
- public star ratings or player reviews
- friend / follow graph
- chat / DMs
- automatic contact exchange
- payment splitting
- complex waitlists / reserves
- multiple simultaneous confirmed sessions for one player in overlapping times
- anonymous public access to named availability
- delete-and-rebuild of old OpenBoard tables

The first engine can be deterministic and greedy. Correct product semantics matter more than mathematical optimality.

---

# 4. Domain model

## 4.1 Canonical objects

### `availability_slots`

Represents:

> "During this window I am matchable, under these preferences."

This remains the canonical source of availability.

### `formation candidate`

A computed, possibly ephemeral recommendation:

> "This is a viable way for players in the current pool to form a game."

Do not persist every candidate.

### `matchmaking_sessions`

Persist only after somebody expresses interest / joins.

A persisted session is a **hostless formation thread**.

### `matchmaking_session_members`

Represents consent state of a player in the formation.

---

# 5. Database changes

Create a new Supabase migration, e.g.

`supabase/migrations/202609xx_matchmaking_marketplace_mvp.sql`

## 5.1 `availability_slots`

### Re-open group sizing

The current migration constrains `target_size = 2`.

Change:

```sql
ALTER TABLE public.availability_slots
  DROP CONSTRAINT IF EXISTS availability_slots_target_size_check;

ALTER TABLE public.availability_slots
  ADD CONSTRAINT availability_slots_target_size_check
  CHECK (target_size BETWEEN 2 AND 6);
```

Treat:

- `target_size` = ideal player count

Add:

```sql
ALTER TABLE public.availability_slots
  ADD COLUMN IF NOT EXISTS min_players smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_players smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS venue_scope text NOT NULL DEFAULT 'exact';
```

Constraints:

```text
2 <= min_players <= target_size <= max_players <= 6
venue_scope IN ('exact','district','any_hk')
```

Interpretation:

- `exact`: selected venue is a hard constraint
- `district`: selected venue is preferred; any venue in its district is acceptable
- `any_hk`: selected venue is preferred; Hong Kong-wide is acceptable

If `venue_id` is null:

- `exact` is invalid
- use `any_hk`
- future work may add district-only publication

### Conditions JSON

Keep `conditions` JSON for non-index-critical preferences in MVP.

Normalise its TypeScript contract to include:

```ts
type MatchConditions = {
  handicap?: boolean;
  noSmoking?: boolean;
  levelPreference?: "similar" | "any";
  levelStrict?: boolean;        // advanced; default false
  feePreference?: "aa" | "any";
  tempo?: "sport" | "casual" | "any";
};
```

Important:

- replace host-centric `costSplit: "host"` semantics in the new marketplace
- use `aa | any`
- do not migrate / reinterpret historical OpenBoard calls

### `commitment`

Keep existing DB values:

```text
going
interested
```

Do not add a new intent table for the MVP UI.

Product mapping:

```text
going       = active / 找緊波
interested  = open / 可以約我
```

`match_intents` may remain in DB for backwards compatibility; the new marketplace should not require it as a second user-facing state.

---

## 5.2 `matchmaking_sessions`

Evolve this table into a hostless formation.

Current host / anchor fields can remain for backwards compatibility, but new rows must not depend on them.

Recommended migration:

```sql
ALTER TABLE public.matchmaking_sessions
  ALTER COLUMN host_player_id DROP NOT NULL,
  ALTER COLUMN anchor_slot_id DROP NOT NULL;

ALTER TABLE public.matchmaking_sessions
  ADD COLUMN IF NOT EXISTS created_by_player_id text
    REFERENCES public.state_players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS min_players smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_players smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'marketplace';
```

Constraints:

```text
2 <= min_players <= target_size <= max_players <= 6
source IN ('marketplace','direct','legacy')
```

For all newly created rows:

- `host_player_id = NULL`
- `anchor_slot_id = NULL` unless useful for traceability
- `created_by_player_id` is audit metadata only
- creator has no special rights

### Status semantics

Keep existing states:

```text
forming
playable
full
cancelled
completed
```

Re-define them:

```text
forming   accepted_count < min_players
playable  min_players <= accepted_count < max_players
full      accepted_count >= max_players
cancelled no valid members / system cancelled
completed session ended
```

`target_size` is ideal size, not the threshold for "成局".

---

## 5.3 `matchmaking_session_members`

Remove one-pending-user restriction:

```sql
DROP INDEX IF EXISTS matchmaking_session_one_pending_member_idx;
```

Stop using `role` for all new marketplace sessions.

Do not need to drop the legacy column immediately.

For new rows:

```text
role = 'member'
```

Extend status if necessary:

```text
pending
accepted
declined
withdrawn
```

Semantics:

- `pending` = directly invited, awaiting answer
- `accepted` = explicitly joined / accepted
- `declined` = declined a direct invitation
- `withdrawn` = previously accepted/pending, then left

Public marketplace users should normally enter directly as `accepted`.

The table already contains `availability_slot_id`; populate it so each membership is traceable to the availability that made the player eligible.

---

## 5.4 Private pair exclusions

Create:

```sql
CREATE TABLE public.matchmaking_pair_preferences (
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  other_player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  preference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, other_player_id),
  CHECK (player_id <> other_player_id),
  CHECK (preference IN ('avoid'))
);
```

Add index on `other_player_id`.

Use same RLS / direct-server-only posture as existing operational matchmaking tables.

---

## 5.5 Optional later schema, not MVP

Do not add now unless implementation proves necessary:

- `venues.lat/lng`
- user-level persistent default matchmaking preferences
- materialised opportunity table
- table inventory
- reliability score table

Reliability can initially be calculated from existing match/session/analytics data later.

---

# 6. Matching engine

Create a new pure domain module:

`lib/matchmaking-marketplace.ts`

Persistence / queries:

`db/matchmaking-marketplace.pg.ts`

Do not keep adding complexity to `db/open-board.pg.ts`.

## 6.1 Step 1 — fetch matchable supply

For selected horizon (default next 7 days):

```text
availability_slots
WHERE cancelled_at IS NULL
AND end_at > now()
AND start_at < now() + 7 days
```

For current viewer:

- include own slots
- exclude players disabled / inactive
- attach venue
- attach rating
- attach pair exclusions
- attach historical opponent metrics if already cheap enough

---

## 6.2 Step 2 — hard eligibility

Two players / slots are eligible only if:

### Time

Common window >= 60 minutes.

### Pair exclusion

Neither direction has an `avoid`.

### Venue

Compatibility rules:

```text
exact + exact
  compatible only if same venue

exact + district
  compatible if exact venue is in district player's acceptable district

exact + any_hk
  compatible

district + district
  compatible if districts overlap / match in MVP

district + any_hk
  compatible

any_hk + any_hk
  compatible
```

Choose the formation venue by strongest constraint:

```text
exact venue
→ preferred same-district venue
→ highest-scoring preferred venue
```

Do not solve travel time yet.

### Confirmed-session conflict

A player already accepted into a `playable/full` overlapping session cannot join another conflicting formation.

### Group range

For candidate group size `N`, every included player's:

```text
min_players <= N <= max_players
```

must hold.

### Other hard conditions

Only make an item hard if the user explicitly asked for strictness.

Examples:

- `levelStrict = true`
- a venue requirement

Do not make "similar level preferred" hard by default.

---

## 6.3 Step 3 — soft scoring

Initial score can be simple and explainable.

Recommended components:

```text
intent strength
time overlap
venue preference fit
group-size preference fit
ELO fit
new-opponent bonus
recent-opponent penalty
```

Suggested MVP priorities, not fixed constants:

```text
Active intent          very high
Existing formation     very high
Time overlap           high
Group-size fit         high
Venue preference       high
ELO fit                medium
Novel opponent         low-medium
Recent repeats         negative
```

Do not optimise weights before real usage data exists.

### Automatic level relaxation

User decision: automatically widen level preference.

Example:

```text
Tier 1: ±100 ELO
Tier 2: ±200 ELO
Tier 3: >±200 if handicap is acceptable
```

UI should describe a wider match honestly:

> 水平有差距 · 可按 ELO 建議讓分

Do not silently imply "水平相近".

---

# 7. Formation generation algorithm — MVP

Do not solve global optimal partitioning yet.

Use a greedy, viewer-centric candidate generator.

## Priority 1 — existing live formations

Show compatible existing `forming/playable` sessions first.

Reason:

> joining an already-forming group creates more liquidity than starting another group.

Score bonus should strongly prefer existing formations that need the viewer.

## Priority 2 — direct 1v1 candidate

For viewers accepting 2 players:

- rank compatible players
- propose top few 1v1 opportunities
- do not publicly claim the other person has agreed

## Priority 3 — small group candidate

For sizes 2–3:

- seed from highest-scoring compatible pair
- add the best mutually compatible third player
- common overlap must remain >= 60 minutes

## Priority 4 — rotation candidate

For sizes 4–6:

- seed from highest-scoring compatible pair
- greedily add compatible players while:
  - common time >= 60 min
  - venue remains compatible
  - target group size lies within every player's range
- stop at viewer's ideal size or 6

## Flexible users

Flexible (`2–6`) users should be preferentially used to fill formations that otherwise miss minimum size.

This maximises liquidity without forcing inflexible users into an unwanted group shape.

## Important

A potential player can appear in multiple computed candidates until they actually accept a formation.

Once accepted into a `playable/full` conflicting session, remove them from competing live opportunities.

---

# 8. Example: ten people, same night, same venue

Given:

```text
4 players prefer 1v1
2 players prefer small group
4 players prefer rotation
```

Do not create:

```text
one 10-player opportunity
```

The engine should be capable of showing:

```text
1v1
Dash + Andy
20:00–22:30

1v1
Peter + Chris
20:00–22:00

Small group
James + Sam + X
20:30–23:00

Rotation
Vincent + Ainod + Thomas + Michael
20:00–23:00
```

This is only a candidate structure until players opt in.

The public UI should show accepted participants and aggregate compatible supply.

Do not label non-consenting potential players as members of a formation.

---

# 9. API design

Prefer a new API namespace rather than mutating the old OpenBoard route.

Suggested routes:

```text
GET    /api/matchmaking/marketplace
POST   /api/matchmaking/marketplace/availability
PATCH  /api/matchmaking/marketplace/availability/:id
DELETE /api/matchmaking/marketplace/availability/:id

POST   /api/matchmaking/marketplace/formations
POST   /api/matchmaking/marketplace/formations/:id/join
POST   /api/matchmaking/marketplace/formations/:id/leave

POST   /api/matchmaking/marketplace/formations/:id/invite
PATCH  /api/matchmaking/marketplace/formations/:id/invitations/:playerId

POST   /api/matchmaking/marketplace/avoid/:playerId
DELETE /api/matchmaking/marketplace/avoid/:playerId
```

Exact route decomposition may be adjusted to repository conventions; keep the domain boundaries.

---

## 9.1 Marketplace GET response

Recommended shape:

```ts
type MarketplaceDashboard = {
  signedIn: boolean;
  date: string;
  dates: {
    date: string;
    publicPlayers: number;
    activePlayers: number;
    formingGroups: number;
  }[];

  mine: {
    availability: MatchableAvailability[];
    sessions: FormationSession[];
  };

  opportunities: FormationOpportunity[];
  availablePlayers: AvailablePlayer[];
  venues: Venue[];
};
```

### `FormationOpportunity`

```ts
type FormationOpportunity = {
  key: string; // ephemeral candidate key or existing session id
  kind: "existing" | "new";
  sessionId?: string;

  startAt: string;
  endAt: string;
  venue: Venue | null;

  minPlayers: number;
  idealPlayers: number;
  maxPlayers: number;

  acceptedPlayers: PlayerSummary[];
  compatiblePlayerCount: number;

  fit: {
    group: "ideal" | "acceptable";
    venue: "exact" | "district" | "flexible";
    level: "close" | "wider" | "handicap";
    overlapMinutes: number;
  };

  score: number;
};
```

Do not send hidden `avoid` relationships to the client.

---

## 9.2 Formation creation / join transaction

When the user taps `加入` on a new candidate:

1. revalidate their availability
2. revalidate hard constraints server-side
3. attempt to find an already-compatible live formation matching this candidate
4. if found, join it
5. otherwise create a new hostless `matchmaking_sessions` row
6. insert viewer as `accepted`
7. recalculate status
8. return session
9. trigger notification work after the transaction

Never trust the candidate score or compatible-player list sent by the client.

---

# 10. Hostless state machine

```text
0 accepted
    ↓ first join
FORMING
1..min-1 accepted
    ↓ enough join
PLAYABLE
min..max-1 accepted
    ↓ reaches cap
FULL
max accepted
```

Leaving:

```text
FULL → PLAYABLE
PLAYABLE → PLAYABLE
PLAYABLE → FORMING   if count < min
FORMING → FORMING
FORMING → CANCELLED  if count = 0
```

The identity of the first member must not affect transitions.

There is no "host cancelled the whole session" action in the new marketplace.

A user can only:

> 我去不到 / 退出

which removes that user's participation and re-runs the state transition.

System/admin cancellation is separate.

---

# 11. UI / UX

Create:

`app/MatchmakingMarketplace.tsx`

Styles:

`app/styles/matchmaking-marketplace.css`

Reuse:

- `Button`
- `Chip`
- `Surface`
- `FormField`
- `EmptyState`
- `InlineNotice`
- `Skeleton`
- `Sheet`
- `PlayerBadge`
- existing design tokens
- existing responsive breakpoints

Do not put new feature styles in `app/globals.css`.

---

# 12. Mobile-first information architecture

The 約戰 tab should answer, in this order:

```text
1. What is my current availability / intent?
2. What is the best opportunity I can join?
3. Who else is free?
4. What formations / sessions am I already part of?
```

Do not lead with a calendar.

---

## 12.1 Hero / quick action

Example:

```text
約戰

今晚想打？
[ 找緊波 ]   [ 公開其他空檔 ]
```

If availability already exists:

```text
今晚 19:00–23:00
SCAA · 認真對打
可以約我

[ 🔥 今晚找緊波 ]
```

One tap upgrades `interested → going`.

---

## 12.2 Date selector

Rolling next 7 days.

Each date can show:

```text
Tue
12 人有空
3 組正在成局
```

Avoid making a dense calendar the primary interface.

WeekBand may remain accessible as an advanced "睇時段" / edit surface if useful.

---

## 12.3 Best opportunities

Heading:

> 最值得加入

Opportunity card example:

```text
🔥 很有機會成局

今晚 · 20:00–23:00
SCAA

多人輪流 · 4–6 人
已經 3 人有興趣
你加入後 → 4 人成局

✓ 時間完全重疊
✓ 你接受多人輪流
✓ 同場地

[ 加入 ]
```

1v1 example:

```text
今晚 · 20:00–22:30
SCAA

認真對打 · 差 1 人
ELO 水平相近

[ 有興趣 ]
```

Do not show a non-consenting player as if they have accepted the pairing.

If the other player's availability is public, a personalised "最適合你的球友" section may name them, but copy must remain:

> 可約 / 很適合

not:

> 你們已配對

---

## 12.4 Who is free

This is equally important to algorithmic recommendations.

Heading:

> 今晚有空的人

Player row:

```text
Andy Chong · ELO 1470
20:00–23:00

🔥 找緊波
SCAA · 認真對打
✓ 與你重疊 3 小時
✓ 水平相近

[ 約 Andy ]
```

Another row:

```text
James Lau · ELO 1610
20:30–22:30

可以約我
灣仔 / 港島都可以
△ 水平較高 · 可讓分

[ 約 James ]
```

Support:

- date
- venue / district
- active first
- compatibility ranking

Do not require users to inspect a grid to understand who is actionable.

---

## 12.5 Availability composer

Goal: publish in <30 seconds.

First screen should contain only:

```text
日期
時間
場地 / 地區彈性

今晚想點打？
[認真對打] [細局] [多人輪流] [有波打就得]

狀態
[找緊波] [可以約我]

[開始找球友]
```

Advanced accordion:

```text
水平：相近優先 / 都可以
讓分：接受
禁煙：需要
費用：AA / 都可以
節奏：競技 / 休閒 / 都可以
```

Remember the user's last used choices in the client initially if needed. Persistent profile defaults are post-MVP.

---

## 12.6 My activity

Use one section:

> 我的安排

States:

```text
可以約我
找緊波
正在成局
已成局
```

Example forming:

```text
多人輪流
20:00–23:00 · SCAA

3 / 最少 4 人
再 1 人就成局

[ 退出 ]
```

Example playable:

```text
✓ 已成局
20:00–23:00 · SCAA
4 人參加

[ 我去不到 ]
```

No host labels.

No "取消整局" button for ordinary participants.

---

# 13. People-first direct invite

User requirement:

> Availability should be easily findable by others.

Therefore a player profile / availability row should support:

```text
[ 約 Andy ]
```

Flow:

1. choose one of Andy's public slots
2. system intersects viewer availability
3. propose common time / venue
4. create or reuse a hostless formation
5. viewer becomes `accepted`
6. Andy becomes `pending`
7. Andy receives notification
8. Andy accepts later
9. session recalculates

If Andy declines:

- viewer is not told that Andy "dislikes" them
- copy: `今次未能約成`
- viewer's availability remains active
- engine resumes other opportunities

---

# 14. Notification strategy

Reuse existing notification infrastructure and channels.

Add notification composers in `lib/notify.ts`.

Minimum messages:

### A. Direct invite

Existing `gameRequestReceived` can be adapted / reused.

### B. Formation needs players

Example:

```text
今晚 SCAA 有 3 人想多人輪流
20:00–23:00 · 再 1 人就成局
```

Send only to top compatible `going` players first.

Avoid blasting every passive availability.

### C. Formation became playable

```text
成局：今晚 20:00–23:00
4 人已加入 · SCAA
```

### D. Dropout / reopening

If count drops below minimum:

```text
今晚呢組差 1 人
20:00–23:00 · SCAA
```

Re-recruit compatible users.

### E. Reminder / result

Reuse current reminder and result logic where possible.

---

## 14.1 No-background-job MVP rule

The app currently does not guarantee a background scheduler.

The MVP must still work without one.

Trigger matching / notification work on writes:

- new `going` availability
- join
- direct invite
- leave / dropout

Use existing `after()` / notification delivery pattern where appropriate.

Post-MVP, add reliable scheduled re-ranking / stale-opportunity nudges if needed.

---

# 15. Public visibility / privacy boundary

User intent is to maximise bridging, not make availability private.

MVP rule:

### Signed-in member

Can see:

- player identity
- published availability
- venue / district
- group preference
- relevant matchmaking conditions

### Guest

Can see:

- aggregate player counts
- aggregate formation counts

Cannot see named player schedules.

### Never public

- private avoid relationship
- exact decline reason
- reliability score
- whether another player rejected a specific person

---

# 16. Analytics

Extend `AvailabilityEvent`.

Recommended events:

```text
matchmaking_marketplace_view
matchmaking_availability_publish
matchmaking_availability_activate
matchmaking_availability_withdraw
matchmaking_player_available_view
matchmaking_player_invite
matchmaking_opportunity_shown
matchmaking_formation_join
matchmaking_formation_leave
matchmaking_formation_playable
matchmaking_formation_full
matchmaking_formation_reopened
matchmaking_formation_salvaged
matchmaking_game_played
matchmaking_player_avoid
```

Useful properties:

```text
group_min
group_ideal
group_max
commitment
overlap_minutes
venue_scope
elo_difference
opportunity_kind
accepted_count
compatible_count
```

---

# 17. MVP KPIs

## North Star

### Availability → Played Match Conversion

```text
published availability
→ viable counterpart
→ formation interest
→ playable session
→ played match
```

## Supporting metrics

### Availability Bridge Rate

% of published availability windows that produce at least one viable compatible counterpart.

### Formation Conversion

% of formations that become `playable`.

### Time to Formation

Median:

```text
availability published
→ playable session
```

### Salvage Rate

For sessions where an accepted player withdraws:

```text
% that still become/remain playable
```

### Refill Rate

For sessions that drop below `min_players`:

```text
% that recruit a replacement and become playable again
```

### Group Preference Fit

% of played sessions whose final participant count falls within each player's preferred acceptable range.

---

# 18. Testing requirements

Add pure unit tests for the matching engine.

Suggested:

`tests/matchmaking-marketplace.test.mjs`

## Core cases

### Case 1 — 10 users, one venue, mixed group preferences

Input:

```text
4 × 1v1
2 × small group
4 × rotation
```

Expect:

- multiple candidate formation shapes
- no forced 10-person group
- every proposed group's size is within members' acceptable range

### Case 2 — hostless dropout

Four-player playable session.

First/creator leaves.

Expect:

- session remains
- remaining three stay accepted
- no whole-session cancel

### Case 3 — drop below minimum

Rotation min=4, accepted=4.

One leaves.

Expect:

```text
playable → forming
```

and formation becomes recruitable.

### Case 4 — refill

After case 3, a compatible fifth player joins.

Expect:

```text
forming → playable
```

and salvage event.

### Case 5 — asynchronous direct invite

A invites B.

A accepted, B pending.

B accepts in later request.

Expect playable 1v1.

### Case 6 — avoid

A has private avoid B.

Expect no A/B direct candidate in either direction.

### Case 7 — venue flexibility

Exact SCAA + any_hk.

Expect compatible and resolved venue = SCAA.

Exact SCAA + exact different venue.

Expect incompatible.

### Case 8 — automatic ELO widening

No ±100 candidate but ±180 exists and handicap accepted.

Expect candidate shown as wider / handicap, not "水平相近".

### Case 9 — conflicting confirmed session

Player already in overlapping playable session.

Expect excluded from another formation.

### Case 10 — passive vs active intent

Same compatibility otherwise.

Expect `going` candidate ranked above `interested`.

---

# 19. UI validation requirements

Per `AGENTS.md`, for UI changes run:

```bash
npm run lint
npm run lint:css
npm run design:metrics
npm test
```

Verify at:

```text
390px iPhone-class width
<=380px narrow phone
desktop >=821px
```

Must verify:

- no horizontal overflow
- no clipped time labels
- composer fits mobile viewport
- 44px standard primary tap targets where applicable
- keyboard/focus behaviour for Sheet and controls
- loading / error / empty state
- long Traditional Chinese names
- 0 opportunities
- 1 opportunity
- dense 10+ player availability
- multiple simultaneous formations

---

# 20. Implementation PR sequence

Do not combine this into one giant PR.

## PR 1 — Domain + migration

Goal:

> make the old formation storage capable of the new semantics.

Changes:

- new migration
- reopen target size 2–6
- add `min_players`, `max_players`, `venue_scope`
- make sessions hostless-capable
- remove one-pending restriction
- add pair-exclusion table
- update TS types / condition parser
- add DB-level tests / domain invariants

Do not switch production UI yet.

### Acceptance

- migrations are backwards compatible
- existing OpenBoard still builds
- no existing production row becomes invalid

---

## PR 2 — Matching engine + API

Goal:

> generate public availability and viable formation candidates.

Changes:

- `lib/matchmaking-marketplace.ts`
- `db/matchmaking-marketplace.pg.ts`
- new API routes
- hard compatibility
- soft scoring
- existing-formation priority
- greedy 1v1/small/rotation generation
- join/leave/direct invite
- hostless state transitions
- unit tests

Do not switch production UI yet.

### Acceptance

10-person fixture produces sensible multiple formation shapes.

---

## PR 3 — Marketplace UI

Goal:

> replace calendar/host-centric decision flow with action-first matchmaking.

Changes:

- `MatchmakingMarketplace.tsx`
- feature CSS
- composer Sheet
- Best opportunities
- Who is free
- My arrangements
- 7-day selector
- direct invite
- avoid action
- mobile verification
- analytics view/publish/join events

Initially gate behind a local feature switch / development toggle if convenient.

### Acceptance

A signed-in user can:

```text
publish availability
→ see compatible players/formations
→ join one
→ later see it become playable
```

without opening OpenBoard.

---

## PR 4 — Notifications + recovery + cutover

Goal:

> make the experience work while users are offline and survive dropouts.

Changes:

- formation notification copy
- notify eligible active players
- direct invite notification
- playable notification
- dropout reopening / refill
- salvage analytics
- switch `HomeClient` 約戰 tab from `OpenBoard` to `MatchmakingMarketplace`
- preserve OpenBoard code temporarily for rollback

### Acceptance

- users need not be online simultaneously
- first member can leave without cancelling others
- sub-minimum group reopens recruitment
- direct invite can be accepted later

---

# 21. Rollback / coexistence strategy

Do not immediately delete:

```text
OpenBoard.tsx
db/open-board.pg.ts
/api/open-board
open_calls
open_call_players
```

During MVP cutover:

- new UI writes new marketplace model
- old OpenBoard remains code-level fallback
- do not dual-write unless migration of active live calls is explicitly required

Before production cutover, decide how to handle future-dated `open_calls`.

Recommended one-time migration / adapter:

```text
for every future open_call:
  create equivalent availability for each current participant
  preserve time
  preserve venue
  map max_players to group max
```

Do not silently drop already-arranged future games from the UI.

After one stable release and data validation, remove legacy paths in a separate cleanup PR.

---

# 22. Codex implementation rules

1. Read `AGENTS.md`, `PRODUCT.md`, `CLAUDE.md` first.
2. Inspect current git diff before editing.
3. Preserve unrelated work.
4. Use shared UI primitives first.
5. Do not add feature CSS to `globals.css`.
6. Keep Traditional Chinese (Hong Kong) product copy.
7. Build domain logic as pure functions where possible.
8. Server must revalidate every candidate before persisting.
9. Do not trust client-supplied scores / compatible player IDs.
10. Do not create a social graph.
11. Do not expose avoid / decline data.
12. Do not recreate host ownership through a differently named field.
13. The creator may be stored for audit, but must not have special cancellation rights.
14. Existing formations must rank above creating duplicate new formations.
15. Do not optimise matching weights prematurely.
16. Prefer deterministic behaviour and tests over clever heuristics.

---

# 23. Definition of done

The MVP is done when this scenario works end-to-end:

```text
10 players publish availability for tonight at SCAA.

Some prefer 1v1.
Some prefer 2–3.
Some prefer 4–6 rotation.
Some are flexible.

The app:
1. makes all published availability discoverable;
2. shows each player personalised, viable formation options;
3. does not force all 10 into one group;
4. lets players join asynchronously;
5. forms sessions once each formation reaches its minimum;
6. prevents hard-incompatible players being matched;
7. automatically widens soft ELO preference when necessary;
8. keeps a session alive if the first participant leaves;
9. reopens recruitment if a group falls below minimum;
10. can refill the group;
11. ultimately links the played session back to match recording / ELO.
```

The success test is not:

> "Can a user create a 局?"

It is:

> **"Can the system turn scattered, public player availability into suitable, resilient groups with minimal coordination?"**
