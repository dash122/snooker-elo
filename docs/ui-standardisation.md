# UI standardisation review

Reviewed 2026-09-06 against source. This is a code review and migration plan, not a browser-verified visual audit. No application components changed in this pass.

## Guidance findings

The checkout had `CLAUDE.md` but no `AGENTS.md`. The old guidance omitted newer primitives and described colour literals as lint-blocked even though they warn. `AGENTS.md` now provides the shared entry point, inventory, reuse rules, exceptions and proportionate validation. `CLAUDE.md` delegates to it to avoid competing copies.

## Priorities

| Priority | Evidence | Migration and verification |
| --- | --- | --- |
| 1: Overlay behavior | `Overlay.tsx` has four scaffolds: `Dialog` has no Tab trap; `BackdropSheet` has no focus lifecycle; `Sheet` and `ConfirmDialog` implement separate traps. `Dialog`/`Sheet` use fixed title IDs. | Centralize focus/dismissal behavior while preserving visual shells. Use unique IDs, exclude hidden/disabled focus targets, and handle empty content and supported stacking. Verify Tab/Shift+Tab, Escape, backdrop clicks and restoration before wider migration. Preserve caller-owned behavior. |
| 2: Fields | `account/AccountForms.tsx:Field` duplicates shared `FormField` label/error markup. The shared field does not link hint/error text to controls; its error border CSS targets only inputs. | Improve the shared ID/description/invalid-state contract for inputs, selects and textareas. Migrate account fields, retaining `message(error)` translation locally. Verify label focus, errors and layout before deleting old CSS. |
| 3: Empty states | `UiBits.tsx:Empty` and `Primitives.tsx:EmptyState` both render a glyph, heading and description with different skins. | Choose the shared appearance, add a compact variant only if needed, migrate callers, then delete unused `.empty` styles. Preserve copy/actions and check dense layouts. |
| 4: Selection controls | `SegmentedControl` hard-codes tab roles without panel wiring or arrow-key navigation; `SlidingToggleGroup` animates caller-defined selection/navigation. | Share selection styling while keeping correct semantics: tabs need panels/roving focus; filters can use pressed buttons or radios. Do not migrate every group to the current tab implementation. Verify keyboard behavior and long labels. |
| 5: Status chips | Shared `Chip`/`ChipRow` coexist with legacy `.pill` styles in `globals.css`; `ChipRow` repeats chip markup. | Audit passive labels by meaning, migrate compatible labels to shared tones, and compose `Chip` inside `ChipRow`. Keep interactive preferences and navigation counts distinct. Delete selectors only after checking all references. |
| 6: CSS ownership | `components.css`, feature styles, layered `globals.css`, and later imports in `layout.tsx` distribute visual ownership. | Migrate one family at a time: common skin in shared CSS, layout in feature CSS. Inspect computed styles before removing overrides. Moving files alone does not reduce drift. |

Start with overlays, then fields and empty states. Each slice should include shared changes, callers, obsolete CSS removal, gallery states and focused verification.

## Keep useful specialisation

- `admin/PlayerLinkCombobox.tsx` already wraps shared `PlayerCombobox`. Its hidden input and form reset handling are useful integration, not duplicate UI.
- `UiBits.tsx` contains shared scorelines, selection and charts. Splitting the file may aid navigation but does not itself standardize rendering.
- Feature sheets should retain data/actions while delegating modal behavior and shell styling.
- Preserve intentional ELO guide typography and specialised story/OG-image rendering constraints.

## Measurement

`npm run design:metrics` completed: typography token usage 74%, spacing token usage 63%, 79 distinct literal font sizes, 70 inline style expressions, five allowed width queries, and 1,370 lines in `globals.css`.

These are raw source counts. The script includes palette definitions and intentional guide styles, counts legitimate runtime geometry, and does not measure primitive adoption. Its 426 distinct CSS hex values are not 426 accidental deviations. Line counts also depend on formatting.

Improve the scoreboard separately: distinguish token definitions, intentional exceptions and ordinary feature styles; add per-family caller counts and remaining legacy selectors. Track deleted duplicate implementations/local skin overrides alongside interaction and visual checks. Do not target zero inline styles or literal colours indiscriminately.
