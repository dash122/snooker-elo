# UI consistency audit — mobile

Snapshot: 2026-08-17. Numbers from `npm run design:metrics` plus direct greps over
`app/**/*.tsx` and `app/globals.css` + `app/styles/*.css`.

The design system in `CLAUDE.md` / `docs/design-system.md` is sound. Almost nothing below
is a gap in the system — it is that **the product code largely does not go through it**.
The tokens landed; the components did not. That is the single theme of this audit.

## Scoreboard

| | Current | Note |
| --- | --- | --- |
| `<button>` hand-rolled vs `<Button>` | **304 vs 9** | 97% of buttons bypass the primitive |
| `Dialog` / `Sheet` usages outside `app/ui-gallery` | **0** | every modal on mobile is bespoke |
| Distinct segmented/tab controls | **8** | see §2 |
| Distinct `border-radius` values | **~40** | 4 radius tokens exist |
| Distinct `box-shadow` values | **138** | 2 shadow tokens exist |
| Distinct `font-weight` values | **9** | 800 and 700 cover 87% of uses |
| Non-`--ds-*` colour custom properties | **277** (`--me-*` 163, `--pc-*` 54, `--mm-*` 52, `--ball/baize-*` 8) | vs 70 `--ds-*` |
| Legacy alias vars still referenced | **877** (`--muted` 347, `--line` 222, `--paper` 99, `--ink` 89, …) | |
| Hardcoded hex (kinds) | **410** | target < 20 |
| Inline `style={{}}` | **55** | |
| `globals.css` | **1228 lines** | target < 500 |

Where a page reflows and how it is spaced is in good shape — the breakpoint list is
clean at exactly the four sanctioned tiers. The variation users see is in **element
identity**: the same control looks different depending on which tab they are on.

---

## 1. Buttons — the largest single source of drift

`Button` in `app/components/ui/Primitives.tsx` supports `primary | secondary | quiet |
danger`, plus a loading state. Product code uses it 9 times. Everywhere else is a raw
`<button>` with an ad-hoc class:

```
26  className="primary"          22  className="secondary"     19  className="more"
 7  className="primary full"      7  className="matchup-trigger"  5  className="close"
 4  className="danger"            4  className="cup-btn ghost sm" 4  className="card-tool danger"
 3  className="primary ses-go"    3  className="primary publish-button"
 2  className="primary sl-primary"  2  className="primary auth-submit"  …
```

Concentration by file: `HomeClient.tsx` 94, `Slots.tsx` 33, `MatchmakingBits.tsx` 30,
`Availability.tsx` 28, `Sessions.tsx` 17.

Two distinct problems:

- **Per-page one-off variants.** `sl-primary`, `ses-go`, `mm-play-go`, `room-live-go`,
  `hero-action`, `free-now-button`, `bracket-record`, `players-expand-open-self`,
  `publish-button` are all "the primary action of this screen" wearing nine different
  class names. Each carries its own padding/radius/shadow, which is where the 138
  shadows and 40 radii come from.
- **A parallel tertiary tier.** `.more`, `.card-tool`, `.link-trigger`, `.danger-link`,
  `cup-btn ghost sm` all approximate `variant="quiet"` and none of them match each other.

Mobile consequence: tap targets are only unified where `globals.css:152` happens to
enumerate the class (`.mini-toggle button,.view-toggle button,.match-view-toggle
button{min-height:var(--control-sm)}`). Any button whose class is not in one of those
hand-maintained selector lists gets no `--control-*` height at all. The ladder exists;
membership in it is opt-in by literal class name, so new screens silently fall out.

**Suggestion.** Make `Button` the only way to render a button, and let the *page* class be
a layout hook, not a skin:

```tsx
<Button variant="primary" className="ses-go">開始</Button>
```

Migrate in the order of the concentration list — `HomeClient.tsx` alone is 31% of the
problem. Delete each one-off's colour/radius/shadow/height declarations as you go; keep
only genuine layout (`grid-area`, `flex`, `width`). Add a lint rule banning bare
`<button>` in `app/**` outside `components/ui/` once the count is low enough to hold.

## 2. Segmented controls / tabs — eight implementations

Every one of these is "pick one of N views", and they are visually distinct:

| Implementation | Where |
| --- | --- |
| `ds-segmented` | **`app/ui-gallery` only** — the sanctioned one, unused in product |
| `page-tabs match-view-toggle` | `HomeClient.tsx:1484` |
| `home-view-nav` | `HomeClient.tsx` |
| `mini-toggle` | `HomeClient.tsx`, `UiBits.tsx` |
| `view-toggle` | `globals.css` (desktop-only; `display:none` under 820px) |
| `availability-tabs` | Availability page |
| `invite-mode-toggle` | `Availability.tsx:145` |
| `sl-mode-switch` / `sl-day-chips` | `Slots.tsx:525,533` |
| `mm-segmented` | Matchmaking |
| `availability-date-strip` | `Availability.tsx:91` (date picker, but same tablist role) |

`globals.css` then spends four separate selector lists (lines 135, 152, 158, 761–785,
863–899, 1158–1216) re-unifying subsets of them — press states, scroll-snap, active
underline, tap heights — each list naming a slightly different subset. That is the tell:
the CSS is already trying to make them one component, by hand, repeatedly. Line 417 even
carries a comment reminding the next person to add their new tab bar to the list.

**Suggestion.** Promote `SegmentedControl` to cover the two real shapes — *fill* (2–3
equal options) and *scroll* (N options, horizontally scrollable with snap, which is what
the mobile tab bars actually need) — then convert the eight. `ds-segmented` already has
the correct 44px `min-height`; the bespoke ones sit at 36px. Expect to delete several
hundred lines of `globals.css`, most of the cross-cutting selector lists with them.

## 3. Sheets and modals — the primitive is unused

`Dialog` and `Sheet` (`app/components/ui/Overlay.tsx`) handle focus-on-open, Escape,
focus restore, scrim click-out, and `aria-modal`. **Nothing outside the gallery imports
them.** Product modals are:

`.sheet` / `.sheet-shell` (+ `.player-detail-sheet`, `.match-entry-sheet` variants),
`.share-sheet`, `.match-filter-sheet`, `.counter-sheet`, `.availability-sheet`,
`.availability-dialog` + `.availability-dialog-backdrop`, `.record-menu-scrim`,
`.sl-drop`, `.ses-drop`, `.a2hs`.

Four different scrims (`.backdrop`, `.record-menu-scrim`, `.availability-dialog-backdrop`,
`.ds-overlay`), of which only `.ds-overlay` and the matchmaking one use `--ds-overlay`.

This is the most mobile-specific finding, because sheets are where mobile-only concerns
live and each implementation solves them separately — or not at all:

- **Safe area.** `.ds-sheet` handles `--ds-safe-bottom`; `.sheet-shell` handles it via raw
  `env(safe-area-inset-*)` in `modal-sheet.css`, and only for the two named variants
  (`player-detail-sheet`, `match-entry-sheet`). The rest get nothing.
- **Scroll containment.** `overscroll-behavior:contain` and `touch-action:pan-y` appear
  only in those same two variants. Other sheets let the page scroll behind them.
- **Bottom-anchoring.** `.ds-overlay--sheet` anchors to the bottom edge under 820px with
  a top-only radius — the correct mobile idiom. Most bespoke sheets stay centre-modal on
  phones.
- **Close affordance.** `.ds-dialog-close` is 44px, top-right absolute. `.close` in
  `modal-sheet.css` is a 36px sticky circle with a `:after` tap-target expander and two
  `!important`s added to win a same-specificity cascade fight — 4 of the 8 remaining
  `!important`s in the codebase are here.

The comments in `app/styles/modal-sheet.css` are an honest record of how expensive this
is: each fix is scoped to one variant because generalising it was too risky.

**Suggestion.** Highest value-per-line change in the audit. Extend `Sheet` once with what
the bespoke ones learned — bounded scroll shell, `overscroll-behavior:contain`,
safe-area padding, sticky close — then migrate. `share-sheet` and `match-filter-sheet`
are the easy first two; `player-detail-sheet` and `match-entry-sheet` are the hard ones
and should go last, once the shared version has proven itself.

## 4. Four parallel colour namespaces

`--ds-*` (70) is the system. Alongside it:

- `--me-*` (163), `--pc-*` (54), `--mm-*` (52), `--ball-*`/`--baize-*` (8) — page-scoped
  palettes. `--pc-*` in particular is one token per element per state
  (`--pc-row-form-loss-bg`, `--pc-slot-chip-border`, `--pc-verdict-sub-text`), which is a
  naming scheme with no reuse built into it.
- The legacy aliases at `globals.css:38` (`--paper`, `--ink`, `--muted`, `--line`, `--deep`,
  `--gold`, …), still referenced **877 times**. Most alias straight onto a `--ds-*` token,
  but `--line:#dde2dc` does not — it is a raw hex that shadows `--ds-border-subtle`, and
  it is the single most-used border colour in the app (222 uses).

So a card border is `--line` on one screen, `--ds-border-subtle` on another,
`--pc-row-border` on a third, and a literal hex on a fourth. Same intended colour, four
sources of truth, and they have already drifted.

**Suggestion.** Three mechanical passes, each independently shippable:

1. `--line` → `--ds-border-subtle` (222 sites, one value decision: keep `#dde2dc` or the
   token's `rgba(20,65,57,.12)` — pick one and accept the small visual delta).
2. Remaining legacy aliases → their `--ds-*` targets, then delete the `:root` block at
   `globals.css:38` and its `stylelint-disable`.
3. Fold `--pc-*`/`--me-*`/`--mm-*` into `--ds-*` where the role already exists. The
   phase-03 rule still applies: promote to a named `--ds-*` token only when a value is
   used 6+ times for the same visual role.

## 5. Cards

At least 30 card recipes — `.podium-card`, `.mm-card`, `.player-card`, `.analytics-card`,
`.highlight-card`, `.calibration-card`, `.session-card`, `.sl-session-card`, `.table-card`,
`.chart-card`, `.trend-card`, `.density-card`, `.admin-card`, `.cup-card`, `.mk-card`,
`.matchup-card`, `.auth-card`, `.account-panel`, `.share-card`, … — against one `Surface`
primitive with three tones.

They differ in radius (9/10/11/12/13/14/15/16/17/18/20px all present), shadow, border
colour source, and padding. On a phone, where cards stack in a single column, these sit
directly above one another and the mismatch is at its most visible — this is the "many
elements not unified" symptom in its purest form.

**Suggestion.** Lower priority than §1–§3 (more sites, less behavioural payoff) but the
same shape: `<Surface tone="raised" className="mm-card">`, with `mm-card` keeping only
layout. Quick win first: collapse every radius in 9–14px to `--radius-sm` (12px) and
15–20px to `--radius-lg` (20px), and every card shadow to `--ds-shadow-resting`. That
alone removes most of the visible difference without touching a single component.

## 6. Smaller items

- **Font weights.** Nine values. 750/850/650/300 are one-off. Standardise on 400/700/800
  (+900 for the ranking hero) — no token needed, just a convention in the design doc.
- **`--fs-*` adoption is 68%**, spacing 63%. The remaining 75 literal font sizes are the
  lint's hard errors; worth clearing before adding new pages so the rule stays credible.
- **`app/globals.css` at 1228 lines** is where most of the above lives. It shrinks
  naturally as §1–§3 land; the cross-cutting tab selector lists (761–785, 863–899,
  1158–1216) are the biggest single block to fall out.
- **55 inline `style={{}}`.** Most are dynamic values (chart geometry, progress widths)
  and are fine; the static ones should move to CSS.

---

## Suggested order

Ordered by *visible mobile inconsistency removed per unit of risk*, not by size.

1. **Sheets → `Sheet`** (§3). Smallest number of call sites, largest behavioural payoff —
   safe-area, scroll containment, and close-button consistency all land at once, and it
   retires 4 `!important`s and most of `modal-sheet.css`.
2. **Segmented controls → `SegmentedControl`** (§2). Eight → one. Fixes the 36px vs 44px
   tap-target split across tabs and deletes the hand-maintained selector lists.
3. **Buttons → `Button`** (§1), file by file, `HomeClient.tsx` first. Largest count;
   parallelisable; each file is independently shippable.
4. **`--line` → `--ds-border-subtle`, then the rest of the legacy aliases** (§4).
   Mechanical, mostly `sed`-able, high visible payoff for the effort.
5. **Radius/shadow collapse on cards** (§6 quick win), then `Surface` adoption (§5).

Steps 1–3 are the ones a user would actually notice tab-to-tab. Steps 4–5 are what stops
the drift from coming back.

A guardrail worth adding alongside step 3: the reason all of this recurred is that
`globals.css` re-unifies components by enumerating class names, so a new screen is
consistent only if someone remembers to add it to five selector lists. Every migration
above replaces an opt-in list with a component default — that is the durable part, more
than any individual number in the scoreboard.
