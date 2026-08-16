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
`stylelint` warns (not yet blocks) if a `padding`/`margin`/`gap` declaration uses a literal value that
exactly matches one of these six numbers instead of the token — same maturity model as colour.

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

`app/globals.css` is exempt from the strict font-size rule (not the breakpoint rule; colour is a
warning everywhere, not part of this list) because it predates this system. That list lives in
`.stylelintrc.json` and **may only ever get shorter**. As each page is migrated onto tokens, delete
its entry. When the array is empty, the migration is finished.

`app/login/auth.css` came off the list in phase 03 slice 5 — it's the first file to fully clear the
type migration.

`app/elo-guide/guide.css` is exempt too, but for a different reason — as of 2026-08-16 this is a
closed decision, not an open TODO. It lives in its own override block in `.stylelintrc.json`,
separate from the shrinking `globals.css` list, because it isn't migration debt: it's a
self-contained marketing/explainer page with its own deliberate type scale (Barlow Condensed
display faces, a `.7rem`–`1.2rem` body range, heavy `clamp()` use) that predates and intentionally
doesn't match the app's 8-role scale. Forcing it onto `--fs-*` would fight the page's own editorial
design rather than fix an inconsistency, so it stays permanently exempt unless someone makes an
explicit design decision to give it its own dedicated token set — that would be new work, not a
mechanical migration, and isn't planned.

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
| Token adoption (type) | 29% | 67% | 100% |
| Breakpoints | 22 | 5 | 5 |
| `!important` | 100 | 85 | 0 |
| `globals.css` lines | 4,825 | 1,794 | < 500 |
| Type-migration-debt files | 3 | 1 | 0 |
| Distinct hex colours | 605 | 424 | < 20 |
| Token adoption (spacing) | not tracked before | 24% | 100% |
| Off-scale spacing literals that should've been tokens | not tracked before | 0 | 0 |

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
4. **10 new named tokens** for the highest-frequency values left after 1-3 that didn't map to an
   existing token: `--ds-success-wash`/`-border`, `--ds-warning-wash`/`-text`, `--ds-highlight-wash`,
   `--ds-accent-soft`, `--ds-border-muted`, `--ds-chart-primary`, `--ds-icon-muted`,
   `--ds-text-quaternary`, `--ds-text-muted-teal`, plus `--green-hover` (named to match the existing
   `--green`/`--green-bright` legacy vars rather than the `--ds-*` prefix). Each name was chosen by
   reading the actual selector it appeared in (see `git show bba501d` for the full reasoning per
   colour) rather than guessed from the hex alone. Two values got mapped onto *existing* tokens
   instead of new ones, because their usage was the same design role, just drifted: `#c3d8d2` (hero
   text on dark brand backgrounds, ~15 RGB units off) → `--ds-text-on-brand-secondary`, and
   `#27704e` (win/success text, ~20 RGB units off) → `--ds-success`. Those two aren't byte-identical
   like passes 1-2, so they were checked against a live preview via `getComputedStyle()` rather than
   trusted on the math alone.

`elo-guide/guide.css`'s own `--guide-*` custom property definitions were left untouched throughout —
those are the values being defined, not usages, so replacing them with `var(--guide-*)` would be
circular. Distinct-hex-species metric: 605 → 432 (passes 1-3 only — naming a new token doesn't move
this metric, since the token's own definition keeps that hex string present in the file, same as any
other token). Lint warnings: 889 → 612 (all four passes).

**Verification note on the colour passes:** the Browser pane still can't composite screenshots in
this environment (times out — "pane not displayed"), even with a reachable dev server. Passes 1-3
(all byte-identical or imperceptible-distance merges) leaned on the mathematically bounded RGB
delta plus 0 console/lint errors. Pass 4's two "reuse an existing token" cases aren't
byte-identical, so those were checked against a live preview via `getComputedStyle()` — confirmed
both resolve to the exact expected token hex. That's still weaker than an actual pixel diff. If a
screenshot tool becomes available, a visual pass over the touched pages (home, login, results,
matchmaking, calibration, elo-guide) would be worth doing before trusting this further.

## Bug found and fixed: root font-size compounding (2026-08-16)

`html{font-size:var(--fs-body)}` pinned the *root* element's font-size to a token that itself steps
down inside media queries (`--fs-body` becomes `.9rem` at ≤599px). Every other `--fs-*` token is
`rem`-based, so all of them resolved against that already-shrunk root — compounding an extra ~10%
shrinkage on top of the phone-tier values in the table above. Concretely: `--fs-label` is documented
to floor at 11px on phones, but was actually rendering at **9.9px** — silently undermining the
sub-11px floor that slices 3-4 spent real effort guaranteeing. This was a pre-existing bug (not
introduced by this migration); it affected every already-tokenized element on the site, not just the
ones touched today. Fixed by pinning `html` to a fixed `16px` (matching `--fs-body`'s own desktop
value, so zero visual change at desktop). Verified via `getComputedStyle()`: `--fs-label` now
resolves to exactly 11px at 375px and 12px at 1280px, matching the table.

**Colour pass 2 (frequency tier 3-9).** Continued the pass-4 methodology (read each colour's actual
selector context, then merge into an existing/near token or name a new one) one tier further down
the frequency list: `--ds-text-inactive`, `--ds-border-hover`, `--ds-accent-text` named as new
tokens; `#e8f1ec`/`#123d37`/`#d6dad5`/`#e7e5dc`/`#c9ccc5` merged into existing/near tokens (same
design intent, small drift, same reasoning as the `#c3d8d2`/`#27704e` cases from pass 4). Also
found and fixed pure internal drift inside `elo-guide/guide.css`: it already defines `--guide-blue`
but two rules were re-typing that exact hex as a literal instead of using the file's own token —
zero-risk fix — and added `--guide-teal-muted` for a colour reused 3× within that file (its own
separate palette, per the closed exemption decision above, not the app's `--ds-*` system).
`color-no-hex` warnings: 612 → 565. Verified against a live preview: every new/merged token
resolves to its expected hex, no console/lint errors, no overflow.

**Colour pass 3 (frequency-2 tier) — and a correction.** Went through all 43 hex values used
exactly twice. About half turned out to be gradient stops for genuinely decorative one-off elements
(snooker-ball radial gradients, share-button glyphs, medal badges) or an external brand colour
(WhatsApp's green) — correctly **not** tokenized, since naming those would be abstraction for its
own sake rather than fixing an inconsistency. The other half were real reuse. New tokens:
`--ds-chart-fill`, `--ds-positive-soft`, `--ds-danger-wash`, `--ds-signup-wash`/`-text` (the cup
signup chip — a blue that doesn't exist anywhere else in the palette), `--ds-accent-pale`,
`--ds-chart-positive`/`-negative` (momentum-chart bars). Eight more values merged into existing
tokens where the role matched closely. `elo-guide/guide.css`-scoped: `--guide-mist`.
`color-no-hex` warnings: 565 → 532. Distinct hex colours: 432 → 424.

*Correction:* the previous version of this doc (and the artifact) reported "432 → 404" for pass 2,
using a custom script that excluded `tokens.css` from the count — different from what
`npm run design:metrics` measures, and not comparable to the 605/574/503/432 lineage used
everywhere else. Re-running `design:metrics` directly against that commit confirmed the real number
was still 432; pass 2 hadn't actually moved the official metric (each merge target was already a
token, so the distinct-species count doesn't shift the same way a *new* token's first use does).
The number directly above (424) is confirmed against `design:metrics` itself.

**Media-query-scoped font sizes, first cut.** Rather than a blanket sweep, computed what each
breakpoint tier's tokens *actually* resolve to (from the tier redefinitions in `globals.css` itself,
not the docs table) and only replaced a literal where it's an exact match — 24 of ~90 remaining
media-scoped literals qualified. Two of the converted declarations (`.person b`, `.bottom button`)
turned out to already be dead code before this change — a higher-specificity or later
same-specificity rule elsewhere in the file was already winning — which is the pre-existing
"multiple overlapping rules for the same selector" problem (root cause #2 in the original audit),
not something this edit introduced; the edit has zero rendered effect in those two cases and is a
real fix in the ones where the edited rule does win. Token adoption: 65% → 67%.

## New front: spacing (2026-08-16)

Padding, margin, and gap had never been touched — a 6-step scale (`--sp-1`..`--sp-6` =
4/8/12/16/24/32px) has existed in `tokens.css` since phase 01, but nothing enforced or migrated it.
2,271 literal spacing declarations exist across the codebase (116 distinct values); before checking
closely this read like "the type/colour work just hasn't reached spacing yet," but it's really its
own gap — spacing was never part of the phase 01 guardrails the way font-size and breakpoints were.

**809 of those 2,271 occurrences (36%) are literal `px`/`rem` values that exactly equal one of the
six scale steps.** Retargeted all of them onto `var(--sp-1..6)`, including inside multi-value
shorthand (`padding:12px 8px` → `padding:var(--sp-3) var(--sp-2)` — only the matching sub-values
change) and preserving `!important`. This is zero-visual-risk by construction: `--sp-*` tokens have
no media-query redefinitions (checked directly, unlike the `--fs-*` bug fixed earlier), and `rem`
now resolves consistently everywhere since the root font-size fix, so a literal already equal to a
token's value renders pixel-identical after the swap. Verified against a live preview across
home/login/elo-guide at 599/1280px: no horizontal overflow, 0 console errors.

Also added tracking so this can't silently regress: a new warning-severity stylelint rule
(`declaration-property-value-disallowed-list`) flags any future spacing literal that exactly matches
a `--sp-*` step, mirroring `color-no-hex`'s maturity model — and two new `design:metrics` rows,
spacing token adoption (24%) and a regression tripwire for exact-scale literals (currently 0,
confirming the sweep above was complete).

**On "decorative one-offs" — checked, not skipped.** Before leaving colour pass 3's decorative
colours alone, went back and checked whether they're actually the *same* UI element redefined
independently in multiple places with drift (which would mean they should be standardized) rather
than genuine one-offs. They're not: the snooker-ball gradient, the medal-tier washes, and the
Instagram share-button gradient are each defined exactly once in the codebase, and two are external
brand-colour constraints (WhatsApp's actual green, Instagram's actual gradient) that shouldn't be
redesigned regardless. The real standardization gap the "many different standards" feeling was
picking up on was spacing, not these.

Not done, in rough priority order:
1. **The other ~1,460 spacing declarations don't land exactly on the 6-step scale** and are the real
   remaining work — this is the spacing equivalent of the harder media-query font-size case: each one
   needs a judgment call (round 10px to 8 or 12? does 18px deserve a 7th step, or round to 16?) plus
   visual QA, not a mechanical sweep. Very small values (1-2px) are likely optical nudges (e.g.
   aligning an icon with a text baseline) that don't belong on the spacing scale at all and shouldn't
   be forced onto it. This is the next thing to tackle to move spacing token adoption meaningfully
   past 24%.
2. **424 hard-coded hex colours still remain** per `design:metrics` (down from 605 across three
   passes). What's left is a long tail: counting usages only (i.e. excluding each token's own
   definition in `tokens.css` — a different, smaller count than the 424 headline number, done here
   only to characterize the shape of what's left, not to replace the official metric), there are 389
   distinct values still used somewhere, and 354 of those are used exactly once. A good number of
   those look like intentionally distinct decorative colours (snooker-ball gradients, medal colours,
   the WhatsApp brand green) rather than design-system violations — pass 3 already found and correctly
   skipped several of these. Continuing past this point has diminishing returns: each one still needs
   a context read, but an increasing fraction won't turn out to deserve a token at all.
3. **Type token adoption is at 67%, not 100%** — most of what's left *inside* `@media` blocks is the
   harder case flagged before: hand-computed tablet/phone step-downs (11.2px, 12.48px, 13.44px...)
   that don't land exactly on any tier's token value, or one-off heading/icon/score-display sizes
   that don't match a text-role token at all. These need visual judgment per declaration, not just
   the exact-match check that handled the first 24.
4. `globals.css` is still 1,794 lines — no page has been fully extracted into its own file yet, so
   the file stays on the stylelint exemption list. Not strictly required for consistency (tokens +
   lint enforce that regardless of file layout) — it's a lower-priority cleanup for the `!important`
   / dead-rule readability problem specifically (see the `.person b` / `.bottom button` finding above
   for a live example of that problem), not the colour/type standardization problem. Still worth
   doing eventually; just after the colour and type work above.

**Resolved:** `elo-guide/guide.css`'s exemption status was an open TODO as of an earlier session;
it's now a closed decision — see "The exemption list" above. It stays permanently exempt by design,
split into its own `.stylelintrc.json` override block so it's no longer conflated with
`globals.css`'s shrinking migration-debt list.

Each slice in the git history follows the same pattern and is safe to copy: retarget hard-coded
sizes onto tokens, verify at 320/375/393px by measuring computed styles (not by eyeballing),
diff against the previous CSS rather than only checking internal consistency, then
`npm run design:metrics` to confirm the numbers moved the right way before committing.
