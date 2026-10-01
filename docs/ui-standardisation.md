# UI standardisation review

Reviewed 2026-09-06 against source. This is a code review and migration plan, not a browser-verified visual audit. No application components changed in this pass.

## Overlay follow-up — 2026-10-01

The overlay priority below describes the September baseline. `Dialog`, `Sheet`, `ConfirmDialog` and `BackdropSheet` now share a focus/scroll lifecycle and mixed-family stack. They use unique accessible title IDs, current callbacks without restarting focus effects, live visible/enabled focus targets, fallback panel focus, topmost Escape/backdrop dismissal, inert background content and focus restoration. Scroll locking lasts until the final overlay closes and restores the original page styles and scroll position. Existing skins and caller-owned busy rules remain.

The gallery includes legacy/shared stacking, typing, busy dismissal, hidden/disabled controls, long forms and a confirmation with no enabled controls. Shared button styles now honour `hidden`.

Verification: build and repository tests passed (396 passed, 2 skipped); changed-file ESLint and TypeScript passed; CSS lint passed with 478 existing warnings; design metrics unchanged. Full ESLint still reports existing errors in untouched application/domain files and `.claude/worktrees`. Browser checks covered desktop and 390px mobile gallery focus wrapping, typing, three-layer Escape/restoration, busy dismissal, empty-panel focus and sheet layout. Installed iOS PWA, physical safe-area and software-keyboard behaviour remain device checks. Page-frame and broader sheet-geometry migration remain separate work.

## Selection follow-up — 2026-10-01

`SegmentedControl` now represents a labelled group of pressed buttons. Enabled filters stay in the normal Tab order; optional disabled items are skipped natively. This corrects account result filters, invitation/duration/privacy choices and matrix display modes through the shared component. Date/venue/night/player filters now use the same selection semantics while retaining their specialised layouts. The date scroller follows the pressed selection when scrolling it into view. Admin report periods remain links with `aria-current="page"`, rather than tab roles on navigation.

True home and match content tabs use `app/components/ui/Tabs.tsx`: a `useId()` group ID, linked `TabList`/`TabPanel`, one enabled tab stop, automatic Left/Right/Home/End activation and disabled-option skipping. Every panel ID exists, including inactive panels; inactive content still unmounts. Tab enters the active panel before its content. Existing sliding indicators, Chinese labels, cup counts, focus styles and view state remain.

The gallery distinguishes choices from tabs and includes disabled items and a long Chinese label. Four keyboard-navigation regression tests cover wrapping, disabled skipping, Home/End, removed/empty selections and native keys. Build/tests passed (400 passed, 2 skipped), TypeScript and focused shared-component lint passed, CSS lint has the same 478 warnings, and design metrics are unchanged. Full ESLint retains its prior 258 errors/44 warnings, including existing effect errors in feature files. Desktop/mobile browser checks covered the gallery and public home/match pages; authenticated account/admin screens and installed PWA assistive-technology behaviour require separate checks.

## September guidance findings

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
