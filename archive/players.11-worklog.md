# Optional ramps and platform pushing

## Previous-task review

The full-width workspace is isolated in `ad30d51`: it gives surplus desktop
width to cargo while bounding the chamber canvas. Keep that layout and the
existing automatic ride-over geometry; ramp installation should select the
contact rule, not duplicate the rendering or the platform pose solver.

The progression tree reserved row 2 for both the base-chassis bar and its first
research nodes. Move research nodes down one row so all four base bays remain
visible, and test actual browser bounds rather than only DOM membership.

## Changes

- Add an ungated, zero-cost Ramp item, installed for every player by default.
  Installation is per-player; its mass stays included in the stock chassis.
  Install/uninstall changes no credits, research, reserve or specification.
  New game restores ramps. Bots' investment order never changes them; an
  explicit install-all test grant can restore a removed ramp.
- Show a free Install/Uninstall action in SCIENCE + SHOP's base-chassis bar,
  including the selected player's installed state and the chamber-wide mode.
  Keep the action available at zero funds and expose its state with
  `aria-pressed`. Use four desktop bays, two on tablets and a mobile stack.
- Cache the shared ramp rule on equipment/roster changes. Every installed ramp
  is required for ride-over. Otherwise disable climbing surfaces, release rider
  locks, fold remaining plates and stop drawing an uninstalled plate.
- Resolve horizontal bumper contacts after platform drive steps and before
  ball/deck contacts. Preserve pre-step order, use actual loaded masses, share
  momentum inelastically, separate overlaps, and propagate contacts through
  chains and both wall stops. Reuse the contact buffer and body scratch fields.
- Give the held mechanical brake Coulomb friction at `1.2 × mass × gravity`,
  independent of engine, throttle, heat or reserve. Retain the unused per-step
  impulse budget to resist incoming thrust without geometric creep. Momentum
  from a fast hit can exceed that budget; friction subsequently stops the slide.
  Existing rival policy stopping remains tuned separately from the B brake.
- Keep impact heat separate from flywheel-recoverable brake work. Signed
  `platformWork` books energy exchanged with competitor machinery outside the
  rig's ledger. Correct wheel spin and deck poses after positional separation.
- Document the choice in the README and context help; archive the design plan.

## Validation

- The implementation-stage full Node suite passed **286/286** tests, including
  existing ramp deployment, riding, equipment, ball and energy regressions.
- Continuation review reran the changed interface and ramp suites: **58/58**.
  Fifteen dedicated ramp tests cover free toggles/reset, per-player isolation,
  bot investment, shared gating/folding, unequal loaded masses, reciprocal
  impacts, static brake hold, inertial slides, incoming work, flywheel recovery,
  hot/empty rigs, stronger engines, wall pins, five-platform chains, live removal
  while overlapping and fast-step ordering. Energy balance is checked throughout.
- Additional probes confirmed parked-brake separation of five coincident hulls
  at either wall and mid-chamber (under 1e-9 m residual overlap), and no creep
  under stock thrust against an unequal cargo load.
- `experiments/browser-layout.cjs` passed at 11 viewport sizes from 320 × 640 to
  5120 × 1440. At 1920 px and wider the cargo table fits without a horizontal
  scrollbar; the canvas stays capped at 1280 × 748.5 CSS px on tall desktops.
  Real clicks remove/reinstall ramps on both players without changing funds or
  the BOT switch. Four shop bays remain reachable without clipping or overlap
  at desktop, tablet and phone widths.
- The full browser smoke test passed during implementation, including the
  corrected progression-tree rows. Its preserved log reports no page errors.
- Browser tools and screenshots stay outside the repository; no runtime
  dependency or generated artifact is added. Syntax and whitespace checks pass.

## Next step

Playtest blocked bot traffic in ramp-free games before adding any yielding or
rerouting policy; the shop's ramp choice should remain entirely player-controlled.
