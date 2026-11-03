# players.5 — the machine controls are per platform, not per page

Status: implemented; see `archive/players.5-worklog.md`.

Source: the report that switching platforms works, but the chamber mouse wheel
tilts the piston drawn on *every* platform at once — evidence that the machine
controls are still page-global instead of per-platform.

## What is wrong

- **The tilt lived on the rig's world, the drawing read it for everyone.** The
  wheel, the slider and the air drag all wrote `world.pistonAngle`, and
  `drawRigMachinery` — called once per platform — painted that one angle (plus
  the rig's fuel, heat and drive light) inside every hull. One wheel notch
  therefore steered all platforms together.
- **The drive toggle was rig-only while the panel claims it belongs to the
  selected platform.** `Space`/`Q` flipped `world.drive` even when a competitor
  held the keys, and the drive button read `world.drive` back.

## Decisions

- **One accessor, any number of platforms.** `machineOf(player)` returns the
  object that holds that platform's machine state: the world for the rig (the
  physics reads the piston angle and drive there), the player object itself for
  every competitor. Nothing else branches on `kind === 'rig'` to reach controls.
- **One writer for the tilt.** `setPistonAngleOf(player, angle)` clamps to the
  same `pistonMaxAngle` physics enforces; the rig's angle goes through
  `physics.setPistonAngle`, a competitor's is stored on its own object. The
  wheel, the slider and the drag in `main.js` all route through the *active*
  player, so they can never touch another platform.
- **The instruments read their own platform's machine.** Fuel, thermometer,
  piston and drive light are drawn from `machineOf(player)`; a competitor's
  bars show its own state (full reserve, cold) instead of leaking the rig's.
- **The panel follows the selection.** `syncActiveControls` also re-reads the
  piston slider, so the switch shows the new platform's angle at once. The
  drive button shows the selected machine's drive, and `Space`/`Q` flip it there.

## Mechanics

```
players.js
  machineOf(player)        rig -> rigWorld, rival -> player
  pistonAngleOf(player)    machine.pistonAngle
  setPistonAngleOf(player, angle)   clamped; rig via physics.setPistonAngle
  createRival              + pistonAngle: 0, drive: false

main.js
  pistonDegrees()          active player's angle
  setPistonAngle(degrees)  routes to the active player (autopilot override on the rig only)
  syncActiveControls()     + syncPistonControl()
  drawRigMachinery(ctx, player)  instruments from machineOf(player)
  toggleDrive()            flips the active machine's drive
```

## Files

- `js/players.js` — `machineOf` / `pistonAngleOf` / `setPistonAngleOf`, rival
  machine fields, API exports.
- `js/main.js` — tilt and drive writers/readers routed through the active
  player, per-platform machinery drawing, piston slider synced on a switch.
- `js/help.js` — the keys paragraph names the piston and drive as
  selected-platform controls.
- `experiments/players.test.js`, `experiments/interface.test.js` — per-platform
  tilt isolation tests, including a three-player roster.

## Acceptance

- With a competitor selected, one wheel notch tilts only that competitor's
  piston; the rig's angle and the other competitors' angles do not move.
- The piston slider shows the selected platform's angle immediately after a
  switch, and `Space`/`Q` flips the selected machine's drive.
- Adding a third or fourth platform needs no new wiring: `machineOf` covers any
  player, and the tests prove it with a three-player roster.
- The full suite passes.
