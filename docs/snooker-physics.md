# Game spin model

`lib/snooker-game.ts` uses metres, seconds and right-handed world angular
velocity (`wx`, `wy`, `wz`), with `y` pointing up. Positive side input is right
side from the shooter's viewpoint and produces positive `wy` regardless of aim.
Spin stays in world coordinates when the ball changes direction.

At the cloth, slip is `(vx + R*wz, vz - R*wx)`. Friction opposes that slip,
transferring horizontal-axis rotation into translation until rolling begins.
Draw can reverse travel after object-ball contact while retaining side spin;
the same spin then acts differently at a cushion behind the shooter. Adding
draw alone must not flip `wy`. Draw drag also increases the side-spin/speed ratio.

The cloth model uses measured snooker values from Mathavan, Jackson and Parkin
(2009): sliding friction 0.178–0.245 (simulation midpoint 0.21) and rolling
deceleration 0.124–0.126 m/s² (midpoint 0.125). These constants apply to every
shot and are not player-specific.

The top of the power scale maps to a cue-tip speed of 4.02 m/s, measured in a
professional player's long backspin shot in the later cueing study linked
below. Lower values use a power curve (`cue speed = 0.4 + 3.62 × (power / 100)^1.3`)
to allow soft touch shots. The 0.4 m/s soft-touch floor is a gameplay calibration
choice; the 1.24 m/s measured warm-up speed is reached at about 33% slider power.
Cue-ball speed is estimated with a one-dimensional impact model using a
0.5 kg effective cue mass, 0.141 kg ball, and 0.73 leather-tip restitution.
Those impact parameters are explicit approximations: the studies measured cue
tip speed, not cue-ball launch speed. The measurements came from a single elite
player and selected tasks, so the slider provides a physically grounded range,
not a universal professional power scale.

The cushion response evaluates the along-rail component of `v + omega × r`.
For inward normal `n` and tangent `t = (-nz, nx)`, the contact offset is
`r = -sqrt(.84)*R*n + .4*R*y`. Its tangential slip is therefore
`v·t + sqrt(.84)*R*wy + .4*R*(wx*nx + wz*nz)`. Both the linear impulse and
angular impulse use this same geometry. Friction stops slip or reaches its
impulse cap; it does not deliberately reverse contact slip for a stronger effect.

This remains a reduced planar model, not the complete Mathavan solver. Nose
height follows that paper; cushion normal restitution (.9) and effective
tangential friction (.28) are game approximations, not its measured coefficients. Vertical
motion, cushion deformation, simultaneous cushion/cloth impulses, cue elevation,
swerve, squirt and ball-to-ball spin friction are not modelled. In particular,
do not interpret passing regression tests as experimental calibration.

References:

- [Mathavan, Jackson and Parkin (2009), high-speed measurements of snooker ball dynamics](https://doi.org/10.1119/1.3157159)
- [Mathavan, Jackson and Parkin (2010), cushion impact dynamics](https://drdavepoolinfo.com/physics_articles/Mathavan_IMechE_2010.pdf)
- [Song et al. (2018), professional snooker cueing study](https://commons.nmu.edu/isbs/vol36/iss1/60/)
- [Later professional snooker cueing biomechanics study](https://doi.org/10.5334/paah.111)
- [Dr. Dave: spin/speed ratio and draw drag](https://drdavepoolinfo.com/faq/sidespin/spin-speed-ratio/)
- [Dr. Dave: running/check side and cushion spin reversal](https://drdavepoolinfo.com/faq/bank-kick/effects/)
