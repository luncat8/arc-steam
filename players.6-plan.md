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
  single plane across the whole body. So a competitor's machine has a drawn
  piston that steers nothing, its deck cannot be aimed, and a ball on the
  rig's deck is described by a plane that skips the deck/piston split.
- **The deck query ignores where the ball comes down.** Both sides run
  `planeContactTime`, whose closed form is only the *ascending* crossing of the
  swept parabola. A ball that arrives from above inside one step is found on
  the way back up, a step late and a few centimetres past the deck, and a ball
  moving faster than the step can carry it into the plane is missed
  altogether. That is the "reflection sometimes does not happen" symptom, and
  it is why a deck hit can come out with the wrong normal.
- **A hull is not solid.** The collector and the piston are contact planes at
  deck height; the body under them is not, so a ball can arrive between them
  and end up inside the chassis.
- **The pose is solved per sample, not per body.** `platformBaseAt` takes the
  maximum of ~25 separate required heights, each one its own lever arm about
  the hull centre. On flat floor that is exact. Against a body the platform is
  climbing (a rival's deck plus its 45° plates) the maximum belongs to a sample
  far from the actual contact, so the hull is pushed up by the wrong lever:
  the base is too low while the pitch trails the ground, and the hull stutters
  as the wheel lift hands over to the body lift. Two platforms also read each
  other's pose while both are being solved, so the pair can settle on poses
  that overlap.
- **The competitor's pose is a slew that has already won.** `settle` writes the
  wanted angle directly (`rival.angle = platformPitchAt(...)`), so its contact
  patch jumps a whole body height in one step when a wheel meets a plate. The
  rig never sees that motion, because `bodySurfaceAt` clamps it to the platform
  limits, but the drawn hull jumps and the ball gets a contact plane that
  teleports.
- **The tilt of a competitor does not reach anything.** `machineOf` gives the
  competitor its own piston angle and the panel steers it, but nothing reads
  it: the deck bounce is horizontal and there is no piston face.

## Decisions

- **One machine, one deck model, for every platform.** The deck of *any*
  platform — the rig and a competitor alike — is a collector span and a
  reflector piston span with the same geometry
  (`pistonCentre`, `pistonHalf`, `collectorFraction`), and it answers with the
  same two surfaces the rig's deck answers with:
  - the collector is flat, carries the deck's motion, and **catches** (the
    ball is held by that platform);
  - the piston bounces the ball off its own tilted face, with the platform's
    machinery behind it.
  A competitor catches into its own deck hopper and bounces off its own
  reflector, so `1 per platform` gives both machines a collector and a piston
  instead of giving the rig a collector and a competitor a bare plate.
- **The tilt is the machine's.** `pistonAngleOf(machine)` is what the physical
  contact uses, so the wheel, the slider and the drag steer the *selected*
  platform's reflector, and the rival's own policy can work its piston. The
  drive flag is the machine's too: `machineOf(player).drive` decides whether a
  piston pulses, for the rig and for a competitor.
- **One contact-plane solve that finds the descending crossing.** The ball's
  swept path against a moving plane is expanded in the plane's frame, so the
  quadratic is solved with the plane's normal velocity in it and the earliest
  non-negative root with a closing normal speed is taken; the foot of the
  contact is then tested against the face half-width in the same frame. This
  removes the "found on the way back up" step and the tunneling.
- **A hull is solid under its own machinery.** A ball that comes down between
  the collector edge and the piston edge is stopped by the deck plane across
  the whole hull, so it can no longer end up inside the chassis; the rig's
  collector/piston contact still wins where those faces are, because it is
  solved first and both are the same height.
- **The pose is one lever arm, not a maximum of many.** The ground under the
  hull is a heightmap of bodies; the wheels contact it, and the base is the
  height that puts *both* wheels on it, given the pitch. The pitch comes from
  the slope of the ground measured on the wheel lines, rate-limited. No sample
  can lift the hull with a lever that does not exist.
- **Bodies are for riding, not for collision.** Contacts stay, because a moving
  deck drags a ball and a piston pulses it, but the *pose* of a platform is
  solved against the terrain and the bodies only once the roster's poses are
  known, in one pass, so the pair cannot settle into overlapping poses.
- **The ballistic computer follows the selected platform.** Prediction takes
  the ball the selected machine may push and simulates *its* deck: the rig's
  collector and piston for the rig, the same two faces for a competitor. The
  overlay, the ghost, the readout and the release all work the selected
  platform's ball, so either platform can use the computer.

## Mechanics

```
deck faces of a platform (same for rig and rival)
  collector  localX = -w/2 + collectorW/2,   angle = 0
  piston     localX = pistonCentre,          angle = pistonAngle
  hull       whole span at deck height,      a solid stop

advanceBall(ball, dt)
  for the machine mayPush(ball, id):
      collector contact -> capture into that machine's deck
      piston contact    -> solvePiston(machine, ...), pulse with machine.drive
      hull contact      -> passive deck bounce

platform pose
  angle  <- slew toward the slope of the wheel-line ground
  base   <- put both wheels on the ground under that angle
  drop   <- rate-limited descent, rise onto a body above through the plate

prediction.predict(world, ball)
  platform = the selected platform's machine
  same collector/piston/hull faces, same solve as the simulation
```

## Files

- `js/physics.js` — the shared deck model (`solveDeck`, `deckContact`,
  `machineDrive`), the corrected `planeContactTime`, a solid hull, the
  single-lever pose solve and the ordered pose update.
- `js/players.js` — `settle` uses the rate-limited pose for a competitor too;
  the ride-over pass runs after both poses are known; `machineOf` is the one
  machine handle; a competitor's collector catches and its piston bounces.
- `js/prediction.js` — predict the selected platform's machine and its two
  faces; the ghost is that machine.
- `js/main.js` — the overlay, the readouts, the release and the ghost read the
  selected platform.
- `js/help.js`, `README.md` — the deck, the tilt and the computer are the
  selected platform's.
- `experiments/*.test.js` — reflection on both machines, the solid hull, the
  pose continuity, the ordered ride-over and the per-platform computer.

## Acceptance

- With a competitor selected, the ballistic computer draws the flight of a
  ball that competitor may push, with that competitor's piston tilt in it, and
  the readout, the ghost and the release address it. The rig's ball is
  untouched.
- A ball that comes down on either platform's collector is caught by it, on
  either platform's piston is reflected along that piston's face, and between
  them is stopped by the deck instead of entering the chassis.
- A ball never passes through a deck it may be pushed by, at any speed the
  simulation can produce.
- Two platforms riding over each other settle with the upper body exactly on
  the lower one, never inside it and never hanging above it.
- A platform crossing another body's deck and plates does not stutter: the
  base height and the pitch are continuous in the platform's motion.
- The full suite passes.
