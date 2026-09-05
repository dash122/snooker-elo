# CLAUDE.md

## Design system — reach for these by default

Full history/reasoning: `docs/design-system.md`. Live reference of what components
exist: `app/ui-gallery` (admin-only in production, open in dev).

**Components first.** Before hand-rolling a button, card, form field, dialog, or
sheet, check `app/components/ui/Primitives.tsx` (`Button`, `Surface`, `FormField`,
`EmptyState`, `InlineNotice`, `SegmentedControl`, `Skeleton`) and
`app/components/ui/Overlay.tsx` (`Dialog`, `Sheet`).

**Type** — use a `--fs-*` token, never a literal size (lint-blocked): `--fs-label`
kickers/chips, `--fs-caption` metadata, `--fs-sm` dense body/labels, `--fs-body`
default, `--fs-lead` card titles, `--fs-h3`/`--fs-h2` headings, `--fs-stat` headline
numbers, `--fs-input` for all form controls (fixed 16px — avoids iOS zoom),
`--fs-display`/`--fs-display-lg` for heroes only.

**Spacing** — use a `--sp-*` token for padding/margin/gap: 1=4px, 1-5=6px, 2=8px,
2-5=10px, 3=12px, 3-5=14px, 4=16px, 4-5=20px, 5=24px, 5-5=28px, 6=32px. Pick the
nearest step. ≤2px/>32px are outside the scale on purpose.

**Colour** — use a `--ds-*` token from `app/styles/tokens.css`. Hex is lint-blocked;
add a named token if the colour you need doesn't exist yet.

**Shape, elevation, motion, control size** — `--radius-2xs`…`--radius-xl`/`--radius-pill`
for corners; `--ds-elevation-1`…`-6` for shadows (pick by how far off the page the
thing sits — ring/inset/sheen shadows are edges, not elevation, and stay literal);
`--ds-duration-*` + `--ds-ease-*` for transitions; and `--control-sm` 36px /
`--control-md` 44px (the standard tap target) / `--control-lg` 50px for the height of
every button, chip, toggle, tab and form control. Nothing tappable goes below 36px.

**Breakpoints** — only four, fixed: `max-width: 380px` (narrow phone, sparingly),
`599px`, `820px`, `1180px`, and `min-width: 821px`. Nothing else.

```bash
npm run lint:css       # type/breakpoints are hard errors, colour warns
npm run design:metrics # adoption scoreboard
```

**CSS files.** `app/globals.css` is legacy and shrinking — don't add to it. New
page/feature CSS goes in its own file under `app/styles/*.css`.
