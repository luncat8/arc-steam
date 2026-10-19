# autopilot.2 — Temporary manual handover and more flight room

## Review

- The previous autopilot correctly shared the simulation's piston solver, but manual input cleared enabled preferences permanently. Separate enabled preference from temporary ownership instead.
- The tilt solver used the keeper's cached drive intent even when only tilt assistance was enabled. Use `world.drive`, and use the actual manual angle when angle assistance is suspended.
- All key events used to rewrite travel direction, including unrelated shortcuts. Only movement keys should update manual travel; a travel click must clear the timed intercept's direction before owning the target.

## Changes

- Three independent, allocation-free manual override timers; chase and timed intercept share travel ownership. Enabled checkboxes do not change during overrides. Status clauses show `manual override`.
- Hold movement or tilt to suspend that duty indefinitely. Resume after two seconds of idle **simulation** time after release, cancellation, or the last discrete command. Wheel, slider input, drive toggles and travel clicks renew the corresponding timer. Explicit switch-off never re-enables itself.
- Pointer capture, cancellation, lost capture, blur, visibility changes and reset release held tilt input. Reset clears pending timers while preserving enabled preferences.
- Chamber height 10 → 15 m; the existing 192 × 16 rock field moves to 13–15 m without changing mineral quantity or rock thickness. Canvas aspect ratio changes from 2.25 to 1.5 to suit the taller view.
- Ball speed scale 1 / 1.5 → 1 / 1.8 (another factor of 1.2 slower). Effective mass 3.24 kg and gravity 9.81 / 3.24 preserve height/energy tuning; debris gravity and platform force/speed remain unchanged.
- Continued development: derive the prediction horizon from height and gravity (`2√(2h/g) + 1`, about 7.3 s), covering the longer round trip instead of losing the landing to the previous 3 s timeout. Buffers remain preallocated.
- Rock fixtures now use layer-relative positions. The braking-recovery test ends at zero velocity rather than including part of the next powered acceleration after reversal; assertions retain their exact energy tolerance.
- README, interface hints and design plans describe the new handover and tuning. Prior measurements remain intact as historical calibration.

## Validation

- `node --test experiments/*.test.js`: 81 tests pass, including held overrides, idle resumption, isolated timers, renewed input, switch-off during suspension, reset, disabled assistance, pause timing and a complete tall-chamber flight prediction.
- `node experiments/rock-impulse-check.cjs`: 7,239,828 contact traces, no amplified/nonunit normals; 351 rock impulses, no stacked impulses; shape-switch tunnelling checks pass.
- `node experiments/autopilot-trips.cjs`: current results in `experiments/logs/autopilot.2-trips.txt`. Over the seeded 120 s run, chase + keepers draw 9493 J; timed intercept + keepers draw 5001 J. Both have zero groundings; maximum apex 18.26–18.45 m stays below the 18.49 m ceiling-plus-one-pulse band. All measured energy balance errors are below 2e-9 J.
- Browser smoke assertions updated for the new geometry and temporary handover. Actual Chromium launch is blocked by the sandbox's missing `libnspr4.so`; browser visual/layout validation remains unverified. Optional browser packages were installed outside the repository; no runtime/build dependencies added.
- `git diff --check`: clean.

## Next step

Add a debris-aware interception duty: compare valuable falling cargo against retaining the ball, with visible predicted energy/travel cost. Keep the current ball-retention policies as a baseline and measure collected/sold value per imported joule before adding wear or further progression gates.
