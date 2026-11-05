# players.6 — ball reflection, the ride-over pose and one machine model

Status: implemented; see `archive/players.6-worklog.md`.

Source: three reports after the per-platform controls landed.

1. **Only one platform can use the ballistic computer.** With a competitor
   selected the machine controls act on it, but the ballistic computer, the
   overlay, the release and the landing readouts stay on the rig's ball.
2. **The reflection is wrong on the piston and the collector.** A rig deck
   caught the ball, the piston tilt reached the ball only on some bounces, and
   a competitor's deck could not steer a ball at all.
3. **Two platforms do not ride cleanly.** They climb onto each other, then the
   upper body sinks into the lower one or is left hanging in the air, and the
   hull stutters while it crosses a body that is not flat ground.

## What is wrong

- **The rig's machinery is hard-wired to the rig.** `advanceBall` queries the
  collector and the piston only for a rig ball, and a competitor's deck is a
  bare plate: a ball on it bounces off an untilted, unpulsed plane. So a
  competitor's machine has a drawn piston that steers nothing, its collector
  cannot catch, and a rig ball on the rig's deck and on a competitor's deck
  are answered by two different solvers.
- **The deck query ignores where the ball comes down.** Both sides run
  `planeContactTime`, whose closed form is only the *ascending* crossing of the
  swept parabola. A ball that arrives from above inside one step is found on
  the way back up, a step late and a few centimetres past the deck, and a ball
  moving faster than the step can carry it into the plane is missed
  altogether. That is the "reflection sometimes does not happen" symptom, and
  it is why a deck hit can come out with the wrong normal.
- **A hull is not solid.** The collector and the piston are contact planes at
  deck height; the body under them is not, so a ball can arrive beside them
  and end up inside the chassis.
- **The pose samples miss the hull edge.** `platformBaseAt` takes the maximum
  of ~25 required heights along the hull underside, stepping from
  `-halfWidth` in fixed increments. The last increment can land *past*
  `+halfWidth`, so the leading corner of the hull is never tested — and that
  is exactly where a platform meets another body's 45° plate. The corner
  sank 6 cm into the plate it was climbing.
- **The climb was rate-limited like a fall.** Rising onto a plate was capped at
  the terrain drop rate (3 m/s), so a platform crossing a 45° plate faster
  than that dragged its hull through it for a few frames: the "stutter", and
  a second way for the upper body to be inside the lower one.
- **The competitor's pose is a slew that has already won.** `settle` writes the
  wanted angle directly (`rival.angle = platformPitchAt(...)`), so its contact
  patch jumps a whole body height in one step when a wheel meets a plate.
- **The ballistic computer is a single shared cache.** `predict` writes one set
  of buffers, and the rig's autopilot prices its own plans with
  `predict(world, ball, 'rig')` 20 times a second — so with a competitor
  selected the overlay is overwritten by the rig's flight after every readout.
  That is why the computer looked rig-only.
- **The release is the rig's.** `canLaunch` reads `world.drive`,
  `launchCapacity` reads the rig's battery and heat, `launchHeight` reads the
  rig's platform, so a competitor can never release a ball even if it caught
  one.

## Decisions

- **One machine, one deck model, for every platform.** The deck of *any*
  platform — the rig and a competitor alike — is a collector span and a
  reflector piston span with the same geometry (`pistonCentre`, `pistonHalf`,
  `collectorFraction`), and it answers with the same three surfaces:
  - the collector is flat and **catches** (every platform holds one ball at a
    time; a full collector returns the ball instead);
  - the piston bounces the ball off **its own tilted face** with the one
    impulse solver (`solveFace`), including the platform's own recoil;
  - the hull is a solid stop beside and under those faces.
  A competitor catches into its own deck, bounces off its own reflector and
  releases with its own drive, so `1 per platform` gives both machines a
  collector and a piston.
- **The machine is one handle.** The rig's machine state lives on the world
  (the physics reads the tilt and the drive there); a competitor keeps the same
  fields on its own body. `machineBody`, `machineById`, `machinesOf`,
  `machineDrive`, `machinePistonAngle` and `heldBallOf` are the only ways the
  ball solve reaches a platform, so nothing branches on a platform being the
  rig beyond the world's own energy ledger.
- **A catch remembers who made it.** A held ball carries `holder`, the id of
  the platform whose collector holds it; the seat, the held mass and the
  release all read it. Only the rig's own catches are rig mass and rig ledger.
- **One contact-plane solve that finds the descending crossing.** The ball's
  swept path against a moving plane is expanded in the plane's frame, so the
  quadratic is solved with the plane's normal velocity in it and the earliest
  non-negative root with a closing normal speed is taken; the foot of the
  contact is then tested against the face half-width in the same frame. This
  removes the "found on the way back up" step and the tunneling, for either
  machine.
- **A body that is outside the rig's ledger books nothing, and a rig ball it
  touches books everything.** A competitor's catches, bounces and pulses are
  its own machinery: a rig-pushable ball's gain there is imported work and its
  loss is heat, so the chamber's balance stays exact through a competitor's
  play.
- **The pose is the hull, sampled edge to edge.** The ground under the hull is
  a heightmap of bodies; the wheels contact it and the underside is sampled
  from `-halfWidth` to `+halfWidth` in a whole number of steps, both edges
  exact, because the corner is the first thing to meet another body.
- **A fall is rate-limited, a climb is not a jump.** The base falls at the
  terrain drop rate, and rises onto a *body still above it* at that rate, but
  a platform climbing a plate follows the ground passing under its hull at its
  own speed. The ball solve clamps the surface velocity it reports, so the
  faster pose cannot inject energy; only the hull follows the climb.
- **Bodies are for riding, not for collision.** Contacts stay, because a moving
  deck drags a ball and a piston pulses it, but the *pose* of a platform is
  solved against the terrain and the bodies, one platform after another.
- **The computer is the selected platform's, and the plan has its own.** The
  ballistic computer simulates the selected machine's two faces against the
  ball that machine may push, and its readout, ghost, marker and release
  address it. The autopilot prices its own plans in a **second trace**, so the
  rig's policy can never replace the flight the player is reading.
- **The release belongs to the holder.** `canLaunch`, the pulse, the height
  and the piston kick all read the machine that holds the ball; a competitor's
  release spends its own fixed pulse and never touches the rig's reserve.

## Mechanics

```
deck surfaces of a platform (same for rig and rival)
  collector  foot in [-w/2, -w/2 + collectorW]     catches / passive return
  piston     foot in [pistonCentre ± pistonHalf]   solveFace with its own tilt
  hull       chassis top, half-width               passive stop

advanceBall(ball, dt)
  for machine in machinesOf(world) while mayPush(ball, machine):
      collector contact -> capture into that machine, else passive return
      piston contact    -> resolvePiston(machine): solveFace, pulse, compression
      hull contact      -> passive deck bounce, depenetrate
  held -> seat on the holder's collector

capture(world, machine, ball)      holder = machine id, joins its momentum
launch(world, ball, machine)       the holder's drive, pulse, height and kick

platform pose
  angle  <- slew toward the slope of the wheel-line ground
  base   <- both wheels plus the underside, sampled -w/2 .. +w/2 edge to edge
  fall   <- rate-limited descent; climb follows the ground under the hull
  rise onto a body above <- rate-limited through its plate

prediction.predict(world, ball?, id?)
  trace = the selected machine's page trace, else the policy trace
  machine = the selected platform, or `id`
  same collector/piston faces, same solve as the simulation
```

## Files

- `js/physics.js` — the machine helpers, the per-machine catch/release, the
  shared `solveFace`, `resolvePiston`, the solid hull as `SURFACE_HULL`, the
  ledger booking for foreign machinery, the edge-to-edge pose sampling and the
  climb rate.
- `js/players.js` — a competitor's machine fields, the policy's `drive` flag,
  and the release of a caught ball by the bot (kept while the platform is
  under the player's controls).
- `js/prediction.js` — the page trace and the policy trace, the selected
  machine and the ball it may push, its own pulse, and the held-by-another
  rule.
- `js/main.js` — the readout, the release and the ball energy read the
  selected machine's ball; the drive light and the push count are that
  machine's.
- `js/autopilot.js` — prices its plan with `id = 'rig'`, guards a chamber where
  every ball is held by a competitor.
- `js/help.js`, `README.md` — every platform catches, reflects and releases
  with its own machinery, and the computer follows the selection.
- `experiments/*.test.js` — reflection on both machines tilt for tilt, either
  collector catching, either deck at any speed, the per-platform computer and
  the release, the competitor's own catch, the ride-over pose and the
  interface's selection.

## Acceptance

- With a competitor selected, the ballistic computer draws the flight of a
  ball it may push, against that competitor's own piston tilt, and the readout,
  the ghost, the marker and the release address it. The rig's autopilot plan
  never replaces that flight, and the rig's ball is untouched.
- A ball that comes down on either platform's collector is caught by that
  platform, on either platform's piston is reflected along that piston's own
  face — the same outgoing velocity tilt for tilt — and a ball never passes
  through either deck at any speed the simulation can produce.
- A caught ball belongs to the platform that caught it: its seat follows that
  hull, the rig's mass and ledger do not include it, and only that machine's
  drive can release it.
- Two platforms riding over each other settle with the upper hull outside the
  lower body, never sinking into it and never stuttering: the base moves like
  a machine and the pitch slews at its own rate.
- The full suite passes.
