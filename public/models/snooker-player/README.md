# Snooker player

Source: [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox), `Assets/Avatars/Adults/Male_Adult_08` (MIT).

The FBX includes a textured, skinned adult human with body, face and finger bones. Its original colour textures were resized to 1024² and encoded as WebP for local web delivery. Neutral normal/specular textures avoid downloading unused source maps. The MIT license is retained in `LICENSE.md`.

The cueing stance, two-bone limb IK, bridge/grip posing and stroke timing are authored in `app/game/PlayerAvatar.ts` and `lib/snooker-presentation.ts`; no third-party animation is used. Bind-pose garment attributes recolour the outfit as a white dress shirt, black waistcoat and dark trousers while retaining skin and fabric detail. A small mesh bow tie follows the collar. The character is fictional and is not a scan or likeness of a professional player.

The head/neck extension, raised cueing elbow and planted staggered feet are constrained independently. Thigh anchors are preserved when the spine bends because this source rig parents the thighs under the spine. `tests/snooker-player.test.mjs` checks the actual bundled skeleton, including hand-to-cue height, cervical separation and floor contact.


The collarbones are reparented to the chest with their bind transforms preserved. This prevents neck/head counter-rotation from twisting the shoulder skin. The torso bends continuously from the pelvis and turns side-on, leaving the cueing shoulder behind the bridge shoulder. Neither neck nor collarbone segments are stretched. Bridge wrist roll keeps the finger fan horizontal; extended shots curl the supporting hand around the rest handle.

The mechanical rest uses a fixed support point 380 mm behind the cue ball, on the same aim line as the cue. Its cross-head saddle meets the cue underside while the cue slides; the shaft spans from that head to the avatar's actual supporting hand. Skeleton/equipment tests include shoulder width, side-on alignment, bridge clearance, grip alignment and support clearance during the complete stroke.


The cue is a fixed 58-inch (1473.2 mm) model with a 9.5 mm tip, an ash taper, ebony butt and brass ferrule. The mesh itself is never scaled to reach the player. Longer reaches select a separate butt extension in 300 mm increments; it stays fixed through the shot. The normal stance has been moved back slightly to leave a plausible butt overhang behind the grip.

The bridge-channel gap from the ball surface varies from 230 to 290 mm with shot power; the wrist sits a further 60 mm behind the channel. The bridge and shoulders remain planted through feathers and delivery. The cueing arm moves through a power-dependent backswing and follows the same material point on the cue.

Feathering and stroke timing are authored approximations inspired by O'Sullivan's fluid style, not a measured reconstruction of his match cadence or current personal equipment. The idle sequence has three slightly different feathers and a front settle. A shot takes over continuously from the current cue position, performs two feathers, settles at the front, draws back, pauses briefly and accelerates to contact at 1720 ms. A velocity-continuous follow-through is held with the head down before the player rises. Reduced-motion preference suppresses idle feathers.

Reference sizing: https://www.parriscues.com/traditional-cue.html (normal cue length). Reference bridge, stable body, power-scaled feathers and delivery: https://wpbsa.com/wp-content/uploads/enrichment-manual-2021-002.pdf (sessions 2–5). O'Sullivan's official course is at https://www.snooker.online/; the public trailer did not play in the verification browser, and no numerical cadence is attributed to it.
