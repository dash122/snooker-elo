# Shootout Timer — Product Requirements Document

**Status:** Revised product definition / proposed MVP  
**Surface:** Standalone, mobile-first web route (proposed: `/shootout`)  
**Primary language:** Traditional Chinese  
**Primary operator:** One timekeeper using one device  
**Rules baseline:** WPBSA Rulebook 2024–25, “Snooker Shootout Competition Rules”

## 1. Product intent

Shootout Timer is a focused timing-and-turn indicator for running a Snooker Shoot Out frame. It shows the continuously running ten-minute match clock, the active player, and the current 15- or 10-second shot clock.

It does **not** record scores, pots, breaks, fouls, balls remaining, a winner, or sudden-death blue results. Those decisions remain with the referee and existing scorekeeping process.

The defining interaction is manual control: the timekeeper presses one prominent button whenever play passes to the other player. Shot-clock expiry does not switch the turn automatically. It changes the interface to an expired state and waits for the timekeeper to confirm the switch while the ten-minute match clock continues uninterrupted.

### Goals

- Accurately run a ten-minute Shoot Out match clock.
- Automatically apply a 15-second shot limit above 5:00 and a 10-second limit at or below 5:00.
- Make the active player unmistakable from a phone at arm’s length.
- Let one timekeeper switch turns with one large, deliberate tap.
- Keep the match clock running when the shot clock expires.
- Recover safely from accidental turn switches or page interruption.

### Non-goals

- Scorekeeping or foul-point calculation.
- Pot, break, ball-on, reds-remaining, or table-state tracking.
- Declaring the match winner or managing a tied-score blue-ball shootout.
- Tournament brackets, scheduling, multi-table control, or broadcast graphics.
- Automatic turn detection or automatic turn switching on expiry.
- Integration with ELO match records in the first release.

## 2. Core rules and product behavior

| Rule or decision | Product behavior |
|---|---|
| Match duration | Match clock counts down continuously from `10:00.0`. |
| Match start | Both clocks start together when the timekeeper presses `開始比賽` for the opening stroke. |
| First five minutes | While match time is above `05:00.0`, each turn receives 15 seconds. |
| Last five minutes | Once match time reaches `05:00.0`, the active shot clock changes immediately to a maximum of 10 seconds. Every later turn starts at 10 seconds. |
| Turn completion | The timekeeper presses the main turn button when the next player’s shot clock should begin. The active player changes and the shot clock resets to the limit for the current match phase. |
| Shot-clock expiry | At zero, show `時間已過` and sound the expiry cue. Do not switch player automatically. The match clock continues. |
| Switch after expiry | The timekeeper presses `確認・轉換球員` to switch the active player and start a fresh 15- or 10-second shot clock. |
| Match-clock expiry | At zero, stop the match clock and show `比賽時間完結`. Do not infer a winner. |
| Time-out | The timekeeper may pause the shot clock, match clock, or both, then resume or reset the shot clock. |
| Official authority | The interface supports timing; the referee remains the final authority for when a clock starts, pauses, resets, or when the match ends. |

### Five-minute transition

- At `05:00.0`, the phase changes from `15 秒` to `10 秒` immediately.
- If the active shot clock shows more than 10 seconds, it becomes `10.0`.
- If it already shows 10 seconds or less, its remaining value is preserved.
- The change does not switch player and does not interrupt the match clock.
- A single visual and audio cue announces `進入 10 秒階段`.

## 3. Primary user and success measures

**計時員** stands beside the table and watches play rather than the screen. They need a one-handed interface with large targets, clear audio feedback, no hidden timer state, and fast correction after an accidental tap.

Success means:

- Current player and both clocks are identifiable within one second.
- A normal turn switch requires one tap.
- An expired shot clock can never be mistaken for an automatic turn change.
- The match clock never pauses because the shot clock expires.
- The interface needs no vertical scrolling during live operation at 360 × 800 CSS pixels.
- The latest turn switch can be reversed without restarting the match.

## 4. Match lifecycle

### A. Setup — `賽前設定`

- Enter or select Player A and Player B.
- Select the opening player.
- Optional venue/table label.
- Test sound and choose whether supported haptics are enabled.
- `進入準備畫面` does not start either clock.

Validation: player names must be present and distinct; opening player must be selected.

### B. Ready — `準備開始`

- Shows both players, inactive `10:00.0` match clock, and inactive `15.0` shot clock.
- Opening player is strongly highlighted.
- Primary action: `開始比賽`.
- Pressing it starts both clocks atomically.

### C. Live turn — `計時中`

- Match and shot clocks run independently.
- Active player is shown with a directional marker and `出桿中`.
- Main button reads `轉換至［另一球員］`.
- Pressing it changes active player and resets the shot clock to 15 or 10 seconds according to current match time.
- Each switch is timestamped in a lightweight event log.

The timer does not determine whether the striker potted a ball and remains at the table. The timekeeper presses the switch button only when the turn actually passes to the other player.

### D. Shot clock expired — `時間已過`

- Shot clock stops at `00.0`; it never displays a negative value.
- Match clock keeps counting down.
- Shot-clock panel changes to the danger state and announces `時間已過`.
- Active player remains unchanged.
- Main button changes to `確認・轉換至［另一球員］`.
- Only pressing that button changes player and starts the next shot clock.
- `取消到時／恢復` is available as a secondary correction if the referee overrules the expiry.

### E. Time-out — `暫停計時`

Available choices:

- `暫停出桿鐘`
- `暫停比賽鐘`
- `全部暫停`

The timekeeper can resume from the preserved time or reset the shot clock to the current phase limit. Paused clocks must be unmistakable and must not resume silently after the app returns from the background.

### F. Match complete — `比賽時間完結`

- Match clock stops at `00:00.0`.
- Shot clock stops and live turn control becomes inactive.
- Show the player who was active when time expired for reference only.
- Actions: `查看時間紀錄`, `修正最後操作`, and `結束並返回`.
- Do not show score, winner, or tie-resolution controls.

## 5. Timer and state requirements

The engine tracks only:

- Match status: setup, ready, live, paused, complete.
- Match start timestamp and remaining time.
- Current phase: 15-second or 10-second.
- Active player.
- Shot-clock start timestamp, remaining time, and status: idle, running, paused, expired.
- Time-out state and which clocks are paused.
- Chronological events: start, player switch, expiry, pause, resume, reset, correction, match end.

### Clock implementation

- Derive remaining time from timestamps using monotonic timing semantics; do not depend on decrementing intervals for accuracy.
- Display tenths on both clocks.
- The match clock is independent of shot-clock state.
- Backgrounding the browser does not pause active clocks. On return, elapsed time is reconciled immediately.
- Request Screen Wake Lock during a live match and show a persistent warning if it is unavailable or released.
- Autosave after each state transition so refresh/crash recovery can reconstruct both clocks.
- Timing and turn switching continue offline after the page has loaded.

### Undo and correction

- `復原上次轉換` restores the previous active player and prior shot-clock snapshot while preserving actual match-clock elapsed time.
- The action states what will be reversed, e.g. `復原：轉換至李志強`.
- Resetting either clock or changing the active player manually requires confirmation showing the resulting state.
- Corrections append an event; they do not erase the original audit entry.

## 6. Information architecture

### Standalone route

- Proposed route: `/shootout`.
- Uses its own lightweight header with no main-app side rail or mobile bottom navigation.
- Initially accessed by direct URL or a secondary experimental link.
- May reuse existing player names, but creates no main match/ELO record.

### Mobile live-controller layout

The critical interface fits in one viewport:

```text
┌────────────────────────────────┐
│ SHOOTOUT        15 秒階段   ● │
│             07:42.6            │  比賽鐘
├────────────────────────────────┤
│  ● 陳大文           李志強    │
│    出桿中                      │
├────────────────────────────────┤
│                               │
│          出桿鐘  08.4          │
│                               │
├────────────────────────────────┤
│       [ 轉換至李志強 ]         │
│ [暫停計時]        [復原上次轉換]│
└────────────────────────────────┘
```

When the shot clock expires, the same geometry is retained:

```text
│          時間已過  00.0         │
│     [ 確認・轉換至李志強 ]      │
```

Keeping the clocks and players spatially stable avoids re-orientation during rapid play.

### Tablet and desktop

- Preserve the mobile control order rather than turning it into a dashboard.
- Center the controller within the existing medium page width.
- At 821px and above, an optional right-side activity rail may show recent turn switches, pauses, and resets.
- Full-screen mode may enlarge player names and clocks for tabletop/display use.

### Persistent live information

- Match clock.
- Shot clock.
- Active player.
- Phase badge: `15 秒階段` or `10 秒階段`.
- Running, paused, or expired state.
- Sound, wake-lock, and offline/save status.

## 7. Interaction requirements

### Touch and ergonomics

- Minimum target: 44 × 44px.
- Main turn-switch button: at least 64px high on phones and placed in the central thumb zone.
- No competing destructive or secondary action beside the turn-switch button.
- Turn switching needs one deliberate tap during normal play; no confirmation modal.
- Apply a short input lock after switching to prevent accidental double taps.
- Every switch gives immediate visual, audio, and optional haptic acknowledgement.
- Do not encode the active player or expiry state by colour alone.

### Audio and haptics

Audio cues are SCAA interface behavior, not mandated WPBSA beep patterns:

- Brief cue at the `05:00.0` transition.
- Warning cue at 5 seconds remaining.
- Distinct countdown tones for the final 3 seconds.
- Strong expiry tone at `00.0`.
- Match-end horn at `00:00.0`.
- Distinct, brief confirmation sound after a manual player switch.

The user must be able to test sound before starting. Text and visual state remain sufficient when audio or haptics are unavailable.

### Safety behavior

- Shot expiry never switches turns automatically.
- Shot expiry never pauses the match clock.
- Pausing only the shot clock leaves the match clock visibly running.
- Player switch labels name the destination player, avoiding an ambiguous `下一位` action.
- Abandon, restart, manual clock adjustment, and match end require confirmation.
- Browser back/reload warns during a live match and offers recovery on return.

## 8. Traditional Chinese terminology

- Feature name: `限時賽計時器`; retain `SHOOTOUT` as the compact mode mark.
- Match clock: `比賽鐘`.
- Shot clock: `出桿鐘`.
- Active player: `出桿球員` / `出桿中`.
- Switch turn: `轉換至［球員姓名］`.
- Expired: `時間已過`.
- Expired confirmation: `確認・轉換至［球員姓名］`.
- Phase labels: `15 秒階段`, `10 秒階段`.
- Time-out: `暫停計時`.
- Undo: `復原上次轉換`.
- Match end: `比賽時間完結`.

English identifiers remain in the data model for future localization.

## 9. Visual-element requirements

### Existing SCAA visual authority

Reuse the established system:

- Deep baize green (`--ds-canvas-brand`, `--ds-surface-featured`) for the live timing arena.
- Functional warm off-white surfaces for setup, sheets, and history.
- Action green for standard controls.
- Gold only for phase markers and featured moments.
- `Noto Sans TC` for UI copy and `Barlow Condensed` for clocks and compact English labels.
- Existing spacing, radius, focus, control-size, safe-area, and breakpoint tokens.

### Live composition

- Treat the screen like a compact venue timing board, not dashboard cards.
- Shot clock is the largest numeral and dominant live element.
- Match clock is the stable top anchor.
- Player names form one continuous turn strip; there are no score values or score placeholders.
- Active player receives a solid marker, stronger contrast, and the text `出桿中`.
- Main switch button visually points toward and names the incoming player.
- Clocks and player strip stay fixed when normal, paused, and expired states change.
- Avoid decorative ball graphics, glass effects, ornamental gradients, and excessive shadows.

### Urgency states

- Normal: stable deep-green field.
- Five seconds remaining: amber perimeter/ring and `尚餘 5 秒`.
- Final three seconds: restrained pulse on the shot-clock region only.
- Expired: solid danger treatment and `時間已過`; no indefinite flashing.
- Five-minute phase change: animate the phase badge once without recolouring the whole screen.
- Paused: freeze numerals and show a persistent `已暫停` band.
- Respect `prefers-reduced-motion`; text and tone communicate every state without animation.

### Iconography

- Utility icons may support pause, undo, sound, full screen, and activity history.
- Live actions always include visible text labels.
- Clocks use tabular numerals and never animate in a way that obscures exact values.

## 10. Accessibility and resilience

- WCAG 2.2 AA contrast for all text and controls.
- Keyboard-operable controls with visible focus.
- Announce meaningful changes only: player switch, 10-second phase, pause/resume, shot expiry, and match end.
- Example screen-reader status: `陳大文出桿，出桿鐘剩餘 8 秒，比賽鐘剩餘 7 分 42 秒`.
- Do not announce every timer tick.
- Do not rely on colour, sound, or vibration alone.
- Support 200% text zoom while retaining both clocks, active player, and main action.
- Landscape phone mode retains both clocks, both names, active state, switch, pause, and undo.

## 11. Functional acceptance criteria

1. `開始比賽` starts match and opening shot clocks atomically.
2. Turns above 5:00 receive 15 seconds.
3. At exactly 5:00, the phase changes immediately to 10 seconds and any active remaining shot time above 10 seconds is capped to 10 seconds.
4. Turns at or below 5:00 receive 10 seconds.
5. A normal manual switch changes active player and resets only the shot clock.
6. At shot-clock zero, the active player remains unchanged and the match clock continues.
7. After shot-clock expiry, only `確認・轉換至［球員］` starts the next player’s clock.
8. Shot-clock pause or reset never pauses the match clock unless `全部暫停` or `暫停比賽鐘` was explicitly selected.
9. Match-clock zero stops all timing and does not declare a winner.
10. Undo restores the prior player and shot-clock state without adding time back to the continuously running match clock.
11. Refresh/background recovery does not create extra official time.
12. Core live controls fit without scrolling at 360 × 800 and remain usable at 320px width.
13. Timing remains functional offline after initial load.
14. Traditional Chinese is complete with no user-facing fallback keys.
15. No score, pot, break, foul-value, ball-state, winner, or blue-shootout control appears anywhere in the feature.

## 12. Suggested delivery slices

### MVP — standalone timing controller

- Setup and opening-player selection.
- Authoritative match and shot clocks.
- Immediate 15-to-10-second transition at 5:00.
- Manual turn switching before and after expiry.
- Independent pause/resume/reset controls.
- Audio/haptic cues, wake lock, undo, local event log, autosave, and crash recovery.
- Responsive standalone interface using the current SCAA visual system.

### Later enhancements

- Server-side session history.
- Read-only spectator timing display paired to the timekeeper device.
- Organizer view for multiple tables.
- Configurable practice mode clearly separated from the official Shoot Out preset.

## 13. Source basis

- [WPBSA Rules of Snooker and English Billiards](https://www.wpbsa.com/rules/) — current rules landing page.
- [WPBSA Rulebook 2024–25, Snooker Shootout Competition Rules, pp. 43–46](https://wpbsa.com/wp-content/uploads/2198_WPBSA-Rulebook-2024-25.pdf).

