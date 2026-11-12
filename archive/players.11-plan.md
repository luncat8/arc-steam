# Optional ramps and platform pushing

## Behaviour

- Every player starts with the stock Ramp installed. It is an ungated, zero-cost
  base-chassis shop item, removable and reinstallable for the selected player.
  Its mass is included in the stock chassis; toggling it changes no machinery
  specification, reserve, credits or research.
- Bots never change ramp installation. New game restores every player's ramp;
  the explicit install-all test mode may also restore a removed ramp.
- Ride-over is a chamber-wide rule: it is enabled only while every player has
  its ramp installed. In that mode the existing layered crossings, advance
  deployment and automatic folding remain unchanged.
- If any player removes a ramp, all ramps stop providing climbing surfaces and
  installed plates fold away. The shop explains both the selected installation
  and the shared collision mode.

## Mechanics

- Without ramps, chassis use horizontal bumpers one platform width apart. Solve
  contacts after every platform's drive step and before ball/deck contacts.
  Preserve the pre-step left/right order, resolve initial overlap, and respect
  both chamber walls and multi-platform chains.
- Contacts are inelastic: conserve horizontal momentum between freely moving
  platforms and dissipate the lost kinetic energy. Use each platform's actual
  mass, including its cargo, machinery and held ball.
- A held brake supplies Coulomb friction, proportional to supported mass and
  gravity and independent of engine power, throttle, reserve or temperature.
  Stock full-throttle engine force is below stock brake friction; strong
  upgrades may exceed it.
- Retain the unspent brake impulse after stopping a platform. That same budget
  resists incoming contact impulses, so a parked brake does not creep under
  ordinary thrust. A fast impact exceeds the per-step budget and moves the
  braked platform until friction dissipates its momentum.
- Keep collision heat distinct from recoverable brake work. Track signed work
  exchanged with competitors outside the rig's energy ledger. Position
  correction must not create kinetic energy, and corrected deck poses and
  wheel spin must be ready before balls are advanced.
- Reuse body fields and contact buffers in fixed-step solves; no per-step
  allocation or bot-only ramp override.

## Validation

- Equipment/default/reset, free repeated toggles, player isolation, test grants
  and bots preserving both installed and removed ramp choices.
- Shop wiring, enabled Remove/Install actions, correct selected-player state,
  chamber-wide mode text, and desktop/mobile drawer layout.
- Existing automatic ramp crossing/deployment regressions.
- Momentum and energy accounting for unbraked, unequal-mass and reciprocal
  collisions; brakes holding against ordinary thrust and sliding under impact;
  empty/hot machines, stronger engines, wall pins and multi-platform chains.
- Full Node suite, focused real-browser layout/shop checks and syntax/diff checks.
