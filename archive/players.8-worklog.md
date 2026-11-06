# players.8 — worklog

Plan: `players.8-plan.md`. Implemented independent research, equipment and
purchasing for every platform, owner-specific machinery and ball physics, the
per-player ballistic-computer gate, automatic competitor investment, and the
competitor's tilt/drive keepers. Updated `README.md` and `js/help.js` to describe
the resulting game.

## What was wrong

- Research and equipment were single global profiles. A rival could hold sale
  proceeds, but there was no rival purchase writer and no way for its machine to
  differ from the rig's.
- Physics, prediction and the shop read the rig's progression regardless of the
  selected platform. Engine, pulse, retention, carried mass, cooling and strike
  ball statistics therefore could not represent independent competitors.
- `predictAll` used the shared ballistic-computer unlock. The rival policy had a
  drive decision but no tilt keeper, so it could not produce the rig's level
  bounce.
- Making the ball's installed mass physical exposed one missing ledger entry:
  replacing a flying rig ball changed its energy without booking the difference.

## What was done

- `js/research.js` and `js/equipment.js`
  - Added lazy per-owner profiles with independent completion, ownership and
    measured deltas. Existing no-owner calls still address the rig; optional
    owner arguments address a competitor. New game clears all profiles.
  - Research, normal equipment, engine tiers, radiators and strike balls all use
    the owner's unlocks and purse. Owned tier swaps remain free. Test grants and
    Communism work per player without copying profiles between players.
  - Machinery mass couples to the machine being upgraded. A flying rig ball's
    mass-replacement energy is booked as imported work or heat, keeping the
    energy balance exact.
- `js/players.js`
  - Added `players.purchase()` as the sole rival debit writer, frozen rival
    ledger entries, lifetime spending and gross-sale accounting. Rival sales do
    not touch the rig ledger; `soldValue === money + spent` after automatic
    investment.
  - Added a deterministic bot build order. It buys materials, electromagnetics,
    the rival's own ballistic computer, a coil, traction and further machinery
    as settlements allow, stopping at an unaffordable step with the balance
    saved.
  - Engine force, speed and carried mass now scale each rival's actual drive.
  - Added a 20 Hz rival contact planner, 12-iteration `solveFace` tilt
    bisection, actuator-limited slew and a reflected-apex drive keeper. Manual
    tilt and drive suspend their matching keeper for the normal two-second
    override window. Policy prediction remains available independently of the
    page-overlay unlock.
  - Added short rubble sweeps during safe flight, with the real landing taking
    priority before contact. This was necessary after the level keeper began
    holding station: without deliberate sweeps a competitor could mine rubble
    but never drive its blade through it, sell, or fund its upgrades.
- `js/physics.js` and `js/ceiling.js`
  - Added owner-aware engines, force, speed, mass, pulse, retention, recovery,
    cooling, ball mass and rock damage. The contacting machine owns deck
    retention/pulse and carried mass; the ball's owner owns its strike-head
    mass, damage and rock retention. Shared balls therefore retain the rig's
    ball specification in every arrangement.
  - Capture, launch, piston and hull solves, forecasts and energy bookkeeping
    use the same owner-specific values as the live chamber.
- `js/prediction.js`
  - `predictAll` returns zero page paths until the selected profile owns the
    ballistic computer. Forecast thrust, pulse, retention, ball properties and
    tier-II state now belong to the selected machine and physical ball.
- `js/main.js`
  - SCIENCE + SHOP, prerequisites, tier selectors, funds and the live
    specification follow the selected player. Test grants cover the whole
    roster. Rival tilt/drive controls connect to their keeper overrides.
  - Registered the existing `science-title` element so the drawer names its
    owner instead of failing during refresh.
- `experiments/*.test.js`
  - Added six tests and extended existing probes for purse/profile isolation,
    real rival coil/motor/engine effects, automatic investment and accounting,
    owner-specific balls/radiators, the selected computer gate, drawer purchases,
    keeper bisection and manual overrides.
  - Updated prediction fixtures to grant the now-required computer explicitly.
    The 90-second competitor mining probe now checks both a real sale and real
    reinvestment rather than assuming all proceeds remain unspent.

## Validation

- `node --check` passed for every `js/*.js`.
- Final `node --test experiments/*.test.js`: **189 pass, 0 fail**:
  autopilot 15, balls 19, ceiling 13, commune 7, economy 3, engine 1,
  equipment 4, interface 34, physics 40, players 23, prediction 19, research 4,
  shop-services 7. Baseline at the start of this stage was 183 tests.
- The autonomous one-per-platform probe reached 90 s with 199 extracted cells,
  726.9 cr gross competitor sales and 480 cr automatically invested; the rig
  received none of those sales and its energy error remained below 1.2e-10 J.
- A staged 2000 cr rival settlement bought four research nodes and the coil,
  spent 1780 cr and saved 220 cr for the unaffordable motor. The rig remained at
  zero completed research and stock pulse.
- Keeper probe: the rival solved a piston contact to `|vx| < 0.04` while the
  untilted contact retained `|vx| > 0.5`; tilt stayed within its range and slew
  rate, the rig angle remained unchanged, and manual tilt/drive overrides held
  until released.

## Next step suggestion

- Add a selected-player transaction view for rival sale/purchase ledgers, then
  run a longer multi-rival economy soak to tune build-order timing and harvest
  sweeps. The existing MARKET / LEDGER drawer remains the rig's cargo, fuel and
  energy account.
- Run `experiments/browser-smoke.cjs` in real Chromium when a browser binary is
  available, including switching owners while the science drawer is open.
