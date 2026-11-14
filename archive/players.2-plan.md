# players.2 — one platform model, live tails and a real player switch

Status: implemented; see `archive/players.2-worklog.md`.

Source: corrections to players.1.

1. Both players drive the **same machine**. The competitor was a smaller, lower
   body; it becomes the rig's own chassis, wheels, deck and tails in a dim
   colour. Nothing about the shape, the ground query or the drive numbers
   differs per player.
2. The platform on top must be **the one applying more drive power**, not
   always the rig. Ranks come from the force setting times whether the platform
   is commanding movement; ties keep the rig up. Layering is strict, so the
   higher-ranked body is carved out of the lower one's ground query and no pair
   can lift itself.
3. The 45° tails are **retractable**. They stay folded when no other platform is
   near, unfold as the gap closes, and their position follows the gap:
   `deploy = clamp((reach − gap) / (reach − full) )`, rate-limited so the plate
   swings at 90°/s instead of snapping. Retracted means a plain vertical face;
   deployed means the plate hangs at 45° from the deck edge to the floor. The
   collision profile reads the plate angle, so the ramp the wheels follow is
   the ramp on screen.
4. The scoreboard switch must move **all controls and the whole view** to the
   selected platform: force setting, direction, brake, travel click, canvas
   focus, panel title, speed, and a per-player summary (money, load, force,
   policy). Machinery that only the rig owns (reserve, heat, ball, shop,
   autopilot) is named as the rig's instead of being presented as the selected
   platform's.

## Model

A player record holds what every platform has — `force`, `tailLeft`,
`tailRight`, position and drive command for competitors, cargo, money — and the
rig reads its live position and force from `world.platform` and
`world.forceSetting`. `posOf(player)` returns the right body for either kind.

```
power(player) = force(player) · (commanded ? 1 : 0)
above(a, b)   = power(a) > power(b), ties to the lower player index
```

The collision body (what another platform stands on, at base height `y`):

```
|dx| <= h                    -> 0.6                      // deck
|dx| <= h + L sin θ          -> 0.6 - (|dx| - h) cot θ   // 45° plate at angle θ
otherwise                   -> 0                        // no body
```

with `h = platformWidth / 2`, `L = 0.6 / cos 45°` and θ the deployment angle of
that end (0 = folded, 45° = down). The plate leaves the deck edge at θ and is
clipped where it meets the floor, so a half-open plate is a shorter, steeper
ramp rather than a floating line; the drawing uses the same clip. The ramp is
exactly 45° when fully deployed.

## Files

- `js/players.js` — one body model, plate geometry, deployment, ranking,
  competitor drive and harvest, both policies, shared drawing.
- `js/main.js` — rig machinery drawn as an overlay inside the shared body pass,
  force slider and view follow the selected player, per-player summary line.
- `index.html`, `styles.css` — the summary line under the control title.
- `js/physics.js` — unchanged signature; the ground query already asks
  `SteamPlayers.surfaceAt(x, exceptId)`.
- `experiments/players.test.js`, `experiments/interface.test.js` — the new
  profile, the power ordering, the deployment curve and the switch.
- `README.md`, `archive/players.2-worklog.md`.

## Result

Shipped as described. `SteamPlayers.draw(context, extras)` is the single body
pass; the rig passes `drawRigMachinery` so its bars, collector and piston move
with its chassis and are covered by a platform riding on top. Deployment is
`clamp((2.6 - gap) / 2.0)` on the side of the closing platform, rate-limited to
90°/s, and the plate is clipped by the floor so drawing and collision are one
line. Power is the player's own force while it commands a move; the query is
strictly one-way so the weaker platform is never lifted.

## Acceptance

- Both platforms render from the same routine; the competitor differs by
  colour and alpha only.
- With the rig driving at 60% against a competitor at 30%, the rig rides over
  it; with the competitor driving at 60% and the rig idle, the competitor rides
  over the rig.
- A folded tail presents a vertical face with no horizontal footprint; a
  deployed tail spans a full 0.6 m at 45°; the deployment follows the gap and
  is rate-limited.
- Clicking a player line moves every movement control to it, dims the others,
  retitles and revalues the panel, and the force slider reads and writes that
  player's setting.
- The full test suite passes.
