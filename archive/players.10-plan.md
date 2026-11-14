# players.10 — the hull that climbs: wheels, struts, and ramps that meet them

## Goal

Two platforms that meet ride over each other rather than collide, and the
machine that climbs does it on its wheels. Nothing about the crossing should
read as a machine perched on its own keel with a wheel hanging in the air, and
no wheel should ever arrive at a ramp that is still on its way out. This covers
three things that have to agree: the hull's underside profile, the reach of the
wheels that ride on it, and the plate schedule that decides when a ramp is down.

## Decisions

- **The wheels are the hull's lowest points and they sit at its ends.** The wheel
  line is the pose's reference: a level hull rests with its wheel contacts on
  the ground and its underside above them. A wheel set in from the nose puts the
  keel's corner on a 45° plate first and beaches the hull there, so the wheels
  ride at `platformWheelHalfSpan`, just inboard of the hull's ends.
- **The underside arches up between the wheels.** `hullDepthAt` is one profile
  for the pose solve and the drawing: `platformBodyBottom` at each wheel,
  `platformKeelArch` higher at the centre, and a chamfer rising to
  `platformBodyTop` at the hull's ends. The arch is what a sharp corner — a deck
  edge being ridden over, a rock shoulder — has to reach before it can touch the
  hull at all, and by then the wheels are already past it. The arch cannot be
  deepened without limit: the drawn hull's thickness at the centre is
  `platformBodyTop − platformBodyBottom − platformKeelArch`, so an arch deep
  enough to clear a 0.6 m deck corner everywhere along the wheelbase leaves no
  body to draw.
- **Wheels hang on struts.** Each wheel slides in the hull's own vertical by up
  to `platformWheelTravel`. The hull's pose stays exactly what the wheel line
  and the belly arch solve for; a strut only follows the ground *down*, so it
  can never lift the machine. This is the difference between a hull carried over
  a crest or down a step and a wheel left in the air: the wheel that is not
  carrying the hull reaches the ground it is passing over. Travel is sized for
  the worst contact a wheel meets — a 0.5 m stair taken at speed, and the deck
  corner the belly rides while cresting another hull.
- **The strut is drawn where the pose puts it.** The hub sits its drop below the
  hull, and the strut itself is drawn only once the wheel has dropped clear of
  the hull line, so an ordinary frame draws the same two circles it always did.
- **A ramp comes out to meet the machine that is coming.** One plate swing takes
  `tailAngle / tailSlew`, and a hull under drive is still accelerating over that
  distance, so the unfold starts two swings out: the reach is the standing
  `tailReach` for a slow approach and grows with the closing speed. The
  deployment in between stays proportional to the gap, so the ramp is visibly
  swinging down rather than snapping.
- **A ramp holds until the hull has passed it.** The fold distance is the
  plate's tip measured against the other hull's *near edge*, not its centre, so
  a plate cannot start folding while a departing wheel is still standing on it.
- **Both ends come down for a rider, and for a hull that will outrun the swing.**
  A hull above the deck drives off one of the ends and cannot wait for a plate
  to swing under its wheels. Neither can a hull closing fast enough to cross
  that deck inside one plate swing: by the time it is up there the far plate's
  own swing is over, so both ends come out together as the near one starts.
- **Who rides is decided by drive power and then kept.** Unchanged from
  players.6/players.8: the platform commanding more force starts the climb, the
  ground query is strictly layered one way only, and an engaged pair keeps its
  rider until the bodies part.

## Files

- `js/physics.js` — `hullDepthAt`, `platformBaseAt`, `settlePose`, `wheelDrops`,
  and the config numbers `platformWheelHalfSpan`, `platformKeelArch`,
  `platformWheelTravel`.
- `js/players.js` — `profileAt`/`surfaceAt` for the plate a wheel rides,
  `stepTails` for the reach, the hold and the both-ends rules, `drawWheels` and
  `renderPlatform` for the strut and the one hull profile.
- `experiments/probe-plate.cjs` — support, float and strut extension over a 45°
  plate and over stepped ground.
- `experiments/probe-ramp.cjs` — the plate angle a wheel meets, on the approach
  and on the run-off, across the speed range and under a bot's own policy.
- `experiments/players.test.js` — the hull profile, the struts, the ramp reach
  and the fold distance.
- `README.md`, `js/help.js` — the hull, the struts and the plate schedule.

## Acceptance

- Over a 45° plate and down a 0.5 m stair, no wheel is left in the air: the
  worst float after the strut has reached down is zero, and the strut's own
  extension stays inside its travel.
- On level ground the struts are slack and a driving hull never extends one.
- A hull crossing another is carried by its wheels, not beached on its keel, and
  the deck corner it crests never raises it higher than a body and a fraction.
- Every wheel meets a fully deployed 45° plate, on the approach and on the
  run-off, from a crawl to the engine's top speed, in both directions, after a
  stop on the deck, and when reversing back off it.
- A plate folds only once the other hull's near edge has passed the ramp's tip,
  and a hull stopped beside the ramp keeps it down.
- The pose the ball rides is unchanged: the strut is a wheel's reach, never a
  change to the deck's height, tilt or reported surface velocity.
- The full test suite passes.
