# Design system — the short version

One rule underneath all of this: **if a value isn't in `app/styles/tokens.css`, it doesn't ship.**
`npm run lint:css` enforces it, so this is not a matter of discipline.

## Type — use a token, never a number

```css
font-size: var(--fs-body);   /* ✅ */
font-size: 14px;             /* ❌ stylelint rejects this */
```

The scale is **responsive**: the same token name resolves to a smaller size on narrower screens,
so a component names a *role* and never needs its own size. Base values live in `tokens.css`; the
tablet and phone steps live in `globals.css`.

| Token | Desktop | Narrow desktop | Phone | Use for |
| --- | --- | --- | --- | --- |
| `--fs-label` | 12px | 11px | 11px | uppercase kickers, table headers, chips |
| `--fs-caption` | 13px | 12px | 12px | secondary metadata under a value |
| `--fs-sm` | 14px | 13px | 13px | dense body, form labels, list captions |
| `--fs-body` | 16px | 15px | 14.4px | default body text |
| `--fs-lead` | 18px | 17px | 16px | card titles, lead paragraphs |
| `--fs-h3` | 20px | 18px | 17px | |
| `--fs-stat` | 24px | 24px | 24px | headline numbers |
| `--fs-h2` | 26px | 24px | 20px | |

Plus three fixed sizes that don't step:

| Token | Size | Use for |
| --- | --- | --- |
| `--fs-input` | 16px | **every** text input/select/textarea — below 16px iOS Safari zooms the page on focus |
| `--fs-display` | 32px | hero headings, empty-state glyphs |
| `--fs-display-lg` | 38px | the primary ranking hero only |

Nothing resolves below 11px. It isn't legible on a phone.
Landing-page heroes that must scale with the viewport may use `clamp()` — that's the one exception.

## Spacing — six steps

`--sp-1` 4px · `--sp-2` 8px · `--sp-3` 12px · `--sp-4` 16px · `--sp-5` 24px · `--sp-6` 32px

Pick the nearest step. Never split the difference — "just 2px more" is how we got 100+ padding values.

## Breakpoints — four tiers, and only four

```css
@media (max-width: 380px)  { }  /* narrow phone — iPhone SE and similar */
@media (max-width: 599px)  { }  /* phone   — single column */
@media (max-width: 820px)  { }  /* tablet  — mobile nav, roomier */
@media (min-width: 821px)  { }  /* desktop — side nav */
@media (max-width: 1180px) { }  /* narrow desktop — compact side nav */
```

Stylelint rejects any other width. A component changes layout at a **tier boundary**, never at a
width chosen to suit that one component. This is what stops "different cards reflow at different
widths on the same phone".

**Use the narrow-phone tier sparingly.** It exists because 320–375px screens genuinely run out of
room — it is where things get dropped or stacked that stay visible on a normal phone. Reach for it
only when content actually does not fit; it is not a general "make it a bit smaller" tier.

> The first version of this system had three tiers and folded the old 360/380px rules into 599px.
> That hid the leaderboard avatar on every phone rather than just the smallest ones, because
> `.person>i{display:none}` had been scoped to `max-width:360px`. Widening a breakpoint widens
> every rule inside it — check what a block actually does before merging it upward.

Custom properties can't be used inside a media query, so these stay as literal numbers — the
lint rule is what keeps the list at four, not the token file.

## Colour

Use a `--ds-*` token. Raw hex is rejected everywhere except `tokens.css`, where the palette is
defined. If you need a colour that doesn't exist, add a **named** token — don't inline the hex.

## The exemption list

`app/globals.css` and `app/elo-guide/guide.css` predate this system and are exempt from the
strict font-size rule (not the breakpoint rule; colour is a warning everywhere, not part of this
list). That list lives in `.stylelintrc.json` and **may only ever get shorter**. As each page is
migrated onto tokens, delete its entry. When the array is empty, the migration is finished.

`app/login/auth.css` came off the list in phase 03 slice 5 — it's the first file to fully clear the
type migration.

Never add a file to it.

## Measuring

```bash
npm run design:metrics
```

Prints the current numbers against their targets. Run it after any styling work — every number
should move toward its target, never away.

## Where this stands (2026-08-16)

This system replaced three competing sets of one-off styles (a design audit found ~110 distinct
font sizes and 22 breakpoints in use). Migration is happening page-by-page; `design:metrics` is
the live scoreboard. As of the last commit on `main`:

| Metric | Then | Now | Target |
| --- | --- | --- | --- |
| Sub-11px declarations | 270 | 1 | 0 |
| Token adoption | 29% | 55% | 100% |
| Breakpoints | 22 | 5 | 5 |
| `!important` | 100 | 85 | 0 |
| `globals.css` lines | 4,825 | 1,794 | < 500 |
| Type-exemption-list files | 3 | 2 | 0 |
| Distinct hex colours | 605 | 432 | < 20 |

Done: home view, player profile sheet, the sub-11px floor across match/H2H/matchmaking/cup
(slices 1-3 of "phase 03"), the `.sl-eyebrow` specificity fix, slice 4 (every remaining literal
sub-11px `font-size` retargeted onto `var(--fs-label)`), slice 5 (`login/auth.css` fully migrated
and removed from the type exemption list), and a two-pass colour consolidation (search
`git log --oneline --grep=slice` for the type slices).

Slice 5 also fixed a live-ish bug the "append overrides at the end" pattern had introduced: the
file had two passes of declarations stacked on the same selectors (original literals, then a later
block redeclaring most of them onto tokens — the same root cause #2 from the original audit). One
of those overrides quietly pointed `.auth-main-form input` at `var(--fs-body)`, which steps down to
14.4px on phones; it was only rendering at the correct 16px because an unrelated global
`input,select,textarea{font-size:16px}` safety-net rule in `globals.css` happened to win. Pinned it
to `var(--fs-input)` (the token that's exempt from responsive stepping for exactly this
iOS-Safari-zoom reason) so correctness no longer depends on an unrelated rule elsewhere.

The one sub-11px value left is intentional: `.fraction` in `elo-guide/guide.css` uses
`font-size:.47em`, relative to its parent element for a math numerator/denominator, not an absolute
text size — the same category of exception as `font-size:0` for visually-hidden text.

**Colour consolidation.** The "605 hard-coded hex colours" figure looked like 605 distinct design
decisions, but frequency analysis showed the max reuse of any single value was 9 occurrences —
most appear once or twice. Clustering every literal hex by RGB distance revealed the real shape of
the problem: dozens of imperceptibly-different shades of the same handful of intended colours
(near-white canvas tints, near-black surfaces, the brand green/gold), not genuinely distinct
choices. Three passes so far:

1. 38 values byte-identical to an existing token → `var(...)`. Zero risk by construction.
2. 147 values within a Euclidean RGB distance of 7 of an existing token (imperceptible — smaller
   than typical anti-aliasing noise) → `var(...)` for that token, instead of adding a new one.
3. 239 remaining values that weren't close to a token but *were* close to each other, merged onto
   79 canonical literals (not yet tokenized — sets up a smaller, tractable set for that later).

`elo-guide/guide.css`'s own `--guide-*` custom property definitions were left untouched throughout —
those are the values being defined, not usages, so replacing them with `var(--guide-*)` would be
circular. Distinct-hex-species metric: 605 → 432. Lint warnings: 889 → 706.

**Verification note on the colour passes:** this session's Browser pane couldn't composite
screenshots (times out — "pane not displayed"), so these were checked via `getComputedStyle()` spot
checks, 0 console/lint errors, and the mathematically bounded RGB delta, not an actual visual diff.
That's a weaker guarantee than the screenshot-based checks used for slices 1-5. If a screenshot tool
becomes available, a visual pass over the touched pages would be worth doing before trusting this
further.

Not done, in rough priority order:
1. **432 hard-coded hex colours still remain** (down from 605, tracked as `stylelint` warnings, not
   blocking). What's left is a smaller set genuinely spread across real distinct colours + one-off
   `--guide-*` definitions — turning the frequent ones into new named tokens is the next step, and
   unlike the consolidation passes it needs a judgment call per colour (what should it be called,
   does it deserve to be a token at all) plus visual QA.
2. **Token adoption is still only 55%** — the sub-11px sweep pushed everything up to the floor but
   most of those declarations still aren't literal-free; many other sizes above 11px (12–24px
   display tier: headings, scoreboard numerals) remain hard-coded rather than on a token. Many of the
   "odd" values already found (11.2px, 12.48px, 13.44px...) are hand-computed tablet/phone step-downs
   that mirror the token scale's own responsive steps — replacing those with a flat desktop token
   would silently remove that responsiveness, so this also needs page-by-page visual QA, not regex.
3. **`elo-guide/guide.css` is a different case from `auth.css`**, not just a smaller one: it's a
   self-contained marketing/explainer page with its own deliberate type scale (Barlow Condensed
   display faces, a `.7rem`–`1.2rem` body range, heavy use of `clamp()`) that doesn't map cleanly
   onto the app's 8-role scale — forcing it there would fight the page's own editorial design rather
   than fix an inconsistency. Before migrating it, decide whether it should (a) get its own small
   dedicated token set, or (b) stay permanently exempt as a one-off landing page. Don't just retarget
   its literals onto `--fs-*` mechanically the way `auth.css` was.
4. `globals.css` is still 1,794 lines — no page has been fully extracted into its own file yet, so
   the file stays on the stylelint exemption list. Not strictly required for consistency (tokens +
   lint enforce that regardless of file layout) — it's a lower-priority cleanup for the `!important`
   / dead-rule readability problem specifically, not the colour/type standardization problem. Still
   worth doing eventually; just after the colour and type work above.

Each slice in the git history follows the same pattern and is safe to copy: retarget hard-coded
sizes onto tokens, verify at 320/375/393px by measuring computed styles (not by eyeballing),
diff against the previous CSS rather than only checking internal consistency, then
`npm run design:metrics` to confirm the numbers moved the right way before committing.
