# terrain.1 — Test mode, thin soil tiles, terrain-following platform, and local grading

## Review of the request

- Add a system-bar test mode beside Communism mode that researches every technology and installs every equipment item.
- Render fallen rubble as 4:1 soil tiles (0.125 m wide × 0.03125 m tall) while retaining a smooth interpolated surface.
- Make the platform, collector, piston, launch geometry, prediction, and autopilot follow the rubble heightmap.
- Make the grader smooth and shave the terrain from its surface in a local travel-side swath, never cutting pits beneath the platform.

## Decisions

- **Test mode is a grant, not a price mode.** It bypasses funds and prerequisites, logs each test grant distinctly, and applies the normal technology/equipment effects and mass bookkeeping. The mode remains selected across New game; switching it off leaves grants intact until the next New game. Communism mode remains independent.
- **Soil geometry is explicit 4:1 tile geometry.** One floor tile is one existing 0.125 m column wide and one quarter of that height. The smoothed `(1,3,3,1)` profile remains the collision/render crest so tiles do not make the terrain jagged.
- **The chassis follows the ground footprint.** It pitches gradually toward the wheelbase slope, lifts to clear terrain under the belly and wheels, and follows the terrain with a controlled downward rate. Collector and piston planes use the same moving pose; predictions include coasting height and pitch.
- **The grader works ahead, not under the wheels.** It smooths and shaves a 1.5 m swath in the direction of travel, uses scratch state to avoid order-dependent smoothing, and clamps all cuts at y = 0. Remote and under-platform piles are untouched.

## Implementation

- `js/ceiling.js`: add `floorCellHeight = cell / 4`; use it for deposited rubble; render each pile as 4:1 rectangles under the existing smoothed crest; expose grader swath/clearance and a cost-free ledger grant API; replace global grading with travel-side smoothing and cutting.
- `js/physics.js`: add terrain height, platform pitch/base/point and moving-plane helpers; preserve prior platform pose and update terrain-following height and slope each step; place held/launched balls on the rotated chassis; use terrain-aware collector/piston contacts and account for contact work.
- `js/prediction.js` / `js/autopilot.js`: predict deck contacts and the coasting ghost on a terrain-following pose; cache predicted contact height and account for the raised deck in ground-to-deck timing and bounce apex; invert the pitched piston offset for the intercept target.
- `js/research.js` / `js/equipment.js`: add grant and all-grant APIs that bypass cost/prerequisite checks while applying ordinary effects.
- `index.html`, `styles.css`, `js/main.js`: add the test-mode switch next to Communism mode; wire grant, reset and mode status; show `TEST` prices and clearly label grant ledger entries; render the chassis and ghost using terrain pose.
- Tests: add explicit floor-tile ratio, terrain-driving/clearance, raised-deck contact, terrain-aware prediction, grant API and interface reset/persistence coverage; rewrite the grader test for local forward grading.
- `README.md`: document controls, independent mode behavior, the floor tile dimensions, platform travel, and local grading.

## Validation

- `node --test experiments/*.test.js`: **98 tests pass**.
- `node --check` passed for all `js/*.js`, all `experiments/*.test.js`, and `experiments/browser-smoke.cjs`.
- `git diff --check`: clean.
- Browser smoke was not executed because Playwright/Chromium packages are not installed in this workspace; the optional smoke script now includes test-mode persistence checks.

## Next step

Use the optional browser smoke test when external Playwright/Chromium tooling is available to inspect the actual tile rendering, system-bar wrapping, and chassis alignment on a piled slope. Continue watching the grader swath and terrain-contact energy accounting in seeded mining runs.
