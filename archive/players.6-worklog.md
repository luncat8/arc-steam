# players.6 — worklog

Plan: `players.6-plan.md`. Implemented the one-machine deck model, the
per-platform ballistic computer and release, the ledger booking for foreign
machinery, and the ride-over pose fixes.

## What was wrong, measured first

- With a competitor selected the overlay was rewritten by the rig's autopilot
  after every readout: `predict` wrote one shared set of buffers and the
  autopilot called `predict(world, ball, 'rig')` 20 times a second, so the
  page's flight survived for less than a frame.
- A competitor's reflector never used its own tilt: a ball dropped on a rival
  deck with +10° came back with the same velocity as with −10°. After the fix
  the same shot gives exactly the rig's outgoing velocity at every tilt
  (vx −0.585 / +0.635 / +0.031 for −10° / +10° / 0° vs 0.6 m/s incoming, on both
  machines).
- A ball dropped on a rival collector ended `grounded`: the competitor deck had
  no catch and no pulse path of its own.
- The rig crossing a parked competitor penetrated its 45° plate by **0.063 m**
  at the leading hull corner. The pose loop stepped from `-halfWidth` in fixed
  increments and the last sample could land past `+halfWidth`, so the corner
  was never tested. Edge-exact sampling plus a climb rate that follows the
  platform's own speed brought the worst case to **0.005 m**, with no per-step
  jump larger than the platform's motion.

## What was done

- `js/physics.js`
  - Machine helpers: `machineBody`, `machineById`, `machinesOf` (preallocated),
    `machineDrive`, `machinePistonAngle`, `heldBallOf`, `focusBallOf`. The ball
    solve, the catch, the release and the ball readout reach a platform only
    through these.
  - `makeBall` carries `holder`; `capture(world, machine, ball)` seats the ball
    on the collector of the machine that caught it, joins that hull's momentum
    and books the catch (rig: heat as before; competitor: a rig-pushable ball's
    energy becomes heat). `heldBallMass` and `heldBallOf` count only the rig's
    own catches.
  - `launchCapacity`, `launchHeight`, `canLaunch` and `launch` take the machine
    that holds the ball: a competitor's release is a fixed `config.pulse`, its
    own piston kick and push count, and a rig-pushable ball's gain is booked as
    imported work.
  - `solvePiston` is now a wrapper over `solveFace(world, machine, ...)`, which
    takes the absolute face angle of the contact. `resolvePiston` runs the
    machine's own pulse, compression, counters and ledger booking, so a rival
    piston reflects exactly like the rig's.
  - The deck loop walks `machinesOf(world)` and resolves the first contact by
    surface: `SURFACE_COLLECTOR` catches (or returns when one is held),
    `SURFACE_PISTON` is `resolvePiston`, `SURFACE_HULL` is a passive stop with
    `depenetrate`.
  - `step` advances every machine's piston spring, and every machine's
    compression is drawn from its own `pistonOffset`.
  - `platformBaseAt` samples the hull underside in a whole number of steps over
    both edges, and a climb may keep up with the ground under the hull
    (`platformDropRate + |stepVx|`); the ball solve still clamps the surface
    velocity it reports, so this cannot inject energy.
- `js/players.js`
  - `createRival` gets the machine fields (`pistonOffset`, `pistonVelocity`,
    `pistonImpact`, `drive`, `bounces`, `pushes`).
  - The ball policy arms `drive` (the one machine flag physics reads) instead
    of a private `pulse`, and a caught ball is released by the bot at once —
    except while that platform holds the player's controls, where the computer
    and `E` are the player's to use.
- `js/prediction.js`
  - Two traces, `page` and `policy`: `predict` writes the page trace for the
    selected machine and the policy trace for any other `id`, so the autopilot
    can price the rig while the page describes a competitor.
  - The working ball is the one that machine holds or may push; a ball held by
    another platform is out of its hands, and the pulse and reserve are the
    machine's own.
- `js/main.js`
  - The ball energy readout, the release button and `E` read the selected
    machine's ball (`focusBallOf(machineOf(active))`); the drive light and the
    "powered pushes" count are that machine's.
- `js/autopilot.js` — guards a chamber where every ball is held by a
  competitor (`world.ball` is null), and prices its plan in the policy trace.
- `js/help.js`, `README.md` — every platform catches, reflects, holds one ball
  and releases with its own drive, and the ballistic computer follows the
  selection.

## Validation

- Every `experiments/*.test.js` run per file: **169 pass, 0 fail**
  (autopilot 15, balls 19, ceiling 13, commune 7, economy 3, engine 1,
  equipment 3, interface 31, physics 35, players 18, prediction 13, research 4,
  shop-services 7).
- New coverage: `either platform reflects a ball off its own reflector face,
  tilt for tilt`; `a ball never passes through either deck, and either
  collector catches it`; `a caught ball is the platform's own, and its release
  is that machine's`; `the ballistic computer follows the selected platform,
  and the rig plan cannot replace it`; `a platform riding over another never
  sinks into it and never stutters`; and the interface run
  `the computer, the release and the ball readout belong to the selected
  platform`.
- Before the fix a wheel notch steered a rival's drawn piston that nothing
  read; after it the rival's drawn compression comes from its own impacts, and
  a rival release leaves the rig's battery untouched.
- Read-through afterwards removed what the new deck loop made dead: the
  per-surface scratch records and `deckFaceOf`, the `surfaces` enum and the
  `launchHeight` export physics no longer needs (prediction keeps its own),
  and the unused player handle in `predict`. `machineBody`, `machineById`,
  `machinesOf`, `machineDrive`, `machinePistonAngle`, `heldBallOf`,
  `focusBallOf` stay exported as the one platform handle the next stage works
  through.

## Next step suggestion

- A competitor's tilt keeper is still missing: the policy never works its
  piston, so a rival reflector only steers a ball by momentum. players.7 could
  give any platform's policy the rig's level-bounce duty (bisected with
  `solveFace` on that machine) and its own drive keeper.
- The machinery panel still shows a competitor at a full reserve and a cold
  thermometer, because only the rig has a reserve and heat model. Either give
  every machine a reserve or drop the two bars from a competitor's hull.
- The pose is within 5 mm of the true contact; the remaining error is the kink
  of another body's profile falling between two samples. Sampling a body's own
  profile breakpoints (deck edges, plate tops) would make it exact.
