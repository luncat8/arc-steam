# Shop engines, braking, trajectory II and commercial grader

## Previous-task review
The source profiles and scalable reserves are usable, but the free centre-pad
selector bypassed engine ownership and shop progression. Keep the physics
profiles and empty-reserve crank, replace that selector with shop transactions.
The existing predictor already includes wall/ceiling reflections; its missing
continuation is specifically rock and piston contacts, not all rising flight.

## Implementation
- Remove the source control and description from recovery controls. Shop rows
  display engine mass, density, efficiency, reload, force and speed ratios.
  First purchase installs the engine; owned engines install free. Electric is
  owned initially. Transactions require parking at the left shop, preserve
  reserve energy (excess becomes heat), and reset ownership with New game.
  Refusals explain location or funds requirements.
- B, including Shift+B, holds a stop-only brake. It cancels a travel target,
  overrides the movement autopilot, never reverses, and clears on release or
  focus loss. Installed Brake flywheel recuperates normally; without it the
  energy becomes heat. Empty-reserve braking requires no fuel.
- Trajectory computer II costs 700 cr, requires Ballistic computer and Power
  electronics, and continues through rock and powered piston contacts for up
  to three flight horizons. Preallocated buffers and the shared piston solver
  are reused; pulse energy is limited to the forecast reserve. Ground and
  collector terminate flight. Keep first-contact telemetry for autopilot
  compatibility. Terrain is held fixed: fracture and later commands make
  subsequent bounces estimates, not guarantees.
- Hire a commercial grader from the shop while parked left. One active bot
  travels left to right at 1.5 m/s, removes at most one floor-cell layer per
  column, then settles exactly once. Stored rubble value follows deposits and
  proportional cuts. Player receives 50% of collected value as credits; the
  operator retains the other half as its fee. No upfront hire charge.
- Bot body is a 0.12 m tall circular segment. Wheel/terrain sampling includes
  this solid surface, while it fits beneath the 0.2 m belly between wheels.
  It does not become permanent terrain and is cleared by New game.

## Validation
- `node --test experiments/*.test.js`: 113/113 pass.
- Added ownership/location/funds/reset and UI buy/free-install tests; B and
  Shift+B tests; empty braking recovery and exact energy balance tests.
- Added grader one-layer/one-pass/50%-payout/no-repeat/reset tests and wheel
  versus belly clearance checks.
- Added read-only tier-II piston/rock continuation tests retaining the first
  intercept and leaving live rock, rubble and world untouched.
- Updated tree affordability calibration: thirteen 100-cell loads fund the
  complete research/equipment tree including the new computer.
- JavaScript syntax checks and `git diff --check` pass.
- Browser smoke was attempted with externally installed Playwright/Chromium,
  but Chromium cannot launch: sandbox lacks `libnspr4.so`. DOM integration
  smoke tests pass; full browser visual validation remains outstanding.

## Next step
Playtest the commercial bot crossing under a moving, loaded platform and tune
its speed/fee. Then improve the tier-II fracture forecast if fixed-rock rebound
estimates diverge too much during active mining.
