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

`app/globals.css`, `app/login/auth.css` and `app/elo-guide/guide.css` predate this system and are
exempt from the colour and type rules (not the breakpoint rule). That list lives in
`.stylelintrc.json` and **may only ever get shorter**. As each page is migrated out of
`globals.css`, delete its entry. When the array is empty, the migration is finished.

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
| Token adoption | 29% | 54% | 100% |
| Breakpoints | 22 | 5 | 5 |
| `!important` | 100 | 85 | 0 |
| `globals.css` lines | 4,825 | 1,794 | < 500 |

Done: home view, player profile sheet, the sub-11px floor across match/H2H/matchmaking/cup
(slices 1-3 of "phase 03"), the `.sl-eyebrow` specificity fix, and now slice 4 — every remaining
literal sub-11px `font-size` in `globals.css`, `login/auth.css`, and `elo-guide/guide.css` retargeted
onto `var(--fs-label)` (search `git log --oneline --grep=slice` for each).

The one sub-11px value left is intentional: `.fraction` in `elo-guide/guide.css` uses
`font-size:.47em`, relative to its parent element for a math numerator/denominator, not an absolute
text size — the same category of exception as `font-size:0` for visually-hidden text.

Also done: 38 raw hex values that were byte-identical to an existing `--ds-*`/`--green`/`--line`/
`--mint` token got rewritten as `var(...)`. This is a zero-risk, mechanical dedupe — it cannot
change any rendered colour since the values are identical — and it dropped `color-no-hex` lint
warnings from 889 to 851. It does **not** move the "574 distinct hex colours" metric, because that
metric counts distinct hex *strings still present anywhere in the CSS* (including each token's own
`--name:#hex` definition), and none of those definitions were touched.

Not done, in rough priority order:
1. **574 hard-coded hex colours** remain (tracked as `stylelint` warnings, not blocking). Unlike the
   sub-11px floor, most of these can't be swept mechanically: each one needs a judgment call (map to
   an existing token, or add a new *named* token per the rule above) and a page-by-page visual check
   — the doc's own phase-03 "don't" list warns against a blind rewrite here.
2. **Token adoption is still only 54%** — the sub-11px sweep pushed everything up to the floor but
   most of those declarations still aren't literal-free; many other sizes above 11px (12–24px
   display tier: headings, scoreboard numerals) remain hard-coded rather than on a token. Many of the
   "odd" values already found (11.2px, 12.48px, 13.44px...) are hand-computed tablet/phone step-downs
   that mirror the token scale's own responsive steps — replacing those with a flat desktop token
   would silently remove that responsiveness, so this also needs page-by-page visual QA, not regex.
3. `globals.css` is still 1,794 lines — no page has been fully extracted into its own file yet, so
   the file stays on the stylelint exemption list.

**Blocker:** the last two items need a working preview to verify against (per the doc's own slice
checklist: "verify at 320/375/393px by measuring computed styles"). This session's dev server can't
get a reachable port — another session already holds :3000 and the browser tooling here can't reach
Vite's fallback port. Continuing safely means either freeing up :3000 or doing the verification in a
session that can reach the preview.

Each slice in the git history follows the same pattern and is safe to copy: retarget hard-coded
sizes onto tokens, verify at 320/375/393px by measuring computed styles (not by eyeballing),
diff against the previous CSS rather than only checking internal consistency, then
`npm run design:metrics` to confirm the numbers moved the right way before committing.
