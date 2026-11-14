# 3D 桌球 surface brief

## Experience

A playable single-frame match against the computer inside Snooker ELO's existing club world. The direction contract is the opening comment in `app/game/Game.tsx`: televised snooker, an elevated camera, lit cloth, a restrained score strip, and one compact shot-control desk. The table is the main experience; surrounding UI makes the next shot understandable.

Preserve Traditional Chinese (Hong Kong) copy, green/gold identity, and the existing condensed display typography. This brief applies only to the game surface; shared design tokens and primitives remain authoritative for the wider app.

## Colors and typography

The arena uses `--ds-canvas-brand` with `--ds-text-on-brand`; gold `--ds-accent-soft` highlights scores and the current player. Supporting copy uses `--ds-text-secondary`. Controls retain shared action, featured and secondary variants instead of inventing another button family. Use existing `--fs-*` typography roles and `--sp-*` spacing.

The Three.js scene supplies material color: green cloth and cushions, dark timber rails, muted brass pocket rims, pale table markings, and recognizable ball colors. These scene materials support the physical object and do not redefine application tokens.

## Layout and depth

Order: compact heading and return link; arena with club caption, table, and score strip; live turn/shot status; shot controls and camera selector; optional rules disclosure. On narrow screens controls stack and the shot button becomes full width. Both camera views fit the table in portrait.

Depth belongs primarily to the lit Three.js table: raised rails, spherical balls, cue, pockets and soft shadows. The arena uses the shared card radius. Keep surrounding chrome restrained so the table remains dominant.

## Components and interaction

- Reuse `Button`, `ButtonLink`, `FormField` and `SegmentedControl` from shared primitives.
- Pointer selection on the table sets aim. Labelled angle and power range inputs provide keyboard operation; the angle control permits fine adjustments.
- Disable shot controls while balls move, during the computer turn, or after the frame ends. Keep live score, target, break, best break and turn feedback legible in text outside the canvas.
- Offer broadcast and overhead views. Restart requires an inline confirmation. WebGL failure displays a readable alert.
- The computer selects a target and pocket route, then strikes through the same physics and scoring path as the player.

## Simulation and rule scope

The table is rendered in Three.js; ball motion is a planar simulation using metres and seconds, advanced at a fixed 240 Hz. It includes equal-mass ball collisions, rolling resistance, cushion rebounds and distance-based pocket capture. This is an approachable physical approximation, not a claim of tournament-grade simulation: no sidespin, jumping, swerve or detailed pocket-jaw geometry.

Rules alternate reds and colors, then clear colors in order, with simplified foul scoring, automatic color targeting and respotting. There is no nominated color, free ball, play-again choice or foul-and-miss replay. A tied clearance respots black. Results do not affect club ELO.

## Guardrails

- Keep original graphics and club identity; acknowledge broadcast/game inspiration without official BBC or WSC branding or affiliation claims.
- Preserve visible focus, labelled controls, readable pending/error states and text feedback alongside the canvas. Do not describe these as a complete nonvisual equivalent of spatial play.
- State the simplified rules and physics honestly in the disclosure. Keep implementation terminology out of the primary shot flow.
- Extend this surface through its owning files (`app/game/`, `app/styles/snooker-game.css`, `lib/snooker-game.ts`, `lib/snooker-match.ts`); avoid unrelated application redesign.

## BBC score strip and animated player

The user selected the contemporary yellow/black BBC layout. The score strip follows the [2025 BBC Four broadcast reference](https://www.tvhome.co.uk/bbc-four/2025/04/19): full-width yellow name panels, black inward turn arrows, white point cells, a teal centre for frames and match length, and a black caption band. It uses the `--ds-broadcast-*` tokens and retains the game's actual names and single-frame format. It does not display a BBC logo or claim official affiliation.

The locally bundled human is Microsoft Rocketbox's MIT-licensed `Male_Adult_08`, with photo-textured skin, hair and a skinned skeleton including fingers. Source and license are in `public/models/snooker-player/`. WebP colour textures keep the complete asset near 1 MB. Bind-pose garment attributes give the player a white shirt, black waistcoat, dark trousers and a mesh bow tie, preserving hand/neck skin. `PlayerAvatar.ts` poses the spine, bridge hand, grip, fingers and staggered legs with two-bone IK; it is procedural cueing, not captured professional snooker motion.

The user's supplied stance photos govern posture: a low chin with a downward gaze, an extended bridge arm, a raised rear elbow and staggered planted feet. Neck and head extension are distributed across the cervical chain; the head clears the collar instead of being folded into a horizontal neck joint. Thigh anchors remain fixed when the torso bends, correcting the source rig's unusual spine-to-thigh parenting. Tests run against the bundled skeleton to check neck separation, cue-plane hand positions across the stroke and floor contact. The player camera preserves its horizontal view on portrait screens.

Both human and computer shots share a 1050 ms cue-contact clock. Ball motion begins at contact, after address and backswing, followed by follow-through and standing to watch. The character stays at the shot origin while balls roll. A third, side-on player camera exposes the stance; broadcast and overhead cameras remain available. Longer reaches show an extended cue and mechanical rest. Model loading/failure is reported in text; reduced-motion preferences suppress idle cue waggling.


## October 2026 realism extension

The arena follows the requested Crucible theatre atmosphere: tiered burgundy seating, a dark curtain wall, a blue-grey playing floor and perimeter boards. Instanced audience geometry bounds draw calls. It is an original approximation, not an architectural replica. The table has a seeded cloth texture, split side cushions, timber rails and muted leather-like pocket rims.

Spin uses two labelled native range inputs and a visual cue-tip marker, with a shared reset button. Shot animation captures spin at queue time. Aim aids cache the current layout/angle/power/spin and sample the gameplay solver on copies: a dashed incoming line, contact ring, solid gold object path and dashed white cue-ball continuation. These are estimates, not a pot guarantee.

Physics uses 240 Hz steps, solid-sphere inertia, slip friction at 0.20 g, rolling resistance at 0.012 g, ball restitution 0.94, cushion restitution 0.90 and cushion friction 0.14. Parameters are engineering approximations and are not calibrated to a particular cloth or cushion. The contact model follows the sliding/rolling and friction-impulse approach discussed in Mathavan et al., https://doi.org/10.1243/09544062JMES1964; it is not the full three-dimensional cushion model. Cushion height, jaws, cloth nap, ball-to-ball tangential friction, swerve and jumping remain outside scope.

Validation covers stopping distance, close-range draw/follow, cushion energy loss, spin-sensitive cushion angle and prediction immutability, plus existing match tests. Desktop and 390px mobile were inspected in Chrome; keyboard spin changes and disabled controls during shots were checked. Shared CSS and controls retain the existing product system.


## XW101 table reference refinement

The table builder is now `app/game/TournamentTable.ts`. It creates actual scalloped cloth boundaries and a perforated rail/slate deck, six individually shaped cushions, recessed pocket liners, stitched cowhide-coloured outer irons with hanging skirts, diamond nets and twin ball slides. The apron is split around the pockets. Dark timber, broad gold fascia, fine mouldings and eight turned legs follow the XW101 visual reference. No manufacturer logo or certification claim is applied. Playing dimensions and physics stay unchanged; pocket jaw collision geometry remains an approximation in the existing solver.

References inspected: XingPai's manufacturer XW101 article and photograph (https://www.xingpaibilliard.com/news/hydt/2020/06/01/4595.html), plus the XW101 pocket/slide close-up at https://i.ebayimg.com/images/g/VVEAAOSwNwVlwpbZ/s-l960.jpg. Images are research references only and are not shipped as game assets.


## Direct shot controls

The shot desk now groups cue-ball contact, table aiming and power/strike in one surface. Tap or drag the cue ball to place the tip within the circular spin limit; arrow keys adjust it and Home resets to centre. The contact marker feeds the existing top/side spin simulation. Table pointer aiming remains primary, with angle number input and left/right fine adjustments. Power is the only range input. Controls disable during either player’s stroke and ball motion. Route/physics explanations are disclosed under help. Desktop uses three columns, tablet two, and phone one. Browser verification for this update was unavailable because the browser tool timed out reaching both local ports; build, targeted lint and behavior tests provide code validation.


## Pocket scale and rendering correction

`lib/snooker-table.ts` now owns the visible pocket cut dimensions shared by the table and capture test. Corner cut radius is 61 mm (about 86 mm across the diagonal); middle cut radius is 45 mm (90 mm across). These are visual approximations, not certified tournament templates. The previous 156 mm middle opening and 226 mm outer leather diameter were visibly oversized. Cushion endpoints now meet the narrower openings, and the leather is a 13 mm band with a 9 mm top thickness instead of a raised collar. The capture region is inset from the visible slate fall to avoid swallowing balls outside the smaller mouths. Tests cover rejected jaw entries and accepted centred/diagonal entries; detailed jaw-rattle physics is still outside scope.

Materials now use a prefiltered room environment, overhead area reflections, a shadow-casting table spotlight, subtle wood grain and varnish, micro-scale cloth bump, bevelled rail edges, polished ball clearcoat and soft ball contact occlusion. Audience materials have lower environment response so the lit table remains the focus. This remains a procedural WebGL scene, not a photogrammetric reproduction.


## Integrated viewport HUD

Shot controls now overlay the 3D arena: cue-ball contact at lower left, power and strike at lower right, score and live turn feedback above the table. Fine aiming and camera/restart options use compact disclosures inside the viewport. The HUD shell passes pointer input through to the table; only its controls intercept input. Phone layouts keep the corner controls inside the arena. The separate control desk below the scene is removed.


## Shoulder and mechanical-rest correction

Rocketbox's clavicles originally inherit the neck transform. Reparent them to Spine2 while preserving bind transforms, so head alignment does not rotate the shoulder girdle. Replace torso two-bone IK and the extra collarbone roll with a continuous pelvis bend and side-on rotation. Align the stance laterally beneath the head rather than pulling a shoulder into the cue line. Preserve the original neck segment length. The bridge hand receives an explicit palm-down roll; the rest hand grips a handle beside the cue.

Cue equipment shares height/support constants from `lib/snooker-presentation.ts`. Rest support stays 380 mm behind the cue ball and on the aim line, independently of cue withdrawal. Its cross-head sits on the cloth and its saddle meets the cue underside; a fitted shaft runs to the actual left-hand position. Cue length reaches the actual grip. Tests cover the bundled FBX skeleton across aim angles, backswing/follow-through, feet, shoulder width/lead, bridge wrist roll and rest support.


## Cue length and feathering

`app/game/Cue.ts` owns a fixed 58-inch cue (9.5 mm tip, 29.5 mm butt, ash shaft, dark butt, ferrule and tip). A separately visible extension attaches to its butt for longer rest shots; base cue geometry is never rescaled. The avatar's minimum stance distance now leaves a natural grip/butt relationship. Bridge-channel surface gap is power-dependent at 230–290 mm and the wrist remains planted 60 mm behind that channel.

The shared presentation clock uses three varied idle feathers, a quiet front settle, two committed feathers, a front pause, smooth final draw, brief back pause, accelerated delivery at 1720 ms, a continuous follow-through and a held finish. A queued stroke begins at the actual idle tip position to avoid a jump. Reduced motion disables idle feathers. These are authored O'Sullivan-inspired motions, not exact biomechanical measurements. Parris sizing and WPBSA's 2021 WDBS coaching manual are the numerical references; O'Sullivan's public trailer did not play in the browser. Tests verify model dimensions, extension attachment, planted bridge, grip station, continuous joins and contact velocity, tip clearance and timing.


## Mobile-first redesign: table as the screen

This section supersedes the earlier layout, control and aiming notes above (integrated HUD, direct shot controls, first-person swipe, precision toggle, shaded corridors). The scene, table, avatar and cue work described earlier is unchanged.

**Layout.** `.sg` is a fixed full-viewport surface on every device; the table canvas fills it and all chrome floats on dark glass. Top: menu button, the yellow/white/teal score strip, an overhead-view toggle, and one info pill (ball on, break or lead, points left on the table). Bottom: coach pill and cue-ball contact button (left), contact readout and fine-tune ruler (centre), power bar (right edge). Menu and coach open the shared `Sheet`. Nothing else is on screen during play. Styles live in `app/styles/snooker-game.css` on `--sg-*` locals derived from tokens.

**Controls.** Three gestures, no modes:
- Tap a ball: aim assist lines the cue up to pot it in its best pocket; tap again to cycle pockets. Tap the cloth to point there.
- Drag on the table: turn the cue. Gearing follows drag speed. A slow drag moves the ghost ball 0.25 mm per pixel at whatever distance it is; a flick swings up to 16× faster. The ruler is five times finer again. Arrow keys still work on the table and the ruler.
- Pull the power bar down and let go to strike. The cue draws back with the thumb and the stroke lands 180 ms after release. A tap never fires; dragging back to the top cancels. Keyboard: arrows set power, Enter strikes.

Cue-ball contact opens from the white ball button as a small panel; it resets to centre after every shot.

**Cameras.** `aim` sits over the cue, rising and backing off with the distance to the object ball so cue ball, contact and pocket are all in frame in portrait. `tv` (ball travel and the opponent's turn) and `top` (toggle) fit the whole table to the viewport; `player` keeps the side-on stance view. Poses ease into each other over 850 ms; reduced motion cuts.

**Aiming aids** (`輔助線`: 完整 / 簡化 / 關閉). One `predictShot` result per aim feeds both the cloth and the HUD: white line to a translucent ghost ball, gold object-ball line, faint cue-ball line and a ring where the cue ball stops. The pocket glows when the shot as aimed and paced pots a legal ball. The readout shows the thickness of contact as a player describes it (全球, 3/4, 半球, 1/4, 薄邊, left or right) so the picture transfers to a real table. Simplified shows short direction stubs only; off shows the aim line and ghost ball.

**Why potting was too hard, and what changed.**
1. Ball contacts were resolved after the cue ball had already sunk into the object ball (up to 8 mm at pace at 240 Hz), which turned the cut angle by a degree or more, differently for each power. The same aim potted at 44 % and missed at 45 %. Contacts now rewind to the instant of touching, so the cut angle is independent of pace.
2. Pockets only accepted a ball whose centre crossed a narrow lane; anything else met a flat cushion. Cushions now end in rounded jaws (`JAW_RADIUS` 20 mm circles, matching the drawn cushion ends) and the ball drops when its centre passes the fall. A slow ball clipping a jaw goes in; a hard one rattles out. Dead-weight margin is about ±21 mm into a corner and straight into a middle. The middle fall is set back 20 mm behind the nose line (`TABLE_POCKETS.middleSetback`), and the drawn pocket moved with it.
3. Aiming was a 120°-per-screen swipe from a camera too low to see the angle. See controls and cameras above.
4. The textbook ghost-ball aim misses cut shots because of throw. Aim assist, the coach and the opponent all aim at the middle of the window of angles that actually pot.

**Opponent.** Three standards in `LEVELS` (初哥, 球會, 職業): cue error, pace error, look-ahead and the pot percentage needed before attacking. Safety play searches thin-to-full contacts at four paces on the three nearest legal balls and scores the leave: no pot on, snookered, distance, cue ball tight on a cushion or back in baulk, then checks the best few against the player's own cue error. The status line says what the opponent is playing (`電腦：打紅球入右頂袋`, `電腦：打防守`).

**Rules added.** Ball in hand in the D at the break and after an in-off (drag the cue ball; the D is highlighted). The opponent chooses its spot with `cueSpotInD`.

**Line-up practice.** `newPractice()` sets colours on spots and fifteen reds down the centre line. No opponent; a miss or foul resets the break and concedes nothing; the cue ball can be placed anywhere before a shot. The score strip shows total, current break and best break.

**Coach.** Opens as a sheet and analyses on open. "幫我擺好呢一桿" sets angle and spin, marks the suggested pace on the power bar and rings the intended cue-ball position on the cloth. After each of your shots the status line carries the verdict.

**Sound.** `app/game/sound.ts` synthesises ball clicks, cushion thuds, the cue tap and the pocket drop from impact speed; no audio assets. Off switch in the menu.

**Still out of scope.** Free ball, foul and a miss, play-again, nominated colours, jump and swerve shots, cloth nap. Jaws are circles, not templated pocket profiles.

**Verification.** Node tests cover pace-independent cut angle, jaw acceptance and rejection, aim assist through throw, prediction readout, snookers and safety legality, opponent levels, ball in hand, points remaining and practice rules. Phone portrait (390×844), phone landscape and desktop were inspected in headless Chromium with software WebGL, including a scripted coach → apply → pull → pot sequence. That renderer runs at a few frames per second, so frame rate, touch feel and audio were not assessed and need a real device.

## Set power, then strike; realistic pace; multi-frame matches

**Power is a setting, not a trigger.** Dragging the bar sets power and draws the cue back as feedback; releasing does nothing else. Aim, spin and power stay adjustable until the round 出桿 button under the bar is pressed. The stroke then skips the waggles and lands about 0.8 s after the press. The cue eases in from wherever it was, so there is no jump. The drag readout gives pace as table lengths (約 2.3 枱長).

**Pace.** Contact physics already matched theory: a full ball passes on 97 % of the speed, a half ball cos 30° of that, and it leaves at about 27° once throw is allowed for. The power curve, though, put most real shots in the bottom third of the bar: 40 % ran 2.5 lengths and 50 % nearly 4. `POWER_RESPONSE_EXPONENT` is now 2: 25 % ≈ 0.4, 50 % ≈ 1.9, 75 % ≈ 6.5 and 100 % ≈ 18 lengths, the last being the unchanged elite maximum cue speed. Opponent pace options shifted to match. The live loop now catches up after frames as slow as 4 fps rather than 20, so a slow phone no longer runs the balls in slow motion.

**Matches.** 賽制 offers 1, 3, 5 or 7 frames (default 3 局 2 勝). Players alternate the break-off. The strip's centre cell shows frames won and match length. Between frames a card shows the result, every frame's score and who breaks next. Changing match length restarts. Practice never counts frames.

## Table realism and the measured cushion model

**Cushions.** `cushion()` now implements Mathavan, Jackson & Parkin (2010), "A theoretical analysis of billiard ball dynamics under cushion impacts" (Proc. IMechE C 224), with their snooker values: cushion restitution .98, cushion friction .14, cloth sliding friction .21, contact 7R/5 above the cloth. Two contacts act at once. The cushion nose presses the ball into the slate, so the cloth under it also grips during the impact. The impulse is integrated in 100 steps per half through compression and restitution; restitution ends when its work reaches e² of the compression work. Effects:
- A rolling ball straight in returns with about 91 % of its speed.
- At 45° it leaves at about 37° with 85 % of its speed, and its remaining forward spin then bends the path wider on the cloth (about 50° at a slow pace, 42° when hit hard).
- Side spin turns a straight-in rebound about 15°, down from 17°+ under the old doubled friction of .28.

Like the published model, it scales with speed, so there is no added speed dependence. The professional's planning takes about 15 % longer (≈2.3 s v 2.0 s worst case, in the worker).

**Rendering.**
- **Reflections.** A purpose-built reflection environment (dark arena, bright rectangular canopy overhead) replaces the generic room. It is applied per material: three.js otherwise replaces every material's `envMapIntensity` with one scene-wide value, which had been silently flattening the balls and hazing the rails. Balls are polished phenolic (clearcoat, low roughness, strong canopy highlight).
- **Cloth.** Procedural baize with a directional nap, faint mottle and fabric sheen, in tournament green.
- **Cushions.** Shaded slightly darker, with a soft occlusion strip along every nose so they read as raised.
- **Rails.** Deep mahogany with reduced base specular, because a top-down camera under a top-down light otherwise turns the rails grey.
- **Shadows.** PCF soft shadows with retuned bias.

## Table frame rebuilt

The frame was a patchwork: separate rail boxes with gaps, a lighter deck showing at the edges, tan half-ring "buckets" for pockets, a segmented apron and gold legs. It is now built like a match table:
- **Rail capping:** one polished piece with rounded corners and bevelled edges, extending about 120 mm beyond the cushions. Its inner edge follows the cushion backs and is notched round each pocket: 110 mm circles at the corners, 85 mm at the set-back middle falls.
- **Pocket shields:** matte black leather fills each notch, wraps the back of the pocket and leaves the throat between the cushion jaws open, with a thin iron lip around the drop.
- **Body:** one continuous apron below the rail, with fine brass beads under the rail and along its foot.
- **Legs:** eight turned mahogany legs on brass collars and dark levelling feet.

Playing dimensions, cushion and pocket physics are unchanged.
