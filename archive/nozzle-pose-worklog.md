# Collector nozzle pose and particle alignment

## Previous-task review

Reviewed `8cd932df562761ee7069edd078dcf92170fcd0f2` and its preceding water-render
fix. The separate collector fractions (water 0.2, sand 0.8) are intentional and
remain unchanged. Machinery is drawn inside the chassis translation and pitch,
but launches used an unrotated horizontal offset and `body.y + deck`. A raised,
level platform was consistent; climbing or descending tilted the visible nozzle
away from the particle origin. The water barrel also applied its world-space
aim inside the chassis rotation, rotating the aim twice.

## Changes

- Added allocation-free `SteamPhysics.collectorPointAt`, using the existing
  platform point transform for both launch coordinates. The collector's
  wall-pocket X clamp is preserved.
- Water, abrasive grains and the rocket tube now launch from their owner's
  posed collector mount. The X-only helpers use the same geometry. The rocket
  change keeps its launch Y consistent with the newly rotated collector X;
  rocket and sand flight rules are otherwise unchanged.
- Moved the sand nozzle height into the shared geometry configuration so its
  drawing and launch cannot drift apart.
- Converted the water aim back into chassis-local coordinates only while
  drawing its barrel. Aiming and airborne particle positions stay world-space.
- Added `experiments/nozzle-geometry.test.js`, comparing transformed drawing
  commands against launch and particle coordinates for rig and rival, on the
  floor, raised level, and raised at both maximum pitches. It also checks the
  water barrel direction, jet spread and the abrasive launch energy.

## Validation

- Before the fix, the new geometry suite passed 8 level-pose cases and failed
  all 8 pitched-pose cases. After the fix: **16/16 pass**.
- Affected suites (nozzle geometry, water, sandblaster, rockets, players,
  physics): **154/154 pass**.
- Full Node suite: **422 pass, 3 fail**. Reproduced the same three failures in
  an untouched archive of the base commit:
  - `commune.test.js`: the UI harness does not load `SteamWater`.
  - `interface.test.js`: radiator preview expects `+35.00 W/K`, receives
    `+50.40 W/K`.
  - `research.test.js`: researched-count expectation is 11, result is 10.
- Native Chromium canvas check: all eight owner/pose combinations align the
  drawn water mount and particle, sand tip, rocket mount, and world-space water
  aim; maximum positional error is below 0.001 px, with no page errors.
- The existing browser smoke script stops at its stale prerequisite-edge
  expectation (12 expected, 13 actual), identically on the base commit.
- `git diff --check` passes. Browser dependencies, baseline copies, screenshots
  and scratch logs are kept outside the patch in `.arena/`.

## Next step

Repair the unrelated full-suite harness and stale research/radiator/browser
expectations so future geometry changes can be checked against a green baseline.
