# players.7 — worklog

Plan: `players.7-plan.md`. Implemented the selected platform's multiple
ballistic flights, the `GROUND` bounce setting, the two-contact drawn horizon,
a ride-over rider latched for the crossing, and the chamber's own piston and
collector reflections in the forecast. `README.md`, `index.html` and `js/help.js`
now describe the resulting rules.

## What was wrong, measured first

- With the **rig** selected and the autopilot engaged, `predict(world, ball,
  'rig')` wrote the *page* trace because `prediction` chose its buffer by
  `id === undefined || id === selectionId()`. The plan ran at 20 Hz and the
  readout at 10 Hz, so the drawn flight was replaced by the autopilot's chosen
  ball (often held, with zero samples) between two readouts. A competitor
  selection had been fixed in players.6; the rig selection had not.
- `2 shared` drew one of two flying balls; `1 per platform` could draw another
  machine's owned ball because `workingBall` fell back to `world.ball`.
- The tier-II overlay marched to `horizon * 3` (~22 s). A half-energy ground
  rebound could not even be tried: ground impact always dissipated all energy.
- A late power change during a ride-over swapped the hulls: with the original
  `js/players.js` the probe reported `swapped:true`, `deepest 1.08439 m` of
  hull penetration and the rival frozen at x ≈ 15.37 while the rig oscillated
  between y = 0 and 0.616. The layer was re-decided from drive power on every
  ground query.
- The forecast's deck bounce used `deckBounce` (the flat-strip shortcut) while
  the chamber's `resolvePiston` uses `solveFace` (friction, recoil, tilt and
  pulse). On a tilted face with sideways motion the outgoing velocities
  differed by up to **1.3541 m/s**. For a 0.15 rad tilt and a 1.2 m/s sideways
  arrival the shortcut put the second contact at x = 4.327 m while the chamber
  put it at x = 3.634 m — a **0.69 m** error in the two-bounce overlay. A
  collector already holding a ball was drawn as a terminal catch although the
  chamber returns the arrival, and the piston's angle/motion could leak into a
  collector rebound because only the last solved face was kept.

## What was done

- `js/physics.js`
  - `groundModes` (`absorb` / `half` / `elastic`) with `setGroundBounce`,
    `groundRetentionNow` and `groundBounceMode`; it is a page setting like the
    rock shape, not world state. `createWorld` resets it to `absorb` and
    `js/main.js` re-applies the system-bar selection on boot and New game.
  - A type-2 ground contact rebounds at `sqrt(retention)` of the normal speed,
    books the lost share as heat for a rig-pushable ball, and settles when the
    rebound is below `config.groundMinBounce` (0.15 m/s). A rubble surface that
    rises under a ball already going up only lifts it, booked as terrain work.
  - `solveFace` now uses `ballMassNow()` — the same installed ball mass its
    pulse, energy and capture bookings use — instead of the base mass.
  - `reflectOnDeck` runs `solveFace` against a read-only projected body with
    the machine id, forecast deck speed and supplied surface motion, so the
    ballistic computer can price the chamber's own impulse sequence without
    touching the world.
- `js/prediction.js`
  - `createTrace` / `traceView` and six preallocated `pagePaths`. `predict`
    writes the page trace only when no machine id is given and the policy trace
    for any explicit id; `predictAll` traces the focus ball plus every other
    *flying* ball that `mayPush` filters for the selected machine. The fallback
    to the rig's ball is gone, so a machine with no ball reports `PARKED`.
  - `drawBounceLimit = 2` ends a drawn path at the second ground, deck or rock
    contact, or at the first contact that ends the flight. The policy trace
    keeps its long tier-II horizon. Ground rebounds use the `GROUND` rule.
  - The winning deck face now owns its angle and surface velocity. A piston
    bounce calls `reflectOnDeck`; a full collector bounces off its flat strip
    with `deckBounce(..., pulse 0)`; an empty collector still ends the flight.
    `surface` is reset per march step so a later contact cannot inherit a stale
    face. `faceResult.captured` ends the forecast where the piston holds a ball.
- `js/main.js` — `predictAll` at the readout cadence, `drawFlight` /
  `drawPrediction` over `computer.paths` / `pathCount` (focus flight gets the
  marker and ghost, companions are dimmer with an endpoint dot), `GROUND`
  wiring on boot, New game and change, and `workingBall()` for the status line
  now reads `autopilot.state.focus` with `isRigBall` rather than the page trace.
- `js/players.js` — `layers` pairs with a latched `rider`, `powerAbove` for the
  first climb and `syncLayers` after `stepRigBot`. The engage/release gaps use
  the plate and tail reaches; the rider is kept until the bodies part, so
  `surfaceAt` and the draw order agree throughout a crossing.
- `index.html`, `js/help.js`, `README.md` — the `GROUND` select and its `?`
  topic, corrected computer/collector/ride-over/ground descriptions, and the
  suite's new coverage.
- `experiments/*.test.js` — 14 new tests: ground retention/heat/settle/lift,
  page-vs-policy isolation, shared and owned multi-flight paths, the drawn
  two-contact cap, a latched ride-over under a late drive change, `GROUND`
  selector persistence and `setLineDash` counts, a projected reflection equal
  to the chamber's piston solve, a full collector's two bounces, and forecasts
  checked against the chamber's real second contact.

## Validation

- Every `experiments/*.test.js` run per file, final pass: **183 pass, 0 fail**
  (autopilot 15, balls 19, ceiling 13, commune 7, economy 3, engine 1,
  equipment 3, interface 33, physics 40, players 19, prediction 19, research 4,
  shop-services 7). Baseline was 169/0 before this stage.
- Page/policy: shared2 draws `pathCount 2` with 180/214 samples; five
  autopilot updates leave the page trace's `kind`, `endX`, `samples` and `ball`
  untouched while `prediction.policy.kind` becomes 2. `each` and a competitor
  both draw `pathCount 1`, the rival's own ball only.
- Ground: half retention gives a rebound ratio of 0.70696 (sqrt 0.5 =
  0.70711), heat 13.831814 and an exact energy ledger; a half-energy ball
  settles after 9 rebounds at t = 7.67 s; elastic ratio ≈ 0.9986; `absorb`
  keeps one contact with heat and zero rebound. Half/elastic drawn paths show
  two ground contacts, absorb one.
- Horizon: with tier II the drawn path has 555 samples and the priced policy
  2210, both naming the same first contact at t = 1.14282 s. A half-energy
  drawn path has 333 samples and stops at the second contact.
- Ride-over: after the latch the late-drive probe reports `swapped:false`,
  `deepest 0.02024 m`, max rig jump 0, max rival jump 0.02225 (one plate step),
  both hulls back at y = 0 and the rival continuing to x = 15.36625.
- Reflections: `reflectOnDeck` equals `solvePiston` to 1e-12 for a moving,
  tilted deck, and `deckBounce` differs by > 0.1 m/s there. With the fix the
  drawn path's last sample is (3.6363, 0.8830) against the chamber's second
  contact (3.6340, 0.8717) at t = 1.8917 s; the flat-strip shortcut would have
  drawn x = 4.327. A full collector bounces twice in both the chamber and the
  overlay (companion path 253 samples) with an exact energy balance.
- Cost: `predictAll` measured 4.28 ms per call with two shared balls and tier
  II, 2.11 ms with one ball, at a 10 Hz readout cadence.
- Pitfalls worth keeping: `setGroundBounce` is process-global and
  `createWorld()` resets it, so every reset and test must re-apply the chosen
  mode; stale `previousX/Y/Angle` poses and stale `players` state from earlier
  tests injected energy and changed predictions until the new tests reset them.
  `autopilot.test.js` reads `prediction.policy`, not `prediction.state`.

## Next step suggestion

- The `ballistics` research flag is still global, so every platform gets the
  computer once the node is researched. If "only one can use the ballistic
  computer" meant a per-platform purchase, give each player a computer flag and
  gate `predictAll` and the overlay on the selected machine's flag.
- A competitor's tilt keeper is still missing: only the rig slews its piston
  towards vertical. Give any platform's policy the level-bounce duty, bisected
  with `solveFace` on that machine, and its own drive keeper.
- A real Chromium pass would confirm the narrower system bar with its third
  select at 390 px; `experiments/browser-smoke.cjs` is ready when a browser
  binary is available.
