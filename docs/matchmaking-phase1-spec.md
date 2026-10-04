# Matchmaking Phase 1 spec

Status: draft for review. Replaces the "publish a slot, then find a stranger" model with
a session-based model built for how amateur snooker players actually behave. It reuses
the existing marketplace engine where it fits; see [Relationship to existing code](#relationship-to-existing-code).

## 1. Goal and success measure

**Goal:** create as many successful matches as possible.

- **Success event:** a participant taps **Played** on a session. A score is optional.
- **Headline metric:** sessions that began in the app and were played, per week.
- **Secondary:** games recorded per session; results linked to a session.
- **Guardrail:** would-play-again rate and the "just right" share of difficulty feedback, so
  volume is not bought with bad games.

Funnel: intent → proposed → confirmed → showed up → played → result recorded.

## 2. Who this is for

Players across clubs and venues in one city, not only one club. Phase 1 launches with
about 30 active players: more than one venue in Hong Kong and one in London.

| Persona | Job to be done | Main pain today |
|---|---|---|
| Regular / league player | Keep my fixture alive; find a stand-in | Back-and-forth in chat; no fixture concept |
| Improver | Play opponents slightly above my level | Partners too weak or too strong |
| P-type "maybe" | Play if it works out, without committing early | Early commitment feels constraining |
| Spontaneous player | Get a game today at a specific time | Nobody sees the request in time |
| Table-holder | I have a table; fill the seats | A game that depends on two uncertain people |
| Solo practiser | Find someone to turn up where I already am | Asking a stranger feels like imposing |
| Newcomer / returner | A patient partner at my level | Fear of embarrassment; no way in |

## 3. Design principles

1. **The unit is a session, not a slot.** 1v1 and group are the same object with a size range.
2. **Group size is insurance.** More possible players means a game more likely to happen. Default to "open to a group".
3. **Availability is not a promise and not a request.** Four rungs with different meanings (section 5).
4. **Nothing is decided for the player.** The app proposes; every commitment is an explicit tap.
5. **Right fit over any fit.** Mutual acceptability and private preferences (section 8).
6. **Trust-based results.** Recording takes effect immediately; no opponent confirmation.
7. **No public shaming.** Reliability is never displayed; only the current confidence label is.
8. **Ask little, prefill everything.** Specific needs cost effort only when the player has them.

## 4. Operating constraints

- **Open frequency:** assume players open the app once or twice a day.
- **No integrations:** no email, WhatsApp, SMS or push. The only reach beyond the app is a
  **prefilled WhatsApp share link** that a person posts themselves (no API needed).
- **Consequences:**
  - Planning works best for later today and tomorrow. For anything starting within about two
    hours, the app says few members will see it in time and makes **Share to WhatsApp** the primary action.
  - Home must resolve everything pending in one pass.
  - Sessions form at the speed of people opening the app. Encourage posting early.
  - Do not show the push prompt in Phase 1.
- **No calendar sync.**
- **Walk-ins are normal** at venues.

## 5. Availability model: four rungs

Each rung changes what others may do. Moving up is one tap; moving down happens by expiry.

| Rung | Meaning | What others can do | Lifetime |
|---|---|---|---|
| 1. Rhythm | "I'm usually around Wed/Fri evenings" | Nothing; the app uses it privately | Standing |
| 2. Open | "I could play Saturday afternoon" (could / likely) | Ask gently; a decline is one tap and silent | Until the window ends |
| 3. Wants a game | "I want a game 3–5pm today" | App proposes sessions; shows on the board; share card offered | Now = 3h; Tonight = to midnight; or the chosen window |
| 4. In | A session I accepted | Counts as a commitment | Until the session ends |

The app never claims "Sam is free". It says "usually around Friday evenings" or "said maybe tonight".

### Timing

- **Rhythm** uses coarse blocks (weekday evening, Saturday afternoon, and so on), not an hourly grid.
- **Open and Wants** accept an exact window: quick chips (Now, Afternoon, After work, Evening) or a custom start and end.
- A **minimum game length** (default 1 hour) applies. A match needs an overlap of at least the longer minimum.
- The app proposes a start time inside the overlap.
- Narrow windows are flagged honestly with a suggestion to extend, never a requirement.

### Daily pulse

The main way availability gets entered. Shown on Home and as the first prompt each day:

> Tonight? **No** · **Maybe** · **Want a game**

Answering is the whole cost for a P-type. A calendar view is optional for planners.

### Visibility defaults

- Rhythm: private (only the app uses it).
- Open: visible to people at the player's venues.
- Wants: visible to members in the player's city.
- **Quiet mode:** show that I'm open but do not offer me to others as someone to ask.
- Each person receives at most a small number of asks per day. A decline reveals nothing beyond "not today".

## 6. Sessions

A session is a time window, a venue (or open), a size range and a set of members.

- **Size:** min, target, max (2–6). A 1v1 is min = max = 2. Default is open to a group.
- **Status:** forming → playable (accepted ≥ min) → full → played / cancelled.
- **Stays on** as people come and go while accepted ≥ min. Players may join late, in progress, when a frame ends.
- **Table status:** *Walk-in* (default) or *Booked*. A booked table makes the holder an anchor.
- **Terms** (vibe, format, conduct) are set by the creator and shown before anyone joins.
- **Rotation** is a free-text note ("winner stays", "pairs"). It is not modelled.
- **Weekly fixtures:** a standing fixture creates a session each week; people tap **Skip this week** rather than opting in.
- **Recommend widening.** When a player asks for a 1v1 with uncertain partners, the app suggests opening it to a group, and says why. A player can choose "1v1 only" and is told honestly it is less reliable.
- **Dropouts.** When someone leaves, the app shows a visible fallback to those left: who else is around, a wider size, or a different time. Solo practice is an acceptable outcome.
- Every commitment (join, accept, confirm) is an explicit action by the player. Nothing auto-forms.

## 7. The board

One screen for everyone. Under the hood everything is an intent on a time-and-place grid.

**Top to bottom:**

1. Context: city (automatic), my venues as chips, day chips (Today / Tomorrow / Weekend).
2. **Next action** queue, in order:
   1. Result to record
   2. Invite to answer
   3. Upcoming session
   4. Open sessions to join
   5. "I want to play"
3. Three actions: **I want to play**, **I have a table**, **I'm around**.
4. The feed, sorted by fit to the viewer:
   - Sessions with open seats (confidence label, table status).
   - People looking (Wants).
   - Pools: "5 people could play Saturday afternoon. Start a table?" (a suggestion, never an auto-form).

| Persona | Where they appear |
|---|---|
| Regular | Weekly fixtures as sessions to skip |
| P-type maybe | "I'm around"; sees pools and open sessions |
| Spontaneous / exact window | Posts a window; sees overlaps |
| Table-holder | Posts a session with seats |
| Observer | Reads the feed without acting |
| Shy player | Quiet mode; receives suggestions, appears to no one |

Rules:

- Venue selection is hidden in a city with only one venue (progressive disclosure).
- Times display in the venue's local time.

## 8. Fit and requirements

**Principle:** a match needs mutual acceptability and preferences are private. Nobody learns why they were or were not shown to someone. Declines are always a generic "Not today".

Each requirement has a strictness: **Must** (hard filter), **Prefer** (ranking only), or **Any**. Most defaults are *Prefer*.

| Dimension | Options |
|---|---|
| Level | Weaker / similar / stronger / any; handicap OK or not; optional hard limit (e.g. within ±100 rating) |
| Vibe | Competitive, relaxed or practice |
| Format | 1v1 or group; race-to; duration |
| Conduct | Smoking, fee split, language |
| People | Prefer: my circle. Avoid: private list |
| Note | One line of free text |
| Role | "Happy to play weaker players" (positive tag) |

No unranked option: handicap covers level concerns, and a player wary of a result can choose not to record it.

### Capturing it simply

- **Onboarding** asks three things: level, usual venues, kind of game. Everything else defaults.
- **Each request** shows one summary line from the profile ("Similar level · relaxed · non-smoking · any of my venues"). Tap to edit; "Add a requirement" reveals the rest.
- **After a game**, two private questions: "Would you play Sam again?" and "Too easy / just right / too hard?". These feed the circle, avoid list and level calibration. Nobody sees the answers.

### Transparency and control

- **Why this person:** chips for what is shared (similar level, both non-smoking, two venues in common). Never any private preference.
- **Relax to see more:** if requirements leave no match, show counts only ("Relax to ±100? +3 people").
- **Groups:** the session carries its own terms, shown before joining. Avoid-list conflicts are enforced silently by not showing the session.
- **Guardrail:** only game-relevant dimensions are filterable. No age, gender or ethnicity filters.

## 9. Venues and the map

- **Pick or add.** Choose an existing venue from the list or add one by name (local and English) with a pin. Optional: table count, notes.
- **The map only shows a pin** for the venue's location. No directions link, no routing.
- **Usable immediately, verified later.** A new venue works for its creator straight away and appears to others as *unverified*.
- **Admin queue:** approve, edit, reject, and **merge duplicates**.
- **Duplicate check on entry:** suggest nearby similar names before creating.
- **Distance replaces district:** with a pin on each venue, "my venues" or "within N km" is possible. City and time zone come from the pin.
- **Venues are an attribute, not separate pools.** Default is flexible ("anywhere in my city") so that thin supply does not fragment.
- **Anonymous activity hints:** "usually 3–4 players here on Friday evenings", from private Rhythm, shown only when at least three people contribute.
- **City is the market boundary:** Hong Kong and London are separate boards.
- **Signal for expansion:** venues added in new cities show where demand is.

**Provider (recommendation):** MapLibre with OpenFreeMap tiles for the pin display; low-volume Nominatim for address search with a drag-the-pin fallback. Verify OpenFreeMap terms and reliability, and Nominatim limits (1 request per second, attribution), before launch. Mapbox and Google Maps were rejected because they need a payment method on file.

## 10. Results

Recording is trust-based and takes effect immediately.

1. **Did you play?** One tap: Played / Didn't happen. "Played" is the success event.
2. **Score** is optional and can be done later: pick the winner, then frames.
3. **Immediate payoff:** rating change, head-to-head record, and a **rematch** button.
4. **Rotation sessions:** tap two players, tap the winner, then **Same again** to add the next game.
5. **Who came?** A list prefilled from accepted players. Unticked players are marked as not showing, privately, with no public consequence.

| Moment | Channel | Action |
|---|---|---|
| Before the session | Home / prefilled link | "Still in?" Yes / Can't |
| Arrival | App | "I'm here" (optional) |
| After | Top card at next open; **Record the result** on the session card; optional share card | Did you play? |
| Score | Same screen | Winner, frames |
| Next open | Home top card | Finish or skip |

### Rules

- **Any participant can enter** a result. The winner is prompted first ("Won? Record it").
- **The other player gets a passive notice** on their next open ("Sam recorded 3–1; you −12") with an optional "Wrong? Fix it". Nothing waits on them.
- **No automatic merging.** If an entry resembles one already recorded, ask the person entering: "Same game, or another one?" If the same game, theirs is discarded. If another, both count.
- **Correction:** the existing match edit and delete apply (either participant, or an admin, with no time limit). Ratings are fully replayed after any change.
- **Traceability:** a record shows who entered it.
- **Admin review:** admins can edit or remove a result. Suspicious patterns (for example repeated lopsided results between the same pair) surface privately to admins.
- **Unplanned games** can be added too. The app suggests linking to an existing session when players, date and venue match.

## 11. New-player level

One question, in snooker terms:

> What's your usual highest break?
> Under 10 · 10–29 · 30–49 · 50–99 · 100+ · Not sure

- Each answer maps to a starting rating (admin-configurable, alongside existing ELO settings), tagged **Provisional**.
- "Not sure" starts mid-range.
- Rating moves faster over the first ~10 games so mistakes correct themselves.
- The private "too easy / just right / too hard" answer nudges the level.
- No approval step.

## 12. Measurement

| Metric | Why |
|---|---|
| Sessions played from the app per week (headline) | Success measure |
| Proposed → confirmed → showed → played → recorded | Where the funnel leaks |
| Share of sessions opened to a group | Insurance uptake |
| Share of sessions still played after a dropout | Fallback working |
| Time from intent to first response | Reach |
| Maybe → played rate | Whether the maybe tier works |
| Share of results linked to a session | Loop closed |
| Would-play-again and "just right" rates | Quality guardrail |
| Players with daily pulse answered | Participation |

## 13. Phasing

| Phase | Scale | Scope |
|---|---|---|
| **1 (this spec)** | About 30 players, more than one HK venue plus one London venue | Four rungs, daily pulse, sessions, board, requirements, venues with pin map, results, new-player level |
| 2 | A real city: 100–300 players | Stranger introductions at scale, mutual reveal for shy players, richer venue features, rating calibration across venues |
| 3 | Multi-city | City as the matching unit, visitor mode, venue partnerships, per-city language and norms |

Features unlock by density, not date. The data model is generic from day one; the interface exposes only what the current density can use.

## 14. Out of scope for Phase 1

Calendar sync; email, WhatsApp, SMS or push integration; directions or routing; unranked games;
safety-driven options such as women-only games; cross-city matching; demographic filters; forum,
marketplace or social features; modelling rotation order.

## 15. Decisions recorded

| Decision | Outcome |
|---|---|
| Success event | "Played" tap; score optional |
| Opponent confirmation | Dropped; trust-based |
| Auto-forming and conditional yes | Dropped; every commitment is an explicit tap |
| Duplicate results | Ask the person entering; never merge automatically |
| Correction window | None; reuse existing edit/delete (decided) |
| Visibility defaults | As in section 5 (owner indifferent) |
| Reach | In-app plus a prefilled WhatsApp link; no integrations |
| Unranked games | No |
| Safety options | Not for now |
| Map | Pin only; MapLibre + OpenFreeMap; no directions |
| New-player level | Highest-break question; provisional rating |
| Rotation | Free-text note |
| Default size | Open to a group |

## Relationship to existing code

The repository already contains a marketplace with group ranges (2–6), venue scope, a private
"avoid" relation, level and handicap conditions, notification jobs, and recurring and "now"
availability endpoints. Treat this spec as a change to the front door, the model and the loop,
not a rewrite of the engine.

Needs verification before building:

- Whether the "intent with strictness" model can extend the existing conditions type.
- Venue storage: moving from district to pin coordinates.
- The result flow versus current match recording (the linking of a result to a session).
- Which of the existing screens and routes this replaces.
